// Build the game and publish it to GitHub Pages.
//
//   node tools/deploy.mjs ["commit message"] [--message-file <path>] [--no-test] [--no-push]
//
// This folder is not a git repository. The published repo is a separate clone (GitHub Desktop):
// sources and the fresh dist/ are copied into it, the root index.html (which points Pages at dist/) is
// regenerated, and only the copied paths are committed — other work in the clone is left alone.
//
// Pages is published by the repo's own workflow (.github/workflows/static.yml): every push to main is built on
// GitHub and that build's dist/ becomes the site. It lives at https://zswolt.github.io/Streamer-s-Kombat-26/ and,
// once the custom domain is set in the repo's Pages settings and its DNS points at GitHub, at
// https://streamerskombatil.online/ (a workflow-published site takes its domain from the settings, not from a
// CNAME file). This script waits for whichever of the two is serving the new build.
import { spawnSync } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLONE = process.env.SK_CLONE ?? path.join(os.homedir(), 'Documents', 'GitHub', 'Streamer-s-Kombat-26');
const DOMAIN = 'streamerskombatil.online';
const PAGES_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
let domainReady = false;
try {
  const ips = await new dns.Resolver().resolve4(DOMAIN).catch(() => dns.resolve4(DOMAIN));
  domainReady = ips.length > 0 && ips.every((ip) => PAGES_IPS.includes(ip));
  if (!domainReady) console.log(`! ${DOMAIN} resolves to ${ips.join(', ')} — not GitHub Pages yet, checking the github.io address`);
} catch { console.log(`! ${DOMAIN} does not resolve yet — checking the github.io address`); }
const SITE = domainReady ? `https://${DOMAIN}/` : 'https://zswolt.github.io/Streamer-s-Kombat-26/';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const mfIdx = args.indexOf('--message-file');
const message = mfIdx >= 0 ? fs.readFileSync(args[mfIdx + 1], 'utf8')
  : args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--message-file') ?? `Update the game (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`;

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', shell: process.platform === 'win32' && /^(npm|npx)$/.test(cmd), ...opts });
  if (r.status !== 0 && !opts.allowFail) { console.error(`\n✗ ${cmd} ${argv.join(' ')} failed (${r.status})`); process.exit(1); }
  return r;
}
function git(argv, opts = {}) { return run('git', ['-C', CLONE, ...argv], opts); }
function gitOut(argv) { return spawnSync('git', ['-C', CLONE, ...argv], { encoding: 'utf8' }).stdout.trim(); }

if (!fs.existsSync(path.join(CLONE, '.git'))) { console.error(`No git clone at ${CLONE} (set SK_CLONE)`); process.exit(1); }

console.log('▸ build');
run('npm', ['run', 'build'], { cwd: ROOT });
if (!flag('--no-test')) { console.log('▸ tests'); run('npx', ['vitest', 'run'], { cwd: ROOT }); }

// ---------------------------------------------------------------- copy into the clone
const SKIP_DIRS = new Set(['node_modules', '.git']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); } else out.push(path.join(dir, e.name));
  }
  return out;
}
const files = [];
function copy(rel) {
  const src = path.join(ROOT, rel), dst = path.join(CLONE, rel);
  if (!fs.existsSync(src)) return;
  if (fs.statSync(src).isDirectory()) { for (const f of walk(src)) copy(path.relative(ROOT, f)); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const same = fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size && fs.readFileSync(dst).equals(fs.readFileSync(src));
  if (!same) fs.copyFileSync(src, dst);
  files.push(rel.split(path.sep).join('/'));
}
console.log('▸ sync →', CLONE);
for (const d of ['client', 'tests', 'docs']) copy(d);
for (const f of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']) copy(f);
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) if (/\.(py|mjs)$/.test(f)) copy(path.join('tools', f));
for (const f of fs.readdirSync(path.join(ROOT, 'tools', 'models'))) if (/\.(py|sh)$/.test(f)) copy(path.join('tools', 'models', f));
copy(path.join('tools', 'models', 'overrides'));
for (const f of fs.readdirSync(path.join(ROOT, 'tools', 'voices'))) if (/\.(md|txt)$/.test(f)) copy(path.join('tools', 'voices', f));

// files that were deleted here are deleted there too (only in the places this script owns)
const OWNED = [/^client\//, /^server\//, /^tests\//, /^docs\//, /^tools\/[^/]+\.(py|mjs)$/, /^tools\/models\/[^/]+\.(py|sh)$/, /^tools\/models\/overrides\//, /^START-SERVER\.bat$/];
const have = new Set(files);
const gone = spawnSync('git', ['-C', CLONE, '-c', 'core.quotepath=false', 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.split('\n')
  .filter((f) => f && OWNED.some((r) => r.test(f)) && !have.has(f) && !fs.existsSync(path.join(ROOT, f)));
if (gone.length) {
  console.log('▸ removing', gone.length, 'deleted file(s):', gone.slice(0, 8).join(', ') + (gone.length > 8 ? ' …' : ''));
  const rl = path.join(os.tmpdir(), `sk-deploy-rm-${process.pid}.txt`);
  fs.writeFileSync(rl, gone.join('\n'));
  run('git', ['-C', CLONE, 'rm', '-q', '--pathspec-from-file=' + rl]);
  fs.rmSync(rl);
}

// dist is replaced wholesale so stale hashed bundles do not pile up (dist/tools in the clone is not ours)
const distDst = path.join(CLONE, 'dist');
for (const e of fs.existsSync(distDst) ? fs.readdirSync(distDst) : []) if (e !== 'tools') fs.rmSync(path.join(distDst, e), { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'dist'), distDst, { recursive: true });

// Pages serves the branch root: its index.html is dist/index.html with a <base> pointing into dist/
const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
if (!/<meta name="viewport"[^>]*>/.test(html)) { console.error('dist/index.html has no viewport meta to anchor the <base> tag'); process.exit(1); }
// (relative, so the same page works under /Streamer-s-Kombat-26/ on github.io and at the root of the custom domain)
fs.writeFileSync(path.join(CLONE, 'index.html'), html.replace(/(<meta name="viewport"[^>]*>)/, '$1\n    <base href="dist/" />'));

// ---------------------------------------------------------------- commit + push
const list = path.join(os.tmpdir(), `sk-deploy-${process.pid}.txt`);
fs.writeFileSync(list, files.join('\n'));
git(['add', '--pathspec-from-file=' + list]);
fs.rmSync(list);
git(['add', '-A', '--', 'dist', 'index.html', ':!dist/tools']);
if (spawnSync('git', ['-C', CLONE, 'diff', '--cached', '--quiet']).status === 0) { console.log('✓ nothing changed — the site is already up to date'); process.exit(0); }
const mf = path.join(os.tmpdir(), `sk-deploy-msg-${process.pid}.txt`);
fs.writeFileSync(mf, message);
git(['commit', '-q', '-F', mf]);
fs.rmSync(mf);
console.log('✓ committed', gitOut(['log', '--oneline', '-1']));
if (flag('--no-push')) process.exit(0);
// someone else may have pushed meanwhile (GitHub itself commits a CNAME when the Pages domain is changed)
git(['fetch', '-q', 'origin', 'main'], { allowFail: true });
if (Number(gitOut(['rev-list', '--count', 'HEAD..origin/main'])) > 0) {
  console.log('▸ merging new commits from origin/main');
  git(['merge', '--no-edit', '-q', 'origin/main']);
}
console.log('▸ push');
git(['push', 'origin', 'main'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });

// ---------------------------------------------------------------- wait for the live site
// the page itself is compared, so a change that leaves the bundle untouched (index.html only) is waited for too;
// if GitHub's build of the page differs in some trivial way, the bundle name is accepted after a minute
const bundle = html.match(/assets\/index-[\w-]+\.js/)?.[0];
const squash = (t) => t.replace(/\s+/g, ' ').trim();
console.log('▸ waiting for', SITE, 'to serve', bundle);
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 6000));
  try {
    const live = await (await fetch(SITE + '?t=' + Date.now(), { cache: 'no-store', redirect: 'follow' })).text();
    if (squash(live) === squash(html) || (i >= 10 && bundle && live.includes(bundle))) { console.log(`✓ live after ~${(i + 1) * 6}s: ${SITE}`); process.exit(0); }
  } catch { /* keep polling */ }
}
console.log('! pushed, but the site had not switched to the new build after 4 minutes — check the repo\'s Actions tab');
