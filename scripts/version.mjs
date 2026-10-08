#!/usr/bin/env node
// Write web/version.json for the deploy. Version from the latest release tag (vMAJOR.MINOR):
// "v1.0" exactly on the tag, "v1.0.3" three commits later; the next tag ("v1.1") restarts the
// count, so versions only go up. Without any tag: "r<commit count>". Uncommitted changes are
// flagged ("+", "-dirty") so a deploy can never silently differ from git. Generated, not
// committed (see .gitignore).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function release() {
  try {
    // e.g. v1.0-3-g253e60c: tag, commits since it, hash
    const [, tag, since] = /^(v\d+\.\d+)-(\d+)-g[0-9a-f]+$/.exec(git('describe', '--tags', '--long', '--match', 'v[0-9]*.[0-9]*'));
    return Number(since) ? `${tag}.${since}` : tag;
  } catch {
    return `r${git('rev-list', '--count', 'HEAD')}`; // no release tag yet
  }
}

const commit = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no').length > 0;
const info = {
  version: `${release()}${dirty ? '+' : ''}`,
  commit: dirty ? `${commit}-dirty` : commit,
  built: new Date().toISOString(),
};
fs.writeFileSync(path.join(root, 'web/version.json'), JSON.stringify(info) + '\n');
console.log(`version ${info.version} (${info.commit})`);
