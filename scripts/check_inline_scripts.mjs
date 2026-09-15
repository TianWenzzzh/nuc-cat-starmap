#!/usr/bin/env node
/**
 * CI 门禁：仓库内所有 HTML 的内联 <script> 块 + 所有 .js 文件逐一 node --check。
 *
 * 由来：v2.2～v2.7 每次提交信息里都手写着「N 个 script 块 node --check 全过」
 * ——这是纯手工仪式，改 HTML 时谁都有忘的一天。版权署名、影廊这类加固一旦
 * 引入语法错误，星图直接白屏，所以固化成脚本挡在 CI 里。
 */
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const htmlFiles = [];
const jsFiles = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.toLowerCase().endsWith('.html')) htmlFiles.push(p);
    else if (name.toLowerCase().endsWith('.js')) jsFiles.push(p);
  }
})(root);

// 内联块 = 不带 src 的 <script>；type="module" 也一并查（语法层两者都吃 --check）
function inlineScripts(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1] || '')) continue;
    if (m[2].trim()) out.push(m[2]);
  }
  return out;
}

const tmp = mkdtempSync(join(tmpdir(), 'html-script-check-'));
let total = 0;
let bad = 0;
function check(label, code) {
  total += 1;
  const f = join(tmp, `chunk-${total}.js`);
  writeFileSync(f, code);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad += 1;
    console.error(`✗ ${label}\n${(r.stderr || '').trim()}\n`);
  }
}

for (const f of htmlFiles) {
  inlineScripts(f).forEach((code, i) => check(`${relative(root, f)} 第${i + 1}个内联块`, code));
}
for (const f of jsFiles) {
  check(relative(root, f), readFileSync(f, 'utf8'));
}
rmSync(tmp, { recursive: true, force: true });

console.log(`检查完成：${htmlFiles.length} 个 HTML 的内联块 + ${jsFiles.length} 个 .js = ${total} 块，失败 ${bad}`);
process.exit(bad ? 1 : 0);
