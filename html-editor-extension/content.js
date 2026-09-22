// HTML 画板 · 内容脚本
// 作用：把当前页面原样交给编辑器 iframe，用户在编辑器里改完导出 HTML。
// 采用「整页遮罩 + 扩展内页面」的方式，编辑过程不污染原页面，退出即还原。
(function () {
  const HOST_ID = '__html_editor_host';

  // 已经开着编辑器 → 再点一次就退出
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }

  // ① 先把当前页面快照下来（必须在插入遮罩之前）
  const pageHTML = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  const pageTitle = document.title || location.pathname.split('/').pop() || '当前页面';

  // ② 遮罩 + 编辑器 iframe
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#F2EFF9', 'margin:0', 'padding:0', 'border:0'
  ].join(';');

  const frame = document.createElement('iframe');
  frame.id = '__html_editor_frame';
  frame.setAttribute('allow', 'clipboard-write');
  frame.src = chrome.runtime.getURL('editor/editor.html') + '?mode=ext';
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#F2EFF9;';
  host.appendChild(frame);
  document.documentElement.appendChild(host);

  function teardown() {
    window.removeEventListener('message', onMessage, false);
    if (host.parentNode) host.remove();
  }

  function onMessage(ev) {
    const msg = ev.data || {};
    if (msg.type === 'html-editor-ready') {
      // 编辑器就绪 → 把页面内容送进去
      frame.contentWindow.postMessage({ type: 'html-editor-load', html: pageHTML, title: pageTitle }, '*');
    } else if (msg.type === 'html-editor-exit') {
      teardown();
    }
  }
  window.addEventListener('message', onMessage, false);

  // 兜底：iframe 加载完成后 1.2 秒仍未握手，就主动发一次
  frame.addEventListener('load', () => {
    setTimeout(() => {
      try {
        frame.contentWindow.postMessage({ type: 'html-editor-load', html: pageHTML, title: pageTitle }, '*');
      } catch (e) {}
    }, 1200);
  });

  // Esc 退出（编辑器内按 Esc 由编辑器自己处理，这里只兜底）
  document.addEventListener('keydown', function esc(ev) {
    if (ev.key === 'Escape' && !document.getElementById(HOST_ID)) {
      document.removeEventListener('keydown', esc, true);
    }
  }, true);
})();
