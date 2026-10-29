import test from 'node:test';
import assert from 'node:assert/strict';
import { commitMessage, judgeProblem, decide, kitWriteProblem, outsideWriteProblem, writeTargets, simpleCommands, splitCommand, unsafeTokenProblem, stagedByPrefix, commitPathspec, COMMIT_HEREDOC, UNSAFE_SENTENCE } from './hook-commit-guard.mjs';
import { runGate } from './gate.mjs';
import { KIT_ROOT } from './roles.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, cleanup, runHook, bashInput, git, write, runTool, PLAN } from './fixtures.mjs';

const guard = (cwd, command) => runHook('hook-commit-guard.mjs', bashInput(cwd, command));

/** The guard expands ~ and $HOME through os.homedir(), which reads HOME: pin it so a throwaway HOME under /tmp cannot turn an outside write into an allowed one. */
const FIXED_HOME = '/Users/testhome';
function withHome(fn) {
  const saved = process.env.HOME;
  process.env.HOME = FIXED_HOME;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.HOME;
    else process.env.HOME = saved;
  }
}


test('commitMessage extracts the subject from -m, --message and the heredoc form', () => {
  assert.equal(commitMessage('git commit -m "S1: a (R-01)"'), 'S1: a (R-01)');
  assert.equal(commitMessage("git add -A && git commit -m 'S1: a (R-01)'"), 'S1: a (R-01)');
  assert.equal(commitMessage('git commit --message="S1: a (R-01)"'), 'S1: a (R-01)');
  assert.equal(commitMessage('git commit -m "$(cat <<\'EOF\'\nS1: a (R-01)\n\nbody\nEOF\n)"'), 'S1: a (R-01)');
  assert.equal(commitMessage('git commit -m "line one\nline two"'), 'line one');
  assert.equal(commitMessage('git commit'), null);
});

test('forbidden commands are denied with one sentence', () => {
  const root = makeProject();
  try {
    const cases = [
      ['npm install lodash', 'Denied: installing or adding a package changes the dependencies, and a dependency is a human decision (ADR-001); ask the human.'],
      ['npm i lodash', 'Denied: installing or adding a package changes the dependencies, and a dependency is a human decision (ADR-001); ask the human.'],
      ['npm ci', 'Denied: installing or adding a package changes the dependencies, and a dependency is a human decision (ADR-001); ask the human.'],
      ['yarn add left-pad', 'Denied: installing or adding a package changes the dependencies, and a dependency is a human decision (ADR-001); ask the human.'],
      ['rm --recursive --force build', 'Denied: rm with -r and -f is not allowed; remove files one by one with git rm, or ask the human.'],
      ['gh pr merge 12 --squash', 'Denied: the human opens, merges and releases (ADR-002); prepare docs/PR.md and say which command the human runs.'],
      ['gh release create v1.0.0', 'Denied: the human opens, merges and releases (ADR-002); prepare docs/PR.md and say which command the human runs.'],
      ['git branch -D other', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git switch main', "Denied: the AI stays on the current branch and commit; switching to another branch or commit is the human's call (ADR-002)."],
      ['git checkout abc1234', "Denied: the AI stays on the current branch and commit; switching to another branch or commit is the human's call (ADR-002)."],
      ['git merge feature', 'Denied: git merge rewrites the tree or the history past the gate; the human merges, rebases, reverts and pulls (ADR-002).'],
      ['git rebase main', 'Denied: git rebase rewrites the tree or the history past the gate; the human merges, rebases, reverts and pulls (ADR-002).'],
      ['git pull', 'Denied: git pull rewrites the tree or the history past the gate; the human merges, rebases, reverts and pulls (ADR-002).'],
      ['git reset HEAD~1', 'Denied: git reset to another commit moves the branch past the gate; to unstage a file run git reset -- <file>, for anything else ask the human.'],
      ['git reset --soft HEAD~1', 'Denied: git reset to another commit moves the branch past the gate; to unstage a file run git reset -- <file>, for anything else ask the human.'],
      ['git config alias.p "push origin HEAD"', 'Denied: git config writes settings (an alias, a hook path, an identity) that the gate cannot see; read with --get or --list, the human sets.'],
      ['git -C /tmp/other commit -m "S1: x (R-01)"', 'Denied: git -C runs git in another folder, where the gate does not see it; run git from the project root.'],
      ['npx prettier --write .', 'Denied: npx runs code from outside the repo; this project has no dependencies, ask the human.'],
      ['rm -rf src', 'Denied: rm with -r and -f is not allowed; remove files one by one with git rm, or ask the human.'],
      ['rm -r -f build', 'Denied: rm with -r and -f is not allowed; remove files one by one with git rm, or ask the human.'],
      ['rm -R -f build', 'Denied: rm with -r and -f is not allowed; remove files one by one with git rm, or ask the human.'],
      ['rm -f -r build', 'Denied: rm with -r and -f is not allowed; remove files one by one with git rm, or ask the human.'],
      ['find . -name "*.tmp" -delete', 'Denied: find -delete, -exec and -fprint change or write files in bulk, which cannot be checked; remove files one by one with git rm, or ask the human.'],
      ['find src -name "*.js" -exec sed -i s/a/b/ {} +', 'Denied: find -delete, -exec and -fprint change or write files in bulk, which cannot be checked; remove files one by one with git rm, or ask the human.'],
      ['n\\pm install lodash', 'Denied: installing or adding a package changes the dependencies, and a dependency is a human decision (ADR-001); ask the human.'],
      ['git pu\\sh', 'Denied: the AI never pushes (ADR-002); the human pushes.'],
      ['git push origin main', 'Denied: the AI never pushes (ADR-002); the human pushes.'],
      ['git switch -c chore/release-notes-skill', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git checkout -b feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git branch feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git worktree add ../x -b x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git switch -cq feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git switch --crea feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git checkout -qb feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git branch -c main feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git branch -m main renamed', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git update-ref refs/heads/feature/x HEAD', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git update-ref --stdin', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git switch --force-c feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git checkout --track origin/feature/x', 'Denied: the AI commits on the current branch; the human creates branches and opens the pull request (ADR-002).'],
      ['git push', 'Denied: the AI never pushes (ADR-002); the human pushes.'],
      ['git tag v1', 'Denied: the AI never tags (ADR-002); the human tags a release.'],
      ['git reset --hard HEAD~1', 'Denied: git reset --hard throws away work that is not committed; ask the human.'],
      ['git clean -fd', 'Denied: git clean deletes files git does not know about, which may be the human\'s; ask the human.'],
      ['git checkout -- .', 'Denied: reverting the whole tree throws away work that is not committed; name one file inside your slice, or ask the human.'],
      ['git restore .', 'Denied: reverting the whole tree throws away work that is not committed; name one file inside your slice, or ask the human.'],
      ['git stash', 'Denied: git stash hides work that is not committed, including the human\'s; ask the human.'],
      ['git commit -a -m "S1: x (R-01)"', 'Denied: git commit -a stages everything; stage the slice files by name so the gate can check them.'],
      ['git commit -am "S1: x (R-01)"', 'Denied: git commit -a stages everything; stage the slice files by name so the gate can check them.'],
      ['git push --force origin main', 'Denied: the AI never pushes (ADR-002); the human pushes.'],
      ['git commit --no-verify -m "S1: x (R-01)"', 'Denied: --no-verify skips the gate; fix what the gate reports instead.'],
      ['git commit --amend -m "S1: x (R-01)"', 'Denied: git commit --amend rewrites a committed slice; make a new commit.'],
      ['git -c user.name=x commit --amend -m "S1: x (R-01)"', 'Denied: git commit --amend rewrites a committed slice; make a new commit.'],
      ['git commit -n -m "S1: x (R-01)"', 'Denied: -n on git commit skips the gate; fix what the gate reports instead.'],
      ['GIT_DIR=/tmp/x git commit -m "S1: x (R-01)"', 'Denied: a GIT_* variable redirects git (its hooks, index, objects or repository) past the gate; run plain git in the project.'],
      ['ln -s /etc/passwd src/x.js', 'Denied: symlinks can point outside the project; copy the file or ask the human.'],
      ['git -c core.hooksPath=/dev/null commit -m "S1: x (R-01)"', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
      ['git config core.hooksPath /tmp/elsewhere', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
      ['git config --unset core.hooksPath', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
    ];
    for (const [command, sentence] of cases) {
      const r = guard(root, command);
      assert.equal(r.status, 2, command);
      assert.equal(r.stderr.trim(), sentence, command);
    }
  } finally {
    cleanup(root);
  }
});

test('any other command passes silently', () => {
  const root = makeProject();
  try {
    for (const command of ['ls -la', 'node --test', 'git status', 'git add -A', 'git checkout -- src/domain/customers.js', 'git stash list', 'git clean -n', 'git reset -- src/domain/customers.js', 'git reset HEAD -- src/domain/customers.js', 'git config --get user.name', 'git branch -r --contains HEAD', 'git fetch origin', 'sort tests/x.txt', 'git restore --worktree docs/notes.md', 'git config core.hooksPath .githooks', 'chmod +x .githooks/pre-commit && git config core.hooksPath .githooks && git config core.hooksPath', 'git tag-helper', 'git log --tags']) {
      const r = guard(root, command);
      assert.equal(r.status, 0, command);
      assert.equal(r.stdout + r.stderr, '', command);
    }
  } finally {
    cleanup(root);
  }
});

test('git commit with red tests: refused, first line names the problem', () => {
  const root = makeProject({ slice: 'S1', test: 'red' });
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(r.status, 2);
    const [first, ...rest] = r.stderr.trim().split('\n');
    assert.equal(first, 'Commit refused: tests: 1 passed, 1 failed: R-02 rejects an empty name.');
    assert.equal(rest.at(-1), 'GATE FAIL');
  } finally {
    cleanup(root);
  }
});

test('git commit with a bad message: refused', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "fix stuff"');
    assert.equal(r.status, 2);
    assert.equal(r.stderr.split('\n')[0], 'Commit refused: commit: "fix stuff" must look like S<n>: what changed (R-xx, R-yy).');
    const noMsg = guard(root, 'git commit');
    assert.equal(noMsg.stderr.trim(), 'Commit refused: pass the message with -m, in the form S<n>: what changed (R-xx, R-yy).');
  } finally {
    cleanup(root);
  }
});

test('git commit with an unplanned staged file: refused', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  write(root, 'index.html', '<p></p>\n');
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(r.status, 2);
    assert.match(r.stderr.split('\n')[0], /^Commit refused: scope: S1: index\.html is not in the plan \(allowed: /);
  } finally {
    cleanup(root);
  }
});

test('git commit on a green, in-scope, well-named slice: allowed', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git add src/domain/customers.js tests/customers.test.js && git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
  } finally {
    cleanup(root);
  }
});

test('docs-only commit with no slice: allowed with a plain message', () => {
  const root = makeProject();
  write(root, 'docs/PLAN.md', '# Plan\n');
  git(root, 'add', '-A');
  try {
    const r = guard(root, 'git commit -m "Plan written"');
    assert.equal(r.status, 0, r.stderr);
  } finally {
    cleanup(root);
  }
});

test('judgeProblem names what changes files or git state and lets reads and test runs through', () => {
  const denied = {
    'git add -A': 'git add',
    'git commit -m "x"': 'git commit',
    'git -c user.name=x commit -m "x"': 'git commit',
    'git checkout main': 'git checkout',
    'git stash': 'git stash',
    'git push origin main': 'git push',
    'node -e "require(\'fs\').writeFileSync(\'docs/x.json\', \'{}\')"': 'an interpreter one-liner (node -e, python -c, sh -c)',
    'python3 -c "open(\'x\',\'w\').write(\'1\')"': 'an interpreter one-liner (node -e, python -c, sh -c)',
    'sh -c "echo x > docs/x.md"': 'an interpreter one-liner (node -e, python -c, sh -c)',
    'node -e "console.log(1e308 * 2 > 1)"': 'an interpreter one-liner (node -e, python -c, sh -c)',
    "node -e 'console.log(0.3 <= 0.1 + 0.2)'": 'an interpreter one-liner (node -e, python -c, sh -c)',
    'node -p "1+1"': 'an interpreter one-liner (node -e, python -c, sh -c)',
    'rm docs/REVIEW.md': 'rm',
    'mv a b': 'mv',
    'cp a.js src/b.js': 'cp',
    'echo x > docs/REVIEW.md': '> redirection',
    'node --test >> out.txt': '> redirection',
    'sed -i "s/a/b/" src/a.js': 'sed -i',
    'echo x | tee docs/x.md': 'tee',
    'node --test && touch done': 'touch',
    'npm install x': 'npm',
  };
  for (const [command, shown] of Object.entries(denied)) assert.equal(judgeProblem(command), shown, command);
  const allowed = [
    'node --test',
    'node --test 2>&1',
    'node --test > /dev/null 2>&1',
    'git diff main..HEAD',
    'git log --oneline',
    'git status --short',
    'grep -rn innerHTML src/',
    `node "${KIT_ROOT}/tools/mutate.mjs" --max 12`,
    `node "${KIT_ROOT}/tools/gate.mjs"`,
    'cat docs/PLAN.md | head -20',
  ];
  for (const command of allowed) assert.equal(judgeProblem(command), null, command);
});

test('a judge is refused state changes with one sentence; the builder and the main session are not', () => {
  const root = makeProject();
  const roles = new Map([['verifier', { name: 'verifier', writes: [], known: true }], ['builder', { name: 'builder', writes: 'slice', known: true }]]);
  try {
    const judge = decide({ ...bashInput(root, 'git add docs/REVIEW.md'), agent_type: 'sdlc-kit:verifier' }, roles);
    assert.equal(judge, 'verifier may not change files or git state; it reads and runs tests (refused: git add).');
    assert.equal(decide({ ...bashInput(root, 'node --test'), agent_type: 'sdlc-kit:verifier' }, roles), null);
    assert.equal(decide({ ...bashInput(root, 'mkdir -p .sdlc'), agent_type: 'sdlc-kit:builder' }, roles), null);
    write(root, 'docs/PLAN.md', PLAN + '\nStatus: approved\n');
    assert.equal(decide(bashInput(root, 'echo S1 > .sdlc/slice'), roles), null);
    const real = guard(root, 'git add -A');
    assert.equal(real.status, 0, 'main session');
    const realJudge = runHook('hook-commit-guard.mjs', { ...bashInput(root, 'rm docs/REVIEW.md'), agent_type: 'sdlc-kit:verifier' });
    assert.equal(realJudge.status, 2);
    assert.equal(realJudge.stderr.trim(), 'verifier may not change files or git state; it reads and runs tests (refused: rm).');
  } finally {
    cleanup(root);
  }
});

test('the kit: only cat, head, tail, grep, ls and node <kit>/tools/<name>.mjs may touch it; everything else is refused', () => withHome(() => {
  const kit = KIT_ROOT;
  const root = makeProject();
  const upper = process.platform === 'darwin' ? kit.toUpperCase() : kit;
  const refused = (command) => assert.match(kitWriteProblem(command, kit, root) ?? '', /^Denied: .*the kit changes in its own repository/, command);
  for (const command of [
    `echo x > "${kit}/tools/gate.mjs"`,
    `rm "${kit}/agents/verifier.md"`,
    `sed -i "s/a/b/" "${kit}/hooks/hooks.json"`,
    `git -C "${kit}" log --oneline`,
    `cp evil.mjs "${kit}/tools/gate.mjs"`,
    `cp evil.mjs -t "${kit}/tools"`,
    `cp evil.mjs -vt"${kit}/tools"`,
    `cp "${kit}/templates/AGENTS.md" AGENTS.md`,
    `echo "${kit}" > .sdlc/kit-path`,
    `cd "${kit}" && git checkout -- .`,
    `node -e "require('fs').writeFileSync('${kit}/tools/x', '')"`,
    `node --require evil.js "${kit}/tools/gate.mjs"`,
    `NODE_OPTIONS="--require evil.js" node "${kit}/tools/gate.mjs"`,
    `sudo node "${kit}/tools/gate.mjs"`,
    `env node "${kit}/tools/gate.mjs"`,
    `node "${kit}/README.md"`,
    `node "${kit}/tools/sub/x.mjs"`,
    `echo x >> "${upper}/tools/gate.mjs"`,
    `python3 -c "open('${kit}/tools/x','w')"`,
    `cat "${kit}/tools/gate.mjs" | tee "${kit}/tools/gate.mjs"`,
    `echo x | xargs -I{} cp {} "${kit}/tools/"`,
    `cat "${kit}/README.md" &`,
    `echo $CLAUDE_PLUGIN_ROOT && rm -r "$CLAUDE_PLUGIN_ROOT/tools"`,
    `touch "$KIT/tools/x"`,
    `vim "${kit}/tools/gate.mjs"`,
    `sudo -u root cat "${kit}/README.md"`,
    `sudo --weird cat "${kit}/README.md"`,
  ]) refused(command);
  for (const command of [
    `node "${kit}/tools/gate.mjs"`,
    `node "${kit}/tools/mutate.mjs" --max 12 --files src/a.js`,
    `node "${kit}/tools/init.mjs"`,
    `node "$CLAUDE_PLUGIN_ROOT/tools/scope.mjs" S1`,
    `node "$KIT/tools/review.mjs" start --cycle 2`,
    `cat "${kit}/README.md"`,
    `head -20 "${kit}/tools/gate.mjs"`,
    `grep -n review "${kit}/tools/gate.mjs"`,
    `ls "${kit}/agents"`,
    'node --test',
  ]) assert.equal(kitWriteProblem(command, kit, root), null, command);
  cleanup(root);
}));

test('shell writes outside the project are denied; writes inside and to /dev/null pass', () => withHome(() => {
  const root = makeProject();
  try {
    assert.deepEqual(writeTargets('echo x > a.txt 2>&1'), ['a.txt']);
    assert.deepEqual(writeTargets('cp a.js b.js dest/'), ['dest/']);
    assert.deepEqual(writeTargets('cp -t dest/ a.js b.js'), ['dest/']);
    assert.deepEqual(writeTargets('cp -vt dest/ a.js'), ['dest/']);
    assert.deepEqual(writeTargets('cp -tdest/ a.js'), ['dest/']);
    assert.deepEqual(writeTargets('cp --target-directory dest/ a.js'), ['dest/']);
    assert.deepEqual(writeTargets('cp --target-directory=dest/ a.js'), ['dest/']);
    assert.deepEqual(writeTargets('tee -a out.log'), ['out.log']);
    assert.deepEqual(writeTargets('dd if=a of=/tmp/b'), ['/tmp/b']);
    for (const command of ['echo x > /etc/notes.txt', 'cp src/a.js /etc/elsewhere/', 'echo x > ~/x.txt', 'echo x > $HOME/x.txt', `echo x > ${FIXED_HOME}/x.txt`, 'mkdir -p /Users/shared/x', 'touch /usr/x', 'dd if=/dev/zero of=/usr/local/x', 'cp a.js -t /etc', 'cp a.js -vt /etc', 'cp a.js -t/etc', 'mv a.js --target-directory=/etc', 'install a.js --target-directory /etc', 'ln -s a.js /etc/a.js', 'rsync a.js /etc/', 'sudo -u root cp a.js /etc/', 'nice -n 5 touch /etc/x', 'exec -a name touch /etc/x', 'time -p touch /etc/x']) {
      assert.match(outsideWriteProblem(command, root) ?? '', /is outside the project; write only inside it/, command);
    }
    for (const command of ['echo x > $OUT/file', 'echo x > *.txt', 'cp a.js --target-directory', 'cp a.js --targetdir=x', 'cp a.js --targ=/tmp docs/', 'cp --backup=simple a.js docs/', 'mv --strip-trailing-slashes a.js docs/', 'ln --logical a.js docs/b.js']) {
      assert.match(outsideWriteProblem(command, root) ?? '', /^Denied: cannot tell where/, command);
    }
    for (const command of ['echo "x > docs/y.md', "echo 'a > docs/z.md"]) {
      assert.equal(outsideWriteProblem(command, root), UNSAFE_SENTENCE, command);
    }
    assert.match(outsideWriteProblem('sudo --weird touch x', root), /is not an option the guard knows/);
    assert.match(outsideWriteProblem('nice -q touch x', root), /is not an option the guard knows/);
    assert.match(outsideWriteProblem('cd /etc && echo x > notes.txt', root), /leaves the project/);
    assert.match(outsideWriteProblem('cd /usr && touch x', root), /leaves the project/);
    assert.match(outsideWriteProblem('pushd /etc && touch x', root), /leaves the project/);
    assert.match(outsideWriteProblem('cd $D && touch x', root), /cannot tell where/);
    assert.equal(outsideWriteProblem('cd $(pwd) && touch x', root), UNSAFE_SENTENCE);
    assert.match(outsideWriteProblem('env -C /etc touch x', root), /leaves the project/);
    assert.match(outsideWriteProblem('env -C /usr touch x', root), /leaves the project/);
    assert.match(outsideWriteProblem('env --chdir=/etc touch x', root), /leaves the project/);
    for (const command of ['echo x > /tmp/notes.txt', 'cp -R src /tmp/plant && echo y > /tmp/plant/a.js', 'echo x > /private/tmp/x', `echo x > ${process.env.TMPDIR ?? '/tmp'}/x.txt`, 'cd /tmp && touch x']) {
      assert.equal(outsideWriteProblem(command, root), null, command);
    }
    assert.match(outsideWriteProblem('env -C docs touch a.md && echo x > /etc/outside.md', root), /is outside the project/, 'env -C does not move the later segments');
    assert.match(outsideWriteProblem('echo x > docs/a.md &', root), /background job/);
    assert.match(outsideWriteProblem('echo x >| docs/a.md', root), /^Denied: >\| /);
    assert.match(outsideWriteProblem('ls | xargs rm', root), /xargs hides/);
    assert.match(outsideWriteProblem('git diff --name-only | xargs grep x', root), /xargs hides/);
    assert.equal(outsideWriteProblem('cd docs && echo x > notes.md', root), null, 'relative to the new directory');
    assert.equal(outsideWriteProblem('pushd docs && popd && echo x > docs/a.md', root), null);
    assert.equal(outsideWriteProblem('env -C docs touch notes.md', root), null);
    assert.equal(outsideWriteProblem('env FOO=1 -C docs touch notes.md', root), null);
    assert.equal(outsideWriteProblem('sudo -u me touch docs/x.md', root), null);
    assert.equal(outsideWriteProblem('cp --recursive --verbose src docs/copy', root), null);
    assert.equal(outsideWriteProblem('cp -rfv src docs/copy', root), null);
    for (const command of ['echo S1 > .sdlc/slice', 'node --test > /dev/null 2>&1', 'mkdir -p .githooks', `echo x > "${root}/docs/notes.md"`, 'cp a b', 'git add -A && git commit -m "x"', `node "${KIT_ROOT}/tools/gate.mjs"`, 'git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"', 'node --test &', 'FOO=1 node --test']) {
      assert.equal(outsideWriteProblem(command, root), null, command);
    }
    const r = guard(root, 'echo x > /etc/elsewhere.txt');
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), 'Denied: /etc/elsewhere.txt is outside the project; write only inside it, or ask the human.');
  } finally {
    cleanup(root);
  }
}));

test('init.mjs sets a repository up in one command', () => {
  const root = makeProject({ plan: false, requirements: false });
  try {
    const r = runTool('init.mjs', [], root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^sdlc-kit init\n {2}kit path {6}\.sdlc\/kit-path -> /);
    assert.match(r.stdout, /git hooks {5}\.githooks\/pre-commit, \.githooks\/commit-msg \(core\.hooksPath set\)/);
    assert.match(r.stdout, /CI {12}\.github\/workflows\/gate\.yml/);
    assert.match(r.stdout, /AGENTS\.md {5}kept/);
    assert.match(r.stdout, /gate {10}GATE PASS/);
    assert.equal(git(root, 'config', 'core.hooksPath'), '.githooks');
    assert.ok(existsSync(join(root, '.githooks/pre-commit')));
    assert.equal(readFileSync(join(root, '.sdlc/kit-path'), 'utf8').trim(), KIT_ROOT);
    assert.equal(guard(root, `node "${KIT_ROOT}/tools/init.mjs"`).status, 0, 'the init command passes the guard');
  } finally {
    cleanup(root);
  }
});

test('simpleCommands: quotes, separators, newlines and # at a word start; never splits inside quotes', () => {
  assert.deepEqual(simpleCommands('grep -n "Covers\\|Files\\|MANUAL" a.js | head -3'), ['grep -n "Covers\\|Files\\|MANUAL" a.js', 'head -3']);
  assert.deepEqual(simpleCommands("echo 'a; b && c' ; ls"), ["echo 'a; b && c'", 'ls']);
  assert.deepEqual(simpleCommands('a && b || c | d\ne'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(simpleCommands('echo a#b > docs/x.md'), ['echo a#b > docs/x.md']);
  assert.deepEqual(simpleCommands('echo a # > /etc/x'), ['echo a']);
  assert.deepEqual(simpleCommands('# rm -rf src\nls'), ['ls']);
  assert.deepEqual(simpleCommands('echo "#not a comment" > docs/x.md'), ['echo "#not a comment" > docs/x.md']);
  assert.equal(splitCommand('echo "a\\"b" && ls').problem, null, 'an escaped quote does not open one');
  assert.deepEqual(splitCommand('echo "a\\"b" && ls').segments, ['echo "a\\"b"', 'ls']);
  const root = makeProject();
  try {
    assert.equal(kitWriteProblem(`grep -n "Covers\\|Files\\|MANUAL" "${KIT_ROOT}/tools/scope.mjs"`, KIT_ROOT, root), null);
    assert.equal(guard(root, `grep -n "Covers\\|Files\\|MANUAL" "${KIT_ROOT}/tools/scope.mjs"`).status, 0);
    assert.equal(guard(root, 'echo "rm -rf x; npm install y" > docs/notes.md').status, 2, 'the forbidden list reads the raw text too');
    const prose = guard(root, 'git commit -m "mentions --no-verify, npm install and rm -rf in prose" docs/x.md');
    assert.ok(!/^Denied/.test(prose.stderr), 'the commit message is skipped by the forbidden list');
  } finally {
    cleanup(root);
  }
});

test('an open quote at a newline or at the end refuses the whole command, for every role', () => {
  const root = makeProject();
  try {
    for (const command of ['echo "a\nrm -rf src"', 'echo "a', "echo 'a\nls", 'echo "x\necho y > /etc/z', 'ls "a']) {
      assert.ok(splitCommand(command).problem, command);
      assert.equal(outsideWriteProblem(command, root), UNSAFE_SENTENCE, command);
      assert.equal(kitWriteProblem(command, KIT_ROOT, root), UNSAFE_SENTENCE, command);
      assert.equal(judgeProblem(command), 'an unreadable command', command);
      assert.equal(guard(root, command).stderr.trim(), UNSAFE_SENTENCE, command);
    }
  } finally {
    cleanup(root);
  }
});

test('no shell parsing: $( ), backticks, << and <<< are refused anywhere, with one literal exception', () => withHome(() => {
  const root = makeProject();
  try {
    for (const command of [
      'echo $(date)',
      'ls `pwd`',
      'cat <<EOF\nhello\nEOF',
      'cat <<< "text"',
      'echo "$(git rev-parse HEAD)"',
      'echo x > "$(cat where)"',
      'cat <<EOF > docs/x.md\nhello\nEOF',
      'echo $(date) > docs/x.md',
      'node "$(cat .sdlc/kit-path)/tools/gate.mjs"',
      'ls "$(cat .sdlc/kit-path)" && echo $(date)',
      'git commit -m "$(cat <<EOF\nS1: x (R-01)\nEOF\n)"',
      'git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)" && echo done',
      'git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"; rm -rf src',
      'ls | xargs grep $(date)',
      'diff <(ls src) <(ls tests)',
      'tee >(cat) < docs/a.md',
      'git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\necho hidden\nEOF\n)"',
      'git add a.js\nrm -rf src && git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"',
    ]) {
      assert.equal(unsafeTokenProblem(command), UNSAFE_SENTENCE, command);
      assert.equal(outsideWriteProblem(command, root), UNSAFE_SENTENCE, command);
      assert.equal(kitWriteProblem(command, KIT_ROOT, root), UNSAFE_SENTENCE, command);
      assert.equal(judgeProblem(command), 'an unreadable command', command);
      assert.equal(guard(root, command).stderr.trim(), UNSAFE_SENTENCE, command);
    }
    for (const command of [
      `node "${KIT_ROOT}/tools/gate.mjs"`,
      `node "${KIT_ROOT}/tools/mutate.mjs" --max 12`,
      `node "${KIT_ROOT}/tools/scope.mjs" S1 && git status`,
      'mkdir -p .sdlc && echo S1 > .sdlc/slice',
      'echo ${HOME} and $USER',
      'git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"',
      'git commit -m "$(cat <<\'EOF\'\nS1: fix F-01 (R-02)\n\nbody; with | marks && more $(not run) `nor this`\nEOF\n)"',
      'git commit -q -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"',
      'git add src/a.js tests/a.test.js && git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"',
    ]) {
      assert.equal(unsafeTokenProblem(command), null, command);
      assert.equal(outsideWriteProblem(command, root), null, command);
      assert.equal(kitWriteProblem(command, KIT_ROOT, root), null, command);
    }
    assert.ok(COMMIT_HEREDOC.test('git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"'));
    assert.ok(!COMMIT_HEREDOC.test('git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)" && ls'), 'nothing may follow the shape');
    assert.ok(!COMMIT_HEREDOC.test('git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\necho hidden\nEOF\n)"'), 'no EOF line inside the body');
    assert.ok(!COMMIT_HEREDOC.test('git add a.js\nls && git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\nEOF\n)"'), 'no newline in the git add prefix');
    assert.ok(COMMIT_HEREDOC.test('git commit -m "$(cat <<\'EOF\'\nS1: x (R-01)\n\nEOF is mentioned mid-line\nEOF\n)"'), 'EOF inside a line is just text');
    assert.equal(judgeProblem(`node "${KIT_ROOT}/tools/gate.mjs"`), null);
    assert.equal(guard(root, 'echo "$(cat .sdlc/kit-path)"').stderr.trim(), UNSAFE_SENTENCE, 'the kit-path subshell is no longer an exception');
  } finally {
    cleanup(root);
  }
}));

test('the commit heredoc shape still reaches the gate with its subject as the message', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const ok = guard(root, 'git commit -m "$(cat <<\'EOF\'\nS1: customer rules (R-01, R-02)\n\nTests first.\nEOF\n)"');
    assert.equal(ok.status, 0, ok.stderr);
    const bad = guard(root, 'git commit -m "$(cat <<\'EOF\'\nfix stuff\nEOF\n)"');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr.split('\n')[0], /^Commit refused: commit: "fix stuff" must look like/);
  } finally {
    cleanup(root);
  }
});

test('the git add prefix is read into the staged set, so the Claude hook refuses an out-of-scope commit itself', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  write(root, 'index.html', '<p></p>\n');
  try {
    const r = guard(root, 'git add index.html src/domain/customers.js tests/customers.test.js && git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(r.status, 2);
    assert.match(r.stderr.split('\n')[0], /^Commit refused: scope: S1: index\.html is not in the plan \(allowed: /);
    const ok = guard(root, 'git add src/domain/customers.js tests/customers.test.js && git commit -m "S1: customer rules (R-01, R-02)"');
    assert.equal(ok.status, 0, ok.stderr);
    for (const command of ['git add -A && git commit -m "S1: x (R-01)"', 'git add . && git commit -m "S1: x (R-01)"', 'git add -u && git commit -m "S1: x (R-01)"']) {
      const bad = guard(root, command);
      assert.equal(bad.status, 2, command);
      assert.equal(bad.stderr.trim(), 'Commit refused: stage the slice files by name (git add <file> <file>); -A, -u, . and * cannot be checked before the commit.', command);
    }
    assert.deepEqual(stagedByPrefix('git add a.js "b c.js" && git commit -m "x"'), { files: ['a.js', 'b c.js'], unparsed: false });
    assert.deepEqual(stagedByPrefix('git commit -m "x"'), { files: [], unparsed: false });
  } finally {
    cleanup(root);
  }
});

test('the commit subject must name the active slice; ids outside its Covers line are a warning', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  git(root, 'add', '-A');
  try {
    const wrong = guard(root, 'git commit -m "S2: customer rules (R-01, R-02)"');
    assert.equal(wrong.status, 2);
    assert.match(wrong.stderr.split('\n')[0], /^Commit refused: commit: "S2: customer rules \(R-01, R-02\)" names S2 but S1 is active \(\.sdlc\/slice\)\./);
    const outside = runGate({ root, staged: true, only: 'commit', message: 'S1: customer rules (R-01, R-04)' });
    assert.ok(outside.ok);
    assert.match(outside.lines[0], /ok; R-04 not in S1's Covers line {3}<- WARN$/);
  } finally {
    cleanup(root);
  }
});

test('shell writes inside the project follow the file rules: human-only files, the plan and a second slice marker are refused', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  try {
    const cases = [
      ['echo approved >> AGENTS.md', 'Denied: AGENTS.md is a human decision file; the human edits it, you ask.'],
      ["sed -i 's/draft/approved/' docs/REQUIREMENTS.md", 'Denied: docs/REQUIREMENTS.md is approved, changing a requirement is a human decision; the human edits it, you ask.'],
      ['cat x >> docs/decisions/ADR-003.md', 'Denied: docs/decisions/ADR-003.md is a decision record; a proposed ADR is written with the Write tool so its Status line can be checked, never through the shell.'],
      ['echo x >> docs/PLAN.md', 'Denied: docs/PLAN.md cannot change while S1 is active; a wider slice is a human decision.'],
      ['echo S7 > .sdlc/slice', 'Denied: S1 is active; finish it and run rm .sdlc/slice after the commit before starting another slice.'],
      ['echo x > .sdlc/kit-path', 'Denied: .sdlc/kit-path is kit state; only the slice marker is written by hand (mkdir -p .sdlc, echo S<n> > .sdlc/slice, rm .sdlc/slice).'],
      ['echo x > index.html', 'S1 allows src/domain/customers.js, tests/customers.test.js, docs/MANUAL-CHECKS.md. index.html is not in the plan. Stop and ask the human.'],
      ['cp src/domain/customers.js src/domain/orders.js', 'S1 allows src/domain/customers.js, tests/customers.test.js, docs/MANUAL-CHECKS.md. src/domain/orders.js is not in the plan. Stop and ask the human.'],
      ['cd src && echo x > ui/main.js', 'S1 allows src/domain/customers.js, tests/customers.test.js, docs/MANUAL-CHECKS.md. src/ui/main.js is not in the plan. Stop and ask the human.'],
    ];
    for (const [command, sentence] of cases) {
      const r = guard(root, command);
      assert.equal(r.status, 2, command);
      assert.equal(r.stderr.trim(), sentence, command);
    }
    for (const command of ['echo x > src/domain/customers.js', 'echo "- [ ] R-01: x" >> docs/MANUAL-CHECKS.md', 'echo x > /tmp/scratch.txt', 'mkdir -p .sdlc', "sed -i '' 's/1/2/' src/domain/customers.js", 'sed -i.bak -e s/1/2/ src/domain/customers.js']) {
      assert.equal(guard(root, command).status, 0, command);
    }
    assert.match(guard(root, 'rm .sdlc/slice').stderr, /not committed/, 'the marker stays while slice files are uncommitted');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'S1: customers (R-01, R-02)');
    assert.equal(guard(root, 'rm .sdlc/slice').status, 0, 'green and committed: the marker may go');
  } finally {
    cleanup(root);
  }
  const idle = makeProject();
  try {
    assert.equal(guard(idle, 'echo S1 > .sdlc/slice').status, 2, 'no slice starts on a plan that is not approved');
    write(idle, 'docs/PLAN.md', PLAN + '\nStatus: approved\n');
    assert.equal(guard(idle, 'echo S1 > .sdlc/slice').status, 0, 'starting a slice when none is active and the plan is approved');
    assert.equal(guard(idle, 'echo x > docs/notes.md').status, 2, 'documents are written with Edit or Write, not by shell');
    const code = guard(idle, 'echo x > src/domain/customers.js');
    assert.equal(code.status, 2);
    assert.equal(code.stderr.trim(), 'No slice is active: only docs/** may change. src/domain/customers.js needs /sdlc-kit:implement-slice S<n> first.');
  } finally {
    cleanup(idle);
  }
});

test('decide is the human\'s: no role may run it or write decisions.json', () => {
  const root = makeProject();
  try {
    for (const command of [`node "${KIT_ROOT}/tools/review.mjs" decide --cycle 1 --accept F-01`, 'node tools/review.mjs decide --cycle 1 --reject F-02', 'echo "{}" > docs/review/1/decisions.json']) {
      const r = guard(root, command);
      assert.equal(r.status, 2, command);
    }
    assert.equal(guard(root, `node "${KIT_ROOT}/tools/review.mjs" decide --cycle 1 --accept F-01`).stderr.trim(), "Denied: review.mjs decide records the human's decision; the human runs it from their own terminal.");
    assert.equal(guard(root, 'echo "{}" > docs/review/1/decisions.json').stderr.trim(), "Denied: docs/review/1/decisions.json is the human's decision on the review findings; the human edits it, you ask.");
    assert.equal(guard(root, `node "${KIT_ROOT}/tools/review.mjs" start`).status, 0);
    const judge = runHook('hook-commit-guard.mjs', { ...bashInput(root, `node "${KIT_ROOT}/tools/review.mjs" decide --cycle 1 --accept F-01`), agent_type: 'sdlc-kit:verifier' });
    assert.equal(judge.status, 2);
  } finally {
    cleanup(root);
  }
});

test('git rules are read from the parsed words: option values do not hide or fake a subcommand', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    for (const [command, sentence] of [
      ['git -c user.name=x push origin main', 'Denied: the AI never pushes (ADR-002); the human pushes.'],
      ['git -C . push', 'Denied: the AI never pushes (ADR-002); the human pushes.'],
      ['git checkout -- .', 'Denied: reverting the whole tree throws away work that is not committed; name one file inside your slice, or ask the human.'],
      ['git checkout -- AGENTS.md', "Denied: AGENTS.md is a human decision file; reverting it is the human's call."],
      ['git restore docs/decisions/ADR-001-stack.md', "Denied: docs/decisions/ADR-001-stack.md is a human decision file; reverting it is the human's call."],
      ['git checkout -- docs/PLAN.md', 'Denied: docs/PLAN.md cannot change while S1 is active; a wider slice is a human decision.'],
      ['git restore --staged', 'Denied: reverting the whole tree throws away work that is not committed; name one file inside your slice, or ask the human.'],
      ['git rm AGENTS.md', 'Denied: AGENTS.md is a human decision file; the human edits it, you ask.'],
      ['git rm docs/REQUIREMENTS.md', 'Denied: docs/REQUIREMENTS.md is approved, changing a requirement is a human decision; the human edits it, you ask.'],
      ['git rm -r docs/decisions', 'Denied: docs/decisions is a folder; remove or move its files one by one so each can be checked, or ask the human.'],
      ['git mv src/domain/customers.js src/domain/lines.js', 'S1 allows src/domain/customers.js, tests/customers.test.js, docs/MANUAL-CHECKS.md. src/domain/lines.js is not in the plan. Stop and ask the human.'],
      ['/usr/bin/git push', 'Denied: the AI never pushes (ADR-002); the human pushes.'],
      ['\\git commit -n -m "S1: x (R-01)"', 'Denied: -n on git commit skips the gate; fix what the gate reports instead.'],
      ['git -c core.hooksPath=/dev/null commit -m "S1: x (R-01)"', 'Denied: redirecting git hooks or the repository bypasses the gate; run plain git in the project.'],
      ['git commit -anm "S1: x (R-01)"', 'Denied: git commit -a stages everything; stage the slice files by name so the gate can check them.'],
    ]) {
      assert.equal(guard(root, command).stderr.trim(), sentence, command);
    }
    for (const command of ['git log -1 --format=%s push', 'git commit -m "push to tag reset --hard" docs/x.md', 'git checkout -- src/domain/customers.js', 'git restore --staged src/domain/customers.js', 'git diff --stat', 'git show HEAD:docs/PLAN.md']) {
      const r = guard(root, command);
      assert.ok(!/Denied/.test(r.stderr), `${command}: ${r.stderr}`);
    }
  } finally {
    cleanup(root);
  }
});

test('builder and main: interpreter one-liners that write or name protected paths are refused; .sdlc/stop-warned is hook state', () => {
  const root = makeProject({ slice: 'S1' });
  try {
    for (const command of [
      'node -e "require(\'fs\').writeFileSync(\'src/x.js\', \'\')"',
      'python3 -c "open(\'docs/PLAN.md\',\'a\').write(\'x\')"',
      'node -e "console.log(require(\'fs\').readFileSync(\'AGENTS.md\',\'utf8\'))"',
      'sh -c "echo S7 > .sdlc/slice"',
      'node -e "process.chdir(\'.sdlc/\')"',
    ]) {
      const r = guard(root, command);
      assert.equal(r.status, 2, command);
      assert.match(r.stderr, /^Denied: an interpreter one-liner/, command);
    }
    assert.match(guard(root, 'sh -c "git commit -n -m x"').stderr, /one-liner/, 'git inside sh -c is not gated');
    assert.equal(guard(root, 'eval "git commit -n -m x"').stderr.trim(), UNSAFE_SENTENCE);
    assert.match(guard(root, 'node -e "console.log(1 + 1)"').stderr, /cannot be checked/, 'no one-liner at all: a write can be spelled a thousand ways');
    assert.equal(guard(root, 'echo S1 > .sdlc/stop-warned').stderr.trim(), 'Denied: .sdlc/stop-warned is hook state; only rm may touch it.');
    assert.equal(guard(root, 'rm .sdlc/stop-warned').status, 0);
  } finally {
    cleanup(root);
  }
});

test('paths named on git commit are added to the staged set; an unreadable pathspec refuses the commit', () => {
  const root = makeProject({ slice: 'S1', test: 'green' });
  write(root, 'index.html', '<p></p>\n');
  git(root, 'add', 'src/domain/customers.js', 'tests/customers.test.js');
  try {
    const named = guard(root, 'git commit -m "S1: customer rules (R-01, R-02)" index.html');
    assert.equal(named.status, 2);
    assert.match(named.stderr.split('\n')[0], /^Commit refused: scope: S1: index\.html is not in the plan/);
    const only = guard(root, 'git commit -o index.html -m "S1: customer rules (R-01, R-02)"');
    assert.match(only.stderr.split('\n')[0], /^Commit refused: scope: S1: index\.html is not in the plan/);
    const dash = guard(root, 'git commit -m "S1: customer rules (R-01, R-02)" -- index.html');
    assert.match(dash.stderr.split('\n')[0], /^Commit refused: scope: S1: index\.html is not in the plan/);
    for (const command of ['git commit -m "S1: x (R-01)" .', 'git commit -m "S1: x (R-01)" src/*.js', 'git commit -m "S1: x (R-01)" $FILES']) {
      const bad = guard(root, command);
      assert.equal(bad.status, 2, command);
      assert.ok(/Commit refused: the paths after git commit cannot be read|Denied: cannot tell where/.test(bad.stderr), command);
    }
    assert.deepEqual(commitPathspec('git commit -m "x" -i a.js -- b.js c.js'), { files: ['a.js', 'b.js', 'c.js'], unparsed: false });
    const ok = guard(root, 'git commit -m "S1: customer rules (R-01, R-02)" src/domain/customers.js');
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    cleanup(root);
  }
});

test('project skills through the shell: main may write .claude/skills with no slice, the builder may not, and the gate accepts the commit', () => {
  const root = makeProject();
  try {
    const shell = guard(root, 'mkdir -p .claude/skills/release-notes && echo x > .claude/skills/release-notes/SKILL.md');
    assert.equal(shell.status, 2);
    assert.equal(shell.stderr.trim(), 'Denied: project skills are written with the Write tool, not through the shell, so each one can be checked as one piece.');
    assert.equal(guard(root, `mkdir -p "${root}/.claude/skills/release notes"`).stderr.trim(), 'Denied: project skills are written with the Write tool, not through the shell, so each one can be checked as one piece.', 'a quoted path with spaces is one plain token, judged as the path it is');
    assert.deepEqual(simpleCommands(`mkdir -p "${root}/.claude/skills/release notes"`), [`mkdir -p "${root}/.claude/skills/release notes"`]);
    const explore = runHook('hook-commit-guard.mjs', { ...bashInput(root, 'echo x > .claude/skills/release-notes/SKILL.md'), agent_type: 'Explore' });
    assert.equal(explore.status, 2, 'only the main session itself');
    assert.equal(guard(root, 'cat .claude/skills/release-notes/SKILL.md').status, 0, 'reading a skill is fine');
    const builder = runHook('hook-commit-guard.mjs', { ...bashInput(root, 'echo x > .claude/skills/release-notes/SKILL.md'), agent_type: 'sdlc-kit:builder' });
    assert.equal(builder.status, 2);
    assert.equal(guard(root, 'echo x > .claude/settings.json').stderr.trim(), 'Denied: .claude/settings.json is a human decision file; the human edits it, you ask.');
    write(root, '.claude/skills/release-notes/SKILL.md', '---\nname: release-notes\n---\n');
    git(root, 'add', '.claude/skills/release-notes/SKILL.md');
    const gate = runGate({ root, staged: true, message: 'Skill: release notes' });
    assert.ok(gate.ok, gate.lines.join('\n'));
    assert.match(gate.lines[1], /no slice active: 1 file staged, all in docs\/ and \.claude\/skills\/$/);
  } finally {
    cleanup(root);
  }
});

test('git add -f is denied; the tester\'s spec files are not written through the shell by the builder', async () => {
  const { decide } = await import('./hook-commit-guard.mjs');
  const root = makeProject({ slice: 'S1', test: 'green' });
  try {
    assert.match(decide(bashInput(root, 'git add -f .sdlc/slice')), /git add -f/);
    assert.match(decide(bashInput(root, 'git add --force x')), /git add -f/);
    assert.equal(decide(bashInput(root, 'git add src/domain/customers.js')), null);
    assert.match(decide(bashInput(root, 'echo x > tests/customers.spec.mjs')), /tester's test/);
    const tester = new Map([['tester', { name: 'tester', writes: ['tests/**/*.spec.mjs'], known: true }]]);
    assert.equal(decide({ ...bashInput(root, 'echo x > tests/customers.spec.mjs'), agent_type: 'sdlc-kit:tester' }, tester), null);
    assert.match(decide({ ...bashInput(root, 'echo x > src/domain/customers.js'), agent_type: 'sdlc-kit:tester' }, tester), /tester writes only/);
  } finally {
    cleanup(root);
  }
});

test('git add --force abbreviations are refused; shell writes into docs/decisions/ are refused to every role', async () => {
  const { decide } = await import('./hook-commit-guard.mjs');
  const root = makeProject();
  const architect = new Map([['architect', { name: 'architect', writes: ['docs/decisions/ADR-*.md'], known: true }]]);
  try {
    for (const f of ['--f', '--fo', '--for', '--forc']) assert.match(decide(bashInput(root, `git add ${f} x`)), /git add -f/, f);
    assert.match(decide({ ...bashInput(root, 'echo "Status: accepted" > docs/decisions/ADR-009.md'), agent_type: 'sdlc-kit:architect' }, architect), /decision record/);
    assert.match(decide(bashInput(root, 'printf x >> docs/decisions/ADR-001-stack.md')), /decision/);
  } finally {
    cleanup(root);
  }
});

test('documents under docs/ are never written through the shell, by any role', async () => {
  const { decide } = await import('./hook-commit-guard.mjs');
  const root = makeProject();
  try {
    assert.match(decide(bashInput(root, 'echo "x" >> docs/NOTES.md')), /documents are written with the Edit or Write tool/);
    assert.equal(decide(bashInput(root, 'echo "- [ ] R-06: x" >> docs/MANUAL-CHECKS.md')), null, 'the checklist has no approval line; appending a check by shell stays allowed');
    assert.match(decide(bashInput(root, 'printf "Status: approved" > docs/UI-SPEC.md')), /documents are written/);
    assert.equal(decide(bashInput(root, 'mkdir -p docs/review/1')), null);
    assert.equal(decide(bashInput(root, 'cat docs/PLAN.md')), null);
  } finally {
    cleanup(root);
  }
});

test('a symlink under docs/ is never a document: ln into docs/ and writes through an existing link are refused', async () => {
  const { decide, isSymlink } = await import('./hook-commit-guard.mjs');
  const { symlinkSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = makeProject();
  try {
    assert.match(decide(bashInput(root, 'ln -s /etc/hosts docs/MANUAL-CHECKS.md')), /symlink|symbolic link/);
    mkdirSync(join(root, 'docs'), { recursive: true });
    symlinkSync('/tmp', join(root, 'docs/linked'));
    assert.ok(isSymlink(root, 'docs/linked/x.md'));
    assert.match(decide(bashInput(root, 'echo x >> docs/linked/MANUAL-CHECKS.md')), /symbolic link/);
    assert.ok(!isSymlink(root, 'docs/PLAN.md'));
  } finally {
    cleanup(root);
  }
});

test('cp that creates or copies links is refused', async () => {
  const { decide } = await import('./hook-commit-guard.mjs');
  const root = makeProject();
  try {
    for (const c of ['cp -s a docs/b', 'cp -rs src docs/x', 'cp -P a b', 'cp --symbolic-link a b', 'cp -l a b']) assert.match(decide(bashInput(root, c)), /links/, c);
    assert.equal(decide(bashInput(root, 'cp docs/PLAN.md /tmp/plan.md')), null);
  } finally {
    cleanup(root);
  }
});
