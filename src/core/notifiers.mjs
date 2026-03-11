import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DEFAULT_ALERT_EMAIL } from "./defaults.mjs";

const execFileAsync = promisify(execFile);

export class ConsoleNotifier {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.channel = "generic";
  }

  async send(event) {
    if (!this.enabled) {
      return;
    }
    console.log(JSON.stringify({ type: "notification", event }, null, 2));
  }
}

import notifier from "node-notifier";
import { spawn } from "node:child_process";

export class SystemNotificationNotifier {
  constructor(config = {}) {
    this.enabled = config.enabled ?? true;
    this.channel = "generic";
  }

  async send(event) {
    if (!this.enabled || process.platform !== "darwin") {
      return;
    }

    try {
      if (event.alertType === "test-email") {
        notifier.notify({
          title: "NC DMV Monitor",
          message: "Desktop notification test successful!",
          sound: true,
          wait: true
        });
        
        notifier.on('click', function (notifierObject, options, event) {
          spawn("open", ["http://localhost:3002"]);
        });
        return;
      }

      if (event.alertType === "consecutive-sequence" && event.sequence) {
        const { sequence } = event;
        notifier.notify({
          title: "NC DMV Slots Found",
          message: `${sequence.slotCount} consecutive slots found at ${sequence.officeName}`,
          sound: true,
          wait: true,
          open: sequence.bookingUrl
        });
        return;
      }

      const { slot } = event;
      notifier.notify({
        title: "NC DMV Slot Found",
        message: `New slot at ${slot.officeName} for ${slot.localStart}`,
        sound: true,
        wait: true,
        open: slot.bookingUrl
      });
    } catch (err) {
      console.error("Failed to send system notification:", err);
    }
  }
}

export class AppleMailNotifier {
  constructor(config = {}) {
    this.enabled = Boolean(config.enabled);
    this.channel = "email";
  }

  async send(event) {
    if (!this.enabled) {
      return;
    }

    if (process.platform !== "darwin") {
      throw new Error("Apple Mail email delivery is supported only on macOS");
    }

    const recipient = event.email || DEFAULT_ALERT_EMAIL;
    const subject = buildEmailSubject(event);
    const body = buildPlainTextEmail(event);

    const script = [
      "on run argv",
      "set recipientAddress to item 1 of argv",
      "set subjectLine to item 2 of argv",
      "set messageBody to item 3 of argv",
      'tell application "Mail"',
      "set outgoingMessage to make new outgoing message with properties {subject:subjectLine, content:messageBody, visible:false}",
      "tell outgoingMessage",
      "make new to recipient at end of to recipients with properties {address:recipientAddress}",
      "end tell",
      "send outgoingMessage",
      "end tell",
      "end run"
    ];

    await execFileAsync("osascript", [
      ...script.flatMap((line) => ["-e", line]),
      recipient,
      subject,
      body
    ]);
  }
}

export class ResendEmailNotifier {
  constructor(config = {}) {
    this.enabled = Boolean(config.enabled);
    this.channel = "email";
    this.apiKey = process.env[config.apiKeyEnv ?? "RESEND_API_KEY"];
    this.from = config.from;
  }

  async send(event) {
    if (!this.enabled) {
      return;
    }

    if (!this.apiKey || !this.from) {
      throw new Error("Resend notifier is enabled but credentials are incomplete");
    }

    const recipient = event.email || DEFAULT_ALERT_EMAIL;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: this.from,
        to: [recipient],
        subject: buildEmailSubject(event),
        html: buildEmailHtml(event)
      })
    });
  }
}

export class WebhookNotifier {
  constructor(config = {}) {
    this.enabled = Boolean(config.enabled);
    this.channel = "generic";
    this.url = process.env[config.urlEnv ?? "APPOINTMENT_WEBHOOK_URL"];
  }

  async send(event) {
    if (!this.enabled) {
      return;
    }

    if (!this.url) {
      throw new Error("Webhook notifier is enabled but no webhook URL env var is set");
    }

    await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event)
    });
  }
}

export function createNotifierFanout(config = {}) {
  return [
    new ConsoleNotifier(config.console?.enabled ?? true),
    new SystemNotificationNotifier(config.systemNotification),
    new AppleMailNotifier(config.appleMail),
    new ResendEmailNotifier(config.resend),
    new WebhookNotifier(config.webhook)
  ];
}

export async function sendTestEmail(notifiers, watcher, recipient = DEFAULT_ALERT_EMAIL) {
  const emailNotifiers = (notifiers ?? []).filter((notifier) => notifier.channel === "email");
  const event = {
    alertType: "test-email",
    watcher: watcher ?? { id: "test-email" },
    email: recipient
  };
  const outcomes = await Promise.allSettled(emailNotifiers.map((notifier) => notifier.send(event)));
  const failures = outcomes.filter((outcome) => outcome.status === "rejected");

  return {
    attempted: emailNotifiers.length,
    failures
  };
}

function buildEmailHtml(event) {
  if (event.alertType === "test-email") {
    return [
      "<p>This is a test email from the NC DMV appointment monitor.</p>",
      "<p>Your Mail-app email notifier is configured and callable from the app.</p>"
    ].join("");
  }

  if (event.alertType === "consecutive-sequence" && event.sequence) {
    return buildSequenceEmailHtml(event);
  }

  if (event.alertType === "office-summary") {
    return buildOfficeSummaryEmailHtml(event);
  }

  const { slot, watcher } = event;
  return [
    `<p>New NC DMV appointment found for watcher <strong>${watcher.id}</strong>.</p>`,
    "<ul>",
    `<li>Office: ${slot.officeName}</li>`,
    `<li>Address: ${slot.officeAddress || "Unknown"}</li>`,
    `<li>Start: ${slot.localStart}</li>`,
    `<li>Distance: ${slot.distanceMiles != null ? `${slot.distanceMiles.toFixed(1)} miles` : "Unknown"}</li>`,
    `<li>Booking URL: <a href="${slot.bookingUrl}">${slot.bookingUrl}</a></li>`,
    "</ul>"
  ].join("");
}

function buildPlainTextEmail(event) {
  if (event.alertType === "test-email") {
    return [
      "This is a test email from the NC DMV appointment monitor.",
      "",
      "If you received this, Mail-app delivery is working from this Mac."
    ].join("\n");
  }

  if (event.alertType === "consecutive-sequence" && event.sequence) {
    return buildSequencePlainTextEmail(event);
  }

  if (event.alertType === "office-summary") {
    return buildOfficeSummaryPlainTextEmail(event);
  }

  const { slot, watcher } = event;
  return [
    `New NC DMV appointment found for watcher ${watcher.id}.`,
    "",
    `Office: ${slot.officeName}`,
    `Address: ${slot.officeAddress || "Unknown"}`,
    `Start: ${slot.localStart}`,
    `Distance: ${slot.distanceMiles != null ? `${slot.distanceMiles.toFixed(1)} miles` : "Unknown"}`,
    `Booking URL: ${slot.bookingUrl}`
  ].join("\n");
}

function buildEmailSubject(event) {
  if (event.alertType === "test-email") {
    return "NC DMV monitor test email";
  }

  if (event.alertType === "consecutive-sequence" && event.sequence) {
    return `NC DMV: ${event.sequence.slotCount} consecutive openings at ${event.sequence.officeName}`;
  }

  if (event.alertType === "office-summary") {
    const totalSlots = event.sequences.reduce((sum, seq) => sum + seq.slotCount, 0);
    return `NC DMV: ${totalSlots} openings found at ${event.officeName}`;
  }

  return `New NC DMV appointment: ${event.slot.officeName} at ${event.slot.localStart}`;
}

function buildSequenceEmailHtml(event) {
  const { sequence, watcher, rule } = event;
  const items = (sequence.slots ?? [])
    .map((slot) => `<li>${slot.localStart}${slot.distanceMiles != null ? ` (${slot.distanceMiles.toFixed(1)} miles)` : ""}</li>`)
    .join("");

  return [
    `<p>Consecutive NC DMV openings found for watcher <strong>${watcher.id}</strong>.</p>`,
    "<ul>",
    `<li>Office: ${sequence.officeName}</li>`,
    `<li>Address: ${sequence.officeAddress || "Unknown"}</li>`,
    `<li>Count: ${sequence.slotCount} consecutive slots</li>`,
    `<li>Rule: ${rule?.gapMinutes ?? 15} minute gaps within ${rule?.radiusMiles ?? 25} miles</li>`,
    `<li>Booking URL: <a href="${sequence.bookingUrl}">${sequence.bookingUrl}</a></li>`,
    "</ul>",
    "<p>Times:</p>",
    `<ul>${items}</ul>`
  ].join("");
}

function buildSequencePlainTextEmail(event) {
  const { sequence, watcher, rule } = event;
  return [
    `Consecutive NC DMV openings found for watcher ${watcher.id}.`,
    "",
    `Office: ${sequence.officeName}`,
    `Address: ${sequence.officeAddress || "Unknown"}`,
    `Count: ${sequence.slotCount} consecutive slots`,
    `Rule: ${rule?.gapMinutes ?? 15} minute gaps within ${rule?.radiusMiles ?? 25} miles`,
    ...sequence.slots.map((slot) => `Time: ${slot.localStart}${slot.distanceMiles != null ? ` (${slot.distanceMiles.toFixed(1)} miles)` : ""}`),
    `Booking URL: ${sequence.bookingUrl}`
  ].join("\n");
}

function buildOfficeSummaryEmailHtml(event) {
  const { sequences, officeName, watcher } = event;
  const officeAddress = sequences[0]?.officeAddress || "Unknown";
  const bookingUrl = sequences[0]?.bookingUrl || "";

  const sequenceHtml = sequences
    .map((seq) => {
      const slotsHtml = seq.slots
        .map((slot) => `<li>${slot.localStart}</li>`)
        .join("");
      return `
      <div style="margin-bottom: 15px; padding: 10px; border: 1px solid #eee; border-radius: 4px;">
        <strong>Sequence of ${seq.slotCount} slots:</strong>
        <ul style="margin: 5px 0;">${slotsHtml}</ul>
      </div>`;
    })
    .join("");

  return [
    `<p>New NC DMV openings found at <strong>${officeName}</strong> for watcher <strong>${watcher.id}</strong>.</p>`,
    "<div style='margin-bottom: 20px;'>",
    `<strong>Office:</strong> ${officeName}<br>`,
    `<strong>Address:</strong> ${officeAddress}<br>`,
    `<strong>Booking URL:</strong> <a href="${bookingUrl}">${bookingUrl}</a>`,
    "</div>",
    "<h3>Available Times:</h3>",
    sequenceHtml
  ].join("");
}

function buildOfficeSummaryPlainTextEmail(event) {
  const { sequences, officeName, watcher } = event;
  const officeAddress = sequences[0]?.officeAddress || "Unknown";
  const bookingUrl = sequences[0]?.bookingUrl || "";

  const sequenceText = sequences
    .map((seq) => {
      const times = seq.slots.map((slot) => `  - ${slot.localStart}`).join("\n");
      return `Sequence of ${seq.slotCount} slots:\n${times}`;
    })
    .join("\n\n");

  return [
    `New NC DMV openings found at ${officeName} for watcher ${watcher.id}.`,
    "",
    `Office: ${officeName}`,
    `Address: ${officeAddress}`,
    `Booking URL: ${bookingUrl}`,
    "",
    "Available Times:",
    "",
    sequenceText
  ].join("\n");
}
