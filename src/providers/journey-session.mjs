import { absoluteUrl, extractInputs, extractStep } from "../lib/html.mjs";

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function mergeSetCookie(cookieJar, response) {
  const rawCookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of rawCookies) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    cookieJar.set(name, value);
  }
}

export class JourneySession {
  constructor({ baseUrl, path }) {
    this.baseUrl = baseUrl;
    this.path = path;
    this.cookieJar = new Map();
    this.history = [];
    this.currentUrl = absoluteUrl(baseUrl, path);
    this.currentStep = null;
  }

  async get(url = this.currentUrl) {
    const response = await fetch(url, {
      headers: this.cookieJar.size > 0 ? { cookie: cookieHeader(this.cookieJar) } : {}
    });
    const html = await response.text();
    mergeSetCookie(this.cookieJar, response);
    this.currentUrl = url;
    this.currentStep = extractStep(html);
    this.history.push({ method: "GET", url, title: this.currentStep.title });
    return this.currentStep;
  }

  async submit({ overrides = {}, actionOverride, includeSubmitValue } = {}) {
    if (!this.currentStep?.form) {
      throw new Error("No form is available on the current step");
    }

    const params = new URLSearchParams();
    for (const input of this.currentStep.inputs) {
      if (!input.name || input.type === "submit" || input.type === "button") {
        continue;
      }
      params.append(input.name, overrides[input.name] ?? input.value ?? "");
    }

    if (includeSubmitValue) {
      params.append("next-button", includeSubmitValue);
    }

    const targetAction = actionOverride ?? this.currentStep.form.action ?? this.currentUrl;
    const url = absoluteUrl(this.baseUrl, targetAction);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(this.cookieJar.size > 0 ? { cookie: cookieHeader(this.cookieJar) } : {})
      },
      body: params.toString()
    });
    const html = await response.text();
    mergeSetCookie(this.cookieJar, response);
    this.currentUrl = url;
    this.currentStep = extractStep(html);
    this.history.push({ method: "POST", url, title: this.currentStep.title });
    return this.currentStep;
  }

  async amendStep({ sourceControlId, targetControlId, overrides = {} }) {
    const params = new URLSearchParams();
    for (const input of this.currentStep.inputs) {
      if (!input.name || input.type === "submit" || input.type === "button") {
        continue;
      }
      params.append(input.name, overrides[input.name] ?? input.value ?? "");
    }

    const url = absoluteUrl(
      this.baseUrl,
      `/Webapp/Appointment/AmendStep?stepControlTriggerId=${encodeURIComponent(sourceControlId)}&targetStepControlId=${encodeURIComponent(targetControlId)}`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(this.cookieJar.size > 0 ? { cookie: cookieHeader(this.cookieJar) } : {})
      },
      body: params.toString()
    });
    const html = await response.text();
    mergeSetCookie(this.cookieJar, response);
    this.#mergeInputValues(html);
    this.history.push({ method: "POST", url, title: "amend-step" });
    return html;
  }

  #mergeInputValues(html) {
    const replacements = new Map();
    for (const input of extractInputs(html)) {
      if (input.name) {
        replacements.set(input.name, input.value ?? "");
      }
    }

    this.currentStep.inputs = this.currentStep.inputs.map((input) =>
      replacements.has(input.name)
        ? { ...input, value: replacements.get(input.name) }
        : input
    );
  }

  summarizeCurrentStep() {
    return {
      title: this.currentStep?.title ?? "",
      buttons: this.currentStep?.buttons.map((button) => button.text || button.value).filter(Boolean) ?? [],
      inputs: this.currentStep?.inputs.map((input) => ({
        name: input.name,
        type: input.type,
        id: input.id,
        valuePreview: String(input.value ?? "").slice(0, 80)
      })) ?? [],
      text: this.currentStep?.text.slice(0, 1500) ?? ""
    };
  }
}
