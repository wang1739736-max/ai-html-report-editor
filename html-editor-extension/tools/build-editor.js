// 由工作区根目录的 html-editor.html 生成插件用的编辑器文件。
// 为什么需要：Chrome 扩展页面（MV3）的内容安全策略禁止内联 <script>，
// 直接放单文件会导致界面显示、但脚本完全不执行（所有按钮失效）。
// 用法：node tools/build-editor.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'html-editor.html');
const outDir = path.resolve(__dirname, '..', 'editor');

if (!fs.existsSync(src)) {
  console.error('找不到源文件：' + src);
  process.exit(1);
}
let html = fs.readFileSync(src, 'utf8');

const styleRe = /<style>([\s\S]*?)<\/style>/;
const scriptRe = /<script>([\s\S]*?)<\/script>/;
const styleMatch = html.match(styleRe);
const scriptMatch = html.match(scriptRe);
if (!styleMatch || !scriptMatch) {
  console.error('源文件里没找到内联 <style> 或 <script>');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'editor.css'), styleMatch[1].trim() + '\n', 'utf8');
fs.writeFileSync(path.join(outDir, 'editor.js'), scriptMatch[1].trim() + '\n', 'utf8');

const out = html
  .replace(styleRe, '<link rel="stylesheet" href="editor.css">')
  .replace(scriptRe, '<script src="editor.js"></script>');
fs.writeFileSync(path.join(outDir, 'editor.html'), out, 'utf8');

const kb = n => Math.round(n / 1024) + ' KB';
console.log('已生成：');
console.log('  editor/editor.html  ' + kb(fs.statSync(path.join(outDir, 'editor.html')).size));
console.log('  editor/editor.css   ' + kb(fs.statSync(path.join(outDir, 'editor.css')).size));
console.log('  editor/editor.js    ' + kb(fs.statSync(path.join(outDir, 'editor.js')).size));
console.log('（源文件：' + path.relative(root, src) + '）');
