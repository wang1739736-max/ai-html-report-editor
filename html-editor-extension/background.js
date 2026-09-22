// AI HTML 汇报修改台 —— 后台脚本
// 点击工具栏图标（或扩展菜单里的条目）→ 把修稿台覆盖到当前页面。
// 如果当前页面不允许注入（chrome:// 新标签页、扩展商店、PDF 等），
// 则直接新开一个标签页进入修稿台本体，保证"点了就能进"。

const EDITOR_PAGE = 'editor/editor.html';
const HOST_ID = '__html_editor_host';

async function toggleOverlay(tabId) {
  // content.js 自带开关：已打开则关闭，未打开则打开
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ['content.js']
  });
}

async function openEditorStandalone() {
  await chrome.tabs.create({ url: chrome.runtime.getURL(EDITOR_PAGE) });
}

chrome.action.onClicked.addListener(async tab => {
  const restricted = !tab || !tab.id || /^(chrome|edge|about|devtools|chrome-extension|chrome-search|chrome-untrusted|view-source|data):/i.test((tab && tab.url) || '');
  if (!restricted) {
    try {
      await toggleOverlay(tab.id);
      return;
    } catch (err) {
      // 常见：本地 file:// 页面未开启"允许访问文件网址"，或页面有严格 CSP
      console.warn('[HTML 画板] 覆盖到当前页面失败，改为直接打开编辑器：', err && err.message);
    }
  }
  await openEditorStandalone();
});

// 给一个默认快捷键（用户可在 chrome://extensions/shortcuts 里改）
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async command => {
    if (command !== 'open-editor') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const restricted = !tab || !tab.id || /^(chrome|edge|about|devtools|chrome-extension|chrome-search|chrome-untrusted|view-source|data):/i.test((tab && tab.url) || '');
    if (!restricted) {
      try { await toggleOverlay(tab.id); return; } catch (e) {}
    }
    await openEditorStandalone();
  });
}
