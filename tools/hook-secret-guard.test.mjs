import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, isSecretPath } from './hook-secret-guard.mjs';
import { makeProject, cleanup, runHook, bashInput, editInput } from './fixtures.mjs';

test('isSecretPath: env files, keys, credentials and secrets folders; examples and docs are not', () => {
  for (const p of ['.env', '.env.local', 'config/.env.production', 'certs/server.pem', 'id_rsa', '.ssh/id_ed25519', 'secrets/db.json', '.secrets/x', 'deploy/app.key', '.npmrc', '.netrc', 'credentials']) {
    assert.ok(isSecretPath(p), p);
  }
  for (const p of ['.env.example', '.env.sample', 'docs/ENV.md', 'src/env.js', 'tests/keyboard.test.js', 'README.md', 'package.json', 'environment.ts']) {
    assert.ok(!isSecretPath(p), p);
  }
});

test('secret guard: Read, Grep, Edit and Bash on a secret are denied; the same on ordinary files pass', () => {
  const root = makeProject();
  try {
    const read = (file_path) => ({ cwd: root, tool_name: 'Read', tool_input: { file_path } });
    assert.match(decide(read('.env')), /looks like a secret/);
    assert.match(decide(read(`${root}/certs/server.pem`)), /looks like a secret/);
    assert.equal(decide(read('.env.example')), null);
    assert.equal(decide(read('src/env.js')), null);
    assert.match(decide({ cwd: root, tool_name: 'Grep', tool_input: { pattern: 'KEY', path: '.env.local' } }), /looks like a secret/);
    assert.equal(decide({ cwd: root, tool_name: 'Grep', tool_input: { pattern: 'KEY', path: 'src' } }), null);
    assert.match(decide(editInput(root, '.env')), /looks like a secret/);
    assert.match(decide(bashInput(root, 'cat .env')), /looks like a secret/);
    assert.match(decide(bashInput(root, 'node -e 1 && cat ~/.ssh/id_rsa')), /looks like a secret/);
    assert.match(decide(bashInput(root, 'git show HEAD:.env')), /looks like a secret/);
    assert.equal(decide(bashInput(root, 'cat .env.example && node --test')), null);
    const r = runHook('hook-secret-guard.mjs', read('.env'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /looks like a secret/);
  } finally {
    cleanup(root);
  }
});

test('secret guard: a Grep glob or Glob pattern over env files or keys is refused; KEY=.env in Bash too; ordinary globs pass', () => {
  const root = makeProject();
  try {
    assert.match(decide({ cwd: root, tool_name: 'Glob', tool_input: { pattern: '**/.env*' } }), /would sweep in secret files/);
    assert.match(decide({ cwd: root, tool_name: 'Grep', tool_input: { pattern: 'KEY', glob: '*.pem' } }), /would sweep in secret files/);
    assert.equal(decide({ cwd: root, tool_name: 'Glob', tool_input: { pattern: 'src/**/*.js' } }), null);
    assert.equal(decide({ cwd: root, tool_name: 'Grep', tool_input: { pattern: 'env', glob: '*.md' } }), null);
    assert.match(decide(bashInput(root, 'FILE=.env.local node tools/x.mjs')), /looks like a secret/);
  } finally {
    cleanup(root);
  }
});

test('a glob spelled around the words still trips when it would match a known secret path', async () => {
  const { isSecretGlob } = await import('./hook-secret-guard.mjs');
  for (const g of ['**/.e*', '.??v', '**/*.pe?', 'certs/*', 'secrets/**', '.ssh/*', '.*']) assert.ok(isSecretGlob(g), g);
  for (const g of ['src/**/*.js', 'docs/*.md', 'tests/**/*.test.mjs', '*.html', '**/*', '**', '*', '**/*.json', 'config/*']) assert.ok(!isSecretGlob(g), g);
});
