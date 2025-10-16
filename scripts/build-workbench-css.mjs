#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const inputFile = path.resolve('undercroft/workbench/css/tailwind.css');
const outputFile = path.resolve('undercroft/workbench/css/generated.css');

const isWindows = process.platform === 'win32';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';
const args = ['tailwindcss', '-i', inputFile, '-o', outputFile, '--minify'];

const result = spawnSync(npxCommand, args, { stdio: 'inherit' });

if (result.error) {
  console.error('Failed to start Tailwind CLI via npx. Did you run npm install?');
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`Tailwind CLI exited with code ${result.status}.`);
  process.exit(result.status ?? 1);
}
