const ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " "
};

export function decodeHtml(value) {
  if (!value) {
    return "";
  }

  return value
    .replace(/&(amp|lt|gt|quot|nbsp);|&#39;/g, (entity) => ENTITY_MAP[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(Number(codePoint)));
}

export function stripTags(value) {
  return decodeHtml(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTagText(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = html.match(regex);
  return match ? stripTags(match[1]) : "";
}

export function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([:@A-Za-z0-9_\-\.\[\]]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeHtml(match[3] ?? match[4] ?? "");
  }
  return attributes;
}

export function extractInputs(html) {
  const inputs = [];
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const raw = match[0];
    const attributes = parseAttributes(raw);
    inputs.push({
      raw,
      attributes,
      type: (attributes.type ?? "text").toLowerCase(),
      name: attributes.name ?? "",
      value: attributes.value ?? "",
      id: attributes.id ?? ""
    });
  }
  return inputs;
}

export function extractButtons(html) {
  const buttons = [];

  for (const match of html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)) {
    const raw = match[0];
    const openTag = raw.match(/<button\b[^>]*>/i)?.[0] ?? "<button>";
    const attributes = parseAttributes(openTag);
    buttons.push({
      raw,
      attributes,
      id: attributes.id ?? "",
      name: attributes.name ?? "",
      value: attributes.value ?? stripTags(raw),
      text: stripTags(raw),
      type: (attributes.type ?? "submit").toLowerCase()
    });
  }

  for (const input of extractInputs(html)) {
    if (input.type === "submit" || input.type === "button") {
      buttons.push({
        raw: input.raw,
        attributes: input.attributes,
        id: input.id,
        name: input.name,
        value: input.value,
        text: input.value,
        type: input.type
      });
    }
  }

  return buttons;
}

export function extractForm(html) {
  const formMatch = html.match(/<form\b[^>]*action=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) {
    return null;
  }

  return {
    action: decodeHtml(formMatch[2] ?? formMatch[3] ?? ""),
    html: formMatch[0],
    innerHtml: formMatch[4]
  };
}

export function extractStep(html) {
  const title = extractTagText(html, "h1") || extractTagText(html, "h2") || "Untitled step";
  const form = extractForm(html);
  const stepControls = [...html.matchAll(/<div[^>]*class="[^"]*step-controls[^"]*"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => ({
    id: match[1],
    text: stripTags(match[2]).slice(0, 4000)
  }));

  return {
    title,
    text: stripTags(form?.innerHtml ?? html),
    form,
    inputs: extractInputs(form?.innerHtml ?? html),
    buttons: extractButtons(form?.innerHtml ?? html),
    stepControls,
    rawHtml: html
  };
}

export function absoluteUrl(baseUrl, maybeRelative) {
  return new URL(maybeRelative, baseUrl).toString();
}
