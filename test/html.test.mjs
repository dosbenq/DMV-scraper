import test from "node:test";
import assert from "node:assert/strict";

import { extractStep } from "../src/lib/html.mjs";

test("extractStep parses title, inputs, and buttons", () => {
  const html = `
    <html>
      <body>
        <h1>Welcome</h1>
        <form action="/submit" method="post">
          <input type="hidden" name="token" value="abc" />
          <button id="go">Next</button>
        </form>
      </body>
    </html>
  `;

  const step = extractStep(html);
  assert.equal(step.title, "Welcome");
  assert.equal(step.form.action, "/submit");
  assert.equal(step.inputs[0].name, "token");
  assert.equal(step.buttons[0].text, "Next");
});
