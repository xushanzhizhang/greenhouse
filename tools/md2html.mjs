/**
 * 需求分析文档生成器：Markdown -> 带目录的 HTML
 * 用法：node tools/md2html.mjs
 */
import fs from 'node:fs';
import { marked } from 'marked';

const SRC = 'D:/greenhouse/docs/需求分析.md';
const OUT = 'D:/greenhouse/docs/需求分析.html';

const md = fs.readFileSync(SRC, 'utf8');
let body = marked.parse(md, { mangle: false, headerIds: false });

// 给 h2/h3 加锚点并生成目录
const toc = [];
let idx = 0;
body = body.replace(/<h([23])>(.*?)<\/h\1>/g, (m, lv, text) => {
  const id = `sec-${++idx}`;
  const plain = text.replace(/<[^>]+>/g, '');
  toc.push({ id, lv: Number(lv), text: plain });
  return `<h${lv} id="${id}">${text}</h${lv}>`;
});

const tocHtml = toc
  .map((t) => `<li class="lv${t.lv}"><a href="#${t.id}">${t.text}</a></li>`)
  .join('\n');

const doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>智慧大棚数字孪生大屏 · 需求分析与设计说明</title>
<style>
  :root {
    --ink: #1b2733; --dim: #5b6d7e; --line: #e2e8ef;
    --accent: #0e8ea8; --accent-soft: #e6f6f9; --bg: #f6f8fa;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    font-size: 15px; line-height: 1.8;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 48px 28px 80px; display: grid; grid-template-columns: 220px 1fr; gap: 36px; }
  .toc { position: sticky; top: 28px; align-self: start; font-size: 13px; }
  .toc h3 { font-size: 12px; letter-spacing: 2px; color: var(--dim); font-weight: 600; margin: 0 0 10px; }
  .toc ul { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--line); }
  .toc li { padding: 3px 0 3px 12px; }
  .toc li.lv3 { padding-left: 24px; font-size: 12.2px; color: var(--dim); }
  .toc a { color: var(--ink); text-decoration: none; }
  .toc a:hover { color: var(--accent); }
  .doc { background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 46px 54px 60px; box-shadow: 0 10px 40px rgba(20,40,60,.06); min-width: 0; }
  h1 { font-size: 29px; line-height: 1.4; margin: 0 0 8px; letter-spacing: .5px; }
  h1 + p, .doc > p:first-of-type { color: var(--dim); }
  h2 { font-size: 20px; margin: 44px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); letter-spacing: .5px; }
  h2:first-of-type { margin-top: 34px; }
  h3 { font-size: 16px; margin: 26px 0 8px; color: #123; }
  h4 { font-size: 14.5px; margin: 18px 0 6px; }
  p { margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 13.4px; }
  th, td { border: 1px solid var(--line); padding: 8px 11px; text-align: left; vertical-align: top; }
  th { background: #f2f5f8; font-weight: 600; color: #22303d; white-space: nowrap; }
  tr:nth-child(even) td { background: #fbfcfd; }
  code { background: #f2f5f8; padding: 1px 5px; border-radius: 3px; font-family: Consolas, monospace; font-size: 13px; }
  pre { background: #0f1b27; color: #d6e6f5; padding: 16px 18px; border-radius: 4px; overflow: auto; font-size: 12.6px; line-height: 1.7; }
  pre code { background: none; padding: 0; color: inherit; }
  blockquote { margin: 12px 0; padding: 8px 16px; border-left: 3px solid var(--accent); background: var(--accent-soft); color: #274; }
  ul, ol { padding-left: 22px; }
  li { margin: 5px 0; }
  .meta-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 8px; }
  .chip { font-size: 12px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 99px; color: var(--dim); background: #fafcfd; }
  .foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--dim); display: flex; justify-content: space-between; }
  @media print {
    body { background: #fff; font-size: 11.5pt; }
    .toc { display: none; }
    .wrap { display: block; max-width: none; padding: 0; }
    .doc { border: none; box-shadow: none; padding: 0; }
    h2 { page-break-after: avoid; }
    table, pre { page-break-inside: avoid; }
  }
  @media (max-width: 960px) {
    .wrap { grid-template-columns: 1fr; padding: 20px 12px 40px; }
    .toc { position: static; }
    .doc { padding: 26px 18px 40px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <aside class="toc">
    <h3>目录 CONTENTS</h3>
    <ul>${tocHtml}</ul>
  </aside>
  <main class="doc">
    <div class="meta-chips">
      <span class="chip">版本 v1.0</span>
      <span class="chip">Three.js r180</span>
      <span class="chip">设计基准 1920×1080</span>
      <span class="chip">GLB 27.5 MB</span>
      <span class="chip">2026-11-18</span>
    </div>
    ${body}
    <div class="foot">
      <span>智慧大棚数字孪生平台 · 需求分析与设计说明</span>
      <span>生成于 ${new Date().toLocaleString('zh-CN')}</span>
    </div>
  </main>
</div>
</body>
</html>`;

fs.writeFileSync(OUT, doc, 'utf8');
console.log('written:', OUT, doc.length, 'bytes, toc:', toc.length);

