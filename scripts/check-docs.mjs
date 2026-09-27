#!/usr/bin/env node
// Documentation checks with no dependencies (run by `npm run lint:docs`):
// - relative links and images in Markdown point at files that exist
// - #anchors into Markdown files match a heading
// - public docs do not link into the local-only planning folders
// - no em or en dashes in Markdown or frontend source (use a hyphen or colon)
// External links are not checked: provider outages should not block contributions.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LOCAL_ONLY = ['next-up-instructions/', 'previous-md-instructions/', 'temp/'];
const DASH = /[–—]/;

const listFiles = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(file => file && !LOCAL_ONLY.some(dir => file.startsWith(dir)) && !file.includes('node_modules/') && existsSync(file));

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens,
// repeated headings get -1, -2 suffixes.
const slugify = heading => heading.replace(/<[^>]+>/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');

const anchorCache = new Map();
const anchorsOf = file => {
  if (!anchorCache.has(file)) {
    const anchors = new Set();
    const seen = new Map();
    let inFence = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('```')) {
        inFence = !inFence;
      }
      const match = !inFence && /^#{1,6} (.*)/.exec(line);
      if (match) {
        const slug = slugify(match[1]);
        const count = seen.get(slug) ?? 0;
        seen.set(slug, count + 1);
        anchors.add(count === 0 ? slug : `${slug}-${count}`);
      }
    }
    anchorCache.set(file, anchors);
  }
  return anchorCache.get(file);
};

const problems = [];
const files = listFiles();

for (const file of files.filter(f => f.endsWith('.md'))) {
  const text = readFileSync(file, 'utf8');
  const prose = text.replace(/```[\s\S]*?```/g, block => block.replace(/[^\n]/g, ' '));
  prose.split('\n').forEach((line, index) => {
    for (const [, target] of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) {
        continue;
      }
      const [linkPath, fragment] = target.split('#');
      const resolved = linkPath ? path.normalize(path.join(path.dirname(file), linkPath)) : file;
      if (linkPath && !existsSync(resolved)) {
        problems.push(`${file}:${index + 1}: missing link target ${target}`);
      } else if (fragment && resolved.endsWith('.md') && !anchorsOf(resolved).has(fragment)) {
        problems.push(`${file}:${index + 1}: no heading for anchor ${target}`);
      }
    }
  });
  text.split('\n').forEach((line, index) => {
    if (LOCAL_ONLY.slice(0, 2).some(dir => line.includes(dir))) {
      problems.push(`${file}:${index + 1}: points into a local-only planning folder`);
    }
  });
}

for (const file of files.filter(f => f.endsWith('.md') || /^frontend\/src\/.*\.(ts|tsx|css)$/.test(f))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (DASH.test(line)) {
      problems.push(`${file}:${index + 1}: em or en dash (use a hyphen or colon)`);
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\ncheck-docs: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check-docs: ${files.filter(f => f.endsWith('.md')).length} Markdown files OK`);
