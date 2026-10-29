#!/usr/bin/env node
// PreToolUse Bash. Denies a few commands outright, runs the gate on the staged state before any `git commit`, and
// keeps a judge (x-writes: [] in its agent file) away from anything that changes files or git state.
// Denial: exit 2, one sentence on stderr (the gate table follows it for a failed commit).
import { realpathSync, existsSync, statSync } from 'node:fs';
import { resolve, sep, basename, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readHookInput, projectRoot, deny, isMain, runGuard, comparablePath, runTests } from './hook-common.mjs';
import { runGate, COMMIT_MESSAGE_HINT } from './gate.mjs';
import { loadRoles, roleOf, isJudge, isMainSession, hasOwnPaths, KIT_ROOT } from './roles.mjs';
import { toProjectPath, isHumanOnly, allowedScope, isInScope, isProjectSkillPath, isTesterSpec, isDecisionPath, isScriptOwnedPath, isSymlink, activeSlice, readText, APPROVED_STATUS, PLAN_FILE, SLICE_MARKER, MANUAL_CHECKS_FILE, SETUP_WRITABLE } from './scope.mjs';

export const FORBIDDEN = [
  [/\brm\b(?=[^|;&\n]*(?:\s-[a-zA-Z]*[rR]|\s--recursive\b))(?=[^|;&\n]*(?:\s-[a-zA-Z]*f|\s--force\b))/, 'Denied: rm with -r and -f is not allowed; remove files one by one with git rm, or ask the human.'],
  [/\b(?:gh|glab)\s+(?:pr\s+(?:create|merge|close|ready|reopen|edit)|mr\s+(?:create|merge|close|approve)|release\s+(?:create|delete|edit|upload)|repo\s+(?:create|delete|fork|sync|edit|archive)|workflow\s+(?:run|enable|disable)|secret|variable)\b/, 'Denied: the human opens, merges and releases (ADR-002); prepare docs/PR.md and say which command the human runs.'],
  [/\bfind\b[^|;&\n]*\s-(?:delete|exec(?:dir)?|ok(?:dir)?|fprint[0f]?|fls)\b/, 'Denied: find -delete, -exec and -fprint change or write files in bulk, which cannot be checked; remove files one by one with git rm, or ask the human.'],
  [/--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?\b/, 'Denied: --no-verify skips the gate; fix what the gate reports instead.'],
  [/\btar\b[^|;&\n]*(?:--(?:to-command|checkpoint-action|use-compress-program|rmt-command|info-script|new-volume-script)\b|\s-I\s)|\bzip\b[^|;&\n]*\s-TT\b|\brsync\b[^|;&\n]*(?:\s-e\s|--rsh\b)|\b(?:un)?zip\b[^|;&\n]*--unzip-command/, 'Denied: that option makes tar, zip or rsync run a program of its own; use the plain form.'],
  [/\bGIT_\w+=/i, 'Denied: a GIT_* variable redirects git (its hooks, index, objects or repository) past the gate; run plain git in the project.'],
  [/\b(?:NODE_OPTIONS|NODE_TEST_CONTEXT|NODE_PATH|PYTHONSTARTUP|PYTHONPATH|PYTHONHOME|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|BASH_ENV|ENV|ZDOTDIR|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|SHELLOPTS|PS4|PROMPT_COMMAND|PATH)=/, 'Denied: a preload or path variable makes an interpreter run code the command does not name; run the command plainly.'],
  [/\bln\s+-[a-zA-Z]*s/, 'Denied: symlinks can point outside the project; copy the file or ask the human.'],
  [/\bcp\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[slPd]/, 'Denied: cp -s, -l, -P and -d create or copy links, which can point a write outside the project; copy plain files or ask the human.'],
  [/\bcp\s[^|;&\n]*--(?:symbolic-link|link|no-dereference)\b/, 'Denied: cp --symbolic-link, --link and --no-dereference create or copy links, which can point a write outside the project; copy plain files or ask the human.'],
  [/\breview\.mjs\b[^|;&\n]*\bdecide\b/, "Denied: review.mjs decide records the human's decision; the human runs it from their own terminal."],
];

/** The commit heredoc shape with its body replaced by one word, so the segment checks can read the rest of the command. */
export function flattenHeredoc(command) {
  return String(command).replace(/-m "\$\(cat <<'EOF'\n[\s\S]*?\nEOF\n\)"/, '-m "heredoc"');
}

/** The text FORBIDDEN runs on: the de-quoted words of each segment and the raw text, with the value of -m or --message left out. */
export function forbiddenText(command) {
  const out = [];
  for (const segment of simpleCommands(command)) {
    const words = parseSegment(segment).words;
    const kept = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i] === '-m' || words[i] === '--message') {
        i++;
        continue;
      }
      if (words[i].startsWith('--message=')) continue;
      kept.push(words[i]);
    }
    out.push(kept.join(' '));
    out.push(segment.replace(/(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g, ' '));
  }
  return out.join('\n');
}

/** Git subcommands that rewrite the tree or the history past the gate: the human merges, rebases, reverts and pulls (ADR-002). */
export const GIT_HISTORY = new Set(['apply', 'am', 'merge', 'rebase', 'cherry-pick', 'revert', 'pull', 'filter-branch', 'replace', 'reflog', 'gc', 'prune', 'checkout-index', 'read-tree', 'update-index', 'hash-object', 'commit-tree', 'write-tree', 'mktree', 'mktag', 'fast-import', 'unpack-objects', 'index-pack', 'prune-packed', 'pack-refs', 'notes', 'bundle', 'submodule', 'subtree', 'fsck']);
/** The plumbing behind a push, and the remote list: the human pushes and the human points the repository anywhere. */
export const GIT_PUSHES = new Set(['push', 'send-pack', 'http-push', 'receive-pack', 'daemon', 'instaweb']);

/** True when git resolves the word as a commit (a branch, a tag, a sha): `git checkout <word>` would move HEAD even when a file of that name exists. */
function isRef(root, word) {
  if (!root || /[$`*?[{\s]/.test(word)) return false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${word}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A real file or folder in the project, given as the command spells it. */
function existsIn(root, cwd, word) {
  try {
    return existsSync(resolve(cwd ?? root, expandWord(word, cwd ?? root)));
  } catch {
    return false;
  }
}

/**
 * Git subcommands and options no role may run, read from the parsed words (an option with a value is skipped).
 * `git rm` and `git mv` are writes: every path they name goes through the same file rules as a shell write (`role`
 * and `cwd` from the caller; without a role the main rules apply).
 */
export function gitProblem(segment, root, role = { name: 'main', writes: 'main' }, cwd = root) {
  const p = parseSegment(segment);
  if (p.cmd !== 'git') return null;
  const sub = gitSubcommand(p.words);
  if (!sub) return null;
  const globals = p.words.slice(gitIndex(p.words) + 1, p.words.indexOf(sub));
  if (globals.some((w) => /^(?:--git-dir|--work-tree|--exec-path|--namespace|--super-prefix|--no-replace-objects|--bare)\b/.test(w) || /core\.hooksPath/i.test(w))) {
    return 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.';
  }
  const configProblem = gitConfigOptionProblem(globals);
  if (configProblem) return configProblem;
  if (root) {
    let where = resolve(cwd ?? root);
    for (let i = 0; i < globals.length; i++) {
      const w = globals[i];
      if (w === '-c') {
        i++;
        continue;
      }
      const dir = w === '-C' ? globals[++i] : w.startsWith('-C') ? w.slice(2) : null;
      if (dir === null) continue;
      if (!dir || UNRESOLVABLE.test(expandWord(dir, where))) return 'Denied: git -C runs git in another folder, where the gate does not see it; run git from the project root.';
      where = resolve(where, expandWord(dir, where));
    }
    if (comparablePath(where) !== comparablePath(root)) return 'Denied: git -C runs git in another folder, where the gate does not see it; run git from the project root.';
  }
  const args = p.words.slice(p.words.indexOf(sub) + 1);
  const flags = args.filter((a) => a.startsWith('-'));
  const paths = args.filter((a) => !a.startsWith('-'));
  if (GIT_PUSHES.has(sub)) return 'Denied: the AI never pushes (ADR-002); the human pushes.';
  if (sub === 'remote' && args[0] && !/^(?:-v|--verbose|show|get-url)$/.test(args[0])) return 'Denied: the remotes are the human\'s (ADR-002); read them with git remote -v.';
  const BRANCH = 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).';
  const MOVE = 'Denied: the AI stays on the current branch and commit; switching to another branch or commit is the human\'s call (ADR-002).';
  if (sub === 'switch' && flags.some((f) => /^-[a-zA-Z]*[cCt]/.test(f) || /^--(c|cr|cre|crea|creat|create|f|fo|for|forc|force|force-.*|o|or|orp|orph|orpha|orphan|t|tr|tra|trac|track)(=|$)/.test(f))) return BRANCH;
  if (sub === 'switch') return MOVE;
  if (sub === 'checkout' && flags.some((f) => /^-[a-zA-Z]*[bBt]/.test(f) || /^--(o|or|orp|orph|orpha|orphan|t|tr|tra|trac|track)(=|$)/.test(f))) return BRANCH;
  if (sub === 'branch' && paths.length > 0 && !flags.some((f) => /^--(list|show-current|contains|merged|no-merged)(=|$)/.test(f))) return BRANCH;
  if (sub === 'branch' && flags.some((f) => /^-[a-zA-Z]*[dDmMcC]/.test(f) || /^--(delete|move|copy|force)(=|$)/.test(f))) return BRANCH;
  if (sub === 'worktree' && args[0] === 'add') return BRANCH;
  if (sub === 'update-ref' || sub === 'symbolic-ref') return BRANCH;
  if (sub === 'add' && flags.some((f) => /^-[a-zA-Z]*f/.test(f) || (f.length >= 3 && '--force'.startsWith(f.split('=')[0])))) return 'Denied: git add -f stages what .gitignore keeps out (kit state, local settings, build output); stage the slice files by name.';
  if (sub === 'tag') return 'Denied: the AI never tags (ADR-002); the human tags a release.';
  if (sub === 'clean' && !flags.some((f) => /^-[a-zA-Z]*n|^--dry-run$/.test(f))) return "Denied: git clean deletes files git does not know about, which may be the human's; ask the human.";
  if (sub === 'stash' && !['list', 'show'].includes(args[0])) return "Denied: git stash hides work that is not committed, including the human's; ask the human.";
  if (GIT_HISTORY.has(sub)) return `Denied: git ${sub} rewrites the tree or the history past the gate; the human merges, rebases, reverts and pulls (ADR-002).`;
  if (sub === 'reset') {
    if (flags.includes('--hard')) return 'Denied: git reset --hard throws away work that is not committed; ask the human.';
    const revs = (args.includes('--') ? args.slice(0, args.indexOf('--')) : paths).filter((a) => !a.startsWith('-') && !existsIn(root, cwd, a));
    if (flags.some((f) => /^--(soft|mixed|merge|keep)$/.test(f)) || revs.some((r) => r !== 'HEAD')) {
      return 'Denied: git reset to another commit moves the branch past the gate; to unstage a file run git reset -- <file>, for anything else ask the human.';
    }
  }
  if (sub === 'config') {
    if (INIT_HOOKS_PATH.test(segment)) return null;
    if (args.some((a) => /core\.hooksPath/i.test(a))) return 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.';
    if (!flags.some((f) => /^(?:-l|--list|--get|--get-all|--get-regexp|--show-origin|--show-scope)$/.test(f))) {
      return 'Denied: git config writes settings (an alias, a hook path, an identity) that the gate cannot see; read with --get or --list, the human sets.';
    }
  }
  if (sub === 'checkout' || sub === 'restore') {
    const afterDash = args.includes('--') ? args.slice(args.indexOf('--') + 1) : paths;
    if (afterDash.some((a) => a === '.' || a === '*' || a === ':/') || (sub === 'restore' && flags.includes('--staged') && afterDash.length !== 1)) {
      return 'Denied: reverting the whole tree throws away work that is not committed; name one file inside your slice, or ask the human.';
    }
    if (sub === 'checkout' && !args.includes('--') && root && (args.includes('-') || paths.some((a) => !existsIn(root, cwd, a) || isRef(root, a)))) return MOVE;
    if (root) {
      for (const path of afterDash) {
        const rel = toProjectPath(root, path);
        const humanOnly = isHumanOnly(root, rel);
        if (humanOnly) return `Denied: ${humanOnly}; reverting it is the human's call.`;
        if (rel === PLAN_FILE && activeSlice(root)) return `Denied: ${PLAN_FILE} cannot change while ${activeSlice(root)} is active; a wider slice is a human decision.`;
      }
    }
  }
  if ((sub === 'rm' || sub === 'mv') && root) {
    const named = args.includes('--') ? args.slice(args.indexOf('--') + 1) : paths;
    if (!named.length || named.some((a) => UNRESOLVABLE.test(expandWord(a, cwd ?? root)))) return `Denied: the paths of git ${sub} cannot be read (glob or variable); name the files.`;
    const targets = sub === 'mv' ? movedPaths(named, cwd ?? root) : named;
    for (const raw of targets) {
      const problem = pathWriteProblem(root, cwd ?? root, raw, { cmd: `git ${sub}`, segment }, role);
      if (problem) return problem;
    }
  }
  if (sub === 'commit') {
    if (flags.some((f) => f === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(f))) return 'Denied: git commit -a stages everything; stage the slice files by name so the gate can check them.';
    if (flags.some((f) => f.length >= 4 && '--amend'.startsWith(f.split('=')[0]))) return 'Denied: git commit --amend rewrites a committed slice; make a new commit.';
    if (flags.some((f) => (f.length >= 6 && '--no-verify'.startsWith(f.split('=')[0])) || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(f) && f !== '-m')) return 'Denied: -n on git commit skips the gate; fix what the gate reports instead.';
  }
  return null;
}

/** What a package manager may do without a human: run the project's own scripts and tests, and read. Everything else (an install under any alias, exec, dlx, publish, version, link, init) changes the dependencies or runs code from outside the repo. */
export const PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun', 'corepack']);
export const PACKAGE_MANAGER_READS = new Set(['test', 't', 'tst', 'run', 'run-script', 'ls', 'list', 'll', 'la', 'view', 'v', 'info', 'show', 'outdated', 'why', 'explain', 'help', 'ping', 'search', 's', 'se', 'find', 'doctor', 'licenses', 'audit', 'config', 'c', 'get', 'prefix', 'root', 'bin', 'env', 'whoami', 'pack']);
export const RUNNERS = new Set(['npx', 'pnpx', 'bunx']);
export function packageManagerProblem(p) {
  if (RUNNERS.has(p.cmd)) return 'Denied: npx runs code from outside the repo; this project has no dependencies, ask the human.';
  if (!PACKAGE_MANAGERS.has(p.cmd)) return null;
  const sub = p.args[0];
  if (p.cmd === 'bun' && sub && /\.(?:m?js|cjs|ts|mts)$/.test(sub)) return null;
  if (!sub) return null;
  if (sub === 'audit' && p.args.includes('fix')) return 'Denied: npm audit fix changes the dependencies, and a dependency is a human decision (ADR-001); ask the human.';
  if (sub === 'config' && !/^(?:get|list|ls)$/.test(p.args[1] ?? '')) return 'Denied: a package manager setting (a registry, a script shell) is the human\'s; read with config get or list.';
  if (sub === 'pack' && !p.flags.some((f) => /^--dry-run$/.test(f))) return 'Denied: packing writes an archive; the human publishes (ADR-002).';
  if (PACKAGE_MANAGER_READS.has(sub)) return null;
  if (/^(?:exec|x|dlx|create|init|innit)$/.test(sub)) return 'Denied: npx runs code from outside the repo; this project has no dependencies, ask the human.';
  return 'Denied: installing or adding a package changes the dependencies, and a dependency is a human decision (ADR-001); ask the human.';
}

/** `gh api` and `glab api` may only read: no method but GET, in any spelling (`-X POST`, `-XPOST`, `--method=post`), and no field, input or template. */
export function ghApiProblem(p) {
  if (!/^(?:gh|glab)$/.test(p.cmd) || p.args[0] !== 'api') return null;
  const words = p.words.slice(p.words.indexOf('api') + 1);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const m = w.match(/^(?:-X|--method)(?:=|$)(.*)$/) ?? w.match(/^-X(.+)$/);
    if (m) {
      const method = (m[1] || words[++i] || '').toUpperCase();
      if (method !== 'GET') return 'Denied: gh api may only read (a plain GET without fields); anything it would change is the human\'s (ADR-002).';
      continue;
    }
    if (/^(?:-f|-F|--field|--raw-field|--input|--template|-t|--hostname)(?:=|$)|^-[a-zA-Z]*[fF]/.test(w)) return 'Denied: gh api may only read (a plain GET without fields); anything it would change is the human\'s (ADR-002).';
  }
  return null;
}

/** The only settings `git -c` may carry: an identity. Anything else (an alias, a pager, an editor, a helper, a `!` command) runs a program or redirects git past the gate. */
export const GIT_C_ALLOWED = /^(?:user\.name|user\.email|commit\.gpgsign|core\.quotepath|color\.ui)=/i;
export function gitConfigOptionProblem(globals) {
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    if (w === '--config-env' || w.startsWith('--config-env=')) return 'Denied: git --config-env sets a setting the gate cannot see; run plain git in the project.';
    if (w !== '-c' && !w.startsWith('-c=')) continue;
    const setting = w === '-c' ? globals[++i] ?? '' : w.slice(3);
    if (!GIT_C_ALLOWED.test(setting) || /=\s*!/.test(setting)) return `Denied: git -c ${setting.split('=')[0]} changes how git runs (an alias, a helper, a program) past the gate; only user.name and user.email may be set this way.`;
  }
  return null;
}

/** A program where only documents belong: docs/ is writable with no slice, so a script there would be a way to run code the plan never named. */
export const EXECUTABLE_DOC = /^(?:docs|\.claude)\/.*\.(?:m?js|cjs|ts|mts|py|sh|bash|zsh|rb|pl|php|ps1|bat|cmd)$/i;
export function isExecutableDoc(rel) {
  return EXECUTABLE_DOC.test(String(rel ?? ''));
}

/** A sed script that writes a file (`w`, `W`) or runs a command (`e`, the `e` flag of `s`): the one sed form the guard cannot follow. */
export const SED_EXECUTES = /(?:^|[;{\n\s])(?:[\d,$]+|\/[^/]*\/)?\s*(?:[wW]\s|e(?:\s|$))|\/[a-zA-Z]*e[a-zA-Z]*(?:\s*;|\s*$|\s*})/;
export function sedProblem(p) {
  if (p.cmd !== 'sed') return null;
  const at = p.words.findIndex((w) => commandName(w) === 'sed');
  const words = p.words.slice(at + 1);
  const scripts = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^--expression=/.test(w)) scripts.push(w.slice(13));
    else if (w === '-e' || w === '--expression') scripts.push(words[++i] ?? '');
    else if (w === '-f' || w === '--file' || /^--file=/.test(w)) return 'Denied: sed -f runs a script file the guard does not read; put the expression on the command line.';
  }
  if (!scripts.length) {
    const plain = words.filter((w, i) => !w.startsWith('-') && w !== '' && !(i > 0 && /^-[a-zA-Z]*i$/.test(words[i - 1]) && w === ''));
    if (plain[0] !== undefined) scripts.push(plain[0]);
  }
  return scripts.some((s) => SED_EXECUTES.test(s)) ? 'Denied: a sed script with w, W or e writes a file or runs a command the guard cannot see; use a plain substitution.' : null;
}

/** The paths a move writes: every source (it disappears) and, for each, where it lands (`dest/<name>` when dest is an existing folder). */
export function movedPaths(named, cwd) {
  if (named.length < 2) return named;
  const dest = named.at(-1);
  const sources = named.slice(0, -1);
  const destAbs = resolve(cwd, expandWord(dest, cwd));
  let isDir = false;
  try {
    isDir = statSync(destAbs).isDirectory();
  } catch {
    isDir = false;
  }
  return [...sources, ...(isDir ? sources.map((s) => join(dest, basename(s))) : [dest])];
}

/**
 * The paths a `git commit` names (after `--`, trailing, or with -i/--include and -o/--only): they are committed too,
 * so the gate must see them. `unparsed` when a path is a glob, a variable or `.`.
 */
export function commitPathspec(segment) {
  const p = parseSegment(segment);
  if (p.cmd !== 'git' || gitSubcommand(p.words) !== 'commit') return { files: [], unparsed: false };
  const args = p.words.slice(p.words.indexOf('commit') + 1);
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      files.push(...args.slice(i + 1));
      break;
    }
    if (a === '-m' || a === '--message' || a === '-F' || a === '--file' || a === '-C' || a === '-c' || a === '--author' || a === '--date') {
      i++;
      continue;
    }
    if (a === '-i' || a === '--include' || a === '-o' || a === '--only') continue;
    if (a.startsWith('-')) continue;
    files.push(a);
  }
  const unparsed = files.some((f) => f === '.' || f === '*' || UNRESOLVABLE.test(f));
  return { files: unparsed ? [] : files, unparsed };
}

/** Interpreters and the flags that make them run a program given on the command line (or from stdin when no script is named). */
const INTERPRETERS = { awk: /^-[a-zA-Z]*e/, gawk: /^-[a-zA-Z]*e/, mawk: /^-[a-zA-Z]*e/, nawk: /^-[a-zA-Z]*e/, node: /^(?:-e|--eval|-p|--print|-pe?|-ep?)$/, nodejs: /^(?:-e|--eval|-p|--print)$/, deno: /^(?:eval|repl)$/, bun: /^(?:-e|--eval|-p|--print)$/, python: /^-[a-zA-Z]*c/, python3: /^-[a-zA-Z]*c/, sh: /^-[a-zA-Z]*c/, bash: /^-[a-zA-Z]*c/, zsh: /^-[a-zA-Z]*c/, dash: /^-[a-zA-Z]*c/, ksh: /^-[a-zA-Z]*c/, perl: /^-[a-zA-Z]*[eE]/, ruby: /^-[a-zA-Z]*e/, php: /^-[a-zA-Z]*r/ };
const INTERPRETER_SELF_ARGS = /^--(?:test|version|help|check)\b|^-[vhV]$/;
/**
 * An interpreter one-liner, read from the parsed segment so `env`, `sudo`, `nice`, a path or a backslash do not hide it:
 * the command is an interpreter and it carries a program flag, `-` for stdin, a `deno eval`, or no script at all (a pipe
 * feeds it). `node --test`, `node -v`, `node script.js`, `python3 -m pytest` are not one-liners. xargs around an
 * interpreter is one too.
 */
export function interpreterOneLiner(segment) {
  const p = typeof segment === 'string' ? parseSegment(segment) : segment;
  if (p.unparsed) return true;
  const words = p.words.map(commandName);
  if (p.viaXargs && words.some((w) => Object.hasOwn(INTERPRETERS, w))) return true;
  const flagShape = INTERPRETERS[p.cmd];
  if (!flagShape) return false;
  if (/^[gmn]?awk$/.test(p.cmd)) return !p.flags.includes('-f') || p.args.length === 0 ? true : false;
  if (p.flags.some((f) => flagShape.test(f))) return true;
  if (p.cmd === 'deno' && p.args.some((a) => flagShape.test(a))) return true;
  if (p.args.includes('-')) return true;
  if (p.args.length === 0 && !p.flags.some((f) => INTERPRETER_SELF_ARGS.test(f))) return true;
  return false;
}
/** The script an interpreter runs (its first plain argument), when the command is an interpreter; null otherwise. */
export function interpreterScript(p) {
  return interpreterFiles(p)[0] ?? null;
}

/** Every file an interpreter would load: the script and the values of -r/--require/--import/--loader (separate or `=value`), in that order; a module run (`python3 -m`) has no script. */
export function interpreterFiles(p) {
  if (!Object.hasOwn(INTERPRETERS, p.cmd)) return [];
  const at = p.words.findIndex((w) => commandName(w) === p.cmd && !/=/.test(w));
  const words = at < 0 ? p.words : p.words.slice(at);
  const preload = [];
  const skip = new Set();
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const m = w.match(/^(?:-r|--require|--import|--loader|--experimental-loader|--env-file|--config-file|-I)(?:=(.*))?$/);
    if (m) {
      if (m[1] !== undefined) preload.push(m[1]);
      else {
        skip.add(i + 1);
        if (words[i + 1] !== undefined) preload.push(words[i + 1]);
      }
      continue;
    }
    if (w === '-m') skip.add(i + 1);
  }
  for (let i = 1; i < words.length; i++) if (/^\d?>{1,2}$|^<$/.test(words[i])) skip.add(i + 1);
  const plain = words.filter((w, i) => i > 0 && !skip.has(i) && !w.startsWith('-') && !/^\d?>{1,2}$|^<$|^&[12]$/.test(w));
  const script = (p.cmd === 'python' || p.cmd === 'python3') && p.flags.includes('-m') ? [] : plain.slice(0, 1);
  return [...script, ...preload.map((f) => f.replace(/^file:\/\//, ''))];
}

/**
 * A script run by an interpreter must be a file inside the project: a script in the temp folder or anywhere else was
 * written out of the guards' sight. `node --test` and module runs (`python3 -m`) carry no script.
 */
export function foreignScriptProblem(command, root) {
  let cwd = resolve(root);
  for (const segment of simpleCommands(command)) {
    const p = parseSegment(segment);
    if (DIR_CHANGERS.has(p.cmd)) {
      if (p.chdir !== 'popd' && !UNRESOLVABLE.test(expandWord(p.chdir, cwd))) cwd = resolve(cwd, expandWord(p.chdir, cwd));
      continue;
    }
    for (const script of interpreterFiles(p)) {
      if (!script.includes('/') && !/\.[a-z]+$/i.test(script) && !script.startsWith('.')) return `Denied: ${script} is a module loaded by name, from outside the project; a program loads only files inside it (or a kit tool).`;
      const expanded = expandWord(script, cwd);
      if (UNRESOLVABLE.test(expanded)) return `Denied: cannot tell which script "${script}" is (variable or glob); name a file inside the project.`;
      const abs = resolve(cwd, expanded);
      const cmp = comparablePath(abs);
      const base = comparablePath(root);
      const kit = comparablePath(KIT_ROOT);
      if (cmp === base || cmp.startsWith(base + sep) || cmp === kit || cmp.startsWith(kit + sep)) continue;
      return `Denied: ${script} is a script outside the project; a program runs only from a file inside it (or a kit tool), where the guards saw it written.`;
    }
  }
  return null;
}

/** Kept for the tests of older shapes: the regex form of the same rule, on the raw text. */
export const INTERPRETER_ONE_LINER = { test: (segment) => interpreterOneLiner(segment) };
/** What a one-liner may not mention when the builder or the main session runs it. */
export const ONE_LINER_WRITES = /writeFile|appendFile|writeSync|openSync|mkdir|rename|unlink|rmSync|rmdir|truncate|copyFile|createWriteStream|\bopen\(|child_process|execSync|spawnSync|\bexec\(|\bspawn\(|subprocess|os\.system|os\.remove|shutil|AGENTS\.md|CLAUDE\.md|docs\/decisions|REQUIREMENTS\.md|PLAN\.md|\.sdlc\/|decisions\.json|\bgit\b/;

/** For every role: an interpreter one-liner cannot be read by the guard (a write can be spelled a thousand ways, base64 among them), so none runs; a script file under the project is run plainly instead. */
export function oneLinerProblem(command) {
  for (const segment of simpleCommands(command)) {
    if (interpreterOneLiner(segment)) {
      return 'Denied: an interpreter one-liner (node -e, python -c, sh -c, a program piped into an interpreter) cannot be checked; use the Edit tool, a plain command, or run a script file.';
    }
  }
  return null;
}

/** What a judge may not run: anything that changes files or git state. Each entry: pattern over one simple command, the name shown. */
export const JUDGE_FORBIDDEN = [
  [/^\s*(?:\S*\/)?\\?git\s+(?:(?:-c|-C)\s+\S+\s+|-\S+\s+)*(add|commit|checkout|switch|reset|stash|clean|merge|rebase|push|pull|fetch|tag|rm|mv|restore|cherry-pick|revert|am|apply|worktree|config|checkout-index|read-tree|update-index|hash-object|commit-tree|write-tree|mktree|fast-import|notes|submodule|branch\s+-[dDmMcC])\b/, 'git $1'],
  [/^\s*(?:\S*\/)?\\?git\s+(?:-\S+\s+)*(?:-c\b|--config-env)/, 'git -c'],
  [/^\s*(?:sudo\s+)?(?:\S*\/)?\\?(rm|mv|cp|tee|mkdir|touch|chmod|chown|ln|truncate|install|dd|patch|rsync|tar|unzip|zip|gzip|gunzip|bzip2|xz|shred|ex|vi|vim|nano|rmdir|unlink)\b/, '$1'],
  [/^\s*(?:sudo\s+)?(?:\S*\/)?sed\s+(?:-[^\s]*\s+)*-i\b|^\s*sed\s+-[a-zA-Z]*i/, 'sed -i'],
  [/^\s*(?:sudo\s+)?(?:\S*\/)?[gmn]?awk\b/, 'awk'],
  [/(?<![0-9&])>{1,2}(?!\s*(?:&[12]\b|\/dev\/null\b))/, '> redirection'],
  [/^\s*(?:\S*\/)?(?:npm|npx|corepack|yarn|pnpm|bun|bunx|pnpx)\b/, '$&'],
  [/^\s*(?:\S*\/)?(?:gh|glab)\s+(?!(?:pr|issue|run|release|repo|api)\s+(?:view|list|status|diff|checks|download|log|watch)\b)/, '$&'],
];

export const UNSAFE_SENTENCE = 'Denied: cannot parse this command safely; run it as separate simple commands.';

/**
 * The commit shape Claude Code writes (optionally after `git add <files> && `): the whole command, nothing else.
 * The gate reads the heredoc body as the message, as before.
 */
export const COMMIT_HEREDOC = /^(?:git add [^;|&$`<>\n]+ && )?git commit (?:-[a-zA-Z](?: [^\s"$`<]+)? )*-m "\$\(cat <<'EOF'\n(?:(?!EOF\n)[^\n]*\n)*EOF\n\)"\s*$/;

/**
 * The guard does not parse shell. A command with `$(`, a backtick, `<<`, `<<<`, `<(` or `>(` anywhere is refused,
 * with one literal exception matched on the raw text: the commit heredoc shape as the whole command.
 */
export function unsafeTokenProblem(command) {
  const text = String(command);
  if (COMMIT_HEREDOC.test(text)) return null;
  if (/\$\(|`|<<|<\(|>\(/.test(text)) return UNSAFE_SENTENCE;
  return hasGroupingOutsideQuotes(text) ? UNSAFE_SENTENCE : null;
}

/**
 * Shell grouping and control words outside quotes: a subshell `( )`, a group `{ ; }`, `!`, `coproc`, `function`, `case`,
 * `if`, `while`, `for`, `until` at the start of a command. The guard reads simple commands only; these make the segment mean something else.
 * `{}` (find's placeholder) and `{a,b}` brace lists inside one word are not grouping.
 */
export function hasGroupingOutsideQuotes(text) {
  let quote = null;
  let word = '';
  const words = [];
  const flush = () => {
    if (word) words.push(word);
    word = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') {
      i++;
      word += 'x';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      word += 'q';
      continue;
    }
    if (c === '(' || c === ')') return true;
    if (/[\s;|&]/.test(c)) {
      flush();
      continue;
    }
    word += c;
  }
  flush();
  return words.some((w, i) => /^(?:\{|\}|!|coproc|function)$/.test(w) || (i === 0 && /^(?:case|if|while|until|for|select)$/.test(w)) || /^\{[^}]*$/.test(w) || (/^[^{]*\}$/.test(w) && w !== '}'));
}

/**
 * Splits a command into its simple commands at ;, &&, ||, | and newlines, outside quotes. `#` starts a comment only
 * at the start of a word, outside quotes. Returns { segments, problem }: `problem` is set when a quote is still open
 * at a newline or at the end, and every check then refuses the whole command.
 */
export function splitCommand(command) {
  const text = String(command).replace(/\\\r?\n/g, ' ');
  const segments = [];
  let current = '';
  let quote = null;
  let comment = false;
  const push = () => {
    segments.push(current);
    current = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '\n') {
      if (quote) return { segments, problem: 'a quote is still open at a newline' };
      comment = false;
      push();
      continue;
    }
    if (comment) continue;
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < text.length) {
        current += c + next;
        i++;
        continue;
      }
      if (c === quote) quote = null;
      current += c;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      current += c + next;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === '#' && /^\s*$|\s$/.test(current)) {
      comment = true;
      continue;
    }
    if (c === ';' || c === '|' || (c === '&' && next === '&')) {
      push();
      if ((c === '|' && next === '|') || c === '&') i++;
      continue;
    }
    if (c === '&' && !/[\d>]$/.test(current) && !/^[\s]*$/.test(current)) {
      current += ' &';
      push();
      continue;
    }
    current += c;
  }
  if (quote) return { segments, problem: 'a quote is still open at the end' };
  segments.push(current);
  return { segments: segments.map((s) => s.trim()).filter(Boolean), problem: null };
}

/** The simple commands of a line; a command the splitter cannot read gives its best-effort segments (callers check splitCommand first). */
export function simpleCommands(command) {
  return splitCommand(command).segments.map((s) => s.trim()).filter(Boolean);
}

/** The whole-command checks every entry point runs first: unsafe tokens, then an unreadable quote. */
export function wholeCommandProblem(command) {
  if (COMMIT_HEREDOC.test(String(command))) return null;
  const unsafe = unsafeTokenProblem(command) ?? (splitCommand(command).problem ? UNSAFE_SENTENCE : null);
  if (unsafe) return unsafe;
  return simpleCommands(command).some((s) => /^\s*(?:\S*\/)?(?:eval|source|\.)\s/.test(s) || /^\s*(?:\S*\/)?(?:eval|source)$/.test(s)) ? UNSAFE_SENTENCE : null;
}

/** Quoted text replaced by a placeholder word, so `node -e "a > b"` is not read as a redirection. */
const unquoted = (segment) => segment.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, 'q');

/** The first thing a judge may not do in this command, or null. */
export function judgeProblem(command) {
  if (wholeCommandProblem(command)) return 'an unreadable command';
  for (const segment of simpleCommands(command)) {
    if (interpreterOneLiner(segment)) return 'an interpreter one-liner (node -e, python -c, sh -c)';
    if (foreignScriptProblem(segment, process.cwd())) return 'a script outside the project';
    for (const [pattern, shown] of JUDGE_FORBIDDEN) {
      const m = unquoted(segment).match(pattern);
      if (m) return shown.replace('$&', m[0].trim()).replace('$1', m[1] ?? '').trim();
    }
    const p = parseSegment(segment);
    if (p.unparsed) return 'an unreadable command';
    if (sedProblem(p)) return 'sed with w, W or e';
    if (WRITERS.has(p.cmd) || writeTargets(p).some((t) => !/^\/dev\/(null|stdout|stderr)$/.test(t))) return p.cmd ?? 'a write';
  }
  return null;
}

const fold = (text) => (process.platform === 'darwin' || process.platform === 'win32' ? text.toLowerCase() : text);

/** The kit root in the forms a command may spell it, lower-cased on a case-insensitive file system. */
export function kitSpellings(kitRoot = KIT_ROOT) {
  const forms = new Set([resolve(kitRoot)]);
  try {
    forms.add(realpathSync(kitRoot));
  } catch {
    // the kit root always exists when the hook runs; keep the resolved form otherwise
  }
  return [...forms].map((f) => f.replace(/\/+$/, '')).map(fold);
}

/** The words of one simple command, quotes honoured and removed, an unquoted backslash dropped the way the shell drops it (`n\\pm` is `npm`, `.en\\v` is `.env`); `>` and `>>` become words of their own. */
export function shellWords(segment) {
  const words = [];
  let word = '';
  let quote = null;
  let has = false;
  const push = () => {
    if (has) words.push(word);
    word = '';
    has = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < segment.length) word += segment[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (c === '\\' && i + 1 < segment.length) {
      word += segment[++i];
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      push();
      continue;
    }
    if (c === '<') {
      push();
      words.push('<');
      continue;
    }
    if (c === '>') {
      const fd = /\d$/.test(word) && word.length === 1 ? word : null;
      if (fd) {
        word = '';
        has = false;
      } else push();
      let op = '>';
      if (segment[i + 1] === '>') {
        op = '>>';
        i++;
      }
      words.push(fd ? `${fd}${op}` : op);
      continue;
    }
    word += c;
    has = true;
  }
  push();
  return words;
}

/** Prefix words that run another command, with the options the guard knows; an unknown option refuses the segment. */
const PREFIXES = {
  sudo: { withValue: ['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-T', '-U'], flags: ['-E', '-n', '-S', '-b', '-H', '-i', '-s', '-k', '-K', '-v', '-A', '-P'] },
  nice: { withValue: ['-n'], flags: [] },
  exec: { withValue: ['-a'], flags: ['-c', '-l'] },
  time: { withValue: [], flags: ['-p', '-l'] },
  env: { withValue: ['-C', '--chdir', '-u', '--unset'], flags: ['-i', '-0', '-v', '--ignore-environment'] },
  command: { withValue: [], flags: ['-p', '-v', '-V'] },
  nohup: { withValue: [], flags: [] },
  builtin: { withValue: [], flags: [] },
};
/** Commands that change what they name. */
export const WRITERS = new Set(['rm', 'mv', 'cp', 'tee', 'touch', 'mkdir', 'chmod', 'chown', 'ln', 'truncate', 'install', 'dd', 'rmdir', 'unlink', 'rsync', 'tar', 'unzip', 'zip', 'gzip', 'gunzip', 'bzip2', 'xz', 'patch', 'shred', 'ex', 'vi', 'vim', 'nano']);
const DIR_CHANGERS = new Set(['cd', 'pushd', 'popd']);
const DEST_COMMANDS = new Set(['cp', 'mv', 'install', 'ln']);
const UNRESOLVABLE = /[$`*?[{]/;
/** A target the parser could not read; it never resolves, so every check refuses it. */
const UNPARSED = '$?';

/** `~`, `$HOME`, `$TMPDIR`, `$CLAUDE_PLUGIN_ROOT`, `$KIT` and `$PWD` spelled out, so the path can be judged. */
export function expandWord(word, cwd, kitRoot = KIT_ROOT) {
  const home = homedir();
  return String(word)
    .replace(/^~(?=\/|$)/, home)
    .replace(/\$\{?HOME\}?/g, home)
    .replace(/\$\{?TMPDIR\}?/g, tmpdir())
    .replace(/\$\{?(?:CLAUDE_PLUGIN_ROOT|KIT)\}?/g, resolve(kitRoot))
    .replace(/\$\{?PWD\}?/g, cwd);
}

/** The command's name as the shell resolves it: `/usr/bin/git` and `\git` are `git`. */
export function commandName(word) {
  return basename(String(word ?? '').replace(/^\\/, ''));
}

/** The index of the `git` word in a segment's words (spelled plainly, with a path, or escaped), or -1. */
export function gitIndex(words) {
  return words.findIndex((w) => commandName(w) === 'git');
}

/**
 * One simple command taken apart: cmd, args (flags out), flags, redirect targets, the directory a cd/pushd/popd
 * changes to (chdir), the directory an `env -C` runs in (envDir), background, xargs, and `unparsed`
 * when a prefix word carries an option the guard does not know.
 */
export function parseSegment(segment) {
  const raw = String(segment);
  const words = shellWords(raw);
  const out = { raw, words, cmd: null, args: [], flags: [], targets: [], chdir: null, envDir: null, background: false, viaXargs: /(^|\s)xargs(\s|$)/.test(raw), prefixed: false, unparsed: null };
  const rest = [];
  for (let i = 0; i < words.length; i++) {
    if (/^\d?>{1,2}$/.test(words[i])) {
      const target = words[i + 1];
      if (target !== undefined && !/^&[12]$/.test(target)) out.targets.push(target);
      i++;
      continue;
    }
    if (words[i] === '<') continue;
    rest.push(words[i]);
  }
  if (rest.at(-1) === '&') {
    out.background = true;
    rest.pop();
  } else if (rest.length && rest.at(-1).endsWith('&') && !/&[12]$/.test(rest.at(-1))) {
    out.background = true;
    rest[rest.length - 1] = rest.at(-1).slice(0, -1);
  }
  let i = 0;
  while (i < rest.length && /^\w+=/.test(rest[i])) i++;
  if (i > 0) out.prefixed = true;
  while (i < rest.length && Object.hasOwn(PREFIXES, rest[i])) {
    const spec = PREFIXES[rest[i]];
    const name = rest[i];
    out.prefixed = true;
    i++;
    while (i < rest.length && (rest[i].startsWith('-') || (name === 'env' && /^\w+=/.test(rest[i])))) {
      const word = rest[i];
      const eq = word.indexOf('=');
      const key = word.startsWith('--') && eq > 0 ? word.slice(0, eq) : word;
      if (name === 'env' && /^\w+=/.test(word)) {
        i++;
        continue;
      }
      if (spec.withValue.includes(key)) {
        const value = word.startsWith('--') && eq > 0 ? word.slice(eq + 1) : rest[i + 1];
        if (name === 'env' && (key === '-C' || key === '--chdir')) out.envDir = value ?? UNPARSED;
        i += word.startsWith('--') && eq > 0 ? 1 : 2;
        continue;
      }
      if (spec.flags.includes(key)) {
        i++;
        continue;
      }
      out.unparsed = `${name} ${word}`;
      return finish(out, rest, i, true);
    }
  }
  return finish(out, rest, i, false);
}

function finish(out, rest, i, stop) {
  if (stop) return out;
  out.cmd = rest[i] === undefined ? null : commandName(rest[i]);
  const tail = rest.slice(i + 1);
  out.flags = tail.filter((w) => w.startsWith('-') && w !== '-');
  out.args = tail.filter((w) => !w.startsWith('-') || w === '-');
  if (DIR_CHANGERS.has(out.cmd)) out.chdir = out.cmd === 'popd' ? 'popd' : (out.args[0] ?? '~');
  return out;
}

/** The long options cp, mv, install and ln may carry; any other long option (GNU abbreviations included) is unparsed. */
const DEST_LONG_OPTIONS = new Set(['--recursive', '--force', '--no-clobber', '--preserve', '--verbose', '--symbolic', '--interactive', '--archive']);

/**
 * The destination of cp, mv, install, ln: -t DIR, -tDIR, -t in a flag cluster, --target-directory[=| ]DIR, else the
 * last argument. A long option not on the short allowlist makes the destination unparsed, so the segment is refused.
 */
export function destinationOf(p) {
  const tail = p.words.slice(p.words.indexOf(p.cmd) + 1);
  for (let i = 0; i < tail.length; i++) {
    const w = tail[i];
    if (w === '--target-directory') return tail[i + 1] ?? UNPARSED;
    if (w.startsWith('--target-directory=')) return w.slice(19) || UNPARSED;
    if (w.startsWith('--')) {
      if (!DEST_LONG_OPTIONS.has(w.split('=')[0])) return UNPARSED;
      continue;
    }
    if (/^-[a-zA-Z]*t/.test(w)) {
      const after = w.slice(w.indexOf('t') + 1);
      return after || tail[i + 1] || UNPARSED;
    }
  }
  return p.args.length ? p.args.at(-1) : UNPARSED;
}

/**
 * The files an in-place sed writes: the words after the options, minus the script. BSD sed takes `-i ''` (an empty
 * suffix word), GNU takes `-i` or `-i.bak`; with -e/-f the script is an option value and every plain word is a file.
 */
export function sedTargets(p) {
  const tail = p.words.slice(p.words.indexOf(p.words.find((w) => commandName(w) === 'sed')) + 1);
  const files = [];
  let inPlace = false;
  let scripted = false;
  for (let i = 0; i < tail.length; i++) {
    const w = tail[i];
    if (w === '--') {
      files.push(...tail.slice(i + 1).filter(Boolean));
      break;
    }
    if (w.startsWith('--')) {
      if (w.startsWith('--in-place')) inPlace = true;
      if (/^--(?:expression|file)$/.test(w)) {
        scripted = true;
        i++;
      } else if (/^--(?:expression|file)=/.test(w)) scripted = true;
      continue;
    }
    if (w.startsWith('-') && w !== '-') {
      const letters = w.slice(1);
      if (letters.includes('i')) {
        inPlace = true;
        if (letters.endsWith('i') && tail[i + 1] === '') i++;
      }
      if (/[ef]$/.test(letters)) {
        scripted = true;
        i++;
      } else if (/[ef]/.test(letters)) scripted = true;
      continue;
    }
    if (w === '') continue;
    files.push(w);
  }
  if (!inPlace) return [];
  return scripted ? files : files.slice(1);
}

/** The paths a segment writes to: redirection targets and the destinations of the writer commands (a move names its sources too). */
export function writeTargets(segment) {
  const p = typeof segment === 'string' ? parseSegment(segment) : segment;
  const targets = [...p.targets];
  const { cmd, args, flags, words } = p;
  if (cmd === 'mv') targets.push(...args.slice(0, -1), destinationOf(p));
  else if (DEST_COMMANDS.has(cmd)) targets.push(destinationOf(p));
  else if (cmd === 'dd') targets.push(...words.filter((w) => w.startsWith('of=')).map((w) => w.slice(3)));
  else if (cmd === 'sed') targets.push(...sedTargets(p));
  else if (cmd === 'sort') {
    const at = words.findIndex((w) => w === '-o' || w === '--output');
    if (at >= 0) targets.push(words[at + 1] ?? UNPARSED);
    const eq = words.find((w) => w.startsWith('--output='));
    if (eq) targets.push(eq.slice(9) || UNPARSED);
  } else if (cmd === 'chmod') targets.push(...args.filter((a) => !/^[ugoa]*[+\-=][rwxXst]*$/.test(a) && !/^[0-7]{3,4}$/.test(a)));
  else if (cmd === 'chown') targets.push(...args.slice(1));
  else if (WRITERS.has(cmd)) targets.push(...args);
  return targets;
}

const KIT_READERS = new Set(['cat', 'head', 'tail', 'grep', 'ls', 'wc', 'diff', 'file', 'stat', 'cut', 'sort', 'uniq', 'tr', 'jq', 'realpath', 'readlink', 'basename', 'dirname', 'test', '[']);
/** The one sed form that only reads: `sed -n '<range>p' <file>`; awk, less and any other sed can run a program or write. */
const SED_PRINT = /^\s*(?:\S*\/)?sed\s+-n\s+(?:'[\d,$]*p'|"[\d,$]*p"|[\d,$]*p)\s+\S+\s*$/;

/**
 * A command that touches the kit with anything but cat, head, tail, grep, ls or `node <kit>/tools/<name>.mjs`, or
 * null. Fail closed: a prefix, a flag before node, a background job, xargs, a writer, an unknown
 * command or a redirection into the kit are all refused.
 */
export function kitWriteProblem(command, kitRoot = KIT_ROOT, root = process.cwd()) {
  const spellings = kitSpellings(kitRoot);
  const kit = comparablePath(kitRoot);
  const mentions = (word) => {
    const expanded = expandWord(word, root, kitRoot);
    if (spellings.some((k) => fold(expanded).includes(k))) return true;
    if (!expanded.includes('/')) return false;
    const cmp = comparablePath(resolve(root, expanded));
    return cmp === kit || cmp.startsWith(kit + sep);
  };
  const refuse = (what) => `Denied: ${what}; the kit changes in its own repository, and from a project session only cat, head, tail, grep, ls and node <kit>/tools/<name>.mjs may touch it.`;
  const whole = wholeCommandProblem(command);
  if (whole) return whole;
  for (const segment of simpleCommands(command)) {
    const p = parseSegment(segment);
    if (!p.words.some(mentions)) continue;
    if (p.background || p.viaXargs) return refuse('a background job or xargs around the kit path cannot be checked');
    if (p.unparsed) return refuse(`"${p.unparsed}" is not an option the guard knows`);
    if (p.prefixed) return refuse(`"${p.words[0]}" before the command hides what runs on the kit`);
    if (writeTargets(p).some(mentions)) return refuse(`the command would write into the kit with "${p.cmd}"`);
    if (p.cmd === 'node') {
      const script = p.words[1];
      if (!script || !mentions(script) || !/\/tools\/[\w-]+\.mjs$/.test(expandWord(script, root, kitRoot))) {
        return refuse('node on the kit is allowed only as node <kit>/tools/<name>.mjs with the script right after node');
      }
      continue;
    }
    if (p.cmd === 'sed' && SED_PRINT.test(segment)) continue;
    if (!KIT_READERS.has(p.cmd)) return refuse(`"${p.cmd ?? segment.trim()}" is not a reader`);
  }
  return null;
}

/**
 * Shell writes inside the project follow the same rules as Edit and Write: never a human-only file, never the plan or
 * a second slice marker while a slice is active, and inside the slice's files (or docs/** with no slice).
 */
export function projectWriteProblem(command, root, role = { name: 'main', writes: 'main' }) {
  let cwd = resolve(root);
  for (const segment of simpleCommands(command)) {
    const p = parseSegment(segment);
    if (DIR_CHANGERS.has(p.cmd)) {
      if (p.chdir !== 'popd' && !UNRESOLVABLE.test(expandWord(p.chdir, cwd))) cwd = resolve(cwd, expandWord(p.chdir, cwd));
      continue;
    }
    const segmentCwd = p.envDir !== null && !UNRESOLVABLE.test(expandWord(p.envDir, cwd)) ? resolve(cwd, expandWord(p.envDir, cwd)) : cwd;
    const plain = p.args.filter((a) => a !== '--');
    const targets = p.cmd === 'mv' && plain.length >= 2 && !plain.some((a) => UNRESOLVABLE.test(expandWord(a, segmentCwd))) ? [...p.targets, ...movedPaths(plain, segmentCwd)] : writeTargets(p);
    for (const raw of targets) {
      const problem = pathWriteProblem(root, segmentCwd, raw, { cmd: p.cmd, segment, words: p.words }, role);
      if (problem) return problem;
    }
  }
  return null;
}

/** The slice marker may go only when the slice is done: tests green and its files committed (or the human removes it). */
function sliceMarkerRemovalProblem(root, slice) {
  const scope = allowedScope(root);
  const files = scope.files ?? [];
  const tests = runTests(root);
  if (!tests.ok) return `Denied: ${slice} is active and tests are red (${tests.summary}); make them pass and commit before rm .sdlc/slice, or ask the human to close the slice.`;
  let dirty = [];
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    dirty = out.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  } catch {
    dirty = [];
  }
  if (dirty.length) return `Denied: ${slice} is active and ${dirty.length} of its file${dirty.length === 1 ? ' is' : 's are'} not committed (${dirty.slice(0, 3).join(', ')}); commit through the gate before rm .sdlc/slice, or ask the human to close the slice.`;
  return null;
}

/**
 * One path a shell command (or git rm / git mv) would write, judged by the file rules: never a human-only file, the plan
 * or a second slice marker while a slice is active, documents only through Edit/Write (the checklist may be appended
 * by echo, never ticked), the tester's specs never by the builder, and inside the role's scope. `where.cmd` is the
 * command as resolved (`rm`, `git mv`, `>`...). Returns the denial sentence or null.
 */
export function pathWriteProblem(root, cwd, raw, where, role = { name: 'main', writes: 'main' }) {
  if (/^\/dev\/(null|stdout|stderr)$/.test(raw)) return null;
  const expanded = expandWord(raw, cwd);
  if (UNRESOLVABLE.test(expanded)) return null;
  const base = comparablePath(root);
  const abs = resolve(cwd, expanded);
  const spelled = toProjectPath(root, abs);
  if (spelled && !spelled.startsWith('../') && spelled !== '..' && isSymlink(root, spelled)) return `Denied: ${spelled} goes through a symbolic link, so the write would land somewhere else; write to a plain path inside the project.`;
  const cmp = comparablePath(abs);
  if (cmp !== base && !cmp.startsWith(base + sep)) return null;
  const rel = toProjectPath(root, abs);
  if (!rel || rel === '.') return null;
  const cmd = where.cmd ?? '';
  const removes = /^(?:git )?(?:rm|mv)$/.test(cmd) && !(cmd === 'mv' && raw === where.words?.at(-1));
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (isDir && removes && !(rel === '.sdlc' || rel.startsWith('.sdlc/'))) return `Denied: ${rel} is a folder; remove or move its files one by one so each can be checked, or ask the human.`;
  if (isProjectSkillPath(rel)) return 'Denied: project skills are written with the Write tool, not through the shell, so each one can be checked as one piece.';
  if (isDecisionPath(rel)) return `Denied: ${rel} is a decision record; a proposed ADR is written with the Write tool so its Status line can be checked, never through the shell.`;
  const slice = activeSlice(root);
  if (rel === '.sdlc/stop-warned') {
    if (cmd === 'rm') return null;
    return 'Denied: .sdlc/stop-warned is hook state; only rm may touch it.';
  }
  if (rel === SLICE_MARKER) {
    if (cmd === 'mkdir' || isDir) return `Denied: ${rel} is kit state; only the slice marker is written by hand (mkdir -p .sdlc, echo S<n> > .sdlc/slice, rm .sdlc/slice).`;
    if (cmd === 'rm') return slice ? sliceMarkerRemovalProblem(root, slice) : null;
    if (slice) return `Denied: ${slice} is active; finish it and run rm .sdlc/slice after the commit before starting another slice.`;
    if (!APPROVED_STATUS.test(readText(resolve(root, PLAN_FILE)))) return `Denied: ${PLAN_FILE} is not approved (no "Status: approved" line); the human approves the plan before a slice starts.`;
    return null;
  }
  if (rel === '.sdlc' || rel.startsWith('.sdlc/')) {
    if (cmd === 'mkdir' && rel === '.sdlc') return null;
    if (cmd === 'rm' && rel !== '.sdlc') return null;
    return `Denied: ${rel} is kit state; only the slice marker is written by hand (mkdir -p .sdlc, echo S<n> > .sdlc/slice, rm .sdlc/slice).`;
  }
  const humanOnly = isHumanOnly(root, rel, role);
  if (humanOnly) return `Denied: ${humanOnly}; the human edits it, you ask.`;
  if (slice && rel === PLAN_FILE) return `Denied: ${PLAN_FILE} cannot change while ${slice} is active; a wider slice is a human decision.`;
  if ((SETUP_WRITABLE.includes(rel) || rel.startsWith('.githooks/') || rel.startsWith('.github/')) && !(cmd === 'chmod' && where.words?.includes('+x'))) return `Denied: ${rel} is the gate's own installation; /sdlc-kit:init writes it from the kit's template and chmod +x makes it run, nothing else changes it through the shell.`;
  if (isScriptOwnedPath(rel)) return `Denied: ${rel} is written by the review scripts (review.mjs, reqreview.mjs render) from the agents' answers; the clerk saves only the answer files, nothing writes the verdict by hand.`;
  if (rel === MANUAL_CHECKS_FILE) {
    const appends = /^(?:echo|printf)$/.test(cmd) && where.words?.includes('>>') && !where.words.includes('>');
    if (!appends) return `Denied: ${rel} changes only by appending a check line (echo "- [ ] ..." >> ${rel}) or with the Edit tool; ${cmd} on it cannot be checked.`;
    if (/\[[xX]\]/.test(where.segment ?? '')) return `Denied: a ticked check ([x]) in ${rel} is the human's signature that they ran it; add checks unticked.`;
  } else if (/^docs\/.*\.md$/i.test(rel)) return `Denied: ${rel} is a document; documents are written with the Edit or Write tool so their content (an approval line among it) can be checked, never through the shell.`;
  if (isExecutableDoc(rel)) return `Denied: ${rel} is a program under docs/; docs/ holds documents, programs live in the slice's files.`;
  if ((cmd === 'ln' || isSymlink(root, rel)) && /^docs\//i.test(rel)) return `Denied: ${rel} would be, or is, a symbolic link under docs/; documents are plain files written with Edit or Write.`;
  if (isTesterSpec(rel) && !hasOwnPaths(role)) return `Denied: ${rel} is the tester's test (a .spec file); the builder makes it pass and adds its own tests in a .test file, it never changes or removes the tester's.`;
  const scope = allowedScope(root, isMainSession(role) ? 'main' : role.writes === 'main' ? 'other' : role.writes);
  if (scope.error) return `Denied: .sdlc/slice says ${scope.slice} but ${scope.error}; run /sdlc-kit:plan-slices or fix the marker before writing ${rel}.`;
  if (isInScope(rel, scope)) return null;
  if (scope.patterns) return `${role.name} writes only ${scope.patterns.join(', ')}. ${rel} is not among them. Stop and ask the human.`;
  if (!scope.slice) {
    if (isProjectSkillPath(rel)) return `${role.name} writes only its slice; project skills under .claude/skills/ are written by the main session.`;
    return `No slice is active: only docs/** may change. ${rel} needs /sdlc-kit:implement-slice S<n> first.`;
  }
  return `${scope.slice} allows ${scope.files.join(', ')}. ${rel} is not in the plan. Stop and ask the human.`;
}

export { isSymlink };

/** The git subcommand: the first word after `git` that is not an option or the value of -C or -c. */
export function gitSubcommand(words) {
  const i = gitIndex(words);
  if (i < 0) return null;
  for (let j = i + 1; j < words.length; j++) {
    if (words[j] === '-C' || words[j] === '-c') j++;
    else if (!words[j].startsWith('-')) return words[j];
  }
  return null;
}

/** The files a `git add <files> &&` prefix stages, or an unparsed marker for -A, --all, . and -u. */
export function stagedByPrefix(command) {
  const files = [];
  for (const segment of simpleCommands(command)) {
    const p = parseSegment(segment);
    if (p.cmd !== 'git' || gitSubcommand(p.words) !== 'add') continue;
    const words = p.words.slice(p.words.indexOf('add') + 1);
    if (words.some((w) => /^(-A|--all|-u|--update|\.|\*)$/.test(w) || (w.startsWith('-') && /[Au]/.test(w)))) return { files, unparsed: true };
    files.push(...words.filter((w) => !w.startsWith('-')));
  }
  return { files, unparsed: false };
}

/**
 * A shell write whose target is outside the project, cannot be resolved, or follows a directory change the guard
 * cannot follow, or null. Relative paths are read against the directory cd, pushd and popd leave; `env -C DIR`
 * applies to its own segment only.
 */
/** Where a shell may write besides the project: the temp folders (a by-hand defect plant, mktemp -d). */
export function writableBases(root) {
  return [...new Set([root, tmpdir(), '/tmp', '/private/tmp'].map(comparablePath))];
}

export function outsideWriteProblem(command, root) {
  const bases = writableBases(root);
  const inside = (abs) => {
    const cmp = comparablePath(abs);
    return bases.some((base) => cmp === base || cmp.startsWith(base + sep));
  };
  const whole = wholeCommandProblem(command);
  if (whole) return whole;
  if (/>\|/.test(command)) return 'Denied: >| forces a write past the shell\'s guard; use a plain > inside the project.';
  let cwd = resolve(root);
  const stack = [];
  for (const segment of simpleCommands(command)) {
    const p = parseSegment(segment);
    if (p.viaXargs) return 'Denied: xargs hides the files it works on; name them in the command.';
    if (p.unparsed) return `Denied: "${p.unparsed}" is not an option the guard knows; write the command plainly.`;
    if (DIR_CHANGERS.has(p.cmd)) {
      if (p.chdir === 'popd') {
        cwd = stack.pop() ?? cwd;
        continue;
      }
      const target = expandWord(p.chdir, cwd);
      if (UNRESOLVABLE.test(target)) return `Denied: cannot tell where "${p.chdir}" points (variable or glob); the commands after it cannot be checked.`;
      const dest = resolve(cwd, target);
      if (!inside(dest)) return `Denied: ${p.cmd} to ${p.chdir} leaves the project; run commands from the project root.`;
      if (p.cmd === 'pushd') stack.push(cwd);
      cwd = dest;
      continue;
    }
    let segmentCwd = cwd;
    if (p.envDir !== null) {
      const target = expandWord(p.envDir, cwd);
      if (UNRESOLVABLE.test(target)) return `Denied: cannot tell where "${p.envDir}" points (variable or glob); the command cannot be checked.`;
      segmentCwd = resolve(cwd, target);
      if (!inside(segmentCwd)) return `Denied: env -C ${p.envDir} leaves the project; run commands from the project root.`;
    }
    const targets = writeTargets(p);
    const writes = targets.length > 0 || WRITERS.has(p.cmd);
    if (!writes) continue;
    if (p.background) return 'Denied: a background job (&) around a write cannot be checked; run it in the foreground.';
    for (const raw of targets) {
      if (/^\/dev\/(null|stdout|stderr)$/.test(raw)) continue;
      const expanded = expandWord(raw, segmentCwd);
      if (UNRESOLVABLE.test(expanded)) return `Denied: cannot tell where "${raw}" points (variable, glob or an unparsed option); use a plain path inside the project.`;
      if (!inside(resolve(segmentCwd, expanded))) return `Denied: ${raw} is outside the project; write only inside it, or ask the human.`;
    }
  }
  return null;
}

/** The two hooksPath commands /sdlc-kit:init runs (set to .githooks, read it back); any other hooksPath use stays denied. */
export const INIT_HOOKS_PATH = /^\s*git\s+config\s+core\.hooksPath(\s+\.githooks\/?)?\s*$/;

/** The subject line of the -m / --message argument, including the heredoc form -m "$(cat <<'EOF' ... EOF)". */
export function commitMessage(command) {
  const m = command.match(/(?:^|\s)(?:-m|--message)(?:=|\s+)([\s\S]*)$/);
  if (!m) return null;
  let rest = m[1];
  if (rest.startsWith('"$(cat <<')) {
    const lines = rest.split('\n').slice(1);
    return lines.find((l) => l.trim() && !/^\s*EOF\s*$/.test(l))?.trim() ?? '';
  }
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    let out = '';
    for (let i = 1; i < rest.length; i++) {
      const c = rest[i];
      if (c === '\\' && quote === '"' && i + 1 < rest.length) {
        out += rest[++i];
        continue;
      }
      if (c === quote) break;
      out += c;
    }
    return out.split('\n')[0].trim();
  }
  return rest.split(/\s/)[0];
}

export function decide(input, roles = loadRoles()) {
  if (input.tool_name !== 'Bash') return null;
  const command = String(input.tool_input?.command ?? '');
  if (!command.trim()) return null;
  const whole = wholeCommandProblem(command);
  if (whole) return whole;
  const role = roleOf(input, roles);
  if (isJudge(role)) {
    const problem = judgeProblem(flattenHeredoc(command));
    if (problem) return `${role.name} may not change files or git state; it reads and runs tests (refused: ${problem}).`;
  }
  const root = projectRoot(input);
  const kitProblem = kitWriteProblem(command, KIT_ROOT, root);
  if (kitProblem) return kitProblem;
  const flat = flattenHeredoc(command);
  const checked = forbiddenText(flat);
  for (const [pattern, reason] of FORBIDDEN) if (pattern.test(checked)) return reason;
  const outside = outsideWriteProblem(flat, root);
  if (outside) return outside;
  let cwd = resolve(root);
  let commitSegment = null;
  let commitCwd = cwd;
  for (const segment of simpleCommands(flat)) {
    const p = parseSegment(segment);
    if (DIR_CHANGERS.has(p.cmd)) {
      if (p.chdir !== 'popd' && !UNRESOLVABLE.test(expandWord(p.chdir, cwd))) cwd = resolve(cwd, expandWord(p.chdir, cwd));
      continue;
    }
    const problem = gitProblem(segment, root, role, cwd) ?? packageManagerProblem(p) ?? ghApiProblem(p) ?? sedProblem(p);
    if (problem) return problem;
    if (!commitSegment && p.cmd === 'git' && gitSubcommand(p.words) === 'commit') {
      commitSegment = segment;
      commitCwd = p.envDir !== null && !UNRESOLVABLE.test(expandWord(p.envDir, cwd)) ? resolve(cwd, expandWord(p.envDir, cwd)) : cwd;
    }
  }
  if (!isJudge(role)) {
    const inside = projectWriteProblem(flat, root, role) ?? oneLinerProblem(flat) ?? foreignScriptProblem(flat, root);
    if (inside) return inside;
  }
  if (!commitSegment) return null;
  if (comparablePath(commitCwd) !== comparablePath(root)) return 'Denied: git commit runs from the project root, where the gate sees it; do not cd before it.';

  const message = commitMessage(command);
  if (message == null) return `Commit refused: pass the message with -m, in the form ${COMMIT_MESSAGE_HINT}.`;
  const staged = stagedByPrefix(flat);
  if (staged.unparsed) return 'Commit refused: stage the slice files by name (git add <file> <file>); -A, -u, . and * cannot be checked before the commit.';
  const named = commitPathspec(commitSegment);
  if (named.unparsed) return 'Commit refused: the paths after git commit cannot be read (glob, variable or .); name the files.';
  const gate = runGate({ root, staged: true, message, extraStaged: [...staged.files, ...named.files] });
  if (gate.ok) return null;
  const failed = gate.rows.filter((r) => !r.ok);
  const why = failed.map((r) => `${r.label}: ${r.text}`).join('; ');
  return `Commit refused: ${why}.\n${gate.lines.join('\n')}`;
}

if (isMain(import.meta.url)) runGuard((input) => decide(input));
