// 生成 Edge 商店上架素材（尺寸严格按官方要求）
//   300×300   扩展图标（必需，1:1）
//   440×280   小促销图（可选，推荐）
//   1400×560  大促销图（可选）
//   1280×800  截图（可选，最多 6 张；官方允许 640×480 或 1280×800）
// 用法：node tools/make-store-assets.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const EXT = path.resolve(__dirname, '..');
const ROOT = path.resolve(EXT, '..');
const OUT = path.join(ROOT, 'store');
const ASSETS = path.join(__dirname, 'store-assets.html');
const SHOT = path.join(__dirname, 'shot.html');

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const chrome = CANDIDATES.find(p => fs.existsSync(p));
if (!chrome) { console.error('没找到 Chrome / Edge'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '');

function capture(url, w, h, outName, budget = 9000) {
  const tmp = path.join(os.tmpdir(), 'cap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.png');
  try {
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
      '--allow-file-access-from-files', '--disable-web-security',
      '--force-device-scale-factor=1',
      `--window-size=${w},${h}`, `--virtual-time-budget=${budget}`,
      '--screenshot=' + tmp.replace(/\\/g, '/'), url
    ], { stdio: 'ignore', timeout: 90000 });
  } catch (e) { /* 截图可能仍已生成 */ }
  if (!fs.existsSync(tmp)) { console.error('  ✗ 截图失败：' + outName); return false; }
  const dest = path.join(OUT, outName);
  fs.copyFileSync(tmp, dest);
  fs.rmSync(tmp, { force: true });
  console.log('  ✓ ' + outName + '  ' + Math.round(fs.statSync(dest).size / 1024) + ' KB  (' + w + '×' + h + ')');
  return true;
}

console.log('生成品牌素材：');
capture(fileUrl(ASSETS) + '?k=logo300', 300, 300, 'logo-300.png', 3000);
capture(fileUrl(ASSETS) + '?k=promoSmall', 440, 280, 'promo-440x280.png', 3000);
capture(fileUrl(ASSETS) + '?k=promoLarge', 1400, 560, 'promo-1400x560.png', 3000);

console.log('生成商店截图（1280×800）：');
const shotUrl = fileUrl(SHOT);
capture(shotUrl, 1280, 800, 'screenshot-1-editor.png');
capture(shotUrl + '?s=insert', 1280, 800, 'screenshot-2-insert.png');
capture(shotUrl + '?s=style', 1280, 800, 'screenshot-3-select.png');

console.log('\n素材目录：' + path.relative(ROOT, OUT));
