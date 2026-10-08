#!/usr/bin/env node
// Write web/version.json for the deploy: r<commit count> (always increasing on master), the
// short commit hash and the build time. Uncommitted changes are flagged ("+", "-dirty") so a
// deploy can never silently differ from git. Generated, not committed (see .gitignore).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const count = git('rev-list', '--count', 'HEAD');
const commit = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no').length > 0;
const info = {
  version: `r${count}${dirty ? '+' : ''}`,
  commit: dirty ? `${commit}-dirty` : commit,
  built: new Date().toISOString(),
};
fs.writeFileSync(path.join(root, 'web/version.json'), JSON.stringify(info) + '\n');
console.log(`version ${info.version} (${info.commit})`);
