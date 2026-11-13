import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A small, repeatable contrast check for the dark palette. It reads the tokens
// the app actually ships rather than a copy, so changing a colour without
// rechecking AA fails the suite. Disabled and decorative text is not included.
const tokens = Object.fromEntries(
  [...readFileSync(new URL("../css/tokens.css", import.meta.url), "utf8")
    .matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
    .map(([, name, hex]) => [name, hex.toLowerCase()]),
);

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

const backgrounds = ["bg", "surface", "surface-raised"];
const foregrounds = [
  "text",
  "text-muted",
  "accent",
  "danger",
  "state-vacant",
  "state-occupied",
  "state-dirty",
  "state-cleaning",
  "state-oos",
];

test("palette tokens are present", () => {
  for (const name of [
    ...backgrounds,
    ...foregrounds,
    "state-oos",
  ]) {
    assert.match(tokens[name] ?? "", /^#[0-9a-f]{6}$/, `--${name}`);
  }
});

test("normal text keeps WCAG AA contrast on every surface", () => {
  for (const foreground of foregrounds) {
    for (const background of backgrounds) {
      const ratio = contrast(tokens[foreground], tokens[background]);
      assert.ok(
        ratio >= 4.5,
        `${foreground} on ${background} is ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test("button label colours keep WCAG AA contrast", () => {
  assert.ok(contrast("#0a1626", tokens.accent) >= 4.5, "primary button");
  assert.ok(contrast("#1a0b0a", tokens.danger) >= 4.5, "danger button");
});
