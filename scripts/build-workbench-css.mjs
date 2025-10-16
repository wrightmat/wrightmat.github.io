#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const inputFile = path.resolve('undercroft/workbench/css/tailwind.css');
const outputFile = path.resolve('undercroft/workbench/css/generated.css');
const tailwindBin = path.resolve('node_modules/.bin/tailwindcss');

if (existsSync(tailwindBin)) {
  const result = spawnSync(tailwindBin, ['-i', inputFile, '-o', outputFile], { stdio: 'inherit' });
  if (result.status === 0) {
    process.exit(0);
  }
  console.warn(`Tailwind CLI exited with code ${result.status}; using fallback generator.`);
} else {
  console.warn('Tailwind CLI not found; using fallback generator.');
}

const COLORS = {
  'white': [255, 255, 255],
  'slate-50': [248, 250, 252],
  'slate-100': [241, 245, 249],
  'slate-200': [226, 232, 240],
  'slate-300': [203, 213, 225],
  'slate-400': [148, 163, 184],
  'slate-500': [100, 116, 139],
  'slate-600': [71, 85, 105],
  'slate-700': [51, 65, 85],
  'slate-800': [30, 41, 59],
  'slate-900': [15, 23, 42],
  'slate-950': [2, 6, 23],
  'sky-300': [125, 211, 252],
  'sky-400': [56, 189, 248],
  'sky-500': [14, 165, 233],
  'sky-600': [2, 132, 199],
  'emerald-200': [167, 243, 208],
  'emerald-400': [52, 211, 153],
  'emerald-500': [16, 185, 129],
  'emerald-700': [4, 120, 87],
  'rose-200': [254, 205, 211],
  'rose-400': [251, 113, 133],
  'rose-500': [244, 63, 94],
  'rose-700': [190, 18, 60],
};

const SPACING = {
  '0': 0,
  'px': 1 / 16,
  '0.5': 0.125,
  '1': 0.25,
  '1.5': 0.375,
  '2': 0.5,
  '2.5': 0.625,
  '3': 0.75,
  '3.5': 0.875,
  '4': 1,
  '5': 1.25,
  '6': 1.5,
  '8': 2,
  '10': 2.5,
  '12': 3,
  '18': 4.5,
  '20': 5,
  '22': 5.5,
  '48': 12,
  '72': 18,
  '80': 20,
};

const FONT_SIZES = {
  'text-xs': ['0.75rem', '1rem'],
  'text-sm': ['0.875rem', '1.25rem'],
  'text-base': ['1rem', '1.5rem'],
  'text-lg': ['1.125rem', '1.75rem'],
  'text-xl': ['1.25rem', '1.75rem'],
  'text-2xl': ['1.5rem', '2rem'],
};

const FONT_WEIGHTS = {
  'font-normal': 400,
  'font-medium': 500,
  'font-semibold': 600,
  'font-bold': 700,
};

const LETTER_SPACING = {
  'tracking-tight': '-0.025em',
  'tracking-wide': '0.025em',
};

const BORDER_RADIUS = {
  'rounded': '0.25rem',
  'rounded-md': '0.375rem',
  'rounded-lg': '0.5rem',
  'rounded-xl': '0.75rem',
  'rounded-2xl': '1rem',
  'rounded-full': '9999px',
};

const SHADOWS = {
  'shadow-sm': '0 1px 2px rgba(15, 23, 42, 0.08)',
  'hover:shadow-lg': '0 20px 45px rgba(15, 23, 42, 0.16)',
};

const MAX_WIDTH = {
  'max-w-5xl': '64rem',
  'max-w-6xl': '72rem',
};

const GRID_COLS = {
  'grid-cols-1': 1,
  'grid-cols-2': 2,
  'grid-cols-3': 3,
  'grid-cols-4': 4,
  'grid-cols-5': 5,
  'grid-cols-6': 6,
};

const MEDIA = {
  'sm': '640px',
  'md': '768px',
  'lg': '1024px',
  'xl': '1280px',
};

const missingTokens = new Set();

const classes = collectClassNames(path.resolve('undercroft/workbench'));
const css = buildCss(Array.from(classes).sort());
writeFileSync(outputFile, css);
console.log(`Generated fallback CSS for ${classes.size} class tokens.`);
if (missingTokens.size) {
  console.warn('Missing token mappings:', Array.from(missingTokens).join(', '));
}

function collectClassNames(rootDir) {
  const result = new Set();
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
      continue;
    }
    if (!current.endsWith('.html') && !current.endsWith('.js')) continue;
    const text = readFileSync(current, 'utf8');
    if (current.endsWith('.html')) {
      const pattern = /class="([^"]+)"/g;
      let match;
      while ((match = pattern.exec(text))) {
        match[1]
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .filter(Boolean)
          .forEach((token) => result.add(token));
      }
    }
    if (current.endsWith('.js')) {
      const pattern = /"([^"\n]*?)"/g;
      const interesting = ['bg-', 'text-', 'border-', 'shadow', 'grid', 'flex', 'gap', 'px', 'py', 'rounded', 'dark:', 'sm:', 'md:', 'lg:', 'xl:', 'focus', 'hover', 'space-y', 'data-[', 'ring', 'w-', 'h-', 'min-h', 'max-w', 'tracking', 'uppercase', 'font', 'transition', 'justify', 'items', 'overflow', 'pointer-events', 'sr-only', 'inset', 'bottom', 'backdrop'];
      let match;
      while ((match = pattern.exec(text))) {
        const value = match[1];
        if (!value.includes(' ')) continue;
        if (!interesting.some((token) => value.includes(token))) continue;
        value
          .split(' ')
          .filter(Boolean)
          .forEach((token) => result.add(token));
      }
    }
  }
  return result;
}

function buildCss(classList) {
  const lines = [];
  lines.push('/* Fallback stylesheet for Workbench. Prefer rebuilding with Tailwind CLI when available. */');
  lines.push(...preflight());
  for (const token of classList) {
    const rule = generateRule(token);
    if (rule) {
      lines.push(rule);
    }
  }
  return lines.join('\n') + '\n';
}

function preflight() {
  return [
    '',
    '*, ::before, ::after {',
    '  box-sizing: border-box;',
    '  border-width: 0;',
    '  border-style: solid;',
    '  border-color: currentColor;',
    '}',
    'html {',
    '  line-height: 1.5;',
    '  -webkit-text-size-adjust: 100%;',
    '  font-family: Inter, system-ui, "Segoe UI", sans-serif;',
    '}',
    'body {',
    '  margin: 0;',
    '  min-height: 100vh;',
    '  background-color: #f8fafc;',
    '  color: #0f172a;',
    '}',
    'button, input, textarea, select {',
    '  font: inherit;',
    '}',
    'a {',
    '  color: inherit;',
    '  text-decoration: inherit;',
    '}',
    ''
  ];
}

function escapeClass(token) {
  return token.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function colorValue(name) {
  if (name.includes('/')) {
    const [base, alpha] = name.split('/');
    const rgb = COLORS[base];
    if (!rgb) return null;
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${parseInt(alpha, 10) / 100})`;
  }
  const rgb = COLORS[name];
  if (!rgb) return null;
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function spacingValue(token) {
  if (token.endsWith('rem]')) {
    return `${token.slice(0, -4)}rem`;
  }
  if (token.endsWith('px]')) {
    return `${token.slice(0, -3)}px`;
  }
  if (token === 'full') {
    return '100%';
  }
  const value = SPACING[token];
  if (value === undefined) return null;
  if (value === 1 / 16) return '1px';
  return `${value}rem`;
}

function applyPrefixes(prefixes, baseSelector) {
  let selectors = [baseSelector];
  const medias = [];
  for (const prefix of prefixes) {
    if (MEDIA[prefix]) {
      medias.push(prefix);
      continue;
    }
    if (prefix === 'hover') {
      selectors = selectors.map((sel) => `${sel}:hover`);
    } else if (prefix === 'focus') {
      selectors = selectors.map((sel) => `${sel}:focus`);
    } else if (prefix === 'focus-visible') {
      selectors = selectors.map((sel) => `${sel}:focus-visible`);
    } else if (prefix === 'group-hover') {
      selectors = selectors.map((sel) => `.group:hover ${sel}`);
    } else if (prefix === 'dark') {
      selectors = selectors.flatMap((sel) => [
        `html.dark ${sel}`,
        `html[data-theme="dark"] ${sel}`,
      ]);
    } else if (prefix.startsWith('data-[')) {
      const attribute = prefix.slice('data-['.length, -1);
      selectors = selectors.map((sel) => `[data-${attribute}]${sel}`);
    }
  }
  return { selectors, medias };
}

function wrapWithMedia(selectors, declarations, medias) {
  const block = `${selectors.join(', ')} {\n  ${declarations.join('\n  ')}\n}`;
  if (!medias.length) {
    return block;
  }
  let wrapped = block;
  for (let i = medias.length - 1; i >= 0; i -= 1) {
    wrapped = `@media (min-width: ${MEDIA[medias[i]]}) {\n${indent(wrapped)}\n}`;
  }
  return wrapped;
}

function indent(text, depth = 1) {
  const pad = '  '.repeat(depth);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

function generateRule(token) {
  if (token.startsWith('space-y-')) {
    const value = spacingValue(token.slice('space-y-'.length));
    if (!value) return null;
    const selector = `.${escapeClass(token)} > :not([hidden]) ~ :not([hidden])`;
    return `${selector} {\n  margin-top: ${value};\n}`;
  }

  const segments = token.split(':');
  const baseToken = segments.pop();
  const declarations = baseDeclarations(baseToken);
  if (!declarations) {
    missingTokens.add(baseToken);
    return null;
  }
  if (declarations.length === 0) {
    return null;
  }
  const selector = `.${escapeClass(token)}`;
  const { selectors, medias } = applyPrefixes(segments, selector);
  return wrapWithMedia(selectors, declarations, medias);
}

function baseDeclarations(token) {
  if (FONT_SIZES[token]) {
    const [size, lineHeight] = FONT_SIZES[token];
    return [`font-size: ${size};`, `line-height: ${lineHeight};`];
  }
  if (FONT_WEIGHTS[token]) {
    return [`font-weight: ${FONT_WEIGHTS[token]};`];
  }
  if (token.startsWith('bg-')) {
    const color = colorValue(token.slice(3));
    if (color) {
      return [`background-color: ${color};`];
    }
  }
  if (token.startsWith('text-')) {
    const color = colorValue(token.slice(5));
    if (color) {
      return [`color: ${color};`];
    }
  }
  if (token.startsWith('border-') && !['border-b', 'border-l', 'border-r', 'border-dashed'].includes(token)) {
    const color = colorValue(token.slice(7));
    if (color) {
      return [`border-color: ${color};`];
    }
  }
  if (token.startsWith('p-')) {
    const value = spacingValue(token.slice(2));
    if (!value) return null;
    return [`padding: ${value};`];
  }
  if (token.startsWith('px-')) {
    const value = spacingValue(token.slice(3));
    if (!value) return null;
    return [`padding-left: ${value};`, `padding-right: ${value};`];
  }
  if (token.startsWith('py-')) {
    const value = spacingValue(token.slice(3));
    if (!value) return null;
    return [`padding-top: ${value};`, `padding-bottom: ${value};`];
  }
  if (token.startsWith('mt-')) {
    const value = spacingValue(token.slice(3));
    if (!value) return null;
    return [`margin-top: ${value};`];
  }
  if (token.startsWith('mb-')) {
    const value = spacingValue(token.slice(3));
    if (!value) return null;
    return [`margin-bottom: ${value};`];
  }
  if (token === 'mx-auto') return ['margin-left: auto;', 'margin-right: auto;'];
  if (token === 'ml-auto') return ['margin-left: auto;'];
  if (token === 'min-h-screen') return ['min-height: 100vh;'];
  if (token.startsWith('min-h-[')) {
    const value = spacingValue(token.slice('min-h-['.length));
    if (!value) return null;
    return [`min-height: ${value};`];
  }
  if (token.startsWith('max-w-')) {
    const value = MAX_WIDTH[token];
    if (!value) return null;
    return [`max-width: ${value};`];
  }
  if (token === 'w-full') return ['width: 100%;'];
  if (token === 'h-full') return ['height: 100%;'];
  if (token.startsWith('w-')) {
    const value = spacingValue(token.slice(2));
    if (!value) return null;
    return [`width: ${value};`];
  }
  if (token.startsWith('h-')) {
    const value = spacingValue(token.slice(2));
    if (!value) return null;
    return [`height: ${value};`];
  }
  if (token === 'flex') return ['display: flex;'];
  if (token === 'inline-flex') return ['display: inline-flex;'];
  if (token === 'grid') return ['display: grid;'];
  if (token === 'block') return ['display: block;'];
  if (token === 'hidden') return ['display: none;'];
  if (token === 'fixed') return ['position: fixed;'];
  if (token === 'backdrop-blur') return ['backdrop-filter: blur(18px);'];
  if (token === 'items-center') return ['align-items: center;'];
  if (token === 'items-end') return ['align-items: flex-end;'];
  if (token === 'justify-between') return ['justify-content: space-between;'];
  if (token === 'justify-center') return ['justify-content: center;'];
  if (token === 'flex-col') return ['flex-direction: column;'];
  if (token === 'flex-wrap') return ['flex-wrap: wrap;'];
  if (token === 'flex-1') return ['flex: 1 1 0%;'];
  if (token === 'flex-shrink-0') return ['flex-shrink: 0;'];
  if (token === 'overflow-hidden') return ['overflow: hidden;'];
  if (token === 'overflow-auto') return ['overflow: auto;'];
  if (token === 'overflow-y-auto') return ['overflow-y: auto;'];
  if (BORDER_RADIUS[token]) return [`border-radius: ${BORDER_RADIUS[token]};`];
  if (token === 'border') return ['border-width: 1px;'];
  if (token === 'border-2') return ['border-width: 2px;'];
  if (token === 'border-b') return ['border-bottom-width: 1px;'];
  if (token === 'border-l') return ['border-left-width: 1px;'];
  if (token === 'border-r') return ['border-right-width: 1px;'];
  if (token === 'border-dashed') return ['border-style: dashed;'];
  if (token === 'ring-2') {
    return ['box-shadow: 0 0 0 2px rgba(148, 163, 184, 0.35);'];
  }
  if (token === 'ring-sky-400') {
    return ['box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.45);'];
  }
  if (token === 'ring-sky-500') {
    return ['box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.5);'];
  }
  if (token === 'shadow-lg') return ['box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);'];
  if (SHADOWS[token]) return [`box-shadow: ${SHADOWS[token]};`];
  if (token === 'transition') {
    return ['transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;', 'transition-duration: 150ms;', 'transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);'];
  }
  if (token === 'transition-all') {
    return ['transition-property: all;', 'transition-duration: 200ms;', 'transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);'];
  }
  if (token === 'transition-colors') {
    return ['transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;', 'transition-duration: 150ms;', 'transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);'];
  }
  if (token === 'uppercase') return ['text-transform: uppercase;'];
  if (LETTER_SPACING[token]) return [`letter-spacing: ${LETTER_SPACING[token]};`];
  if (FONT_SIZES[token]) {
    const [size, lineHeight] = FONT_SIZES[token];
    return [`font-size: ${size};`, `line-height: ${lineHeight};`];
  }
  if (FONT_WEIGHTS[token]) return [`font-weight: ${FONT_WEIGHTS[token]};`];
  if (token === 'text-center') return ['text-align: center;'];
  if (token === 'outline-none') return ['outline: none;'];
  if (token === 'no-underline') return ['text-decoration: none;'];
  if (token === 'sr-only') {
    return ['position: absolute;', 'width: 1px;', 'height: 1px;', 'padding: 0;', 'margin: -1px;', 'overflow: hidden;', 'clip: rect(0, 0, 0, 0);', 'white-space: nowrap;', 'border-width: 0;'];
  }
  if (token === 'pointer-events-none') return ['pointer-events: none;'];
  if (token === 'inset-x-0') return ['left: 0;', 'right: 0;'];
  if (token === 'bottom-4') return [`bottom: ${spacingValue('4')};`];
  if (token.startsWith('grid-cols-')) {
    const count = GRID_COLS[token];
    if (!count) return null;
    return [`grid-template-columns: repeat(${count}, minmax(0, 1fr));`];
  }
  if (token.startsWith('col-span-')) {
    const span = token.slice('col-span-'.length);
    return [`grid-column: span ${span} / span ${span};`];
  }
  if (token === 'gap-1') return [`gap: ${spacingValue('1')};`];
  if (token === 'gap-2') return [`gap: ${spacingValue('2')};`];
  if (token === 'gap-3') return [`gap: ${spacingValue('3')};`];
  if (token === 'gap-4') return [`gap: ${spacingValue('4')};`];
  if (token === 'gap-6') return [`gap: ${spacingValue('6')};`];
  if (token === 'gap-8') return [`gap: ${spacingValue('8')};`];
  if (token === '-translate-y-1') return ['transform: translateY(-0.25rem);'];
  if (token === 'group' || token === 'iconify' || token === 'shadow-theme' || token === 'items' || token === 'No') return [];
  return null;
}
