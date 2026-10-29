#!/usr/bin/env node
// Measured mutations: plant one defect at a time in a copy of the project and see whether `node --test` notices.
//   node mutate.mjs [--files a.js,b.js] [--max n] [--root <dir>] [--min <ratio>] [--timeout <ms>]
// Every site is mutated by default (the result is then the same on every run); --max n samples n sites evenly.
// Targets: files under src/domain/ and src/storage/ (or the --files list). The copy is made with Node fs, without
// .git, docs, .sdlc and node_modules, so no hook and no git state is touched. Operators, one per site:
//   <  <->  <=      >  <->  >=      ===  <->  !==      &&  <->  ||      true  <->  false
//   binary +  <->  -       integer n  ->  n + 1       single-line `return x`  ->  `return undefined`
// Comments, string and template literals, import lines and test files are never mutated. A mutant that does not
// parse is reported apart and not counted. Caught = the tests fail or time out. Survived = they stay green.
// Equivalent mutants are skipped: `return null` and `return undefined`, and the 1 and -1 of a comparator's `? 1 : -1`.
// Output: `mutations  199 planted, 185 caught, 14 survived`, then `  survived: <file>:<line> "a" -> "b"` per survivor
// (ten at most, then `  ... and N more`). Exit 0; with --min <ratio>, exit 1 when caught / planted is below it (the
// strict gate uses --min 1).
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isMain } from './hook-common.mjs';

export const TARGET_PREFIXES = ['src/domain/', 'src/storage/'];
export const SKIPPED_DIRS = new Set(['.git', 'docs', '.sdlc', 'node_modules']);
export const DEFAULT_MAX = Infinity;
export const SURVIVORS_SHOWN = 10;
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * A mask of the source: code characters kept, everything inside a comment, a string or a template literal
 * replaced by a space (newlines kept, so line numbers hold). Regex literals are not recognised.
 */
export function codeMask(source) {
  const out = [];
  let i = 0;
  let state = 'code';
  let templateDepth = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line';
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        state = 'block';
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        state = c;
        out.push(' ');
        i++;
        continue;
      }
      if (c === '`') {
        state = 'template';
        templateDepth = 0;
        out.push(' ');
        i++;
        continue;
      }
      out.push(c);
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out.push('\n');
      } else out.push(' ');
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code';
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    if (state === "'" || state === '"') {
      if (c === '\\') {
        out.push(' ', source[i + 1] === '\n' ? '\n' : ' ');
        i += 2;
        continue;
      }
      if (c === state || c === '\n') state = 'code';
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    if (state === 'template') {
      if (c === '\\') {
        out.push(' ', source[i + 1] === '\n' ? '\n' : ' ');
        i += 2;
        continue;
      }
      if (c === '$' && next === '{') templateDepth++;
      else if (c === '}' && templateDepth > 0) templateDepth--;
      else if (c === '`' && templateDepth === 0) state = 'code';
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
  }
  return out.join('');
}

/** The operators: name, pattern over one masked line, replacement text. */
export const OPERATORS = [
  { name: '<= -> <', pattern: /<=(?!=)/g, to: '<' },
  { name: '< -> <=', pattern: /(?<![<>=!])<(?![<=])/g, to: '<=' },
  { name: '>= -> >', pattern: /(?<!=)>=(?!=)/g, to: '>' },
  { name: '> -> >=', pattern: /(?<![<>=!-])>(?![>=])/g, to: '>=' },
  { name: '=== -> !==', pattern: /===/g, to: '!==' },
  { name: '!== -> ===', pattern: /!==/g, to: '===' },
  { name: '&& -> ||', pattern: /&&/g, to: '||' },
  { name: '|| -> &&', pattern: /\|\|/g, to: '&&' },
  { name: '+ -> -', pattern: /(?<=[\w)\]]\s*)\+(?![+=])(?=\s*[\w(])/g, to: '-' },
  { name: '- -> +', pattern: /(?<=[\w)\]]\s*)-(?![-=>])(?=\s*[\w(])/g, to: '+' },
  { name: 'true -> false', pattern: /\btrue\b/g, to: 'false' },
  { name: 'false -> true', pattern: /\bfalse\b/g, to: 'true' },
  { name: 'n -> n + 1', pattern: /(?<![\w.])\d+(?![\w.])/g, to: (m) => String(Number(m) + 1) },
  { name: 'return x -> return undefined', pattern: /^(\s*)return\s+(?!(?:undefined|null)\b)[^;]+;?\s*$/g, to: (m, indent) => `${indent}return undefined;` },
];

/** Every site in a file where one operator applies: { line, column, from, to, operator }. */
export function findSites(source) {
  const masked = codeMask(source);
  const lines = source.split('\n');
  const maskedLines = masked.split('\n');
  const sites = [];
  maskedLines.forEach((maskedLine, index) => {
    if (/^\s*(import\b|export\s+.*\bfrom\b)/.test(maskedLine)) return;
    for (const op of OPERATORS) {
      for (const m of maskedLine.matchAll(op.pattern)) {
        const from = lines[index].slice(m.index, m.index + m[0].length);
        const to = typeof op.to === 'function' ? op.to(m[0], ...m.slice(1)) : op.to;
        if (from === to) continue;
        if (op.name === 'n -> n + 1' && isComparatorOne(maskedLine, m.index)) continue;
        sites.push({ line: index + 1, column: m.index, from, to, operator: op.name });
      }
    }
  });
  return sites.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** True for the 1 or -1 of a comparator's `? 1 : -1` (an equivalent mutant for a sort). */
export function isComparatorOne(maskedLine, column) {
  const m = maskedLine.match(/\?\s*(-?)1\s*:\s*(-?)1\b/);
  if (!m) return false;
  const first = m.index + m[0].indexOf('1');
  const second = m.index + m[0].lastIndexOf('1');
  return column === first || column === second;
}

/** The survivor line: `  survived: <file>:<line> "a" -> "b"`, with the mutated text trimmed. */
export function survivorLine(s) {
  return `  survived: ${s.file}:${s.line} ${JSON.stringify(s.from.trim())} -> ${JSON.stringify(s.to.trim())}`;
}

/** The mutated source for one site. */
export function applySite(source, site) {
  const lines = source.split('\n');
  const text = lines[site.line - 1];
  lines[site.line - 1] = text.slice(0, site.column) + site.to + text.slice(site.column + site.from.length);
  return lines.join('\n');
}

export function isTestFile(relPath) {
  return /(^|\/)tests?\//.test(relPath) || /\.test\.m?js$/.test(relPath);
}

function walk(dir, root, out) {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    if (statSync(full).isDirectory()) walk(full, root, out);
    else if (/\.m?js$/.test(name) && !isTestFile(rel)) out.push(rel);
  }
  return out;
}

/** The files to mutate: --files when given, else every module under src/domain/ and src/storage/. */
export function targetFiles(root, files) {
  if (files?.length) return files.map((f) => f.replace(/^\.\//, '')).filter((f) => existsSync(join(root, f)) && !isTestFile(f));
  if (!existsSync(join(root, 'src'))) return [];
  return walk(join(root, 'src'), root, []).filter((f) => TARGET_PREFIXES.some((p) => f.startsWith(p))).sort();
}

/** Up to `max` sites spread evenly over the files, each file's share spread over its length. Deterministic. */
export function chooseSites(perFile, max) {
  const files = perFile.filter((f) => f.sites.length);
  if (!files.length) return [];
  const total = files.reduce((n, f) => n + f.sites.length, 0);
  const budget = Math.min(max, total);
  const shares = files.map((f) => ({ file: f.file, sites: f.sites, take: Math.floor((budget * f.sites.length) / total) }));
  let left = budget - shares.reduce((n, s) => n + s.take, 0);
  for (let i = 0; left > 0; i = (i + 1) % shares.length) {
    if (shares[i].take < shares[i].sites.length) {
      shares[i].take++;
      left--;
    }
  }
  const chosen = [];
  for (const s of shares) {
    const n = s.sites.length;
    for (let i = 0; i < s.take; i++) chosen.push({ file: s.file, ...s.sites[Math.floor((i * n) / s.take)] });
  }
  return chosen;
}

function runTests(root, timeoutMs) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test'], { cwd: root, encoding: 'utf8', timeout: timeoutMs, env });
  return { ok: !r.error && r.status === 0, timedOut: r.error?.code === 'ETIMEDOUT', output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function parses(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10_000 });
  return !r.error && r.status === 0;
}

/**
 * Runs the mutations. options: { root, files, max, timeoutMs }
 * Returns { planted, caught, survived, survivors: [{file,line,from,to}], parseErrors: [...], baselineOk, lines }.
 */
export function mutate(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const max = options.max ?? DEFAULT_MAX;
  if (!(max > 0)) throw new RangeError('--max must be a positive number');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const files = targetFiles(root, options.files);
  const result = { planted: 0, caught: 0, survived: 0, survivors: [], parseErrors: [], baselineOk: true, files, lines: [] };
  const summary = () => `mutations  ${result.planted} planted, ${result.caught} caught, ${result.survived} survived`;

  if (!files.length) {
    result.lines.push(`${summary()} (no files under ${TARGET_PREFIXES.join(' or ')})`);
    return result;
  }
  const perFile = files.map((file) => ({ file, sites: findSites(readFileSync(join(root, file), 'utf8')) }));
  const chosen = chooseSites(perFile, max);
  if (!chosen.length) {
    result.lines.push(`${summary()} (no operator site in ${files.join(', ')})`);
    return result;
  }

  const copy = mkdtempSync(join(tmpdir(), 'sdlc-mutate-'));
  try {
    cpSync(root, copy, { recursive: true, filter: (src) => !SKIPPED_DIRS.has(relative(root, src).split(sep)[0]) });
    const baseline = runTests(copy, timeoutMs);
    if (!baseline.ok) {
      result.baselineOk = false;
      result.lines.push(`mutations  baseline tests ${baseline.timedOut ? 'timed out' : 'fail'} before any mutation; nothing planted`);
      return result;
    }
    for (const site of chosen) {
      const path = join(copy, site.file);
      const original = readFileSync(path, 'utf8');
      writeFileSync(path, applySite(original, site));
      try {
        if (!parses(path)) {
          result.parseErrors.push(site);
          continue;
        }
        result.planted++;
        const run = runTests(copy, timeoutMs);
        if (run.ok) {
          result.survived++;
          result.survivors.push(site);
        } else result.caught++;
      } finally {
        writeFileSync(path, original);
      }
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
  result.lines.push(summary());
  for (const s of result.survivors.slice(0, SURVIVORS_SHOWN)) result.lines.push(survivorLine(s));
  if (result.survivors.length > SURVIVORS_SHOWN) result.lines.push(`  ... and ${result.survivors.length - SURVIVORS_SHOWN} more`);
  if (result.parseErrors.length) {
    result.lines.push(`  ${result.parseErrors.length} mutant${result.parseErrors.length === 1 ? '' : 's'} did not parse and ${result.parseErrors.length === 1 ? 'was' : 'were'} not counted: ${result.parseErrors.map((s) => `${s.file}:${s.line}`).join(', ')}`);
  }
  return result;
}

function cli(argv) {
  const value = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  const files = value('--files')?.split(',').map((s) => s.trim()).filter(Boolean);
  const result = mutate({
    root: value('--root') ?? process.cwd(),
    files,
    max: value('--max') ? Number(value('--max')) : undefined,
    timeoutMs: value('--timeout') ? Number(value('--timeout')) : undefined,
  });
  console.log(result.lines.join('\n'));
  const min = value('--min');
  if (min === undefined) return 0;
  if (!result.baselineOk) return 1;
  if (result.planted === 0) return 0;
  return result.caught / result.planted >= Number(min) ? 0 : 1;
}

if (isMain(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
