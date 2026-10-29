#!/usr/bin/env node
// PreToolUse Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit|Bash. No role reads or writes a secret file: .env and its
// variants, private keys, a secrets/ folder. A credential that reaches the model's context can end up in a commit, a
// log or a finding. Example and template files (.env.example) are fine. Denial: exit 2, one sentence on stderr.
import { readdirSync, statSync, globSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readHookInput, projectRoot, deny, isMain, runGuard } from './hook-common.mjs';
import { toProjectPath } from './scope.mjs';
import { simpleCommands, shellWords, expandWord } from './hook-commit-guard.mjs';
import { patternToRegExp } from './roles.mjs';
import { basename } from 'node:path';

/** A secret by its name: .env, .env.local, .envrc, *.pem, *.key, id_rsa, a secrets/ or .secrets/ folder, *.p12 / *.pfx, the tools' credential files. */
export const SECRET_PATH = /^\/proc\/[^/]+\/(?:environ|cmdline|mem|maps|status|auxv)$|^\/dev\/k?mem$|(?:^|\/)\.env(?:\.[\w.-]+)?$|(?:^|\/)\.envrc$|(?:^|\/)\.?secrets?\/|\.(?:pem|key|p12|pfx|jks|keystore)$|(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$|(?:^|\/)(?:credentials|\.netrc|\.npmrc|\.pypirc|\.git-credentials)$|(?:^|\/)[\w.-]*secrets?\.(?:json|ya?ml|toml|xml)$|\.config\/gh\/hosts\.yml$|\.docker\/config\.json$|\.kube\/config$|(?:^|\/)\.aws\/(?:credentials|config)$|(?:^|\/)appsettings\.(?:\w+\.)?secrets?\.json$/i;
/** The public shapes of those names: documentation, not a secret. */
export const SECRET_EXAMPLE = /\.(?:example|sample|template|dist|md)$|(?:^|\/)\.env\.d\.ts$/i;

export function isSecretPath(relPath) {
  const p = String(relPath ?? '').replace(/\\/g, '/');
  return SECRET_PATH.test(p) && !SECRET_EXAMPLE.test(p);
}

/** A search pattern or glob that would sweep secrets in: it names .env, a key extension, a secrets folder or an ssh key. */
export const SECRET_GLOB = /\.env(?![a-z])|\.(?:pem|key|p12|pfx|jks|keystore)\b|(?:^|\/|\*)\.?secrets?(?:\/|$|\*)|id_(?:rsa|dsa|ecdsa|ed25519)|\.netrc|\.npmrc|\.pypirc|\.git-credentials/i;
/** Secret paths a glob is tried against: a pattern that would match any of them sweeps secrets in, whatever it is spelled like. */
export const SECRET_SAMPLES = ['.env', '.env.local', 'config/.env.production', 'certs/server.pem', 'deploy/app.key', '.ssh/id_rsa', '.ssh/id_ed25519', 'secrets/db.json', '.secrets/token', '.npmrc', '.netrc', 'keystore.jks', 'cert.p12'];
// A pattern worth trying against the samples: it reaches for hidden files or says a secret word. A bare star, a
// recursive star or a recursive star with an extension is navigation, not a sweep.
export const SWEEP_SHAPE = /(?:^|\/)\.[^/]*[*?]|secret|env|key|\.pe|\.ke|id_|\.rsa|cred|token|cert|ssh|p12|pfx|jks|netrc|npmrc/i;
export function isSecretGlob(pattern) {
  const p = String(pattern ?? '');
  if (/\.example|\.sample|\.template/i.test(p)) return false;
  if (SECRET_GLOB.test(p)) return true;
  if (!SWEEP_SHAPE.test(p) && !/[[\]]/.test(p)) return false;
  let re;
  try {
    re = patternToRegExp(p.startsWith('/') ? p.slice(1) : p);
  } catch {
    return true;
  }
  return SECRET_SAMPLES.some((s) => re.test(s));
}

/** A command that dumps the environment, where the human keeps the secrets: printenv, env, set, export -p, a one-liner printing process.env or os.environ. */
export const ENV_DUMP = /process\.env(?![.\[\w])|process\s*\[|globalThis\.process|\benviron\b(?!\[|\.get\()|\/proc\/\S*\/environ|\bENV\.to_h\b|\bSystem\.getenv\(\)|Environment\.GetEnvironmentVariables/i;
const SECRET_NAME = /key|secret|token|pass|pwd|credential|auth/i;
/** Programs that print the environment of a process by other means: ps with the e flags, launchctl, systemctl. */
const ENV_BY_PROGRAM = /^(?:\S*\/)?ps\s+(?:[a-zA-Z]*e[a-zA-Z]*(?!\S)|-[a-zA-Z]*E[a-zA-Z]*(?!\S)|(?:\S+\s+)*-o\s*\S*(?:env|command|args))|^(?:\S*\/)?launchctl\s+(?:getenv|export)\b|^(?:\S*\/)?systemctl\s+show-environment\b|^(?:\S*\/)?docker\s+(?:inspect|exec\s+\S+\s+(?:env|printenv))\b|^(?:\S*\/)?kubectl\s+(?:get\s+secret|exec\s+\S+.*\s(?:env|printenv))\b/i;
/**
 * A segment that prints the environment: `env` or `printenv` with no command word and no named variable (options or
 * not), `set` alone, `export`, `declare`, `typeset` without an assignment, `printenv <a secret-sounding name>`, or a
 * program that reaches the whole environment object.
 */
export function dumpsEnvironment(segment) {
  if (ENV_DUMP.test(segment) || ENV_BY_PROGRAM.test(segment)) return true;
  const words = shellWords(segment);
  const cmd = basename(words[0] ?? '');
  const rest = words.slice(1);
  const plain = rest.filter((w) => !w.startsWith('-'));
  if (cmd === 'env' || cmd === 'printenv') {
    if (plain.length === 0) return true;
    if (cmd === 'printenv') return plain.some((w) => SECRET_NAME.test(w));
    return false;
  }
  if (cmd === 'set') return rest.length === 0;
  if (cmd === 'export' || cmd === 'declare' || cmd === 'typeset') return !plain.some((w) => w.includes('='));
  return false;
}
export function envDumpProblem(command) {
  for (const segment of simpleCommands(String(command ?? ''))) {
    if (dumpsEnvironment(segment)) return `Denied: "${segment.trim().slice(0, 60)}" prints the environment, where the human keeps the secrets; read one named variable the code needs, never the whole set.`;
  }
  return null;
}

/** How many entries a folder walk reads before it gives up; past it the answer is "unknown", which fails closed. */
export const WALK_LIMIT = 20000;

/**
 * Every secret-named file under a folder (the whole tree, node_modules, .git and the kit checkout skipped), as paths.
 * Returns `{ secrets, complete }`; `complete: false` when the walk hit WALK_LIMIT, and the caller treats that as a secret.
 */
export function secretsUnder(dir) {
  const secrets = [];
  let seen = 0;
  let complete = true;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!complete) return;
      if (++seen > WALK_LIMIT) {
        complete = false;
        return;
      }
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.sdlc-kit') continue;
      const path = join(d, e.name);
      if (e.isDirectory()) {
        walk(path);
        continue;
      }
      if (isSecretPath(e.name) || isSecretPath(path.replace(/\\/g, '/'))) secrets.push(path);
    }
  };
  try {
    if (!statSync(dir).isDirectory()) return { secrets, complete };
  } catch {
    return { secrets, complete };
  }
  walk(dir);
  return { secrets, complete };
}

/** The first secret under a folder, or a marker when the walk could not finish, or null. */
export function secretUnder(dir) {
  const { secrets, complete } = secretsUnder(dir);
  if (secrets.length) return secrets[0];
  return complete ? null : `${dir} (more than ${WALK_LIMIT} entries: the folder could not be checked)`;
}

/** True when a glob (as rg, grep or the Grep tool read it) matches a file, by its name or by its path relative to the folder searched. */
export function globMatches(glob, file, base) {
  if (/[{}]|^!|\\/.test(String(glob))) return true;
  const rel = String(file).startsWith(base + '/') ? String(file).slice(base.length + 1) : String(file);
  const name = basename(String(file));
  let re;
  try {
    re = patternToRegExp(String(glob).replace(/^\.\//, ''));
  } catch {
    return true;
  }
  return re.test(name) || re.test(rel);
}

/** Commands that read a whole folder: grep -r, rg, ag, ack, tar, zip, cat of a folder, find with -exec. */
const RECURSIVE = /^(?:\S*\/)?(?:rg|ag|ack)$/;
const GREPS = /^(?:\S*\/)?(?:grep|egrep|fgrep)$/;
const ARCHIVERS = /^(?:\S*\/)?(?:tar|zip|7z|rsync|ditto)$/;
/** Copies that read a whole folder: cp with -r/-R/-a, mv of a folder, ditto, rsync. Their sources are the folders read. */
const COPIERS = /^(?:\S*\/)?(?:cp|mv)$/;
/**
 * The include and exclude patterns of a grep-like command: `--exclude=X`, `--exclude-dir=X`, `--ignore X` exclude; rg's
 * `-g`/`--glob`/`--iglob` include unless the value starts with `!`. Values the option takes as the next word are read too.
 */
export function grepPatterns(words) {
  const include = [];
  const exclude = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const m = w.match(/^(--exclude-dir|--exclude|--ignore-dir|--ignore|-g|--glob|--iglob|--include)(?:=(.*))?$/);
    if (!m) continue;
    const value = m[2] !== undefined ? m[2] : words[++i];
    if (value === undefined) continue;
    if (m[1] === '-g' || m[1] === '--glob' || m[1] === '--iglob') {
      if (value.startsWith('!')) exclude.push(value.slice(1));
      else include.push(value);
    } else if (m[1] === '--include') include.push(value);
    else exclude.push(value);
  }
  return { include, exclude };
}

/** True when the command's patterns keep every secret out: each secret matches an exclude, or the includes name files and none of them matches it. */
export function secretsKeptOut(secrets, base, { include, exclude }) {
  return secrets.every((s) => exclude.some((g) => globMatches(g, s, base)) || (include.length > 0 && !include.some((g) => globMatches(g, s, base))));
}

const VALUE_OPTIONS = /^(?:--exclude-dir|--exclude|--ignore-dir|--ignore|-g|--glob|--iglob|--include|-e|--regexp|-f|--file|-t|--type|-T|--type-not|-m|--max-count|-A|-B|-C|-j|--threads)$/;

/** A recursive read over a folder that holds a secret-named file, unless the command's patterns keep every secret out: the secret would land in the output. */
export function recursiveReadProblem(command, cwd) {
  for (const segment of simpleCommands(String(command ?? ''))) {
    const words = shellWords(segment);
    const cmd = words[0] ?? '';
    const gitGrep = basename(cmd) === 'git' && words[1] === 'grep' && words.some((w) => /^--(?:no-index|untracked|no-exclude-standard)$/.test(w));
    const copier = COPIERS.test(cmd) && (basename(cmd) === 'mv' || words.some((w) => /^-[a-zA-Z]*[rRa]/.test(w) || w === '--recursive' || w === '--archive'));
    const recursive = RECURSIVE.test(cmd) || gitGrep || copier || (GREPS.test(cmd) && words.some((w) => /^-[a-zA-Z]*[rR]|^--(?:recursive|dereference-recursive)$/.test(w))) || (basename(cmd) === 'diff' && words.some((w) => /^-[a-zA-Z]*r|^--recursive$/.test(w))) || ARCHIVERS.test(cmd) || (/^(?:\S*\/)?(?:find|fd|fdfind)$/.test(cmd) && words.some((w) => /^-(?:exec|execdir|ok|print0?|ls|x|X)$|^--exec(?:-batch)?$/.test(w)));
    if (!recursive) continue;
    const patterns = grepPatterns(words);
    const skip = new Set();
    for (let i = 1; i < words.length; i++) if (VALUE_OPTIONS.test(words[i])) skip.add(i + 1);
    let plain = words.slice(gitGrep ? 2 : 1).filter((w, i) => !skip.has(i + (gitGrep ? 2 : 1)) && !w.startsWith('-') && w !== '<');
    if ((GREPS.test(cmd) || RECURSIVE.test(cmd) || gitGrep) && !words.some((w) => /^(?:-e|--regexp|-f|--file)(?:=|$)/.test(w))) plain = plain.slice(1);
    if (copier) plain = plain.slice(0, -1);
    const dirs = plain.map((w) => expandWord(w, cwd)).filter((w) => !/[*?[]/.test(w));
    const finder = /^(?:\S*\/)?(?:find|fd|fdfind)$/.test(cmd);
    let targets = dirs.length ? dirs : RECURSIVE.test(cmd) || gitGrep ? ['.'] : [];
    if (finder) {
      const firstOption = words.findIndex((w, i) => i > 0 && w.startsWith('-'));
      const heads = words.slice(1, firstOption < 0 ? undefined : firstOption).filter((w) => !/[*?[]/.test(w));
      const roots = basename(cmd) === 'find' ? heads : heads.slice(1);
      targets = (roots.length ? roots : ['.']).map((w) => expandWord(w, cwd));
    }
    for (const d of targets) {
      const base = resolve(cwd, d);
      const { secrets, complete } = secretsUnder(base);
      if (!complete) return `Denied: "${segment.trim().slice(0, 60)}" reads a folder too large to check for secrets (more than ${WALK_LIMIT} entries); name the folders you need.`;
      if (!secrets.length || secretsKeptOut(secrets, base, patterns)) continue;
      const shown = secrets.find((s) => !secretsKeptOut([s], base, patterns)) ?? secrets[0];
      return `Denied: "${segment.trim().slice(0, 60)}" reads a whole folder that holds ${shown.replace(cwd + '/', '')}, so the secret would land in the output; name the files or folders, or exclude the secret (--exclude='.env*', -g '!.env*').`;
    }
  }
  return null;
}

/** The file a reading or writing tool names, or the words of a shell command that look like a secret path (a word with a glob is tried as a pattern). */
export function secretTargets(input) {
  const t = input?.tool_input ?? {};
  if (input?.tool_name === 'Bash') {
    const out = [];
    for (const segment of simpleCommands(String(t.command ?? ''))) {
      for (const word of shellWords(segment)) {
        if (/^--(?:exclude|ignore|glob|iglob)/.test(word)) continue;
        const expanded = expandWord(word, input.cwd ?? process.cwd());
        out.push(expanded, ...(/[:=]/.test(expanded) ? expanded.split(/[:=]/) : []));
      }
    }
    return out;
  }
  if (/^mcp__/.test(String(input?.tool_name ?? ''))) return allStrings(t);
  return [t.file_path, t.notebook_path, t.path, t.source, t.destination].filter((p) => typeof p === 'string' && p);
}

/** Every string in a tool input, at any depth: an MCP tool names its files however it likes, so each string is tried as a path. */
export function allStrings(value, out = [], depth = 0) {
  if (depth > 6) return out;
  if (typeof value === 'string') {
    if (value) out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out, depth + 1));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out, depth + 1));
  return out;
}

/** Programs that print what a file holds (or pack it): a word with `$` or a brace list behind them cannot be judged. */
const FILE_READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'awk', 'sed', 'cut', 'sort', 'uniq', 'wc', 'xxd', 'od', 'strings', 'base64', 'hexdump', 'cp', 'tar', 'zip', 'rsync', 'scp', 'curl', 'jq', 'yq', 'tee', 'paste', 'tr', 'diff', 'cmp', 'file', 'stat', 'source', '.']);
/** A word the shell still has to expand: a variable expandWord did not resolve, or a brace list. */
export const UNEXPANDED = /\$|\{[^}]*,[^}]*\}|\{\d+\.\.\d+\}/;
/** A file reader given a word the guard cannot resolve (`cat $F`, `cat .e{nv,}`): the file it would print is unknown, so it is refused. */
export function unresolvedReadProblem(command, cwd) {
  for (const segment of simpleCommands(String(command ?? ''))) {
    const words = shellWords(segment);
    const cmd = basename(words[0] ?? '');
    if (!FILE_READERS.has(cmd)) continue;
    for (const w of words.slice(1)) {
      if (w.startsWith('-') || w === '<') continue;
      if (UNEXPANDED.test(expandWord(w, cwd))) return `Denied: "${w}" cannot be resolved by the guard (a variable or a brace list), so what ${cmd} would read is unknown; spell the file name out.`;
    }
  }
  return null;
}

/** A glob word expanded in the folder the command runs in: the first match that is a secret, or null. Dot files match only a pattern that spells the dot, as the shell does. */
export function globExpandsToSecret(word, cwd) {
  let matches;
  try {
    matches = globSync(word, { cwd, withFileTypes: false });
  } catch {
    return `${word} (the pattern could not be expanded)`;
  }
  const spellsDot = /(?:^|\/)\./.test(word);
  for (const m of matches) {
    const rel = String(m).replace(/\\/g, '/');
    if (!spellsDot && /(?:^|\/)\./.test(rel)) continue;
    if (isSecretPath(rel)) return rel;
  }
  return null;
}

/** The shell words that carry a glob: `cat .env*` names no file, but the pattern sweeps the secrets in. */
export function bashGlobs(input) {
  if (input?.tool_name !== 'Bash') return [];
  const out = [];
  for (const segment of simpleCommands(String(input.tool_input?.command ?? ''))) {
    for (const word of shellWords(segment)) if (/[*?[]/.test(word) && !/^[-!]/.test(word)) out.push(word);
  }
  return out;
}

/** The glob of a Grep or Glob call (the `glob` field, or Glob's `pattern`): a sweep over hidden env files or keys is refused too. */
export function secretGlobs(input) {
  const t = input?.tool_input ?? {};
  const out = [];
  if (typeof t.glob === 'string') out.push(...t.glob.split(/\s+/).filter((g) => g && !g.startsWith('!')));
  if (input?.tool_name === 'Glob' && typeof t.pattern === 'string') out.push(t.pattern);
  if (/^mcp__.*(?:search|find|glob|list|grep|ls)/i.test(String(input?.tool_name ?? ''))) {
    for (const key of ['pattern', 'glob', 'include', 'path', 'query']) if (typeof t[key] === 'string' && /[*?[]/.test(t[key])) out.push(t[key]);
  }
  return out;
}

export function decide(input) {
  const root = projectRoot(input);
  for (const glob of [...secretGlobs(input), ...bashGlobs(input)]) {
    if (isSecretGlob(glob)) return `Denied: the pattern ${glob} would sweep in secret files (.env, keys, credentials); search named source folders instead.`;
  }
  if (input?.tool_name === 'Bash') {
    const cwd = input.cwd ?? process.cwd();
    for (const word of bashGlobs(input)) {
      const hit = globExpandsToSecret(expandWord(word, cwd), cwd);
      if (hit) return `Denied: ${word} expands to ${hit}, a secret (an .env file, a key, a credentials file); name the files you need.`;
    }
    const dump = envDumpProblem(input.tool_input?.command) ?? unresolvedReadProblem(input.tool_input?.command, input.cwd ?? process.cwd()) ?? recursiveReadProblem(input.tool_input?.command, input.cwd ?? process.cwd());
    if (dump) return dump;
  }
  if (input?.tool_name === 'Grep') {
    const t = input.tool_input ?? {};
    const dir = resolve(root, String(t.path ?? root));
    const { secrets, complete } = secretsUnder(dir);
    if (!complete) return `Denied: this search over ${t.path ?? 'the project'} covers a folder too large to check for secrets; search a named folder.`;
    const globs = typeof t.glob === 'string' && t.glob ? t.glob.split(/\s+/).filter(Boolean) : [];
    const include = globs.filter((g) => !g.startsWith('!'));
    const exclude = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
    const narrowType = typeof t.type === 'string' && t.type && !/^(?:all|config|cert|pem|env|txt|text|json|yaml|xml|toml)$/i.test(t.type);
    const reached = secrets.filter((s) => !narrowType && (include.length === 0 || include.some((g) => globMatches(g, s, dir))) && !exclude.some((g) => globMatches(g, s, dir)));
    if (reached.length) return `Denied: this search over ${t.path ?? 'the project'} would read ${reached[0].replace(root + '/', '')}; search with a glob that names source files (src/**/*.js) or a folder that holds no secret.`;
  }
  for (const raw of secretTargets(input)) {
    const target = String(raw).replace(/^[({]+|[)}]+$/g, '');
    const rel = toProjectPath(root, target);
    const spelled = String(raw);
    if (isSecretPath(rel) || isSecretPath(spelled) || isSecretPath(target)) {
      return `Denied: ${spelled} looks like a secret (an .env file, a key, a credentials file); no role reads or writes secrets, the human sets them in the environment and the code reads process.env.`;
    }
  }
  return null;
}

if (isMain(import.meta.url)) runGuard((input) => decide(input));
