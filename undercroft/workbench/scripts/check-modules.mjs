#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const defaultTargets = [
  "../js/pages/template.js",
  "../js/pages/system.js",
  "../js/lib/root-inserter.js",
  "../js/lib/json-preview.js",
  "../js/lib/editor-canvas.js",
];

const targets = (args.length ? args : defaultTargets).map((target) =>
  resolve(__dirname, target)
);

let exitCode = 0;

for (const target of targets) {
  const result = spawnSync(process.execPath, ["--check", target], {
    stdio: "inherit",
  });
  if (result.status && result.status !== 0) {
    exitCode = result.status;
  }
}

process.exit(exitCode);
