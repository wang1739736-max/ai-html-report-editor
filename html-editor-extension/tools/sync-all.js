// AI HTML 汇报修改台 · 一键同步打包
// 作用：以根目录 html-editor.html 为唯一源，重新生成 / 归档 / 打包，并校验一致性。
// 用法：node html-editor-extension/tools/sync-all.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const EXT = path.resolve(__dirname, '..');            // html-editor-extension/
const ROOT = path.resolve(EXT, '..');                 // 工作区根
const SRC = path.join(ROOT, 'html-editor.html');      // 唯一源文件
const EDITOR = path.join(EXT, 'editor');
const VERSIONS = path.join(ROOT, 'versions');
const ZIP = path.join(ROOT, 'html-editor-extension.zip');

const log = (...a) => console.log(...a);
const kb = n => Math.round(n / 1024) + ' KB';

// ---------- 1. 生成插件版编辑器三件套 ----------
log('\n[1/4] 由 html-editor.html 生成插件版编辑器…');
execFileSync(process.execPath, [path.join(__dirname, 'build-editor.js')], { stdio: 'inherit' });

// ---------- 2. 归档单文件版 ----------
log('\n[2/4] 归档单文件版…');
fs.mkdirSync(VERSIONS, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const archive = path.join(VERSIONS, 'html-editor-v1.0-' + today + '.html');
fs.copyFileSync(SRC, archive);
log('  ' + path.relative(ROOT, archive) + '  ' + kb(fs.statSync(archive).size));

// ---------- 3. 打包插件（标准 zip，正斜杠） ----------
log('\n[3/4] 打包插件…');
function walk(dir, base, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const full = path.join(dir, e.name);
    const rel = (base ? base + '/' : '') + e.name;
    if (e.isDirectory()) walk(full, rel, out);
    else out.push({ rel, full });
  });
  return out;
}
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function zipDir(dir, rootName, outFile) {
  const files = walk(dir, '', []);
  const locals = [], centrals = [];
  let offset = 0;
  files.forEach(f => {
    const name = rootName + '/' + f.rel;
    const data = fs.readFileSync(f.full);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(0, 42);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  });
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(outFile, Buffer.concat([Buffer.concat(locals), centralBuf, eocd]));
  return files.length;
}
const n = zipDir(EXT, 'html-editor-extension', ZIP);
log('  ' + path.relative(ROOT, ZIP) + '  ' + kb(fs.statSync(ZIP).size) + '（' + n + ' 个文件）');
fs.copyFileSync(ZIP, path.join(VERSIONS, 'html-editor-extension-v1.0-' + today + '.zip'));

// ---------- 4. 一致性校验 ----------
log('\n[4/4] 一致性校验…');
const src = fs.readFileSync(SRC, 'utf8');
const grab = (text, tag) => {
  const m = text.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  return m ? m[1].trim() : null;
};
const srcCss = grab(src, 'style');
const srcJs = grab(src, 'script');
const genCss = fs.readFileSync(path.join(EDITOR, 'editor.css'), 'utf8').trim();
const genJs = fs.readFileSync(path.join(EDITOR, 'editor.js'), 'utf8').trim();
const genHtml = fs.readFileSync(path.join(EDITOR, 'editor.html'), 'utf8');

const checks = [
  ['单文件版 <style> ↔ 插件 editor.css', srcCss === genCss],
  ['单文件版 <script> ↔ 插件 editor.js', srcJs === genJs],
  ['插件 editor.html 已外置样式', genHtml.includes('href="editor.css"')],
  ['插件 editor.html 已外置脚本', genHtml.includes('src="editor.js"')],
  ['插件 editor.html 无内联 <script>（MV3 会拦截）', !/<script>/.test(genHtml)],
  ['插件 editor.html 含插件模式', genHtml.includes('mode=ext') || genJs.includes('mode=ext')],
  ['归档与单文件版一致', fs.readFileSync(archive, 'utf8') === src]
];
let ok = true;
checks.forEach(([name, pass]) => {
  log('  ' + (pass ? '✅' : '❌') + ' ' + name);
  if (!pass) ok = false;
});
log('\n' + (ok ? '全部一致 ✅  未封装目录与打包文件均已是最新版本。' : '存在不一致 ❌  请检查上面的失败项。'));
log('提示：改完 html-editor.html 后，重新运行本脚本即可；扩展需回 chrome://extensions 点「重新加载」。');
process.exit(ok ? 0 : 1);
