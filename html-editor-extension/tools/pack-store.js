// 生成符合 Edge / Chrome 商店要求的扩展包
// 关键差异：商店要求 manifest.json 位于 ZIP 的【根目录】，不能多套一层文件夹；
// 且包内只放扩展运行需要的文件（不含 tools/、README 等）。
// 用法：node tools/pack-store.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EXT = path.resolve(__dirname, '..');
const ROOT = path.resolve(EXT, '..');
const OUT_DIR = path.join(ROOT, 'store');

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const OUT = path.join(OUT_DIR, `ai-html-report-editor-v${manifest.version}.zip`);

// 需要打进商店包的内容
const INCLUDE_FILES = ['manifest.json', 'background.js', 'content.js'];
const INCLUDE_DIRS = ['editor', 'icons'];

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function collect() {
  const out = [];
  INCLUDE_FILES.forEach(f => {
    const full = path.join(EXT, f);
    if (fs.existsSync(full)) out.push({ rel: f, full });
  });
  INCLUDE_DIRS.forEach(dir => {
    const base = path.join(EXT, dir);
    if (!fs.existsSync(base)) return;
    (function walk(d, prefix) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
        const full = path.join(d, e.name);
        const rel = prefix + '/' + e.name;
        if (e.isDirectory()) walk(full, rel);
        else out.push({ rel, full });
      });
    })(base, dir);
  });
  return out;
}

function zip(files, outFile) {
  const locals = [], centrals = [];
  let offset = 0;
  files.forEach(f => {
    const data = fs.readFileSync(f.full);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const nameBuf = Buffer.from(f.rel, 'utf8');
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
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  });
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(outFile, Buffer.concat([Buffer.concat(locals), central, eocd]));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const files = collect();
zip(files, OUT);

// —— 自检 ——
const checks = [];
checks.push(['manifest.json 在 ZIP 根目录（商店要求）', files.some(f => f.rel === 'manifest.json')]);
checks.push(['没有多余的顶层文件夹', !files.some(f => f.rel.startsWith('html-editor-extension/'))]);
checks.push(['名称 ≤ 45 字符', manifest.name.length <= 45]);
checks.push(['描述 ≤ 132 字符', manifest.description.length <= 132]);
checks.push(['manifest_version = 3', manifest.manifest_version === 3]);
checks.push(['图标齐全', ['16', '32', '48', '128'].every(s => manifest.icons && manifest.icons[s])]);
const editorFiles = files.filter(f => f.rel.startsWith('editor/')).map(f => f.rel);
checks.push(['编辑器已外置脚本（MV3 CSP）', editorFiles.includes('editor/editor.js') && editorFiles.includes('editor/editor.css')]);

console.log('商店包：' + path.relative(ROOT, OUT) + '  ' + Math.round(fs.statSync(OUT).size / 1024) + ' KB  (' + files.length + ' 个文件)');
console.log('包含：' + files.map(f => f.rel).join('  '));
console.log('\n自检：');
let ok = true;
checks.forEach(([name, pass]) => { console.log('  ' + (pass ? '✅' : '❌') + ' ' + name); if (!pass) ok = false; });
console.log('\n' + (ok ? '可以上传到 Edge 合作伙伴中心 ✅' : '有问题，先修复 ❌'));
process.exit(ok ? 0 : 1);
