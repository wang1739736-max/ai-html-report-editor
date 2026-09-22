// 生成 README 用的编辑器截图（无头 Chrome）
// 用法：node tools/make-screenshot.js
// 原理：tools/shot.html 通过插件模式的消息通道，把一份示例周报喂给编辑器，再整屏截图。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const EXT = path.resolve(__dirname, '..');
const ROOT = path.resolve(EXT, '..');
const OUT = path.join(ROOT, 'docs', 'screenshot-editor.png');
const SHOT_PAGE = path.join(EXT, 'tools', 'shot.html');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const chrome = CANDIDATES.find(p => fs.existsSync(p));
if (!chrome) {
  console.error('没找到 Chrome / Edge，无法生成截图。');
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmpPng = path.join(os.tmpdir(), 'shot-' + Date.now() + '.png');
const fileUrl = 'file:///' + SHOT_PAGE.replace(/\\/g, '/').replace(/^\/+/, '');

try {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--window-size=1680,1000', '--virtual-time-budget=9000',
    '--screenshot=' + tmpPng.replace(/\\/g, '/'),
    fileUrl
  ], { stdio: 'ignore', timeout: 90000 });
} catch (e) {
  // Chrome 有时以非 0 退出但截图已生成，继续检查文件
}

if (!fs.existsSync(tmpPng)) {
  console.error('截图失败：没有产出文件。');
  process.exit(1);
}
fs.copyFileSync(tmpPng, OUT);
fs.rmSync(tmpPng, { force: true });
console.log('已生成 ' + path.relative(ROOT, OUT) + '  ' + Math.round(fs.statSync(OUT).size / 1024) + ' KB');
