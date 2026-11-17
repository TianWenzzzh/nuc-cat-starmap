#!/usr/bin/env node
/**
 * check_roster_sync.mjs — 猫咪名册 CSV ↔ HTML 内嵌 CATS 数据一致性自检
 *
 * 零依赖，仅用 Node.js 内置模块。
 * 比对 data/猫咪名册.csv 与 中北喵星图.html 内嵌的 CATS 数组，
 * 按「编号」逐条比对关键字段，输出一致条数、差异清单与退出码。
 *
 * 用法：
 *   node scripts/check_roster_sync.mjs
 *
 * 退出码：
 *   0 = 完全一致
 *   1 = 发现差异（或运行出错）
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// ── 路径 ──────────────────────────────────────────────
const CSV_PATH = join(projectRoot, 'data', '猫咪名册.csv');
const HTML_PATH = join(projectRoot, '中北喵星图.html');

// ── CSV 列契约（12 列）────────────────────────────────
const CSV_COLUMNS = [
  '编号', '昵称', '军衔', '工位', '毛色', '特征描述',
  '代表照片文件', '照片数量', '出没区域', '关联照片编号', '置信度', '备注',
];

// ── CSV → HTML 字段映射 ──────────────────────────────
// 只比对两侧都有的关键字段；HTML 独有字段（coatGroup/bio/brightness）
// 和 CSV 独有字段（关联照片编号/置信度/备注）不参与比对。
const FIELD_MAP = {
  '编号':     'id',
  '昵称':     'name',
  '军衔':     'rank',
  '工位':     'title',
  '毛色':     'coat',
  '特征描述': 'features',
  '代表照片文件': 'photo',
  '照片数量': 'photoCount',
  '出没区域': 'area',
};

// ── 工具函数 ──────────────────────────────────────────

/** 去除 UTF-8 BOM */
function stripBOM(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

/** 简易 CSV 行解析（支持双引号包裹、逗号转义） */
function parseCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

/** 解析 CSV 全文 → 对象数组 */
function parseCSV(text) {
  const lines = stripBOM(text).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV 行数不足（无数据行）');

  // 用契约列名解析表头，验证列数
  const header = parseCSVLine(lines[0]);
  if (header.length !== CSV_COLUMNS.length) {
    throw new Error(`CSV 表头列数 ${header.length} ≠ 预期 ${CSV_COLUMNS.length}：${JSON.stringify(header)}`);
  }
  // 逐列校验表头名称（允许前后空白）
  for (let i = 0; i < CSV_COLUMNS.length; i++) {
    if (header[i].trim() !== CSV_COLUMNS[i]) {
      throw new Error(`CSV 第 ${i + 1} 列名「${header[i].trim()}」≠ 预期「${CSV_COLUMNS[i]}」`);
    }
  }

  const records = [];
  for (let r = 1; r < lines.length; r++) {
    const values = parseCSVLine(lines[r]);
    if (values.length !== CSV_COLUMNS.length) {
      throw new Error(`CSV 第 ${r + 1} 行列数 ${values.length} ≠ ${CSV_COLUMNS.length}`);
    }
    const obj = {};
    for (let c = 0; c < CSV_COLUMNS.length; c++) {
      obj[CSV_COLUMNS[c]] = values[c].trim();
    }
    records.push(obj);
  }
  return records;
}

/** 从 HTML 提取内嵌 CATS 数组 */
function extractCATS(html) {
  // 匹配 `const CATS = [ ... ];` 或 `var CATS = [ ... ];`
  const m = html.match(/(?:const|var|let)\s+CATS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) throw new Error('HTML 中未找到 CATS 数组定义');

  const body = m[1];
  const cats = [];

  // 逐个提取 `{ ... }` 对象
  let depth = 0, start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (body[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const objStr = body.slice(start, i + 1);
        cats.push(parseJSObject(objStr));
        start = -1;
      }
    }
  }
  if (cats.length === 0) throw new Error('CATS 数组中未解析到任何对象');
  return cats;
}

/** 简易 JS 对象字面量解析（提取 key: value 对） */
function parseJSObject(str) {
  const obj = {};
  // 匹配 `key: value` 或 `"key": value` 或 `'key': value`
  // value 可以是：字符串（单/双引号）、数字、布尔
  const regex = /(?:["']?)(\w+)(?:["']?)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|-?\d+\.?\d*)/g;
  let m;
  while ((m = regex.exec(str)) !== null) {
    let val = m[2];
    if (val.startsWith('"') || val.startsWith("'")) {
      // 去引号，反转义
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
    obj[m[1]] = val;
  }
  return obj;
}

// ── 归一化函数（消除两侧格式差异后再比对）────────────

/** 特征描述：CSV 用空格分隔，HTML 用「、」分隔 → 统一为空格排序数组 */
function normalizeFeatures(val) {
  if (!val) return '';
  return val
    .split(/[、\s]+/)           // 按顿号或空格切分
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .sort()
    .join(' ');
}

/** 照片路径：CSV 用「补充视频照片/」前缀，HTML 用「assets/photos/」前缀 → 取文件名 */
function normalizePhoto(val) {
  if (!val) return '';
  // 取最后一段文件名（兼容 / 和 \）
  const parts = val.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1].trim();
}

/** 照片数量：统一为整数 */
function normalizePhotoCount(val) {
  if (val === undefined || val === null || val === '') return '';
  return String(parseInt(val, 10) || 0);
}

/** 通用归一化：去首尾空白 */
function normalizeText(val) {
  return (val ?? '').trim();
}

// ── 字段归一化策略表 ──────────────────────────────────
const NORMALIZERS = {
  'features': normalizeFeatures,
  'photo':    normalizePhoto,
  'photoCount': normalizePhotoCount,
};

/** 比对单个字段，返回 true=一致 / false=有差异 */
function compareField(csvVal, htmlVal, htmlField) {
  const norm = NORMALIZERS[htmlField] || normalizeText;
  return norm(csvVal) === norm(htmlVal);
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  // 1. 读取文件
  let csvText, htmlText;
  try {
    csvText = readFileSync(CSV_PATH, 'utf-8');
  } catch (e) {
    console.error(`❌ 无法读取 CSV：${CSV_PATH}\n   ${e.message}`);
    process.exit(1);
  }
  try {
    htmlText = readFileSync(HTML_PATH, 'utf-8');
  } catch (e) {
    console.error(`❌ 无法读取 HTML：${HTML_PATH}\n   ${e.message}`);
    process.exit(1);
  }

  // 2. 解析
  let csvRecords, htmlCats;
  try {
    csvRecords = parseCSV(csvText);
  } catch (e) {
    console.error(`❌ CSV 解析失败：${e.message}`);
    process.exit(1);
  }
  try {
    htmlCats = extractCATS(htmlText);
  } catch (e) {
    console.error(`❌ HTML CATS 提取失败：${e.message}`);
    process.exit(1);
  }

  console.log('═'.repeat(60));
  console.log('  猫咪名册 CSV ↔ HTML 内嵌 CATS 数据一致性自检');
  console.log('═'.repeat(60));
  console.log(`CSV  记录数：${csvRecords.length}`);
  console.log(`HTML CATS 数：${htmlCats.length}`);
  console.log();

  // 3. 构建索引（按编号/id）
  const csvMap = new Map();
  for (const r of csvRecords) {
    csvMap.set(r['编号'], r);
  }
  const htmlMap = new Map();
  for (const c of htmlCats) {
    htmlMap.set(c.id, c);
  }

  // 4. 编号集合差异
  const csvIds = new Set(csvMap.keys());
  const htmlIds = new Set(htmlMap.keys());
  const onlyInCsv = [...csvIds].filter(id => !htmlIds.has(id)).sort();
  const onlyInHtml = [...htmlIds].filter(id => !csvIds.has(id)).sort();

  // 5. 逐条比对共有编号
  const commonIds = [...csvIds].filter(id => htmlIds.has(id)).sort();
  const diffs = [];   // { id, field, csvVal, htmlVal }
  let consistentCount = 0;

  for (const id of commonIds) {
    const csvRec = csvMap.get(id);
    const htmlRec = htmlMap.get(id);
    let allMatch = true;

    for (const [csvCol, htmlField] of Object.entries(FIELD_MAP)) {
      const csvVal = csvRec[csvCol];
      const htmlVal = htmlRec[htmlField];
      if (!compareField(csvVal, htmlVal, htmlField)) {
        diffs.push({
          id,
          field: `${csvCol} ↔ ${htmlField}`,
          csvVal: csvVal ?? '(空)',
          htmlVal: htmlVal ?? '(空)',
        });
        allMatch = false;
      }
    }

    if (allMatch) consistentCount++;
  }

  // 6. 输出报告
  console.log('─'.repeat(60));
  console.log('【编号集合差异】');
  if (onlyInCsv.length === 0 && onlyInHtml.length === 0) {
    console.log('  无（两侧编号集合完全一致）');
  } else {
    if (onlyInCsv.length > 0) {
      console.log(`  仅 CSV 有（${onlyInCsv.length}）：${onlyInCsv.join(', ')}`);
    }
    if (onlyInHtml.length > 0) {
      console.log(`  仅 HTML 有（${onlyInHtml.length}）：${onlyInHtml.join(', ')}`);
    }
  }
  console.log();

  console.log('─'.repeat(60));
  console.log('【字段比对结果】');
  console.log(`  共有编号：${commonIds.length}`);
  console.log(`  一致条数：${consistentCount}`);
  console.log(`  差异数量：${diffs.length}`);
  console.log();

  if (diffs.length > 0) {
    console.log('─'.repeat(60));
    console.log('【差异清单】');
    console.log('  格式：编号 | 字段 | CSV 值 | HTML 值');
    console.log();
    for (const d of diffs) {
      console.log(`  ${d.id}`);
      console.log(`    字段：${d.field}`);
      console.log(`    CSV ：${d.csvVal}`);
      console.log(`    HTML：${d.htmlVal}`);
      console.log();
    }
  }

  // 7. 汇总与退出码
  const totalIssues = onlyInCsv.length + onlyInHtml.length + diffs.length;
  console.log('═'.repeat(60));
  if (totalIssues === 0) {
    console.log('✅ 全部一致，双数据源无漂移。');
    console.log(`   CSV ${csvRecords.length} 条 ↔ HTML ${htmlCats.length} 条，${consistentCount} 条字段全部匹配。`);
    process.exit(0);
  } else {
    console.log(`⚠️  发现 ${totalIssues} 处差异（编号差异 ${onlyInCsv.length + onlyInHtml.length} + 字段差异 ${diffs.length}）。`);
    process.exit(1);
  }
}

main();
