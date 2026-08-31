#!/usr/bin/env node
/**
 * Add or remove the Sentry widget tag across the site, for LOCAL TESTING ONLY.
 *
 *   node tools/sentry-local.js on     # inject the tags
 *   node tools/sentry-local.js off    # take them out again
 *   node tools/sentry-local.js status
 *
 * Why this exists: Sentry is deliberately not on the published site right now,
 * so the tags are absent from the committed HTML — which means they are absent
 * locally too, and there is nothing to test against on the real pages. This
 * puts them back in the working tree only.
 *
 * The injected tag carries `data-sentry-local="1"`, which is both how `off`
 * finds them again and a marker in any diff that these are not meant to ship.
 * A page served from localhost points the widget at http://localhost:7071/api
 * regardless of what the tag says, so nothing here can reach production.
 *
 * `on` refuses to run on a dirty working tree, so `git checkout -- .` is
 * always enough to undo it completely.
 */
'use strict';

const fs = require('fs');
const path = require('path');
// execFileSync, not execSync: no shell is involved, so nothing here can be
// turned into a shell string. The command happens to be a fixed literal, but
// the safe form costs nothing.
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MARKER = 'data-sentry-local="1"';

// Which page gets which entryPage value. Matches what shipped before removal.
const PAGES = {
  'index.html': 'home',
  'forge/index.html': 'forge',
  'forge/demo/index.html': 'forge-demo',
  'shield/index.html': 'shield',
  'platform/index.html': 'platform',
  'careers.html': 'careers',
  'contact.html': 'contact',
  'security.html': 'security',
  'terms.html': 'terms',
  'privacy.html': 'privacy',
  'request/index.html': 'request',
  'tools/index.html': 'tools',
  'tools/photoScrubber/index.html': 'photo-scrubber',
  'coming-soon.html': 'coming-soon',
};

const tagFor = (page) =>
  `<script src="/assets/sentry/sentry.js" defer data-sentry-page="${page}" ${MARKER}></script>`;

const LOCAL_TAG_RE = /\n?<script src="\/assets\/sentry\/sentry\.js"[^>]*data-sentry-local="1"><\/script>\n?/g;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function write(rel, html) {
  fs.writeFileSync(path.join(ROOT, rel), html, 'utf8');
}

function dirty() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function turnOn() {
  const pending = dirty();
  if (pending) {
    console.error('Working tree is not clean. Commit or stash first, so that');
    console.error('`git checkout -- .` is enough to undo this afterwards:\n');
    console.error(pending);
    process.exit(1);
  }

  let n = 0;
  for (const [rel, page] of Object.entries(PAGES)) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      console.warn(`  missing: ${rel}`);
      continue;
    }
    let html = read(rel);
    if (html.includes('assets/sentry/sentry.js')) {
      console.log(`  already present: ${rel}`);
      continue;
    }
    const i = html.lastIndexOf('</body>');
    if (i === -1) {
      console.warn(`  no </body>: ${rel}`);
      continue;
    }
    write(rel, html.slice(0, i) + tagFor(page) + '\n' + html.slice(i));
    n += 1;
  }
  console.log(`\nSentry injected into ${n} page(s) — LOCAL ONLY.`);
  console.log('The widget will talk to http://localhost:7071/api.');
  console.log('\nUndo with:  node tools/sentry-local.js off   (or: git checkout -- .)');
  console.log('Do NOT commit these tags.');
}

function turnOff() {
  let n = 0;
  for (const rel of Object.keys(PAGES)) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const html = read(rel);
    const cleaned = html.replace(LOCAL_TAG_RE, '\n');
    if (cleaned !== html) {
      write(rel, cleaned);
      n += 1;
    }
  }
  console.log(`Removed local Sentry tags from ${n} page(s).`);
  const leftover = Object.keys(PAGES).filter(
    (rel) => fs.existsSync(path.join(ROOT, rel)) && read(rel).includes('assets/sentry/sentry.js')
  );
  if (leftover.length) {
    console.warn('\nStill referencing the widget (not injected by this script — check by hand):');
    leftover.forEach((l) => console.warn('  ' + l));
  }
}

function status() {
  const withTag = Object.keys(PAGES).filter(
    (rel) => fs.existsSync(path.join(ROOT, rel)) && read(rel).includes('assets/sentry/sentry.js')
  );
  console.log(`${withTag.length} of ${Object.keys(PAGES).length} pages currently carry the widget.`);
  withTag.forEach((p) => console.log('  ' + p));
  if (withTag.length === 0) console.log('  (none — this is the correct state to commit)');
}

const cmd = process.argv[2];
if (cmd === 'on') turnOn();
else if (cmd === 'off') turnOff();
else if (cmd === 'status') status();
else {
  console.error('Usage: node tools/sentry-local.js <on|off|status>');
  process.exit(1);
}
