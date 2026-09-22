(function () {
  const stage = document.getElementById('stage');
  const stageWrap = document.getElementById('stage-wrap');
  const dropHint = document.getElementById('drop-hint');
  const panel = document.getElementById('panel');
  const statusbar = document.getElementById('statusbar');
  const fileInput = document.getElementById('file-input');
  const imgFileInput = document.getElementById('img-file-input');

  let selected = null;
  let selection = [];        // 多选集合，selected 为其中最后（主）一个
  let overlay = null;
  let handles = [];
  let undoStack = [], redoStack = [];
  let restoring = false;
  let tool = 'select';       // select | text | rect | img | hand
  let zoom = 1;

  const $ = id => document.getElementById(id);
  const setStatus = m => { const el = document.getElementById('status-msg'); if (el) el.textContent = m; };
  const doc = () => stage.contentDocument;
  const win = () => stage.contentWindow;
  const setDirty = () => { $('project-state').textContent = '● 未保存更改'; refreshLayers(); checkOverflow(true); scheduleAutoSave(); };

  // ================= 文件加载 =================
  function loadFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      stage.srcdoc = r.result;
      dropHint.style.display = 'none';
      undoStack = []; redoStack = [];
      refreshUndoButtons();
      $('project-name').textContent = file.name;
      $('project-state').textContent = '已打开';
      const cp = currentPage();
      if (cp) { cp.name = file.name.replace(/\.html?$/i, ''); cp.html = r.result; }
      renderTabs();
      saveProject(true);
      setStatus('已加载：' + file.name);
    };
    r.readAsText(file);
  }
  const openFile = () => fileInput.click();
  // 「打开」入口在文件菜单里（见文件菜单逻辑）
  fileInput.onchange = () => loadFile(fileInput.files[0]);
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); }
  });

  // ================= 缩放 =================
  function applyZoom() {
    stage.style.zoom = zoom;
    const w = Math.round((stage.clientWidth || stageWrap.clientWidth - 40) / zoom);
    const h = Math.round((stage.clientHeight || stageWrap.clientHeight - 40) / zoom);
    $('viewport-label').textContent = '画板  /  ' + w + ' × ' + h;
    if (typeof buildRulers === 'function') buildRulers();
  }
  $('t-zoom').onchange = () => { zoom = parseFloat($('t-zoom').value); applyZoom(); };
  $('btn-fit').onclick = () => {
    const d = doc();
    let target = 1;
    if (d && d.documentElement) {
      const cw = d.documentElement.scrollWidth || 0;
      const avail = stageWrap.clientWidth - 40;
      if (cw > avail) target = Math.max(0.25, avail / cw);
    }
    zoom = Math.round(target * 100) / 100;
    $('t-zoom').value = ['0.6','0.75','1','1.25','1.5','2'].includes(String(zoom)) ? String(zoom) : '';
    applyZoom();
    setStatus('缩放：' + Math.round(zoom * 100) + '%');
  };
  window.addEventListener('resize', applyZoom);

  // ================= 工具轨 =================
  // ================= 左侧快捷功能栏（用户自选图标） =================
  const LS_RAIL = 'htmlCanvas.rail';
  const RAIL_COMMANDS = [
    { id: 'tool:select', icon: '↖', label: '选择工具', hint: 'V', tool: 'select' },
    { id: 'tool:text', icon: 'T', label: '文本工具', hint: 'T', tool: 'text' },
    { id: 'tool:shape', icon: '▦', label: '形状工具', hint: 'R', tool: 'shape' },
    { id: 'tool:img', icon: '▧', label: '图片工具', hint: 'I', tool: 'img' },
    { id: 'tool:hand', icon: '✥', label: '移动画布', hint: '空格', tool: 'hand' },
    { id: 'act:undo', icon: '↩', label: '撤销', hint: 'Ctrl+Z', run: () => undo() },
    { id: 'act:redo', icon: '↪', label: '重做', hint: 'Ctrl+Y', run: () => redo() },
    { id: 'act:duplicate', icon: '⧉', label: '再制元素', run: () => $('btn-dup').click() },
    { id: 'act:delete', icon: '🗑', label: '删除选中', hint: 'Delete', run: () => deleteSelected() },
    { id: 'act:group', icon: '▣', label: '组合', hint: 'Ctrl+G', run: () => $('grp').click() },
    { id: 'act:ungroup', icon: '▢', label: '取消组合', hint: 'Ctrl+Shift+G', run: () => $('ungrp').click() },
    { id: 'act:front', icon: '⤊', label: '置于顶层', run: () => $('z-front').click() },
    { id: 'act:back', icon: '⤋', label: '置于底层', run: () => $('z-back').click() },
    { id: 'act:alignleft', icon: '⇤', label: '左对齐', run: () => alignSelection('left') },
    { id: 'act:aligncx', icon: '⇹', label: '水平居中', run: () => alignSelection('cx') },
    { id: 'act:aligncy', icon: '⇳', label: '垂直居中', run: () => alignSelection('cy') },
    { id: 'act:disth', icon: '≡', label: '水平等距分布', run: () => distribute('h') },
    { id: 'act:distv', icon: '⋮', label: '垂直等距分布', run: () => distribute('v') },
    { id: 'act:scalemode', icon: '⇱', label: '视觉缩放开关', run: () => $('scale-mode').click() },
    { id: 'act:reset', icon: '↺', label: '恢复原始状态', run: () => $('reset-el').click() },
    { id: 'act:painter', icon: '🖌', label: '格式刷', run: () => $('fmt-painter').click() },
    { id: 'act:find', icon: '🔍', label: '查找替换', hint: 'Ctrl+F', run: () => $('btn-find').click() },
    { id: 'act:theme', icon: '🎨', label: '统一主题配色', run: () => $('btn-theme').click() },
    { id: 'act:block', icon: '🧩', label: '存为区块', run: () => $('btn-save-block').click() },
    { id: 'act:rulers', icon: '📐', label: '标尺与辅助线', run: () => $('btn-rulers').click() },
    { id: 'act:fit', icon: '⤢', label: '适合窗口', run: () => $('btn-fit').click() },
    { id: 'act:phone', icon: '▯', label: '手机预览', run: () => $('dev-phone').click() },
    { id: 'act:pc', icon: '🖥', label: '电脑预览', run: () => $('dev-pc').click() },
    { id: 'act:save', icon: '💾', label: '保存到本地项目', hint: 'Ctrl+S', run: () => saveLocal() },
    { id: 'act:export', icon: '⤓', label: '导出 HTML（下载）', run: () => { if (runExportCheck()) downloadHTML(); } },
    { id: 'act:preview', icon: '👁', label: '预览', run: () => $('btn-preview').click() },
    { id: 'act:open', icon: '📂', label: '打开文件', hint: 'Ctrl+O', run: () => openFile() },
    { id: 'act:pages', icon: '🗂', label: '页面管理', run: () => showPages() },
    { id: 'act:newpage', icon: '＋', label: '新建页面', run: () => addPage() },
    { id: 'act:history', icon: '🕘', label: '历史版本', hint: 'Ctrl+H', run: () => showHistory() },
    { id: 'act:templates', icon: '📑', label: '从模板新建', run: () => showTemplates() },
    { id: 'act:assets', icon: '📦', label: '资源检查', run: () => showAssets() },
    { id: 'act:check', icon: '✅', label: '导出检查', run: () => runExportCheck(true) },
    { id: 'act:selectall', icon: '▤', label: '全选', hint: 'Ctrl+A', run: () => { const ev = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }); window.dispatchEvent(ev); } },
    { id: 'act:layerpanel', icon: '☰', label: '图层面板', run: () => { showRibbonTab('home'); const t = document.querySelector('.ptab[data-page="page-layers"]'); panel.style.display = 'flex'; if (t) t.click(); } },
    { id: 'act:propspanel', icon: '⚙', label: '属性面板', run: () => { const t = document.querySelector('.ptab[data-page="page-props"]'); panel.style.display = 'flex'; if (t) t.click(); } },
    { id: 'act:codepanel', icon: '⟨⟩', label: '代码面板', run: () => { const t = document.querySelector('.ptab[data-page="page-code"]'); panel.style.display = 'flex'; if (t) t.click(); } }
  ];
  const RAIL_DEFAULT = ['tool:select', 'tool:text', 'tool:shape', 'tool:img', 'tool:hand', 'act:undo', 'act:delete'];
  let railItems = RAIL_DEFAULT.slice();
  function railCmd(id) { return RAIL_COMMANDS.find(c => c.id === id); }
  function saveRail() { try { localStorage.setItem(LS_RAIL, JSON.stringify(railItems)); } catch (e) {} }
  function loadRail() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_RAIL));
      if (Array.isArray(s) && s.length) railItems = s.filter(id => railCmd(id));
    } catch (e) {}
  }
  function renderRail() {
    const box = $('rail-btns');
    if (!box) return;
    box.innerHTML = '';
    railItems.forEach(id => {
      const c = railCmd(id);
      if (!c) return;
      const b = document.createElement('button');
      b.textContent = c.icon;
      b.title = c.label + (c.hint ? '（' + c.hint + '）' : '') + '\n右键可调整位置或移除';
      if (c.tool) b.dataset.tool = c.tool;
      b.className = (c.tool && c.tool === tool) ? 'checked' : '';
      b.onclick = () => { if (c.tool) setTool(c.tool); else if (c.run) c.run(); };
      b.oncontextmenu = e => { e.preventDefault(); openRailMenu(e.clientX, e.clientY, id); };
      box.appendChild(b);
    });
  }
  function syncRailChecked() {
    document.querySelectorAll('#rail-btns button[data-tool]').forEach(b => {
      b.classList.toggle('checked', b.dataset.tool === tool);
    });
  }
  let railMenu = null;
  function closeRailMenu() { if (railMenu) { railMenu.remove(); railMenu = null; } }
  function openRailMenu(cx, cy, id) {
    closeRailMenu();
    const idx = railItems.indexOf(id);
    const c = railCmd(id);
    railMenu = document.createElement('div');
    railMenu.className = 'dropdown open';
    const mk = (text, fn, danger) => {
      const row = document.createElement('div');
      row.className = 'dd-item' + (danger ? ' danger' : '');
      row.textContent = text;
      row.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); fn(); closeRailMenu(); };
      railMenu.appendChild(row);
    };
    const title = document.createElement('div');
    title.className = 'dd-title';
    title.textContent = c ? c.label : '快捷功能';
    railMenu.appendChild(title);
    if (idx > 0) mk('↑ 上移', () => { railItems.splice(idx, 1); railItems.splice(idx - 1, 0, id); saveRail(); renderRail(); });
    if (idx >= 0 && idx < railItems.length - 1) mk('↓ 下移', () => { railItems.splice(idx, 1); railItems.splice(idx + 1, 0, id); saveRail(); renderRail(); });
    mk('✕ 从左侧移除', () => { railItems = railItems.filter(x => x !== id); saveRail(); renderRail(); }, true);
    mk('＋ 添加其他功能…', () => showRailPicker());
    document.body.appendChild(railMenu);
    const r = railMenu.getBoundingClientRect();
    railMenu.style.left = Math.max(8, Math.min(cx, window.innerWidth - r.width - 12)) + 'px';
    railMenu.style.top = Math.max(8, Math.min(cy, window.innerHeight - r.height - 12)) + 'px';
    setTimeout(() => {
      const off = () => { closeRailMenu(); document.removeEventListener('mousedown', off, true); };
      document.addEventListener('mousedown', off, true);
    }, 0);
  }
  function showRailPicker() {
    closeRailMenu();
    const groups = [
      { title: '工具', items: RAIL_COMMANDS.filter(c => c.tool) },
      { title: '编辑与排列', items: RAIL_COMMANDS.filter(c => c.id.startsWith('act:') && ['act:undo', 'act:redo', 'act:duplicate', 'act:delete', 'act:group', 'act:ungroup', 'act:front', 'act:back', 'act:alignleft', 'act:aligncx', 'act:aligncy', 'act:disth', 'act:distv', 'act:scalemode', 'act:reset', 'act:selectall'].includes(c.id)) },
      { title: '效率与面板', items: RAIL_COMMANDS.filter(c => ['act:painter', 'act:find', 'act:theme', 'act:block', 'act:rulers', 'act:fit', 'act:phone', 'act:pc', 'act:layerpanel', 'act:propspanel', 'act:codepanel'].includes(c.id)) },
      { title: '文件', items: RAIL_COMMANDS.filter(c => ['act:open', 'act:save', 'act:export', 'act:preview', 'act:pages', 'act:newpage', 'act:history', 'act:templates', 'act:assets', 'act:check'].includes(c.id)) }
    ];
    const rows = groups.map(g =>
      '<div class="dd-title">' + g.title + '</div>'
      + g.items.map(c =>
        '<label class="rail-pick"><input type="checkbox" data-rail="' + c.id + '"' + (railItems.includes(c.id) ? ' checked' : '') + '>'
        + '<span class="rp-icon">' + c.icon + '</span><span>' + c.label + '</span>'
        + (c.hint ? '<span class="hint">' + c.hint + '</span>' : '') + '</label>'
      ).join('')
    ).join('');
    showModal(
      '<h3>自定义左侧快捷功能</h3>'
      + '<div class="mnote">勾选后立即出现在左侧竖栏；顺序可用右键菜单调整。当前共 ' + railItems.length + ' 个。</div>'
      + '<div class="rail-picker">' + rows + '</div>'
      + '<div class="actions"><button data-modal="cancel">取消</button>'
      + '<button id="m-rail-reset">恢复默认</button>'
      + '<button class="primary" data-modal="ok">应用</button></div>',
      () => {
        const picked = [];
        document.querySelectorAll('[data-rail]').forEach(inp => { if (inp.checked) picked.push(inp.dataset.rail); });
        railItems = picked.length ? picked : RAIL_DEFAULT.slice();
        saveRail(); renderRail();
        closeModal();
        setStatus('左侧快捷功能已更新（' + railItems.length + ' 个）');
      }
    );
    $('m-rail-reset').onclick = () => {
      document.querySelectorAll('[data-rail]').forEach(inp => { inp.checked = RAIL_DEFAULT.includes(inp.dataset.rail); });
    };
  }
  $('rail-add').onclick = () => showRailPicker();
  loadRail();
  renderRail();

  // 快捷键切换工具后同步左侧高亮
  const toolBtns = { select: 1, text: 1, shape: 1, img: 1, hand: 1 };
  let pendingShape = 'rect';
  function setTool(t, shape) {
    tool = t;
    if (shape) pendingShape = shape;
    syncRailChecked();
    $('btn-shape-menu').classList.toggle('active', t === 'shape');
    const hints = {
      select: '选择工具：单击选中，Shift 点选/框选多选，拖动移动（带吸附参考线，Alt 临时关闭）',
      text: '文本工具：在画布上按住拖出文本框大小（直接单击用默认大小）',
      shape: '形状工具：在画布上按住拖出形状大小（直接单击用默认大小）',
      img: '图片工具：在画布上点击，插入一张本地图片',
      hand: '移动画布：按住拖动来滚动画布'
    };
    setStatus(hints[t]);
  }
  window.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 方向键微调选中元素（WPS 手感）
    if (selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const t = getTransform(selected);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (!selected.__edNudge) { snapshot(); selected.__edNudge = true; }
      setTransform(selected, t.x + dx, t.y + dy, t.r, t.s);
      updateOverlay();
      fillPanel();
      setDirty();
      setStatus('位置：X ' + Math.round(t.x + dx) + '  Y ' + Math.round(t.y + dy));
      clearTimeout(window.__edNudgeTimer);
      window.__edNudgeTimer = setTimeout(() => { if (selected) selected.__edNudge = false; }, 600);
      return;
    }
    const map = { v: 'select', t: 'text', r: 'shape', i: 'img', ' ': 'hand' };
    const k = e.key.toLowerCase();
    if (map[k]) { e.preventDefault(); setTool(map[k]); }
  });

  // ================= 撤销 / 重做（记录步骤名与当时选中项，符合 Office 习惯） =================
  function pathOf(el) {
    const d = doc();
    if (!d || !el) return null;
    const path = [];
    let n = el;
    while (n && n !== d.body) {
      const p = n.parentElement;
      if (!p) return null;
      path.unshift(Array.prototype.indexOf.call(p.children, n));
      n = p;
    }
    return n === d.body ? path : null;
  }
  function elAtPath(path) {
    const d = doc();
    if (!d || !path) return null;
    let n = d.body;
    for (let i = 0; i < path.length; i++) {
      if (!n) return null;
      n = n.children[path[i]];
    }
    return n && n !== d.body ? n : null;
  }
  function snapshot(label) {
    if (restoring) return;
    const d = doc();
    if (!d || !d.body) return;
    const sel = selection.filter(el => el && el.isConnected).map(pathOf).filter(Boolean);
    undoStack.push({ html: d.body.innerHTML, label: label || '编辑', sel });
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    refreshUndoButtons();
    refreshHistoryMenu();
  }
  function currentState(label) {
    const d = doc();
    return { html: d.body.innerHTML, label, sel: selection.filter(el => el && el.isConnected).map(pathOf).filter(Boolean) };
  }
  function applyState(item) {
    const d = doc();
    restoring = true;
    deselect();
    d.body.innerHTML = item.html;
    restoring = false;
    reattachOverlay();
    // 恢复当时的选中项
    if (item.sel && item.sel.length) {
      const els = item.sel.map(elAtPath).filter(Boolean);
      if (els.length) {
        selection = els;
        selected = els[els.length - 1];
        panel.style.display = 'flex';
        updateOverlay(); fillPanel(); updateSelCount(); refreshLayers();
      }
    }
  }
  function undo() {
    const d = doc();
    if (!undoStack.length || !d) { setStatus('没有可撤销的操作了'); return; }
    redoStack.push(currentState('重做前的状态'));
    const item = undoStack.pop();
    applyState(item);
    refreshUndoButtons(); refreshHistoryMenu();
    setStatus('已撤销：' + item.label + (undoStack.length ? '（还可撤销 ' + undoStack.length + ' 步）' : ''));
  }
  function redo() {
    const d = doc();
    if (!redoStack.length || !d) { setStatus('没有可重做的操作了'); return; }
    undoStack.push(currentState('撤销前的状态'));
    const item = redoStack.pop();
    applyState(item);
    refreshUndoButtons(); refreshHistoryMenu();
    setStatus('已重做：' + item.label);
  }
  function refreshUndoButtons() {
    const u = $('btn-undo'), r = $('btn-redo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }
  // 撤销步骤下拉（像 Office 的下拉历史，可一次退回多步）
  function refreshHistoryMenu() {
    const menu = $('history-menu');
    if (!menu) return;
    menu.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'dd-title';
    title.textContent = '撤销历史（点击可退回该步之前）';
    menu.appendChild(title);
    if (!undoStack.length) {
      const empty = document.createElement('div');
      empty.className = 'dd-item';
      empty.style.color = 'var(--text-3)';
      empty.textContent = '暂无可撤销的操作';
      menu.appendChild(empty);
      return;
    }
    const list = undoStack.slice(-14).reverse();
    list.forEach((item, idx) => {
      const steps = idx + 1;
      const row = document.createElement('div');
      row.className = 'dd-item';
      row.innerHTML = '<span>' + item.label + '</span><span class="hint">退回 ' + steps + ' 步</span>';
      row.onclick = () => {
        menu.classList.remove('open');
        for (let i = 0; i < steps; i++) undo();
        setStatus('已回退 ' + steps + ' 步');
      };
      menu.appendChild(row);
    });
  }
  $('btn-undo').onclick = undo;
  $('btn-redo').onclick = redo;
  $('btn-history-list').onclick = e => {
    e.stopPropagation();
    refreshHistoryMenu();
    const menu = $('history-menu');
    if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
    openDropdown($('btn-history-list'), menu);
  };
  window.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    if (e.key === 'Escape' && fmtStyle) { e.preventDefault(); cancelFormat(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length && !typing && !editing()) { e.preventDefault(); deleteSelected(); }
  });
  refreshUndoButtons();

  function reattachOverlay() {
    const d = doc();
    if (!d || !d.body) return;
    buildOverlay(d);
  }

  function buildOverlay(d) {
    const old = d.getElementById('__ed_overlay');
    if (old) old.remove();
    overlay = d.createElement('div');
    overlay.id = '__ed_overlay';
    handles = [];
    ['nw','n','ne','e','se','s','sw','w','rot'].forEach(dir => {
      const h = d.createElement('div');
      h.className = '__ed_handle' + (dir === 'rot' ? ' __ed_rot' : '');
      h.dataset.dir = dir;
      h.style.cursor = dir === 'rot' ? 'grab' : dir + '-resize';
      overlay.appendChild(h);
      handles.push(h);
    });
    d.body.appendChild(overlay);
  }

  // ================= iframe 初始化 =================
  stage.addEventListener('load', () => {
    const d = doc();
    if (!d || !d.body) return;

    d.addEventListener('click', e => {
      const t = e.target;
      if (t && t.closest && t.closest('video,audio,iframe')) return;   // 让媒体控件可用
      e.preventDefault();
    }, true);
    d.addEventListener('submit', e => e.preventDefault(), true);

    const st = d.createElement('style');
    st.id = '__ed_style';
    st.textContent = `
      .__ed_hover { outline:2px dashed #9B8CFF !important; outline-offset:1px; cursor:move; }
      .__ed_editing { outline:2px solid #34D399 !important; cursor:text !important; }
      #__ed_overlay { position:fixed; pointer-events:none; border:2px solid #5B7CFA; z-index:2147483646; display:none; }
      .__ed_handle { position:absolute; width:9px; height:9px; background:#FFFFFF; border:1px solid #5B7CFA; border-radius:1px; pointer-events:auto; z-index:2147483647; }
      .__ed_rot { width:12px; height:12px; border-radius:50%; background:#5B7CFA; border:2px solid #FFFFFF; box-shadow:0 0 0 1px #5B7CFA; }
      .__ed_drawing { outline:2px dashed #9B8CFF !important; }
      .__ed_overflow { outline:2px solid #EF5A6F !important; outline-offset:0; }
      .__ed_flash { outline:3px solid #F5A623 !important; outline-offset:2px; }
      .__ed_hidden { display:none !important; }
      .__ed_ctx {
        position:fixed; z-index:2147483647; min-width:158px; padding:5px;
        background:rgba(255,255,255,.96); border:1px solid rgba(160,170,200,.35);
        border-radius:12px; box-shadow:0 14px 34px rgba(70,66,120,.28);
        font-family:"Microsoft YaHei",sans-serif; font-size:13px; color:#2A3142;
      }
      .__ed_ctx .ci { padding:7px 12px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; gap:16px; }
      .__ed_ctx .ci:hover { background:#EEF1FF; color:#4B5BD6; }
      .__ed_ctx .ci.danger:hover { background:#FFF1F3; color:#D9536A; }
      .__ed_ctx .csep { height:1px; background:rgba(160,170,200,.28); margin:4px 6px; }
      .__ed_ctx .ck { color:#98A2B3; font-size:11px; }
    `;
    (d.head || d.documentElement).appendChild(st);
    buildOverlay(d);

    d.addEventListener('mouseover', e => {
      if (editing() || tool !== 'select') return;
      d.querySelectorAll('.__ed_hover').forEach(el => el.classList.remove('__ed_hover'));
      const t = e.target;
      if (t && t !== d.body && t !== d.documentElement && !overlay.contains(t))
        t.classList.add('__ed_hover');
    });
    d.addEventListener('mouseout', e => {
      if (e.target.classList) e.target.classList.remove('__ed_hover');
    });

    d.addEventListener('mousedown', onMouseDown, true);

    // 右键菜单：删除 / 复制 / 层级 / 组合（解决"插进去的元素删不掉"的发现性问题）
    d.addEventListener('contextmenu', e => {
      e.preventDefault();
      const t = e.target;
      if (!t || t === d.body || t === d.documentElement || isEditorNode(t)) return;
      const locked = lockedAncestor(t);
      if (locked) { setStatus('该元素已锁定或隐藏（可在「图层」页签解锁）'); return; }
      if (!selection.includes(t)) selectElement(t);
      openCtxMenu(e.clientX, e.clientY);
    });

    function closeCtxMenu() {
      d.querySelectorAll('.__ed_ctx').forEach(m => m.remove());
    }
    function openCtxMenu(cx, cy) {
      closeCtxMenu();
      const m = d.createElement('div');
      m.className = '__ed_ctx';
      const items = [
        ['复制', 'Ctrl+C', () => copySelection(false)],
        ['再制', 'Ctrl+D', () => $('btn-dup').click()],
        ['sep'],
        ['置于顶层', '', () => $('z-front').click()],
        ['上移一层', '', () => $('z-up').click()],
        ['下移一层', '', () => $('z-down').click()],
        ['置于底层', '', () => $('z-back').click()],
        ['sep'],
        ['组合', 'Ctrl+G', () => $('grp').click()],
        ['取消组合', 'Ctrl+Shift+G', () => $('ungrp').click()],
        ['sep'],
        ['删除', 'Delete', () => deleteSelected(), true]
      ];
      items.forEach(it => {
        if (it[0] === 'sep') { const s = d.createElement('div'); s.className = 'csep'; m.appendChild(s); return; }
        const row = d.createElement('div');
        row.className = 'ci' + (it[3] ? ' danger' : '');
        row.innerHTML = '<span>' + it[0] + '</span>' + (it[1] ? '<span class="ck">' + it[1] + '</span>' : '');
        row.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); it[2](); closeCtxMenu(); };
        m.appendChild(row);
      });
      d.body.appendChild(m);
      const r = m.getBoundingClientRect();
      m.style.left = Math.max(4, Math.min(cx, d.documentElement.clientWidth - r.width - 6)) + 'px';
      m.style.top = Math.max(4, Math.min(cy, d.documentElement.clientHeight - r.height - 6)) + 'px';
      setTimeout(() => {
        const off = ev => { closeCtxMenu(); d.removeEventListener('mousedown', off, true); d.removeEventListener('scroll', off, true); };
        d.addEventListener('mousedown', off, true);
        d.addEventListener('scroll', off, true);
      }, 0);
    }

    d.addEventListener('dblclick', e => {
      if (tool !== 'select') return;
      const t = e.target;
      if (!t || t === d.body || t === d.documentElement || overlay.contains(t) || isEditorNode(t)) return;
      e.preventDefault();
      e.stopPropagation();
      // 组合内的元素：双击先「进入组合」，再双击才改文字（与 Office 一致）
      const gid = groupIdOf(t);
      if (gid && enteredGroup !== gid) {
        enteredGroup = gid;
        selectElement(t);
        setStatus('已进入组合：可单独选中组内元素；按 Esc 或点击空白处退出');
        return;
      }
      snapshot('编辑文字');
      selectElement(t);
      t.contentEditable = 'true';
      t.classList.add('__ed_editing');
      t.focus();
      t.addEventListener('blur', () => {
        t.contentEditable = 'false';
        t.classList.remove('__ed_editing');
        setDirty();
        setStatus('文字已更新');
      }, { once: true });
    }, true);

    d.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (!cancelFormat()) { stopEditing(); deselect(); setTool('select'); } }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !editing()) { e.preventDefault(); e.stopPropagation(); undo(); }
      // 删除：Delete 或 Backspace（正在改文字时不拦截）
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length && !editing()) {
        e.preventDefault(); e.stopPropagation(); deleteSelected();
      }
    });

    d.addEventListener('scroll', updateOverlay, true);
    d.addEventListener('scroll', buildRulers, true);
    deselect();
    applyZoom();
    rebuildResponsiveCss();
    rebuildHoverCss();
    setTimeout(() => { setDevice(device); buildRulers(); }, 0);
    setStatus('就绪：单击选中，拖动移动，拉角缩放，双击改字');
  });

  function editing() {
    const d = doc();
    return d && d.querySelector('[contenteditable="true"]');
  }
  function stopEditing() {
    const d = doc();
    if (!d) return;
    d.querySelectorAll('[contenteditable="true"]').forEach(el => {
      el.contentEditable = 'false';
      el.classList.remove('__ed_editing');
    });
  }

  // ================= 鼠标交互 =================
  function onMouseDown(e) {
    const d = doc();
    if (editing()) return;
    const t = e.target;

    // 抓手工具：拖动画布滚动
    if (tool === 'hand') {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      const sl = stageWrap.scrollLeft, stp = stageWrap.scrollTop;
      function mv(ev) { stageWrap.scrollLeft = sl - (ev.clientX - sx); stageWrap.scrollTop = stp - (ev.clientY - sy); }
      function up() {
        d.removeEventListener('mousemove', mv, true);
        d.removeEventListener('mouseup', up, true);
      }
      d.addEventListener('mousemove', mv, true);
      d.addEventListener('mouseup', up, true);
      return;
    }

    // 形状 / 文本工具：按住拖出大小（WPS 手感），直接单击用默认大小
    if (tool === 'text' || tool === 'shape') {
      e.preventDefault(); e.stopPropagation();
      startDraw(e, tool);
      return;
    }

    // 图片工具：点击后选本地图片
    if (tool === 'img') {
      e.preventDefault(); e.stopPropagation();
      pickImageAt(e);
      setTool('select');
      return;
    }

    if (t.classList && t.classList.contains('__ed_handle') && selected) {
      e.preventDefault(); e.stopPropagation();
      if (t.dataset.dir === 'rot') startRotate(e);
      else if (selection.length > 1) startGroupResize(e, t.dataset.dir);   // 多选/组合：整组缩放
      else startResize(e, t.dataset.dir);
      return;
    }
    // Alt + 单击：把元素设为「对齐基准」，之后用对齐按钮时其他元素都对齐到它
    if (e.altKey && t.tagName !== 'IMG') {
      e.preventDefault(); e.stopPropagation();
      if (alignAnchor === t) { alignAnchor = null; clearAnchorMark(); setStatus('已取消对齐基准'); }
      else { alignAnchor = t; markAnchor(t); setStatus('已设为对齐基准：多选后用「对齐与分布」按钮，其他元素会对齐到它'); }
      return;
    }
    if (t === overlay) return;
    if (!t || t === d.body || t === d.documentElement) { startMarquee(e); return; }
    // 锁定 / 隐藏的元素不参与画布操作
    const locked = lockedAncestor(t);
    if (locked) {
      e.preventDefault(); e.stopPropagation();
      const row = doc().body.contains(locked);
      setStatus('该元素已锁定或隐藏' + (row ? '（可在「图层」页签解锁）' : ''));
      return;
    }

    // 媒体元素：选中但不拦截事件，播放控件照常可用
    if (t.tagName === 'VIDEO' || t.tagName === 'AUDIO') {
      selectElement(t);
      return;
    }
    e.preventDefault(); e.stopPropagation();
    // 格式刷：点击其他元素直接套用样式
    if (fmtStyle && t && t !== d.body && t !== d.documentElement) {
      applyFormat(t);
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      selectElement(t, true);
      if (selected) startDrag(e);
      return;
    }
    if (!selection.includes(t)) selectElement(t);
    else { updateOverlay(); updateSelCount(); }
    startDrag(e);
  }

  // ---------- 框选（WPS 的橡皮筋选择） ----------
  function startMarquee(e) {
    const d = doc(), w = win();
    if (!d || !d.body) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX / zoom + w.scrollX;
    const sy = e.clientY / zoom + w.scrollY;
    const box = d.createElement('div');
    box.className = '__ed_marquee';
    box.style.cssText = 'position:absolute;z-index:2147483644;pointer-events:none;'
      + 'border:1px dashed #5B7CFA;background:rgba(156,73,57,.12);display:none;';
    d.body.appendChild(box);
    let dragging = false;

    function bounds(ev) {
      const cx = ev.clientX / zoom + w.scrollX;
      const cy = ev.clientY / zoom + w.scrollY;
      return { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
    }
    function onMove(ev) {
      const b = bounds(ev);
      if (!dragging && b.w + b.h < 6) return;
      dragging = true;
      box.style.display = 'block';
      box.style.left = b.x + 'px'; box.style.top = b.y + 'px';
      box.style.width = b.w + 'px'; box.style.height = b.h + 'px';
    }
    function onUp(ev) {
      d.removeEventListener('mousemove', onMove, true);
      d.removeEventListener('mouseup', onUp, true);
      box.remove();
      if (!dragging) { deselect(); return; }
      const b = bounds(ev);
      const hits = Array.from(d.body.children).filter(el => {
        if (isEditorNode(el) || isLocked(el)) return false;
        const vb = visualBox(el);
        return vb.x < b.x + b.w && vb.x + vb.w > b.x && vb.y < b.y + b.h && vb.y + vb.h > b.y;
      });
      if (!hits.length) { deselect(); setStatus('框选未命中元素'); return; }
      selection = [];
      hits.forEach(el => { groupMembers(el).forEach(g => { if (!selection.includes(g)) selection.push(g); }); });
      selected = selection[selection.length - 1];
      panel.style.display = 'flex';
      updateOverlay(); fillPanel(); updateSelCount(); refreshLayers();
      setTool('select');
      setStatus('框选：已选中 ' + selection.length + ' 个元素');
    }
    d.addEventListener('mousemove', onMove, true);
    d.addEventListener('mouseup', onUp, true);
  }

  // ---------- 形状定义（与 WPS 形状面板对应） ----------
  const SHAPES = {
    rect:     { w: 180, h: 120, css: 'background:#5B7CFA;' },
    round:    { w: 180, h: 120, css: 'background:#9B8CFF;border-radius:10px;' },
    ellipse:  { w: 140, h: 140, css: 'background:#9B8CFF;border-radius:50%;' },
    triangle: { w: 150, h: 130, css: 'background:#9B8CFF;clip-path:polygon(50% 0,100% 100%,0 100%);' },
    diamond:  { w: 150, h: 150, css: 'background:#9B8CFF;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);' },
    arrow:    { w: 190, h: 110, css: 'background:#5B7CFA;clip-path:polygon(0 30%,60% 30%,60% 0,100% 50%,60% 100%,60% 70%,0 70%);' },
    star:     { w: 150, h: 145, css: 'background:#FFB65C;clip-path:polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);' },
    line:     { w: 240, h: 3,   css: 'background:#8E97AC;' }
  };

  function newShapeEl(d, shape) {
    const def = SHAPES[shape] || SHAPES.rect;
    const el = d.createElement('div');
    el.dataset.edShape = shape;
    el.style.cssText = 'position:absolute;z-index:' + (maxZ() + 1) + ';' + def.css;
    return el;
  }

  // 按住拖拽绘制；单击则用默认尺寸
  function startDraw(e, kind) {
    const d = doc(), w = win();
    if (!d || !d.body) { setStatus('请先打开一个 HTML 文件'); return; }
    const startX = (e.clientX / zoom) + w.scrollX;
    const startY = (e.clientY / zoom) + w.scrollY;
    const def = kind === 'text' ? { w: 180, h: 60 } : (SHAPES[pendingShape] || SHAPES.rect);

    let el = null;
    let moved = false;
    snapshot();

    function onMove(ev) {
      const cx = (ev.clientX / zoom) + w.scrollX;
      const cy = (ev.clientY / zoom) + w.scrollY;
      if (!moved && Math.abs(cx - startX) + Math.abs(cy - startY) < 6) return;
      if (!moved) {
        moved = true;
        el = kind === 'text' ? makeTextBox(d) : newShapeEl(d, pendingShape);
        el.style.left = Math.round(startX) + 'px';
        el.style.top = Math.round(startY) + 'px';
        el.classList.add('__ed_drawing');
        d.body.appendChild(el);
      }
      let nw = Math.abs(cx - startX), nh = Math.abs(cy - startY);
      if (ev.shiftKey) { const m = Math.max(nw, nh); nw = m; nh = m; }   // Shift 画正方形/正圆
      el.style.width = Math.max(4, Math.round(nw)) + 'px';
      el.style.height = Math.max(kind === 'text' ? 24 : 3, Math.round(nh)) + 'px';
      el.style.left = Math.round(Math.min(startX, cx)) + 'px';
      el.style.top = Math.round(Math.min(startY, cy)) + 'px';
    }
    function onUp() {
      d.removeEventListener('mousemove', onMove, true);
      d.removeEventListener('mouseup', onUp, true);
      if (!el) {                                    // 单击 → 默认大小
        el = kind === 'text' ? makeTextBox(d) : newShapeEl(d, pendingShape);
        el.style.left = Math.round(startX) + 'px';
        el.style.top = Math.round(startY) + 'px';
        el.style.width = def.w + 'px';
        el.style.height = def.h + 'px';
        d.body.appendChild(el);
      }
      el.classList.remove('__ed_drawing');
      setTool('select');
      selectElement(el);
      setDirty();
      if (kind === 'text') setStatus('文本框已创建：双击输入文字');
      else setStatus('形状已创建：可拖动、拉角缩放、顶部圆点旋转');
    }
    d.addEventListener('mousemove', onMove, true);
    d.addEventListener('mouseup', onUp, true);
  }

  function makeTextBox(d) {
    const el = d.createElement('div');
    el.textContent = '双击编辑文字';
    el.style.cssText = 'position:absolute;z-index:' + (maxZ() + 1)
      + ';padding:8px 12px;font-size:20px;color:#2A3142;background:#FFFFFF;'
      + 'border:1px solid #DCE2F0;border-radius:2px;box-sizing:border-box;';
    return el;
  }

  // 旋转手柄（WPS 顶部圆点）
  function startRotate(e) {
    const d = doc(), w = win();
    const el = selected;
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.width / 2);
    const cy = (r.top + r.height / 2);
    const base = getTransform(el);
    snapshot('旋转');

    function onMove(ev) {
      const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      let deg = ang;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;   // Shift 吸附 15°
      setTransform(el, base.x, base.y, deg, base.s);
      updateOverlay();
      setStatus('旋转：' + Math.round(deg) + '°');
    }
    function onUp() {
      d.removeEventListener('mousemove', onMove, true);
      d.removeEventListener('mouseup', onUp, true);
      fillPanel();
      setDirty();
    }
    d.addEventListener('mousemove', onMove, true);
    d.addEventListener('mouseup', onUp, true);
  }

  function pickImageAt(e) {
    const d = doc(), w = win();
    if (!d || !d.body) { setStatus('请先打开一个 HTML 文件'); return; }
    const x = Math.round(e.clientX / zoom + w.scrollX);
    const y = Math.round(e.clientY / zoom + w.scrollY);
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const img = d.createElement('img');
        img.src = r.result;
        img.onload = () => {
          const iw = Math.min(img.naturalWidth, 400);
          snapshot();
          img.style.cssText = 'position:absolute;width:' + iw + 'px;z-index:' + (maxZ() + 1)
            + ';left:' + x + 'px;top:' + y + 'px';
          d.body.appendChild(img);
          selectElement(img);
          setDirty();
          setStatus('已插入图片');
        };
      };
      r.readAsDataURL(f);
    };
    inp.click();
  }

  // ================= 变换（平移 + 旋转 + 视觉缩放，不脱离文档流） =================
  function getTransform(el) {
    const s = el.style.transform || '';
    const mt = s.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    const mr = s.match(/rotate\((-?[\d.]+)deg\)/);
    const ms = s.match(/scale\((-?[\d.]+)\)/);
    return {
      x: mt ? +mt[1] : 0,
      y: mt ? +mt[2] : 0,
      r: mr ? +mr[1] : 0,
      s: ms ? +ms[1] : 1
    };
  }
  function setTransform(el, x, y, r, sc) {
    captureOriginal(el);
    let s = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (r) s += ` rotate(${Math.round(r * 10) / 10}deg)`;
    if (sc && Math.abs(sc - 1) > 0.001) s += ` scale(${Math.round(sc * 1000) / 1000})`;
    el.style.transform = s;
  }
  // 元素在页面中的布局坐标（不受 transform 影响，旋转后选框仍能对齐）
  function layoutRect(el) {
    let x = 0, y = 0, node = el;
    while (node) { x += node.offsetLeft || 0; y += node.offsetTop || 0; node = node.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  // ================= 原始状态快照（用于「↺ 恢复」） =================
  const ED_ORIG_KEYS = ['transform', 'width', 'height', 'left', 'top', 'position', 'zIndex',
    'backgroundColor', 'color', 'fontSize', 'lineHeight', 'letterSpacing', 'borderRadius',
    'borderWidth', 'borderStyle', 'borderColor', 'boxShadow', 'opacity', 'objectFit', 'objectPosition'];
  function captureOriginal(el) {
    if (!el || !el.style || el.dataset.edOrig) return;
    const o = {};
    ED_ORIG_KEYS.forEach(k => { o[k] = el.style[k] || ''; });
    el.dataset.edOrig = JSON.stringify(o);
  }
  function resetElement(el) {
    if (!el.dataset.edOrig) return false;
    const o = JSON.parse(el.dataset.edOrig);
    ED_ORIG_KEYS.forEach(k => { el.style[k] = o[k] || ''; });
    delete el.dataset.edOrig;
    return true;
  }

  // 视觉包围盒（文档坐标）：用 getBoundingClientRect 计算，能正确反映祖先 transform / 动画带来的位移
  // 旋转时从外接矩形反解出未旋转的宽高，保证选框仍然贴合
  function unrotatedSize(el, rect, t) {
    if (!t.r) return { w: rect.width, h: rect.height };
    const rad = Math.abs(t.r) * Math.PI / 180;
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    const det = c * c - s * s;
    if (Math.abs(det) < 0.02) { const L = layoutRect(el); return { w: L.w * t.s, h: L.h * t.s }; }
    return {
      w: Math.max(1, (c * rect.width - s * rect.height) / det),
      h: Math.max(1, (c * rect.height - s * rect.width) / det)
    };
  }
  // 视口坐标（用于 position:fixed 的选框）
  function clientBox(el) {
    const t = getTransform(el);
    const r = el.getBoundingClientRect();
    const size = unrotatedSize(el, r, t);
    return { x: r.left + r.width / 2 - size.w / 2, y: r.top + r.height / 2 - size.h / 2, w: size.w, h: size.h };
  }
  // 文档坐标（用于对齐、面板 X/Y、尺寸提示等）
  function visualBox(el) {
    const cb = clientBox(el);
    return { x: cb.x + win().scrollX, y: cb.y + win().scrollY, w: cb.w, h: cb.h };
  }

  // ================= 吸附基准与参考线（拖动 / 缩放共用） =================
  // 基准 = 画板边缘中线 + 当前视口内所有可见元素的边缘与中线（含嵌套）+ 视口边界 + 手动辅助线
  function buildSnapLines(excludeEls) {
    const d = doc(), w = win();
    const v = [], h = [];
    v.push(0, d.body.scrollWidth / 2, d.body.scrollWidth);
    h.push(0, d.body.scrollHeight / 2, d.body.scrollHeight);
    const pad = 240 / zoom;
    const view = {
      l: w.scrollX - pad,
      t: w.scrollY - pad,
      r: w.scrollX + w.innerWidth / zoom + pad,
      b: w.scrollY + w.innerHeight / zoom + pad
    };
    v.push(view.l + pad, (view.l + view.r) / 2, view.r - pad);
    h.push(view.t + pad, (view.t + view.b) / 2, view.b - pad);
    const skipTags = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1, BR: 1 };
    const skip = excludeEls || [];
    d.body.querySelectorAll('*').forEach(o => {
      if (skipTags[o.tagName]) return;
      if (isEditorNode(o) || o.classList.contains('__ed_hidden')) return;
      if (skip.some(it => it === o || (it.contains && it.contains(o)))) return;
      const cs = w.getComputedStyle(o);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
      const r = o.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const x = r.left + w.scrollX, y = r.top + w.scrollY;
      if (x > view.r || x + r.width < view.l || y > view.b || y + r.height < view.t) return;
      v.push(x, x + r.width / 2, x + r.width);
      h.push(y, y + r.height / 2, y + r.height);
    });
    d.querySelectorAll('.__ed_guide').forEach(g => {
      const t = parseFloat(g.style.top), l = parseFloat(g.style.left);
      if (!isNaN(t)) h.push(t);
      if (!isNaN(l)) v.push(l);
    });
    return { v: v.slice(0, 600), h: h.slice(0, 600) };
  }
  // 参考线绘制器（紫线 + 蓝色数值标签）
  function makeGuidePainter() {
    const d = doc();
    const made = [];
    let pointer = { x: 0, y: 0 };
    return {
      setPointer(x, y) { pointer = { x, y }; },
      clear() { made.splice(0).forEach(e => e.remove()); },
      draw(vertical, pos, label) {
        const g = d.createElement('div');
        g.style.cssText = 'position:absolute;z-index:2147483643;pointer-events:none;background:#8B5CF6;'
          + (vertical ? 'width:1px;top:0;height:' + d.body.scrollHeight + 'px;left:' + pos + 'px;'
                      : 'height:1px;left:0;width:' + d.body.scrollWidth + 'px;top:' + pos + 'px;');
        d.body.appendChild(g);
        made.push(g);
        if (label) {
          const tag = d.createElement('div');
          tag.style.cssText = 'position:absolute;z-index:2147483644;pointer-events:none;'
            + 'background:#5B7CFA;color:#fff;font-size:11px;font-family:"Microsoft YaHei",sans-serif;'
            + 'padding:2px 7px;border-radius:7px;white-space:nowrap;box-shadow:0 3px 10px rgba(91,124,250,.4);'
            + 'left:' + (vertical ? (pos + 7) : Math.max(4, pointer.x + 12)) + 'px;'
            + 'top:' + (vertical ? Math.max(4, pointer.y - 32) : Math.max(4, pos - 26)) + 'px;';
          tag.textContent = label;
          d.body.appendChild(tag);
          made.push(tag);
        }
      }
    };
  }
  // 在候选线里找最近的一条（用于拖动与缩放吸附）
  function nearestLine(value, lines, th) {
    let best = null;
    lines.forEach(line => {
      const diff = line - value;
      if (Math.abs(diff) <= th && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, pos: line };
    });
    return best;
  }

  function startDrag(e) {
    const d = doc();
    const items = selection.slice();
    if (!items.length) return;
    const el = selected;
    const startX = e.clientX, startY = e.clientY;
    const bases = items.map(it => ({ el: it, t: getTransform(it) }));
    const box0 = visualBox(el);
    let moved = false;

    // 吸附基准：画板边缘/中线 + 当前视口内「所有可见元素」的边缘与中线（含嵌套元素）+ 视口边界 + 辅助线
    const targets = buildSnapLines(items);
    const guide = makeGuidePainter();
    function clearGuides() { guide.clear(); }
    function snap(dx, dy) {
      const TH = 6 / zoom;
      const ex = [box0.x + dx, box0.x + dx + box0.w / 2, box0.x + dx + box0.w];
      const ey = [box0.y + dy, box0.y + dy + box0.h / 2, box0.y + dy + box0.h];
      const nx = ['左边缘', '水平中心', '右边缘'];
      const ny = ['上边缘', '垂直中心', '下边缘'];
      let bx = null, by = null;
      ex.forEach((v, i) => targets.v.forEach(tv => {
        const diff = tv - v;
        if (Math.abs(diff) <= TH && (!bx || Math.abs(diff) < Math.abs(bx.diff))) bx = { diff, pos: tv, name: nx[i] };
      }));
      ey.forEach((v, i) => targets.h.forEach(tv => {
        const diff = tv - v;
        if (Math.abs(diff) <= TH && (!by || Math.abs(diff) < Math.abs(by.diff))) by = { diff, pos: tv, name: ny[i] };
      }));
      clearGuides();
      let ndx = dx, ndy = dy;
      if (bx) { ndx += bx.diff; guide.draw(true, bx.pos, bx.name + ' ' + Math.round(bx.pos) + 'px'); }
      if (by) { ndy += by.diff; guide.draw(false, by.pos, by.name + ' ' + Math.round(by.pos) + 'px'); }
      return { dx: ndx, dy: ndy };
    }

    function onMove(ev) {
      let dx = (ev.clientX - startX) / zoom, dy = (ev.clientY - startY) / zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) { snapshot('移动元素'); moved = true; }
      guide.setPointer(ev.clientX, ev.clientY);
      // 图片：按住 Alt 拖动 = 调整图片在框内的显示位置（不移动元素本体）
      if (ev.altKey && el.tagName === 'IMG' && items.length === 1) {
        const cur = win().getComputedStyle(el).objectPosition.split(' ');
        let ox = parseFloat(cur[0]); let oy = parseFloat(cur[1]);
        if (isNaN(ox)) ox = 50; if (isNaN(oy)) oy = 50;
        el.style.objectPosition = Math.max(0, Math.min(100, ox - dx)) + '% ' + Math.max(0, Math.min(100, oy - dy)) + '%';
        fillPanel();
        setStatus('调整图片内部位置（Alt 拖动）');
        return;
      }
      // 按住 Shift：只沿水平 / 垂直方向移动（快速对齐）
      if (ev.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      if (!ev.ctrlKey && !ev.metaKey) { const s = snap(dx, dy); dx = s.dx; dy = s.dy; }   // Ctrl 临时关闭吸附
      bases.forEach(b => setTransform(b.el, b.t.x + dx, b.t.y + dy, b.t.r, b.t.s));
      updateOverlay();
      showSizeTip(ev.clientX, ev.clientY, el);
    }
    function onUp() {
      d.removeEventListener('mousemove', onMove, true);
      d.removeEventListener('mouseup', onUp, true);
      clearGuides();
      hideSizeTip();
      if (moved) {
        fillPanel(); checkOverflow(true); setDirty();
        setStatus('已移动 ' + bases.length + ' 个元素（按住 Ctrl 可关闭吸附）');
      }
    }
    d.addEventListener('mousemove', onMove, true);
    d.addEventListener('mouseup', onUp, true);
  }

  function startResize(e, dir) {
    const d = doc();
    const el = selected;
    const L = layoutRect(el);
    const startX = e.clientX, startY = e.clientY;
    const base = getTransform(el);
    const layoutW = L.w, layoutH = L.h;                   // 布局尺寸
    const ow = layoutW * base.s, oh = layoutH * base.s;   // 视觉尺寸（含已有缩放）
    const ratio = ow / (oh || 1);
    // 关键：文档流里的元素改宽高会挤动其他元素 —— 这种情况自动改用「视觉缩放」；
    // 本来就是绝对定位的元素（插入的形状/文本块等）改真实宽高不会影响别人。
    const pos = win().getComputedStyle(el).position;
    const inFlow = pos !== 'absolute' && pos !== 'fixed';
    const scaling = scaleMode || inFlow;
    const whyScale = !scaleMode && inFlow;
    const targets = buildSnapLines(selection);
    const guide = makeGuidePainter();
    const box0 = visualBox(el);       // 起始视觉框（锚点边的位置由它决定）
    snapshot('调整大小');

    function onMove(ev) {
      const dx = (ev.clientX - startX) / zoom, dy = (ev.clientY - startY) / zoom;
      let nw = ow, nh = oh, tx = base.x, ty = base.y;
      if (dir.includes('e')) nw = ow + dx;
      if (dir.includes('s')) nh = oh + dy;
      if (dir.includes('w')) nw = ow - dx;
      if (dir.includes('n')) nh = oh - dy;
      // 按住 Shift 等比缩放；勾选「锁定宽高比」时始终等比（WPS 手感）
      const constrain = (ev.shiftKey && dir.length === 2) || lockRatio;
      if (constrain) {
        if (dir === 'e' || dir === 'w') nh = nw / ratio;
        else if (dir === 'n' || dir === 's') nw = nh * ratio;
        else if (Math.abs(dx) > Math.abs(dy)) nh = nw / ratio;
        else nw = nh * ratio;
      }
      nw = Math.max(10, nw); nh = Math.max(10, nh);

      // 缩放时同样吸附：让正在拖动的边对齐到其他元素的边/中线（Ctrl 可临时关闭）
      guide.setPointer(ev.clientX, ev.clientY);
      guide.clear();
      if (!ev.ctrlKey && !ev.metaKey) {
        const TH = 6 / zoom;
        if (dir.includes('e') || dir.includes('w')) {
          const edge = dir.includes('e') ? box0.x + nw : box0.x + box0.w - nw;
          const hit = nearestLine(edge, targets.v, TH);
          if (hit) {
            const snapped = dir.includes('e') ? hit.pos - box0.x : (box0.x + box0.w) - hit.pos;
            if (snapped > 10 && snapped < 20000) {
              nw = snapped;
              guide.draw(true, hit.pos, '吸附到 ' + Math.round(hit.pos) + 'px');
            }
          }
        }
        if (dir.includes('s') || dir.includes('n')) {
          const edge = dir.includes('s') ? box0.y + nh : box0.y + box0.h - nh;
          const hit = nearestLine(edge, targets.h, TH);
          if (hit) {
            const snapped = dir.includes('s') ? hit.pos - box0.y : (box0.y + box0.h) - hit.pos;
            if (snapped > 10 && snapped < 20000) {
              nh = snapped;
              guide.draw(false, hit.pos, '吸附到 ' + Math.round(hit.pos) + 'px');
            }
          }
        }
      }

      if (scaling) {
        // 视觉缩放：只改 transform: scale，文字与内部布局完全不重排
        // 锚点是对侧边：拖右边→左边固定（+），拖左边→右边固定（−），上下同理
        const factor = dir.length === 2
          ? Math.max(nw / ow, nh / oh)
          : (dir === 'e' || dir === 'w' ? nw / ow : nh / oh);
        const sc = Math.max(0.05, base.s * factor);
        const ds = sc - base.s;
        let nx = base.x, ny = base.y;
        if (dir.includes('e')) nx = base.x + (layoutW / 2) * ds;
        if (dir.includes('w')) nx = base.x - (layoutW / 2) * ds;
        if (dir.includes('s')) ny = base.y + (layoutH / 2) * ds;
        if (dir.includes('n')) ny = base.y - (layoutH / 2) * ds;
        setTransform(el, nx, ny, base.r, sc);
      } else {
        // 真实宽高：把「视觉目标尺寸」换算回布局尺寸
        el.style.width = Math.max(1, Math.round(nw / base.s)) + 'px';
        el.style.height = Math.max(1, Math.round(nh / base.s)) + 'px';
        // 拖左边 / 上边时，让对侧边保持不动
        if (dir.includes('w')) {
          tx = base.x + layoutW / 2 + ow / 2 - nw / 2 - (nw / base.s) / 2;
        }
        if (dir.includes('n')) {
          ty = base.y + layoutH / 2 + oh / 2 - nh / 2 - (nh / base.s) / 2;
        }
        setTransform(el, tx, ty, base.r, base.s);
      }
      updateOverlay();
      showSizeTip(ev.clientX, ev.clientY, el);
    }
    function onUp() {
      d.removeEventListener('mousemove', onMove, true);
      d.removeEventListener('mouseup', onUp, true);
      guide.clear();
      hideSizeTip();
      fillPanel();
      checkOverflow(true);
      setDirty();
      setStatus(scaling
        ? (whyScale ? '已视觉缩放（该元素在文档流中，自动避免挤动其他元素；可用「↺ 恢复」还原）'
                    : '已视觉缩放（文字不会重排，可用「↺ 恢复」还原）')
        : '尺寸已更新（绝对定位元素，不影响其他元素）');
    }
    d.addEventListener('mousemove', onMove, true);
    d.addEventListener('mouseup', onUp, true);
  }

  // ================= 选框（含旋转手柄） =================
  function updateOverlay() {
    if (!overlay) return;
    if (!selected || !selected.isConnected) { overlay.style.display = 'none'; return; }
    const gid = isGroupSelection();
    const multi = selection.length > 1;
    const t = multi ? { r: 0, s: 1 } : getTransform(selected);
    const vb = multi ? groupUnionBox(selection) : clientBox(selected);
    const rw = vb.w, rh = vb.h;
    overlay.style.display = 'block';
    overlay.style.position = 'fixed';
    overlay.style.left = (vb.x - 2) + 'px';
    overlay.style.top = (vb.y - 2) + 'px';
    overlay.style.width = (rw + 4) + 'px';
    overlay.style.height = (rh + 4) + 'px';
    // 选框跟随元素旋转（旋转围绕中心，与元素一致）
    overlay.style.transform = t.r ? `rotate(${t.r}deg)` : '';
    overlay.style.transformOrigin = '50% 50%';
    const W = rw + 4, H = rh + 4;
    const pos = {
      nw: [-5, -5], n: [W/2 - 4, -5], ne: [W - 4, -5],
      e: [W - 4, H/2 - 4], se: [W - 4, H - 4], s: [W/2 - 4, H - 4],
      sw: [-5, H - 4], w: [-5, H/2 - 4],
      rot: [W/2 - 6, -30]
    };
    handles.forEach(h => {
      const p = pos[h.dataset.dir] || [0, 0];
      h.style.left = p[0] + 'px';
      h.style.top = p[1] + 'px';
      if (h.dataset.dir === 'rot') h.style.transform = t.r ? `rotate(${-t.r}deg)` : '';
    });
    renderGhosts();
  }

  // 页面里常有 CSS 动画/过渡（AI 生成的页面尤其多），定时把选框对齐到元素真实位置
  setInterval(() => {
    if (alignAnchor && !alignAnchor.isConnected) { alignAnchor = null; clearAnchorMark(); }
    if (!selected || !selected.isConnected || editing()) { refreshAnchorMark(); return; }
    updateOverlay();
    refreshAnchorMark();
  }, 400);

  // ================= 组合（Office 习惯：整组一个选框、整组缩放、双击进组） =================
  let enteredGroup = null;      // 已进入的组合 id（此时可单独选中组内元素）
  function groupIdOf(el) { return (el && el.dataset) ? el.dataset.edGroup : null; }
  function isGroupSelection() {
    if (selection.length < 2) return null;
    const gid = groupIdOf(selection[0]);
    if (!gid) return null;
    return selection.every(el => groupIdOf(el) === gid) ? gid : null;
  }
  function groupUnionBox(els) {
    const bs = els.map(clientBox);
    const l = Math.min(...bs.map(b => b.x)), t = Math.min(...bs.map(b => b.y));
    const r = Math.max(...bs.map(b => b.x + b.w)), bo = Math.max(...bs.map(b => b.y + b.h));
    return { x: l, y: t, w: r - l, h: bo - t };
  }
  // 整组按比例缩放（围绕对侧边为锚点），使用视觉缩放，组内文字不重排
  function startGroupResize(e, dir) {
    const d = doc();
    const els = selection.slice();
    const startX = e.clientX, startY = e.clientY;
    const box = groupUnionBox(els);
    const bases = els.map(el => {
      const b = clientBox(el), t = getTransform(el);
      return { el, t, b };
    });
    const ratio = box.w / (box.h || 1);
    const targets = buildSnapLines(selection);
    const guide = makeGuidePainter();
    snapshot('缩放组合');
    const anchorX = dir.includes('w') ? box.x + box.w : box.x;
    const anchorY = dir.includes('n') ? box.y + box.h : box.y;

    function onMove(ev) {
      const dx = (ev.clientX - startX), dy = (ev.clientY - startY);
      let nw = dir.includes('e') ? box.w + dx : dir.includes('w') ? box.w - dx : box.w;
      let nh = dir.includes('s') ? box.h + dy : dir.includes('n') ? box.h - dy : box.h;
      nw = Math.max(20, nw); nh = Math.max(20, nh);
      // 整组缩放也吸附到其他元素边界（Ctrl 关闭）
      guide.setPointer(ev.clientX, ev.clientY);
      guide.clear();
      if (!ev.ctrlKey && !ev.metaKey) {
        const TH = 6 / zoom;
        if (dir.includes('e') || dir.includes('w')) {
          const edge = dir.includes('e') ? box.x + nw : box.x + box.w - nw;
          const hit = nearestLine(edge, targets.v, TH);
          if (hit) {
            const snapped = dir.includes('e') ? hit.pos - box.x : (box.x + box.w) - hit.pos;
            if (snapped > 20 && snapped < 20000) { nw = snapped; guide.draw(true, hit.pos, '吸附到 ' + Math.round(hit.pos) + 'px'); }
          }
        }
        if (dir.includes('s') || dir.includes('n')) {
          const edge = dir.includes('s') ? box.y + nh : box.y + box.h - nh;
          const hit = nearestLine(edge, targets.h, TH);
          if (hit) {
            const snapped = dir.includes('s') ? hit.pos - box.y : (box.y + box.h) - hit.pos;
            if (snapped > 20 && snapped < 20000) { nh = snapped; guide.draw(false, hit.pos, '吸附到 ' + Math.round(hit.pos) + 'px'); }
          }
        }
      }
      const uniform = ev.shiftKey || dir.length === 2;
      let f = 1;
      if (uniform) f = Math.max(nw / box.w, nh / box.h);
      else if (dir === 'e' || dir === 'w') f = nw / box.w;
      else f = nh / box.h;
      f = Math.max(0.05, f);
      bases.forEach(b => {
        const t = b.t;
        const nx = anchorX + (b.b.x - anchorX) * f;
        const ny = anchorY + (b.b.y - anchorY) * f;
        // 位置改为「目标视觉位置」，同时整体缩放
        const cur = clientBox(b.el);
        setTransform(b.el, t.x + (nx - cur.x), t.y + (ny - cur.y), t.r, t.s * f);
      });
      updateOverlay();
      setStatus('组合缩放中：' + Math.round(f * 100) + '%（按住 Shift 等比，可用「↺ 恢复」还原）');
    }
    function onUp() {
      d.removeEventListener('mousemove', onMove, true);
      d.removeEventListener('mouseup', onUp, true);
      guide.clear();
      hideSizeTip();
      fillPanel(); setDirty();
      setStatus('组合已缩放（Ctrl+Z 可撤销）');
    }
    d.addEventListener('mousemove', onMove, true);
    d.addEventListener('mouseup', onUp, true);
  }

  // ================= 选中 / 面板 =================
  function deselect() {
    selected = null;
    selection = [];
    enteredGroup = null;
    if (overlay) overlay.style.display = 'none';
    clearGhosts();
    updateSelCount();
    panel.style.display = 'none';
    refreshLayers();
  }

  // 组合成员：选中组内任意一个即整组选中
  function groupMembers(el) {
    const gid = el.dataset ? el.dataset.edGroup : null;
    if (!gid) return [el];
    const d = doc();
    return Array.from(d.body.querySelectorAll('[data-ed-group="' + gid + '"]'));
  }

  function selectElement(el, additive) {
    if (!el) return;
    // 已进入某个组合时，可以单独选中组内元素；否则点组内任意元素 = 选中整组
    const gid = groupIdOf(el);
    const group = (gid && enteredGroup === gid) ? [el] : groupMembers(el);
    if (additive) {
      const already = group.every(g => selection.includes(g));
      selection = already ? selection.filter(x => !group.includes(x)) : selection.concat(group.filter(g => !selection.includes(g)));
    } else {
      selection = group.slice();
    }
    selected = selection.length ? selection[selection.length - 1] : null;
    if (!selected) { deselect(); return; }
    panel.style.display = 'flex';
    updateOverlay();
    fillPanel();
    updateSelCount();
    refreshLayers();
    setStatus('已选中 ' + selection.length + ' 个元素');
  }

  function updateSelCount() {
    $('sel-count').textContent = selection.length === 0 ? '未选中'
      : selection.length === 1 ? '已选 1 个'
      : '已选 ' + selection.length + ' 个';
  }

  // 非主选中元素的虚线提示框
  function clearGhosts() {
    const d = doc();
    if (!d) return;
    d.querySelectorAll('.__ed_ghost').forEach(g => g.remove());
  }
  function renderGhosts() {
    const d = doc();
    if (!d || !d.body) return;
    clearGhosts();
    if (isGroupSelection()) return;   // 组合时只显示一个整体选框
    selection.filter(el => el !== selected && el.isConnected).forEach(el => {
      const vb = clientBox(el);
      const g = d.createElement('div');
      g.className = '__ed_ghost';
      g.style.cssText = 'position:fixed;pointer-events:none;border:1px dashed #9B8CFF;'
        + 'z-index:2147483645;left:' + (vb.x - 1) + 'px;top:' + (vb.y - 1) + 'px;'
        + 'width:' + (vb.w + 2) + 'px;height:' + (vb.h + 2) + 'px;';
      d.body.appendChild(g);
    });
  }

  // ================= 右侧页签：属性 / 图层 =================
  document.querySelectorAll('.ptab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('active', t === tab));
      const pages = { 'page-props': 'block', 'page-layers': 'block', 'page-code': 'flex' };
      Object.keys(pages).forEach(id => {
        $(id).style.display = (id === tab.dataset.page) ? pages[id] : 'none';
      });
      if (tab.dataset.page === 'page-code') { refreshLayers(); loadCode(); }
    };
  });

  function elementLabel(el) {
    const tag = el.tagName.toLowerCase();
    const id = (el.id && !el.id.startsWith('__ed')) ? '#' + el.id : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14);
    return tag + id + (text ? '　' + text : '');
  }

  function isEditorNode(el) {
    if (!el || !el.classList) return true;
    if ((el.id || '').startsWith('__ed')) return true;
    return el.classList.contains('__ed_ghost') || el.classList.contains('__ed_marquee')
      || el.classList.contains('__ed_guide') || el.classList.contains('__ed_ctx')
      || el.classList.contains('__ed_anchor');
  }
  function isLocked(el) {
    return !!(el.dataset && el.dataset.edLocked === '1') || el.classList.contains('__ed_hidden');
  }
  function lockedAncestor(el) {
    let n = el;
    while (n && n !== doc().body) {
      if (isLocked(n)) return n;
      n = n.parentElement;
    }
    return null;
  }

  function refreshLayers() {
    const box = $('page-layers');
    if (!box) return;
    const d = doc();
    if (!d || !d.body) return;
    box.innerHTML = '';
    const top = Array.from(d.body.children).filter(el => !isEditorNode(el));
    if (!top.length) {
      box.innerHTML = '<div class="layers-empty">画布中还没有元素</div>';
      return;
    }
    const tree = document.createElement('div');
    box.appendChild(tree);
    const walk = (parent, container, depth) => {
      if (depth > 3) return;
      Array.from(parent.children).filter(el => !isEditorNode(el)).reverse().forEach(el => {
        container.appendChild(makeLayerRow(el, depth));
        if (el.children.length) {
          const sub = document.createElement('div');
          sub.className = 'layer-kids';
          container.appendChild(sub);
          walk(el, sub, depth + 1);
        }
      });
    };
    walk(d.body, tree, 0);
  }

  function makeLayerRow(el, depth) {
    const row = document.createElement('div');
    row.className = 'layer-row';
    if (selection.includes(el)) row.classList.add('active');
    if (el.dataset.edLocked === '1') row.classList.add('locked');
    if (el.classList.contains('__ed_hidden')) row.classList.add('hidden');
    row.style.paddingLeft = (8 + depth * 10) + 'px';
    row.draggable = true;

    const tag = document.createElement('span');
    tag.className = 'ltag';
    tag.textContent = el.tagName.toLowerCase();
    const name = document.createElement('span');
    name.className = 'lname';
    name.textContent = el.dataset.edName || labelFor(el);
    const eye = document.createElement('span');
    eye.className = 'lbtn';
    eye.textContent = el.classList.contains('__ed_hidden') ? '🚫' : '👁';
    eye.title = '显示 / 隐藏（仅编辑时，不导出）';
    const lock = document.createElement('span');
    lock.className = 'lbtn';
    lock.textContent = el.dataset.edLocked === '1' ? '🔒' : '🔓';
    lock.title = '锁定 / 解锁（锁定后不可在画布上选中拖动）';
    const ren = document.createElement('span');
    ren.className = 'lbtn';
    ren.textContent = '✎';
    ren.title = '重命名图层';

    row.append(tag, name, eye, lock, ren);
    eye.onclick = e => { e.stopPropagation(); el.classList.toggle('__ed_hidden'); refreshLayers(); setStatus(el.classList.contains('__ed_hidden') ? '已隐藏（编辑时）' : '已显示'); };
    lock.onclick = e => {
      e.stopPropagation();
      el.dataset.edLocked = el.dataset.edLocked === '1' ? '0' : '1';
      if (el.dataset.edLocked === '1' && selection.includes(el)) { selection = selection.filter(x => x !== el); selected = selection[selection.length - 1] || null; if (!selected) deselect(); else { updateOverlay(); fillPanel(); } }
      refreshLayers();
      setStatus(el.dataset.edLocked === '1' ? '已锁定' : '已解锁');
    };
    ren.onclick = e => {
      e.stopPropagation();
      const v = prompt('图层名称', el.dataset.edName || labelFor(el));
      if (v !== null) { el.dataset.edName = v.trim(); refreshLayers(); }
    };
    row.onclick = () => { setTool('select'); selectElement(el); };
    row.ondragstart = e => { e.dataTransfer.setData('text/plain', 'layer'); row.dataset.dragging = '1'; window.__edDragLayer = el; };
    row.ondragover = e => { e.preventDefault(); row.classList.add('dragover'); };
    row.ondragleave = () => row.classList.remove('dragover');
    row.ondrop = e => {
      e.preventDefault();
      row.classList.remove('dragover');
      const src = window.__edDragLayer;
      if (!src || src === el || src.contains(el)) return;
      snapshot();
      // 拖到目标行上：放到目标前面（可跨层级移动）
      el.parentNode.insertBefore(src, el);
      refreshLayers();
      setDirty();
      setStatus('图层顺序已调整');
    };
    return row;
  }

  function labelFor(el) {
    const id = (el.id && !el.id.startsWith('__ed')) ? '#' + el.id : '';
    const cls = (typeof el.className === 'string' && el.className && !el.className.startsWith('__ed'))
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 12);
    return (id + cls) || text || el.tagName.toLowerCase();
  }

  function rgbToHex(rgb) {
    const m = rgb && rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#000000';
    return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
  }

  function fillPanel() {
    if (!selected) return;
    const w = win();
    const cs = w.getComputedStyle(selected);
    const tag = selected.tagName.toLowerCase();
    $('sel-tag').textContent = '<' + tag + '>';

    const isImg = tag === 'img';
    const bgImg = !isImg && cs.backgroundImage !== 'none' ? cs.backgroundImage : null;
    $('sec-img').style.display = (isImg || bgImg) ? 'block' : 'none';
    if (isImg) $('prop-img-src').value = selected.getAttribute('src') || '';
    else if (bgImg) $('prop-img-src').value = bgImg.slice(5, -2);
    $('prop-img-alt').value = selected.getAttribute('alt') || '';

    $('prop-color').value = rgbToHex(cs.color);
    $('prop-color-hex').value = rgbToHex(cs.color);
    $('prop-bg-hex').value = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : rgbToHex(cs.backgroundColor);
    $('prop-bg').value = $('prop-bg-hex').value || '#ffffff';
    $('prop-fontsize').value = parseInt(cs.fontSize) || '';

    const vb = visualBox(selected);
    $('prop-x').value = Math.round(vb.x);
    $('prop-y').value = Math.round(vb.y);
    $('prop-w').value = Math.round(vb.w);
    $('prop-h').value = Math.round(vb.h);

    // 行高 / 字间距 / 图片填充
    $('prop-lineheight').value = cs.lineHeight && cs.lineHeight !== 'normal'
      ? Math.round((parseFloat(cs.lineHeight) / (parseFloat(cs.fontSize) || 16)) * 100) / 100 : '';
    $('prop-letterspacing').value = parseFloat(cs.letterSpacing) ? Math.round(parseFloat(cs.letterSpacing) * 10) / 10 : '';
    syncFitButtons();
    if (selected.tagName === 'IMG' && cs.objectPosition) {
      const p = cs.objectPosition.split(' ');
      $('prop-objx').value = Math.round(parseFloat(p[0])) || '';
      $('prop-objy').value = Math.round(parseFloat(p[1])) || '';
    }

    $('t-size').value = parseInt(cs.fontSize) || '';
    $('t-color').value = rgbToHex(cs.color);
    $('t-fill').value = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#ffffff' : rgbToHex(cs.backgroundColor);

    // 同步第二行功能区的形状样式
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') $('s-fill').value = rgbToHex(cs.backgroundColor);
    if (cs.borderTopColor && cs.borderTopStyle !== 'none') $('s-line').value = rgbToHex(cs.borderTopColor);
    $('s-linew').value = parseFloat(cs.borderTopWidth) ? Math.round(parseFloat(cs.borderTopWidth)) : '';
    $('s-radius').value = parseFloat(cs.borderRadius) ? Math.round(parseFloat(cs.borderRadius)) : '';
    $('s-opacity').value = Math.round(parseFloat(cs.opacity) * 100) || 100;
    $('s-shadow').classList.toggle('checked', cs.boxShadow && cs.boxShadow !== 'none');

    // 链接与悬停
    refreshLinkPanel();
    if (selected.dataset.edHoverId) {
      if (selected.dataset.edHoverBg) $('hover-bg').value = selected.dataset.edHoverBg;
      if (selected.dataset.edHoverColor) $('hover-color').value = selected.dataset.edHoverColor;
    }

    // 间距 / 边框
    const px = v => parseFloat(v) ? Math.round(parseFloat(v)) : '';
    $('pad-t').value = px(cs.paddingTop); $('pad-r').value = px(cs.paddingRight);
    $('pad-b').value = px(cs.paddingBottom); $('pad-l').value = px(cs.paddingLeft);
    $('mar-t').value = px(cs.marginTop); $('mar-r').value = px(cs.marginRight);
    $('mar-b').value = px(cs.marginBottom); $('mar-l').value = px(cs.marginLeft);
    $('bd-w').value = px(cs.borderTopWidth);
    $('bd-style').value = cs.borderTopStyle === 'none' ? '' : cs.borderTopStyle;
    $('bd-color').value = rgbToHex(cs.borderTopColor);
    $('bd-color-hex').value = rgbToHex(cs.borderTopColor);

    // 媒体 / 表格 / 布局 三个上下文面板
    syncMediaPanel();
    syncTablePanel();
    syncFlexPanel();
  }

  $('prop-color').addEventListener('input', e => { $('prop-color-hex').value = e.target.value; });
  $('prop-bg').addEventListener('input', e => { $('prop-bg-hex').value = e.target.value; });

  function needSelected() {
    if (!selected || !selected.isConnected) { setStatus('请先单击画布中的一个元素'); return false; }
    return true;
  }

  // 面板输入即时应用（回车或失焦）
  function bindPanelInput(id, fn) {
    $(id).addEventListener('change', () => {
      if (!needSelected()) return;
      snapshot('修改样式');
      fn();
      updateOverlay();
      fillPanel();
      setDirty();
    });
  }
  bindPanelInput('prop-x', () => {
    const vb = visualBox(selected), t = getTransform(selected);
    setTransform(selected, t.x + ((+$('prop-x').value) - vb.x), t.y, t.r, t.s);
  });
  bindPanelInput('prop-y', () => {
    const vb = visualBox(selected), t = getTransform(selected);
    setTransform(selected, t.x, t.y + ((+$('prop-y').value) - vb.y), t.r, t.s);
  });
  bindPanelInput('prop-w', () => {
    selected.style.width = $('prop-w').value + 'px';
    const pos = win().getComputedStyle(selected).position;
    if (pos !== 'absolute' && pos !== 'fixed') setStatus('已设置真实宽度：该元素在文档流中，可能挤动其他元素（需要的话可开「视觉缩放」）');
  });
  bindPanelInput('prop-h', () => {
    selected.style.height = $('prop-h').value + 'px';
    const pos = win().getComputedStyle(selected).position;
    if (pos !== 'absolute' && pos !== 'fixed') setStatus('已设置真实高度：该元素在文档流中，可能挤动其他元素（需要的话可开「视觉缩放」）');
  });
  bindPanelInput('prop-color-hex', () => { selected.style.color = $('prop-color-hex').value; });
  bindPanelInput('prop-bg-hex', () => { selected.style.backgroundColor = $('prop-bg-hex').value || 'transparent'; });
  bindPanelInput('prop-fontsize', () => { selected.style.fontSize = $('prop-fontsize').value + 'px'; });

  // ================= 工具条格式 =================
  $('btn-bold').onclick = () => {
    if (!needSelected()) return;
    snapshot('修改样式');
    const cur = win().getComputedStyle(selected).fontWeight;
    selected.style.fontWeight = (parseInt(cur) >= 600 || cur === 'bold') ? 'normal' : 'bold';
    setDirty();
  };
  $('btn-italic').onclick = () => {
    if (!needSelected()) return;
    snapshot('修改样式');
    selected.style.fontStyle = win().getComputedStyle(selected).fontStyle === 'italic' ? 'normal' : 'italic';
    setDirty();
  };
  $('btn-under').onclick = () => {
    if (!needSelected()) return;
    snapshot('修改样式');
    selected.style.textDecoration = win().getComputedStyle(selected).textDecorationLine.includes('underline') ? 'none' : 'underline';
    setDirty();
  };
  $('t-font').onchange = () => {
    if (!$('t-font').value || !needSelected()) return;
    snapshot();
    selected.style.fontFamily = $('t-font').value;
    setDirty();
  };
  $('t-size').onchange = () => {
    if (!$('t-size').value || !needSelected()) return;
    snapshot();
    selected.style.fontSize = $('t-size').value + 'px';
    setDirty();
  };
  $('t-color').oninput = () => {
    if (!selected || !selected.isConnected) return;
    if (!selected.__edC1) { snapshot(); selected.__edC1 = true; }
    selected.style.color = $('t-color').value;
    setDirty();
  };
  $('t-color').onchange = () => { if (selected) selected.__edC1 = false; };
  $('t-fill').oninput = () => {
    if (!selected || !selected.isConnected) return;
    if (!selected.__edC2) { snapshot(); selected.__edC2 = true; }
    selected.style.backgroundColor = $('t-fill').value;
    setDirty();
  };
  $('t-fill').onchange = () => { if (selected) selected.__edC2 = false; };
  $('t-align').onchange = () => {
    if (!$('t-align').value || !needSelected()) { $('t-align').value = ''; return; }
    snapshot();
    selected.style.textAlign = $('t-align').value;
    $('t-align').value = '';
    setDirty();
  };
  if ($('t-arrange')) $('t-arrange').onchange = () => {
    const v = $('t-arrange').value;
    $('t-arrange').value = '';
    if (!v || !needSelected()) return;
    snapshot();
    const z = el => { const n = parseInt(win().getComputedStyle(el).zIndex); return isNaN(n) ? 0 : n; };
    selection.forEach((el, i) => {
      if (v === 'front') el.style.zIndex = String(maxZ() + 1 + i);
      else if (v === 'back') el.style.zIndex = String(minZ() - selection.length + i);
      else if (v === 'up') el.style.zIndex = String(z(el) + 1.5);
      else if (v === 'down') el.style.zIndex = String(z(el) - 1.5);
    });
    setDirty();
    setStatus('层级已调整：' + ({ front: '置于顶层', back: '置于底层', up: '上移一层', down: '下移一层' }[v] || ''));
  };
  function maxZ() {
    let m = 0;
    doc().querySelectorAll('body *').forEach(el => {
      const z = parseInt(win().getComputedStyle(el).zIndex);
      if (!isNaN(z) && z < 2147483640 && z > m) m = z;
    });
    return m;
  }
  function minZ() {
    let m = 0;
    doc().querySelectorAll('body *').forEach(el => {
      const z = parseInt(win().getComputedStyle(el).zIndex);
      if (!isNaN(z) && z < m) m = z;
    });
    return m;
  }

  $('btn-dup').onclick = () => {
    if (!selection.length) { needSelected(); return; }
    snapshot('粘贴元素');
    const made = [];
    selection.slice().forEach(src => {
      const clone = src.cloneNode(true);
      const t = getTransform(src);
      setTransform(clone, t.x + 20, t.y + 20, t.r, t.s);
      src.parentNode.insertBefore(clone, src.nextSibling);
      made.push(clone);
    });
    selection = made;
    selected = made[made.length - 1];
    panel.style.display = 'flex';
    updateOverlay(); fillPanel(); updateSelCount(); refreshLayers(); setDirty();
    setStatus('已复制 ' + made.length + ' 个元素（Ctrl+Z 可撤销）');
  };

  function deleteSelected() {
    // 选中集合里的元素可能已被页面脚本移除，这里做一次清理
    selection = selection.filter(el => el && el.isConnected && !isEditorNode(el));
    if (!selection.length && selected && selected.isConnected && !isEditorNode(selected)) selection = [selected];
    if (!selection.length) { setStatus('请先单击画布中的一个元素'); return; }
    snapshot('删除元素');
    const n = selection.length;
    selection.slice().forEach(el => el.remove());
    deselect();
    setDirty();
    setStatus('已删除 ' + n + ' 个元素（Ctrl+Z 可撤销）');
  }
  $('btn-del').onclick = deleteSelected;

  // ================= 图片 =================
  $('apply-img-src').onclick = () => {
    if (!needSelected()) return;
    snapshot('修改样式');
    const v = $('prop-img-src').value.trim();
    if (selected.tagName === 'IMG') selected.src = v;
    else selected.style.backgroundImage = v ? `url("${v}")` : '';
    setDirty();
    setStatus('图片已更新');
  };
  $('btn-img-file').onclick = () => { if (needSelected()) imgFileInput.click(); };
  imgFileInput.onchange = () => {
    const f = imgFileInput.files[0];
    if (!f || !selected) return;
    snapshot();
    const r = new FileReader();
    r.onload = () => {
      if (selected.tagName === 'IMG') selected.src = r.result;
      else selected.style.backgroundImage = `url("${r.result}")`;
      setDirty();
      setStatus('本地图片已嵌入（base64）');
    };
    r.readAsDataURL(f);
    imgFileInput.value = '';
  };

  // ================= 工具条插入按钮 =================
  function centerPos() {
    const w = win();
    return {
      x: Math.round(w.scrollX + w.innerWidth / 2 - 90),
      y: Math.round(w.scrollY + w.innerHeight / 2 - 60)
    };
  }
  // 文本：进入拖拽绘制模式
  $('btn-ins-text').onclick = () => setTool('text');
  // 形状面板：选一个形状后进入拖拽绘制模式
  $('btn-shape-menu').onclick = e => {
    e.stopPropagation();
    const pal = $('shape-palette');
    const open = !pal.classList.contains('open');
    if (open) {
      const r = $('btn-shape-menu').getBoundingClientRect();
      pal.style.left = r.left + 'px';
      pal.style.top = (r.bottom + 6) + 'px';
    }
    pal.classList.toggle('open', open);
    $('btn-shape-menu').classList.toggle('active', open);
  };
  document.querySelectorAll('.shape-item').forEach(item => {
    item.onclick = e => {
      e.stopPropagation();
      $('shape-palette').classList.remove('open');
      if (item.dataset.block) { insertBlock(item.dataset.block); return; }
      if (item.dataset.media) { showMediaInsert(item.dataset.media); return; }
      setTool('shape', item.dataset.shape);
    };
  });
  document.addEventListener('click', () => {
    $('shape-palette').classList.remove('open');
    $('btn-shape-menu').classList.toggle('active', tool === 'shape');
  });
  // 图片：直接选文件，放到画布中央
  $('btn-ins-img').onclick = () => {
    if (!doc() || !doc().body) { setStatus('请先打开一个 HTML 文件（Ctrl+O）'); return; }
    const p = centerPos();
    pickImageAt({ clientX: (p.x - win().scrollX) * zoom, clientY: (p.y - win().scrollY) * zoom });
  };

  // ================= WPS 功能区：形状样式 / 对齐分布 / 组合 / 层级 =================
  const visBox = el => visualBox(el);
  // 用「当前视觉位置 → 目标位置」的差值来移动，避免祖先 transform 造成的坐标误差
  const moveTo = (el, x, y) => {
    const t = getTransform(el), cur = visualBox(el);
    setTransform(el, t.x + (x - cur.x), t.y + (y - cur.y), t.r, t.s);
  };

  function selOrWarn(min) {
    if (selection.length < (min || 1)) {
      setStatus(min > 1 ? '请先选中至少 ' + min + ' 个元素（Shift 点选或框选）' : '请先选中一个元素');
      return false;
    }
    return true;
  }

  // ================= 对齐基准（Alt + 单击设置） =================
  let alignAnchor = null;
  function anchorBox() {
    if (!alignAnchor || !alignAnchor.isConnected) return null;
    const vb = clientBox(alignAnchor);
    return { x: vb.x + win().scrollX, y: vb.y + win().scrollY, w: vb.w, h: vb.h };
  }
  function markAnchor(el) {
    const d = doc();
    if (!d) return;
    clearAnchorMark();
    const vb = clientBox(el);
    const m = d.createElement('div');
    m.className = '__ed_anchor';
    m.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483644;border:2px dashed #22C3A6;'
      + 'border-radius:3px;box-shadow:0 0 0 3px rgba(34,195,166,.16);'
      + 'left:' + (vb.x - 4) + 'px;top:' + (vb.y - 4) + 'px;'
      + 'width:' + (vb.w + 8) + 'px;height:' + (vb.h + 8) + 'px;';
    d.body.appendChild(m);
  }
  function clearAnchorMark() {
    const d = doc();
    if (d) d.querySelectorAll('.__ed_anchor').forEach(m => m.remove());
  }
  function refreshAnchorMark() {
    if (alignAnchor && alignAnchor.isConnected) markAnchor(alignAnchor);
  }

  // ---------- 对齐 ----------
  function alignSelection(mode) {
    if (!selOrWarn(1)) return;
    snapshot('对齐');
    const boxes = selection.map(el => ({ el, b: visBox(el) }));
    // 对齐基准优先级：Alt 指定的基准元素 > 单选时用页面 > 多选时用选区外框
    const ab = anchorBox();
    const useAnchor = ab && selection.length >= 2 && selection.includes(alignAnchor);
    const toPage = selection.length === 1;
    let L, R, T, B;
    if (useAnchor) {
      L = ab.x; R = ab.x + ab.w; T = ab.y; B = ab.y + ab.h;
    } else if (toPage) {
      const d = doc();
      L = 0; T = 0;
      R = d.body.scrollWidth || d.documentElement.clientWidth;
      B = d.body.scrollHeight || d.documentElement.clientHeight;
    } else {
      L = Math.min(...boxes.map(o => o.b.x));
      R = Math.max(...boxes.map(o => o.b.x + o.b.w));
      T = Math.min(...boxes.map(o => o.b.y));
      B = Math.max(...boxes.map(o => o.b.y + o.b.h));
    }
    boxes.forEach(({ el, b }) => {
      if (mode === 'left') moveTo(el, L, b.y);
      if (mode === 'right') moveTo(el, R - b.w, b.y);
      if (mode === 'cx') moveTo(el, (L + R) / 2 - b.w / 2, b.y);
      if (mode === 'top') moveTo(el, b.x, T);
      if (mode === 'bottom') moveTo(el, b.x, B - b.h);
      if (mode === 'cy') moveTo(el, b.x, (T + B) / 2 - b.h / 2);
    });
    updateOverlay(); fillPanel(); setDirty();
    const label = { left: '左对齐', right: '右对齐', cx: '水平居中', top: '顶端对齐', bottom: '底端对齐', cy: '垂直居中' }[mode];
    setStatus('已' + label + (useAnchor ? '（以青框基准元素为准）' : toPage ? '（相对页面）' : '（相对选区，共 ' + selection.length + ' 个元素）'));
  }
  [['al-l','left'],['al-cx','cx'],['al-r','right'],['al-t','top'],['al-cy','cy'],['al-b','bottom']]
    .forEach(([id, mode]) => { $(id).onclick = () => alignSelection(mode); });

  // ---------- 等距分布 ----------
  function distribute(axis) {
    if (!selOrWarn(3)) return;
    snapshot('等距分布');
    const boxes = selection.map(el => ({ el, b: visBox(el) }));
    const key = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'w' : 'h';
    boxes.sort((a, b) => a.b[key] - b.b[key]);
    const first = boxes[0], last = boxes[boxes.length - 1];
    const span = (last.b[key] + last.b[size]) - first.b[key];
    const total = boxes.reduce((s, o) => s + o.b[size], 0);
    const gap = (span - total) / (boxes.length - 1);
    let cursor = first.b[key];
    boxes.forEach(o => {
      if (axis === 'h') moveTo(o.el, cursor, o.b.y);
      else moveTo(o.el, o.b.x, cursor);
      cursor += o.b[size] + gap;
    });
    updateOverlay(); fillPanel(); setDirty();
    setStatus(axis === 'h' ? '已水平等距分布' : '已垂直等距分布');
  }
  $('al-dh').onclick = () => distribute('h');
  $('al-dv').onclick = () => distribute('v');

  // ---------- 形状样式 ----------
  function applyShapeStyle(fn, label) {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(fn);
    updateOverlay(); fillPanel(); setDirty();
    setStatus(label + '已应用');
  }
  // 颜色滑块连续拖动时只记一次撤销
  let styleSnapOpen = false;
  function styleOnce() { if (!styleSnapOpen) { snapshot(); styleSnapOpen = true; } }
  window.addEventListener('mouseup', () => { styleSnapOpen = false; });

  $('s-fill').oninput = () => { if (!selOrWarn(1)) return; styleOnce(); selection.forEach(el => { el.style.backgroundColor = $('s-fill').value; }); setDirty(); };
  $('s-line').oninput = () => {
    if (!selOrWarn(1)) return;
    styleOnce();
    selection.forEach(el => {
      el.style.borderStyle = 'solid';
      el.style.borderColor = $('s-line').value;
      if (!parseFloat(el.style.borderWidth)) el.style.borderWidth = '2px';
    });
    setDirty();
  };
  $('s-linew').onchange = () => {
    const v = $('s-linew').value;
    if (v === '') return;
    applyShapeStyle(el => { el.style.borderStyle = 'solid'; el.style.borderWidth = v + 'px'; }, '线宽');
  };
  $('s-radius').onchange = () => {
    const v = $('s-radius').value;
    if (v === '') return;
    applyShapeStyle(el => { el.style.borderRadius = v + 'px'; }, '圆角');
  };
  $('s-opacity').onchange = () => {
    const v = $('s-opacity').value;
    if (v === '') return;
    applyShapeStyle(el => { el.style.opacity = String(Math.min(100, Math.max(5, +v)) / 100); }, '透明度');
  };
  $('s-shadow').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    const on = !selection[0].style.boxShadow;
    selection.forEach(el => { el.style.boxShadow = on ? '0 6px 18px rgba(0,0,0,.28)' : ''; });
    $('s-shadow').classList.toggle('checked', on);
    setDirty();
    setStatus(on ? '已添加投影' : '已取消投影');
  };

  // ---------- 组合 / 取消组合 ----------
  let groupSeq = 0;
  $('grp').onclick = () => {
    if (!selOrWarn(2)) return;
    snapshot('组合');
    const gid = 'g' + (++groupSeq) + '_' + Date.now().toString(36);
    selection.forEach(el => { el.dataset.edGroup = gid; });
    enteredGroup = null;
    setDirty();
    refreshLayers();
    setStatus('已组合 ' + selection.length + ' 个元素：拖动任意一个会整体移动，拉角会整体缩放，双击可进组编辑');
  };
  $('ungrp').onclick = () => {
    const grouped = selection.filter(el => el.dataset.edGroup);
    if (!grouped.length) { setStatus('当前选中里没有已组合的元素'); return; }
    snapshot('取消组合');
    const gids = new Set(grouped.map(el => el.dataset.edGroup));
    const d = doc();
    gids.forEach(gid => d.body.querySelectorAll('[data-ed-group="' + gid + '"]').forEach(el => delete el.dataset.edGroup));
    enteredGroup = null;
    setDirty();
    refreshLayers();
    setStatus('已取消组合');
  };

  // ---------- 层级 ----------
  function layerZ(el) { const z = parseInt(win().getComputedStyle(el).zIndex); return isNaN(z) ? 0 : z; }
  $('z-front').onclick = () => { if (!selOrWarn(1)) return; snapshot(); selection.forEach(el => { el.style.zIndex = String(maxZ() + 1 + selection.indexOf(el)); }); setDirty(); setStatus('已置于顶层'); };
  $('z-back').onclick = () => { if (!selOrWarn(1)) return; snapshot(); selection.forEach((el, i) => { el.style.zIndex = String(minZ() - selection.length + i); }); setDirty(); setStatus('已置于底层'); };
  $('z-up').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(el => { el.style.zIndex = String(layerZ(el) + 1.5); });
    setDirty(); setStatus('已上移一层');
  };
  $('z-down').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(el => { el.style.zIndex = String(layerZ(el) - 1.5); });
    setDirty(); setStatus('已下移一层');
  };

  // ---------- 快捷键 ----------
  window.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'g') { e.preventDefault(); e.shiftKey ? $('ungrp').click() : $('grp').click(); }
    if (k === 'f') { e.preventDefault(); $('btn-find').click(); }
    if (k === 'a') {
      e.preventDefault();
      const d = doc();
      if (!d || !d.body) return;
      selection = Array.from(d.body.children).filter(el => !(el.id || '').startsWith('__ed') && !el.classList.contains('__ed_ghost'));
      selected = selection[selection.length - 1] || null;
      if (selected) { panel.style.display = 'flex'; updateOverlay(); fillPanel(); updateSelCount(); refreshLayers(); }
      setStatus('已全选 ' + selection.length + ' 个元素');
    }
  });

  // ================= P0 功能区：缩放 / 恢复 / 行高 / 图片填充 / 溢出 / 查找替换 / 格式刷 =================
  $('reset-el').onclick = () => {
    if (!selOrWarn(1)) return;
    const done = selection.filter(el => resetElement(el)).length;
    if (selected && selected.isConnected) { updateOverlay(); fillPanel(); }
    setDirty();
    setStatus(done ? '已恢复 ' + done + ' 个元素的原始状态' : '选中的元素没有被编辑器修改过');
  };

  let scaleMode = false;
  $('scale-mode').onclick = () => {
    scaleMode = !scaleMode;
    $('scale-mode').classList.toggle('checked', scaleMode);
    setStatus(scaleMode ? '视觉缩放：拉角只改显示大小，文字不会重排（推荐改 AI 页面）' : '真实尺寸：拉角写入真实宽高');
  };

  // 行高 / 字间距
  bindPanelInput('prop-lineheight', () => { selected.style.lineHeight = $('prop-lineheight').value; });
  bindPanelInput('prop-letterspacing', () => { selected.style.letterSpacing = $('prop-letterspacing').value + 'px'; });

  // 图片填充方式
  function currentFit(el) {
    if (el.tagName === 'IMG') return el.style.objectFit || '';
    const bs = win().getComputedStyle(el).backgroundSize;
    if (bs === 'contain') return 'contain';
    if (bs === 'cover') return 'cover';
    if (bs === '100% 100%') return 'fill';
    if (bs === 'auto') return 'none';
    return '';
  }
  function applyFit(mode) {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(el => {
      captureOriginal(el);
      if (el.tagName === 'IMG') el.style.objectFit = mode;
      else { el.style.backgroundSize = mode === 'fill' ? '100% 100%' : mode === 'none' ? 'auto' : mode; el.style.backgroundRepeat = 'no-repeat'; }
    });
    syncFitButtons();
    setDirty();
    setStatus('图片填充：' + ({ contain: '适应（完整显示）', cover: '填充（裁切铺满）', fill: '拉伸', none: '原始尺寸' }[mode]));
  }
  $('fit-contain').onclick = () => applyFit('contain');
  $('fit-cover').onclick = () => applyFit('cover');
  $('fit-fill').onclick = () => applyFit('fill');
  $('fit-none').onclick = () => applyFit('none');
  function syncFitButtons() {
    const cur = selected ? currentFit(selected) : '';
    [['fit-contain', 'contain'], ['fit-cover', 'cover'], ['fit-fill', 'fill'], ['fit-none', 'none']]
      .forEach(([id, m]) => $(id).classList.toggle('checked', cur === m));
  }
  function setObjPos(x, y) {
    const el = selected;
    if (!el) return;
    const val = x + '% ' + y + '%';
    if (el.tagName === 'IMG') el.style.objectPosition = val;
    else el.style.backgroundPosition = val;
  }
  bindPanelInput('prop-objx', () => setObjPos($('prop-objx').value || '50', $('prop-objy').value || '50'));
  bindPanelInput('prop-objy', () => setObjPos($('prop-objx').value || '50', $('prop-objy').value || '50'));

  // 文字溢出检查
  function checkOverflow(silent) {
    const d = doc();
    if (!d || !d.body) return 0;
    let n = 0;
    d.querySelectorAll('body *').forEach(el => {
      if ((el.id || '').startsWith('__ed')) return;
      el.classList.remove('__ed_overflow');
      if (el.tagName === 'IMG') return;
      if (!el.style.height && !el.style.width) return;
      const over = (el.scrollHeight - el.clientHeight > 2) || (el.scrollWidth - el.clientWidth > 2);
      if (over && el.clientHeight > 0) { el.classList.add('__ed_overflow'); n++; }
    });
    $('overflow-badge').style.display = n ? 'inline' : 'none';
    $('overflow-badge').textContent = '⚠ ' + n + ' 处内容溢出';
    if (!silent) setStatus(n ? '检测到 ' + n + ' 处内容溢出（红色描边），点这里可跳过去' : '未发现内容溢出');
    return n;
  }
  $('overflow-badge').onclick = () => {
    const n = checkOverflow(true);
    if (!n) { setStatus('未发现内容溢出'); return; }
    const first = doc().querySelector('.__ed_overflow');
    if (first) {
      setTool('select');
      selectElement(first);
      const L = layoutRect(first);
      win().scrollTo(Math.max(0, L.x - 60), Math.max(0, L.y - 60));
      setStatus('已定位到溢出的元素，共 ' + n + ' 处');
    }
  };

  // 全页查找替换
  function pageTextNodes() {
    const d = doc();
    if (!d || !d.body) return [];
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if ((p.id || '').startsWith('__ed')) return NodeFilter.FILTER_REJECT;
        if (p.classList && (p.classList.contains('__ed_ghost') || p.classList.contains('__ed_guide'))) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const out = [];
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }
  function findMatches() {
    const q = $('find-what').value;
    if (!q) return [];
    const cs = $('find-case').checked;
    const norm = t => cs ? t : t.toLowerCase();
    const needle = norm(q);
    const hits = [];
    pageTextNodes().forEach(node => {
      const text = norm(node.nodeValue);
      let idx = 0;
      while ((idx = text.indexOf(needle, idx)) !== -1) {
        hits.push(node);
        idx += needle.length || 1;
      }
    });
    return hits;
  }
  function updateFindCount() { $('find-count').textContent = findMatches().length + ' 处匹配'; }
  $('find-what').oninput = updateFindCount;
  $('find-case').onchange = updateFindCount;
  $('find-do').onclick = () => {
    const q = $('find-what').value;
    if (!q) { setStatus('请先输入要查找的内容'); return; }
    const hits = findMatches();
    if (!hits.length) { setStatus('没有找到「' + q + '」'); return; }
    snapshot();
    const repl = $('find-repl').value;
    const cs = $('find-case').checked;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? 'g' : 'gi');
    new Set(hits).forEach(node => { node.nodeValue = node.nodeValue.replace(re, repl); });
    updateFindCount();
    checkOverflow(true);
    setDirty();
    setStatus('已替换 ' + hits.length + ' 处「' + q + '」');
  };
  $('find-close').onclick = () => $('find-panel').classList.remove('open');
  $('btn-find').onclick = () => {
    const p = $('find-panel');
    const open = !p.classList.contains('open');
    if (open) {
      const r = $('btn-find').getBoundingClientRect();
      p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 380)) + 'px';
      p.style.top = (r.bottom + 6) + 'px';
      updateFindCount();
      $('find-what').focus();
    }
    p.classList.toggle('open', open);
  };

  // 格式刷
  const FMT_PROPS = ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'color', 'textAlign',
    'lineHeight', 'letterSpacing', 'backgroundColor', 'borderRadius', 'borderWidth', 'borderStyle',
    'borderColor', 'boxShadow', 'opacity', 'padding', 'textDecoration'];
  let fmtStyle = null, fmtSticky = false;
  function startFormatPainter(sticky) {
    if (!selOrWarn(1)) return;
    const cs = win().getComputedStyle(selected);
    fmtStyle = {};
    FMT_PROPS.forEach(p => { fmtStyle[p] = cs[p]; });
    fmtSticky = sticky;
    $('fmt-painter').classList.add('checked');
    $('fmt-state').style.display = 'inline';
    setStatus(sticky ? '格式刷（连续）：点多个元素反复套用，Esc 结束' : '格式刷已就绪：点其他元素套用样式（Esc 取消）');
  }
  $('fmt-painter').onclick = () => startFormatPainter(false);
  $('fmt-painter').ondblclick = () => startFormatPainter(true);
  function applyFormat(el) {
    if (!fmtStyle || !el) return false;
    snapshot();
    captureOriginal(el);
    Object.keys(fmtStyle).forEach(k => { try { el.style[k] = fmtStyle[k]; } catch (e) {} });
    if (!fmtSticky) { fmtStyle = null; $('fmt-painter').classList.remove('checked'); $('fmt-state').style.display = 'none'; }
    checkOverflow(true);
    setDirty();
    setStatus('格式已套用' + (fmtSticky ? '（连续模式，Esc 结束）' : ''));
    return true;
  }
  function cancelFormat() {
    if (!fmtStyle) return false;
    fmtStyle = null;
    $('fmt-painter').classList.remove('checked');
    $('fmt-state').style.display = 'none';
    setStatus('已退出格式刷');
    return true;
  }

  // ================= 通用下拉菜单 & 模态框 =================
  // 弹层必须挂在 body 上：头部/工具条用了 backdrop-filter 会生成包含块与层叠上下文，
  // 留在里面会让 position:fixed 的下拉被压在其它面板下面
  ['file-dropdown', 'shape-palette', 'find-panel', 'history-menu'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  });

  function openDropdown(btn, dd) {
    dd.classList.add('open');
    const r = btn.getBoundingClientRect();
    dd.style.left = Math.max(8, Math.min(r.left, window.innerWidth - dd.offsetWidth - 12)) + 'px';
    dd.style.top = (r.bottom + 6) + 'px';
  }
  document.addEventListener('click', e => {
    document.querySelectorAll('.dropdown.open').forEach(dd => {
      if (!dd.contains(e.target)) dd.classList.remove('open');
    });
  });
  let modalOnOk = null;
  function showModal(html, onOk) {
    $('modal-box').innerHTML = html;
    modalOnOk = onOk || null;
    $('modal-mask').classList.add('open');
  }
  function closeModal() { $('modal-mask').classList.remove('open'); modalOnOk = null; }
  $('modal-mask').addEventListener('click', e => {
    if (e.target === $('modal-mask')) closeModal();
    if (e.target.dataset && e.target.dataset.modal === 'ok') { if (modalOnOk) modalOnOk(); }
    if (e.target.dataset && e.target.dataset.modal === 'cancel') closeModal();
  });

  // ================= 本地存储：自动保存 / 历史版本 / 最近文件 =================
  const LS_SESSION = 'htmlCanvas.session';
  const LS_HISTORY = 'htmlCanvas.history';
  const LS_RECENT = 'htmlCanvas.recent';
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { setStatus('本地存储空间不足，自动保存失败'); } };
  let historyTimer = null;

  function pushHistory(reason) {
    const html = serializeKeep();
    if (!html) return;
    const list = lsGet(LS_HISTORY, []);
    list.unshift({ ts: Date.now(), name: $('project-name').textContent, reason: reason || '自动', html });
    lsSet(LS_HISTORY, list.slice(0, 10));
  }
  let autoSaveQuiet = false;
  function autoSave() {
    const d = doc();
    if (!d || !d.body) return;
    const html = serializeKeep();
    if (!html) return;
    lsSet(LS_SESSION, { ts: Date.now(), name: $('project-name').textContent, html });
    saveProject(true);
    if (!autoSaveQuiet) setStatus('已自动保存到本地浏览器 ' + new Date().toLocaleTimeString());
  }
  function scheduleAutoSave() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => { autoSave(); }, 2000);
  }
  setInterval(() => {
    if ($('project-state').textContent.includes('未保存')) autoSave();
  }, 60000);
  window.addEventListener('beforeunload', e => {
    if ($('project-state').textContent.includes('未保存')) {
      e.preventDefault();
      e.returnValue = '有未保存的修改，确定离开吗？';
      return e.returnValue;
    }
  });
  // 启动时检测可恢复会话
  (function checkSession() {
    const s = lsGet(LS_SESSION, null);
    if (!s || !s.html) return;
    const mins = Math.round((Date.now() - s.ts) / 60000);
    $('restore-text').textContent = '检测到未保存的编辑内容：' + (s.name || '未命名') + '（' + (mins < 1 ? '刚刚' : mins + ' 分钟前' + '）');
    $('restore-bar').classList.add('open');
  })();
  $('restore-yes').onclick = () => {
    const s = lsGet(LS_SESSION, null);
    if (s && s.html) {
      stage.srcdoc = s.html;
      dropHint.style.display = 'none';
      $('project-name').textContent = s.name || '未命名项目';
      $('doc-tab').textContent = s.name || '未命名项目';
      undoStack = []; redoStack = []; refreshUndoButtons();
      setStatus('已恢复上次会话');
    }
    $('restore-bar').classList.remove('open');
  };
  $('restore-no').onclick = () => {
    localStorage.removeItem(LS_SESSION);
    $('restore-bar').classList.remove('open');
  };
  function rememberRecent(name, html) {
    const list = lsGet(LS_RECENT, []).filter(x => x.name !== name);
    list.unshift({ name, ts: Date.now(), html });
    lsSet(LS_RECENT, list.slice(0, 5));
  }

  // ================= 文件菜单 =================
  function newPage(html, name) {
    const cp = currentPage();
    if (cp) { cp.html = html; cp.name = name; }
    stage.srcdoc = html;
    dropHint.style.display = 'none';
    undoStack = []; redoStack = []; refreshUndoButtons();
    $('project-name').textContent = name;
    $('project-state').textContent = '新建';
    renderTabs();
    saveProject(true);
    setStatus('已新建：' + name);
  }
  const BLANK_PAGE = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>新建页面</title>\n'
    + '<style>body{font-family:"Microsoft YaHei",sans-serif;margin:0;padding:40px;color:#20242C;background:#fff;}</style>\n'
    + '</head>\n<body>\n</body>\n</html>';
  const SKELETON_PAGE = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>新建页面</title>\n'
    + '<style>\n'
    + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;padding:48px;color:#20242C;background:#F6F7FC;}\n'
    + 'h1{font-size:38px;margin:0 0 16px;} p{font-size:16px;line-height:1.8;color:#5A6478;max-width:720px;}\n'
    + '.btn{display:inline-block;margin-top:24px;background:#5B7CFA;color:#fff;padding:12px 26px;border-radius:3px;text-decoration:none;}\n'
    + '.cols{display:flex;gap:20px;margin-top:32px;} .col{flex:1;background:#fff;border-radius:4px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.06);}\n'
    + '</style>\n</head>\n<body>\n'
    + '<h1>页面标题</h1>\n<p>在这里写正文。这段文字可以直接双击修改，也可以拖动调整位置。</p>\n'
    + '<a class="btn" href="#">主要按钮</a>\n'
    + '<div class="cols"><div class="col"><h3>栏目一</h3><p>内容说明</p></div>'
    + '<div class="col"><h3>栏目二</h3><p>内容说明</p></div></div>\n'
    + '</body>\n</html>';
  $('btn-file-menu').onclick = e => {
    e.stopPropagation();
    const dd = $('file-dropdown');
    if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }
    openDropdown($('btn-file-menu'), dd);
  };
  $('file-dropdown').addEventListener('click', e => {
    const item = e.target.closest('.dd-item');
    if (!item) return;
    $('file-dropdown').classList.remove('open');
    const act = item.dataset.act;
    if (act === 'new-blank') { if (confirmUnsaved()) newPage(BLANK_PAGE, '未命名项目'); }
    if (act === 'new-skeleton') { if (confirmUnsaved()) newPage(SKELETON_PAGE, '新建页面'); }
    if (act === 'templates') showTemplates();
    if (act === 'page-new') addPage();
    if (act === 'pages') showPages();
    if (act === 'export-all') exportAllPages();
    if (act === 'open') openFile();
    if (act === 'recent') showRecent();
    if (act === 'save') saveLocal();
    if (act === 'saveas') showSaveAs();
    if (act === 'info') showPageInfo();
    if (act === 'history') showHistory();
    if (act === 'assets') showAssets();
    if (act === 'check') runExportCheck(true);
    if (act === 'export') { if (runExportCheck()) downloadHTML(); }
  });
  function confirmUnsaved() {
    if (!$('project-state').textContent.includes('未保存')) return true;
    return confirm('当前有未保存的修改，确定要新建吗？（会自动保存到本地，可从「历史版本」找回）');
  }
  function showSaveAs() {
    const cur = ($('project-name').textContent || 'page').replace(/\.html?$/i, '');
    showModal(
      '<h3>导出为文件</h3>'
      + '<div class="frow"><label>文件名</label><input type="text" id="m-name" value="' + cur + '"></div>'
      + '<div class="mnote">这一步会<b>下载一个 .html 文件</b>到本机。如果只是想保存进度，用「保存到本地项目」即可（Ctrl+S，不下载）。</div>'
      + '<div class="actions"><button data-modal="cancel">取消</button><button class="primary" data-modal="ok">下载</button></div>',
      () => {
        const name = ($('m-name').value || 'page').trim().replace(/\.html?$/i, '');
        $('project-name').textContent = name + '.html';
        const cp = currentPage();
        if (cp) { cp.name = name; renderTabs(); }
        closeModal();
        downloadHTML();
      }
    );
  }

  // 保存 = 写入本地项目（不下载文件）
  function saveLocal() {
    const d = doc();
    if (!d || !d.body || $('project-state').textContent === '未打开') {
      setStatus('还没有可保存的内容，先打开或新建一个页面');
      return;
    }
    syncCurrentPage();
    lsSet(LS_PROJECT, { name: project.name, pages: project.pages, activeId: project.activeId });
    lsSet(LS_SESSION, { ts: Date.now(), name: $('project-name').textContent, html: serializeKeep() });
    pushHistory('保存');
    const t = new Date().toLocaleTimeString();
    $('project-state').textContent = '已保存 ' + t;
    setStatus('✅ 已保存到本地项目（' + project.pages.length + ' 个页面，' + t + '）· 要文件请用「导出 HTML」');
  }
  if ($('btn-save-local')) $('btn-save-local').onclick = () => saveLocal();
  function showPageInfo() {
    const d = doc();
    const title = d ? (d.title || '') : '';
    const desc = d ? (d.querySelector('meta[name="description"]') || {}).content || '' : '';
    showModal(
      '<h3>页面标题与描述</h3>'
      + '<div class="frow"><label>标题</label><input type="text" id="m-title" value="' + title.replace(/"/g, '&quot;') + '"></div>'
      + '<div class="frow"><label>描述</label><textarea id="m-desc">' + desc + '</textarea></div>'
      + '<div class="mnote">标题显示在浏览器标签与搜索结果里，描述用于 SEO 摘要。</div>'
      + '<div class="actions"><button data-modal="cancel">取消</button><button class="primary" data-modal="ok">保存</button></div>',
      () => {
        const d2 = doc();
        if (d2) {
          snapshot();
          d2.title = $('m-title').value;
          let meta = d2.querySelector('meta[name="description"]');
          if (!meta) { meta = d2.createElement('meta'); meta.name = 'description'; (d2.head || d2.documentElement).appendChild(meta); }
          meta.content = $('m-desc').value;
          setDirty();
          setStatus('页面标题与描述已更新');
        }
        closeModal();
      }
    );
  }
  function showHistory() {
    const list = lsGet(LS_HISTORY, []);
    const rows = list.length ? list.map((h, i) =>
      '<div class="hist-item" data-idx="' + i + '"><span>' + new Date(h.ts).toLocaleString() + '　' + (h.reason || '') + '</span><span>' + (h.name || '') + '</span></div>'
    ).join('') : '<div class="mnote">还没有历史版本。保存或自动保存后会生成。</div>';
    showModal(
      '<h3>历史版本（最近 10 次）</h3>' + rows
      + '<div class="mnote" style="margin-top:10px">点任意一条即可恢复该版本（当前内容仍可用 Ctrl+Z 撤销）。</div>'
      + '<div class="actions"><button data-modal="cancel">关闭</button></div>'
    );
    document.querySelectorAll('.hist-item').forEach(el => {
      el.onclick = () => {
        const h = list[+el.dataset.idx];
        if (!h) return;
        snapshot();
        stage.srcdoc = h.html;
        closeModal();
        setStatus('已恢复到 ' + new Date(h.ts).toLocaleString() + ' 的版本');
      };
    });
  }
  function showRecent() {
    const list = lsGet(LS_RECENT, []);
    const rows = list.length ? list.map((h, i) =>
      '<div class="recent-item" data-idx="' + i + '"><span>' + h.name + '</span><span>' + new Date(h.ts).toLocaleDateString() + '</span></div>'
    ).join('') : '<div class="mnote">还没有最近文件。导出或保存后会记录在这里（最多 5 个，存在本机浏览器）。</div>';
    showModal(
      '<h3>最近文件</h3>' + rows
      + '<div class="actions"><button data-modal="cancel">关闭</button></div>'
    );
    document.querySelectorAll('.recent-item').forEach(el => {
      el.onclick = () => {
        const r = list[+el.dataset.idx];
        if (!r) return;
        if (!confirmUnsaved()) return;
        stage.srcdoc = r.html;
        dropHint.style.display = 'none';
        $('project-name').textContent = r.name;
        $('doc-tab').textContent = r.name;
        $('project-state').textContent = '已打开';
        closeModal();
        setStatus('已打开最近文件：' + r.name);
      };
    });
  }

  // ================= 编辑：剪切 / 复制 / 粘贴 =================
  let clipboard = [];
  function copySelection(cut) {
    if (!selection.length) { needSelected(); return; }
    clipboard = selection.map(el => el.outerHTML);
    if (cut) {
      snapshot('剪切元素');
      selection.slice().forEach(el => el.remove());
      deselect();
      setDirty();
      setStatus('已剪切 ' + clipboard.length + ' 个元素');
    } else {
      setStatus('已复制 ' + clipboard.length + ' 个元素（Ctrl+V 粘贴）');
    }
  }
  $('btn-copy').onclick = () => copySelection(false);
  $('btn-cut').onclick = () => copySelection(true);
  $('btn-paste').onclick = () => pasteClipboard();
  function pasteClipboard() {
    const d = doc();
    if (!d || !d.body) { setStatus('请先打开或新建一个页面'); return; }
    if (!clipboard.length) { setStatus('剪贴板为空'); return; }
    snapshot('粘贴元素');
    const made = [];
    clipboard.forEach(html => {
      const tmp = d.createElement('div');
      tmp.innerHTML = html;
      const el = tmp.firstElementChild;
      if (!el) return;
      const t = getTransform(el);
      setTransform(el, t.x + 24, t.y + 24, t.r, t.s);
      el.style.zIndex = String(maxZ() + 1);
      d.body.appendChild(el);
      made.push(el);
    });
    selection = made;
    selected = made[made.length - 1] || null;
    if (selected) { panel.style.display = 'flex'; updateOverlay(); fillPanel(); updateSelCount(); refreshLayers(); }
    setDirty();
    setStatus('已粘贴 ' + made.length + ' 个元素');
  }

  // ================= 图片管理：锁定比例 / alt / 压缩 / 丢失检查 =================
  let lockRatio = false;
  $('img-lockratio').onchange = () => {
    lockRatio = $('img-lockratio').checked;
    setStatus(lockRatio ? '已锁定宽高比：拉角时保持比例' : '已解除宽高比锁定');
  };
  bindPanelInput('prop-img-alt', () => { selected.setAttribute('alt', $('prop-img-alt').value); });
  $('btn-img-compress').onclick = () => {
    if (!needSelected() || selected.tagName !== 'IMG') { setStatus('请先选中一张图片'); return; }
    const src = selected.src;
    if (!src) { setStatus('图片没有地址'); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxW = 1600;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const out = c.toDataURL('image/jpeg', 0.72);
      const before = Math.round(src.length / 1365);
      const after = Math.round(out.length / 1365);
      snapshot();
      captureOriginal(selected);
      selected.src = out;
      setDirty();
      fillPanel();
      setStatus('已压缩：约 ' + before + 'KB → ' + after + 'KB');
    };
    img.onerror = () => setStatus('图片加载失败（可能是外链跨域），无法压缩');
    img.src = src;
  };
  $('btn-img-check').onclick = () => {
    const d = doc();
    if (!d || !d.body) return;
    const imgs = Array.from(d.body.querySelectorAll('img'));
    const bad = imgs.filter(im => !im.complete || im.naturalWidth === 0);
    if (!bad.length) { setStatus('检查完成：' + imgs.length + ' 张图片全部正常'); return; }
    setTool('select');
    selectElement(bad[0]);
    setStatus('发现 ' + bad.length + ' 张图片加载失败（已选中第一张），共 ' + imgs.length + ' 张');
  };

  // ================= 导出检查 =================
  function collectIssues() {
    const d = doc();
    if (!d || !d.body) return [];
    const issues = [];
    const imgs = Array.from(d.body.querySelectorAll('img'));
    const bad = imgs.filter(im => !im.complete || im.naturalWidth === 0);
    if (bad.length) issues.push({ level: 'bad', text: bad.length + ' 张图片加载失败（导出后会显示为空白）' });
    const remote = imgs.filter(im => /^https?:/i.test(im.getAttribute('src') || ''));
    if (remote.length) issues.push({ level: 'bad', text: remote.length + ' 张图片是外链（对方删除或限流后会失效，建议点「压缩」内嵌为 base64）' });
    if (!d.title) issues.push({ level: 'bad', text: '页面没有标题（浏览器标签会显示文件名）' });
    const desc = d.querySelector('meta[name="description"]');
    if (!desc || !desc.content) issues.push({ level: 'bad', text: '缺少页面描述 meta description（影响分享摘要与 SEO）' });
    const scripts = d.querySelectorAll('script').length;
    if (scripts) issues.push({ level: 'ok', text: scripts + ' 段脚本会原样保留（翻页/动画等交互不受影响）' });
    const overflow = d.querySelectorAll('.__ed_overflow').length;
    if (overflow) issues.push({ level: 'bad', text: overflow + ' 处元素内容溢出，导出前建议调整' });
    const noAlt = imgs.filter(im => !im.getAttribute('alt')).length;
    if (noAlt) issues.push({ level: 'bad', text: noAlt + ' 张图片缺少替代文字 alt' });
    return issues;
  }
  function runExportCheck(showReport) {
    const issues = collectIssues();
    const bad = issues.filter(i => i.level === 'bad');
    if (showReport) {
      const rows = issues.length
        ? issues.map(i => '<div class="' + (i.level === 'bad' ? 'check-bad' : 'check-ok') + '" style="padding:6px 0;font-size:12px">'
            + (i.level === 'bad' ? '⚠ ' : '✓ ') + i.text + '</div>').join('')
        : '<div class="check-ok" style="padding:6px 0;font-size:12px">✓ 一切正常，可以放心导出</div>';
      showModal('<h3>导出检查</h3>' + rows
        + '<div class="actions"><button data-modal="cancel">取消</button><button class="primary" data-modal="ok" id="m-export-go">仍然导出</button></div>',
        () => { closeModal(); downloadHTML(); });
      return false;
    }
    if (bad.length) setStatus('导出检查：发现 ' + bad.length + ' 个问题（文件菜单 → 导出检查 可查看详情）');
    return true;
  }

  // ================= 内容块插入 =================
  const BLOCKS = {
    h1: { w: 420, h: 64, html: '<div style="font-size:36px;font-weight:700;color:#2A3142;font-family:\'Microsoft YaHei\',sans-serif;">大标题文字</div>' },
    p: { w: 420, h: 72, html: '<div style="font-size:16px;line-height:1.8;color:#5A6478;font-family:\'Microsoft YaHei\',sans-serif;">在这里输入正文内容，双击即可编辑。</div>' },
    btn: { w: 140, h: 44, html: '<div style="background:#5B7CFA;color:#fff;padding:12px 26px;border-radius:3px;text-align:center;font-family:\'Microsoft YaHei\',sans-serif;">按钮文字</div>' },
    link: { w: 160, h: 30, html: '<a href="#" style="color:#5B7CFA;text-decoration:underline;font-family:\'Microsoft YaHei\',sans-serif;">链接文字</a>' },
    hr: { w: 500, h: 1, html: '<div style="height:1px;background:#DCE2F0;"></div>' },
    cols2: { w: 640, h: 180, html: '<div style="display:flex;gap:16px;width:100%;height:100%;"><div style="flex:1;background:#fff;border-radius:4px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);">栏目一</div><div style="flex:1;background:#fff;border-radius:4px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);">栏目二</div></div>' },
    cols3: { w: 760, h: 180, html: '<div style="display:flex;gap:16px;width:100%;height:100%;"><div style="flex:1;background:#fff;border-radius:4px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);">栏目一</div><div style="flex:1;background:#fff;border-radius:4px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);">栏目二</div><div style="flex:1;background:#fff;border-radius:4px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);">栏目三</div></div>' },
    list: { w: 320, h: 120, html: '<ul style="margin:0;padding-left:22px;font-size:16px;line-height:2;color:#2A3142;font-family:\'Microsoft YaHei\',sans-serif;"><li>第一项内容</li><li>第二项内容</li><li>第三项内容</li></ul>' },
    table: { w: 480, h: 140, html: '<table style="border-collapse:collapse;width:100%;font-size:14px;font-family:\'Microsoft YaHei\',sans-serif;"><tr><th style="border:1px solid #DCE2F0;padding:8px;background:#F1F4FB;">表头</th><th style="border:1px solid #DCE2F0;padding:8px;background:#F1F4FB;">表头</th></tr><tr><td style="border:1px solid #DCE2F0;padding:8px;">内容</td><td style="border:1px solid #DCE2F0;padding:8px;">内容</td></tr><tr><td style="border:1px solid #DCE2F0;padding:8px;">内容</td><td style="border:1px solid #DCE2F0;padding:8px;">内容</td></tr></table>' }
  };
  function insertBlock(key) {
    const d = doc();
    if (!d || !d.body) { setStatus('请先打开或新建一个页面'); return; }
    const def = BLOCKS[key];
    if (!def) return;
    const w = win();
    snapshot();
    const box = d.createElement('div');
    box.style.cssText = 'position:absolute;box-sizing:border-box;z-index:' + (maxZ() + 1)
      + ';left:' + Math.round(w.scrollX + w.innerWidth / 2 - def.w / 2) + 'px;'
      + 'top:' + Math.round(w.scrollY + 80) + 'px;'
      + 'width:' + def.w + 'px;';
    box.innerHTML = def.html;
    if (def.h) box.style.minHeight = def.h + 'px';
    d.body.appendChild(box);
    setTool('select');
    selectElement(box);
    setDirty();
    setStatus('已插入内容块：双击可改文字，拖动可移动');
  }

  // ================= 尺寸提示 =================
  function showSizeTip(cx, cy, el) {
    const vb = visualBox(el), t = getTransform(el);
    let txt = 'X ' + Math.round(vb.x) + '   Y ' + Math.round(vb.y) + '   ' + Math.round(vb.w) + ' × ' + Math.round(vb.h);
    if (t.r) txt += '   ' + Math.round(t.r) + '°';
    if (t.s && Math.abs(t.s - 1) > 0.001) txt += '   ' + Math.round(t.s * 100) + '%';
    const tip = $('size-tip');
    tip.textContent = txt;
    tip.style.left = Math.min(window.innerWidth - 200, cx + 16) + 'px';
    tip.style.top = Math.max(8, cy - 34) + 'px';
    tip.classList.add('on');
  }
  function hideSizeTip() { $('size-tip').classList.remove('on'); }

  // ================= 标尺与辅助线 =================
  function rulersOn() { return $('stage-wrap').classList.contains('rulers-on'); }
  function stageOffset() {
    const s = stage.getBoundingClientRect(), w = $('stage-wrap').getBoundingClientRect();
    return { x: s.left - w.left + $('stage-wrap').scrollLeft, y: s.top - w.top + $('stage-wrap').scrollTop };
  }
  function buildRulers() {
    const hT = $('ruler-h-ticks'), vT = $('ruler-v-ticks');
    hT.innerHTML = ''; vT.innerHTML = '';
    if (!rulersOn() || !stage.clientWidth) return;
    const off = stageOffset();
    const step = 50;
    for (let c = 0; c * zoom < stage.clientWidth * zoom + 1; c += step) {
      const x = off.x + c * zoom;
      if (x > $('stage-wrap').clientWidth) break;
      const t = document.createElement('div');
      t.className = 'rtick h';
      t.style.left = x + 'px';
      hT.appendChild(t);
      if (c % 200 === 0) {
        const n = document.createElement('div');
        n.className = 'rnum';
        n.style.left = (x + 2) + 'px'; n.style.top = '1px';
        n.textContent = c;
        hT.appendChild(n);
      }
    }
    for (let c = 0; c * zoom < stage.clientHeight * zoom + 1; c += step) {
      const y = off.y + c * zoom;
      if (y > $('stage-wrap').clientHeight) break;
      const t = document.createElement('div');
      t.className = 'rtick v';
      t.style.top = y + 'px';
      vT.appendChild(t);
      if (c % 200 === 0) {
        const n = document.createElement('div');
        n.className = 'rnum';
        n.style.top = (y + 2) + 'px'; n.style.left = '1px';
        n.textContent = c;
        vT.appendChild(n);
      }
    }
  }
  function addGuide(axis, pos) {
    const d = doc();
    if (!d || !d.body) return null;
    const g = d.createElement('div');
    g.className = '__ed_guide';
    g.dataset.axis = axis;
    g.style.cssText = 'position:absolute;z-index:2147483642;pointer-events:auto;background:#8B5CF6;'
      + (axis === 'h' ? 'left:0;right:0;height:1px;cursor:ns-resize;' : 'top:0;bottom:0;width:1px;cursor:ew-resize;');
    g.style[axis === 'h' ? 'top' : 'left'] = Math.round(pos) + 'px';
    d.body.appendChild(g);
    g.addEventListener('mousedown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const start = axis === 'h' ? ev.clientY : ev.clientX;
      const orig = parseFloat(g.style[axis === 'h' ? 'top' : 'left']) || 0;
      const mv = e2 => {
        const now = axis === 'h' ? e2.clientY : e2.clientX;
        const np = Math.round(orig + (now - start) / zoom);
        g.style[axis === 'h' ? 'top' : 'left'] = np + 'px';
        setStatus('辅助线位置：' + np + 'px');
      };
      const up = () => { d.removeEventListener('mousemove', mv, true); d.removeEventListener('mouseup', up, true); };
      d.addEventListener('mousemove', mv, true);
      d.addEventListener('mouseup', up, true);
    });
    g.addEventListener('dblclick', ev => { ev.preventDefault(); ev.stopPropagation(); g.remove(); setStatus('已删除辅助线'); });
    return g;
  }
  function clearGuides() {
    const d = doc();
    if (d) d.querySelectorAll('.__ed_guide').forEach(g => g.remove());
  }
  function bindRulerDrag(ruler, axis) {
    ruler.addEventListener('mousedown', e => {
      if (!doc() || !doc().body) return;
      e.preventDefault();
      const s = stage.getBoundingClientRect();
      const g = addGuide(axis, axis === 'h' ? (e.clientY - s.top) / zoom : (e.clientX - s.left) / zoom);
      if (!g) return;
      const mv = e2 => {
        const now = axis === 'h' ? (e2.clientY - s.top) / zoom : (e2.clientX - s.left) / zoom;
        g.style[axis === 'h' ? 'top' : 'left'] = Math.round(now) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', mv, true);
        document.removeEventListener('mouseup', up, true);
        setStatus('已添加辅助线（拖动可移动，双击删除）');
      };
      document.addEventListener('mousemove', mv, true);
      document.addEventListener('mouseup', up, true);
    });
  }
  bindRulerDrag($('ruler-h'), 'h');
  bindRulerDrag($('ruler-v'), 'v');
  // ================= 功能区选项卡 =================
  function showRibbonTab(name) {
    document.querySelectorAll('.rtab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.rpage').forEach(p => p.classList.toggle('active', p.dataset.page === name));
    try { localStorage.setItem('htmlCanvas.ribbonTab', name); } catch (e) {}
  }
  document.querySelectorAll('.rtab').forEach(t => { t.onclick = () => showRibbonTab(t.dataset.tab); });
  $('btn-fold-ribbon').onclick = () => {
    const collapsed = $('ribbon-body').classList.toggle('collapsed');
    $('btn-fold-ribbon').textContent = collapsed ? '⌄' : '⌃';
    $('btn-fold-ribbon').classList.toggle('checked', collapsed);
    try { localStorage.setItem('htmlCanvas.ribbonCollapsed', collapsed ? '1' : '0'); } catch (e) {}
    setStatus(collapsed ? '功能区已折叠（点 ⌄ 展开，快捷键 Ctrl+F1）' : '功能区已展开');
    setTimeout(applyZoom, 0);
  };
  (function initRibbon() {
    let tab = null, collapsed = null;
    try {
      tab = localStorage.getItem('htmlCanvas.ribbonTab');
      collapsed = localStorage.getItem('htmlCanvas.ribbonCollapsed');
    } catch (e) {}
    showRibbonTab(tab && document.querySelector('.rtab[data-tab="' + tab + '"]') ? tab : 'home');
    if (collapsed === null && window.innerHeight < 780) collapsed = '1';
    if (collapsed === '1') {
      $('ribbon-body').classList.add('collapsed');
      $('btn-fold-ribbon').textContent = '⌄';
      $('btn-fold-ribbon').classList.add('checked');
    }
  })();
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'F1') { e.preventDefault(); $('btn-fold-ribbon').click(); }
  });
  // 效率页签里的三个入口
  if ($('btn-history')) $('btn-history').onclick = () => showHistory();
  if ($('btn-assets')) $('btn-assets').onclick = () => showAssets();
  if ($('btn-check')) $('btn-check').onclick = () => runExportCheck(true);

  $('btn-rulers').onclick = () => {
    const on = !rulersOn();
    $('stage-wrap').classList.toggle('rulers-on', on);
    $('btn-rulers').classList.toggle('checked', on);
    if (!on) clearGuides();
    setTimeout(() => { applyZoom(); buildRulers(); }, 0);
    setStatus(on ? '标尺已开启：从上方/左侧标尺拖出辅助线，双击辅助线可删除' : '标尺已关闭');
  };

  // ================= 多端适配 =================
  const DEVICE_W = { pc: 0, pad: 820, phone: 390 };
  let device = 'pc';
  function setDevice(k) {
    device = k;
    ['pc', 'pad', 'phone'].forEach(x => $('dev-' + x).classList.toggle('checked', x === k));
    if (k === 'pc') { stage.style.flex = '1'; stage.style.width = ''; }
    else { stage.style.flex = 'none'; stage.style.width = DEVICE_W[k] + 'px'; }
    applyZoom();
    buildRulers();
    setStatus('预览宽度：' + (k === 'pc' ? '自适应（电脑）' : DEVICE_W[k] + 'px（' + (k === 'pad' ? '平板' : '手机') + '）'));
  }
  $('dev-pc').onclick = () => setDevice('pc');
  $('dev-pad').onclick = () => setDevice('pad');
  $('dev-phone').onclick = () => setDevice('phone');
  setDevice('pc');

  function rebuildResponsiveCss() {
    const d = doc();
    if (!d) return;
    let st = d.getElementById('__ed_responsive');
    if (!st) { st = d.createElement('style'); st.id = '__ed_responsive'; (d.head || d.documentElement).appendChild(st); }
    st.textContent = '@media (max-width:600px){[data-ed-hide~="phone"]{display:none !important}}\n'
      + '@media (min-width:601px) and (max-width:1024px){[data-ed-hide~="pad"]{display:none !important}}';
  }
  function toggleHide(which) {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(el => {
      const cur = (el.dataset.edHide || '').split(/\s+/).filter(Boolean);
      const i = cur.indexOf(which);
      if (i >= 0) cur.splice(i, 1); else cur.push(which);
      if (cur.length) el.dataset.edHide = cur.join(' '); else delete el.dataset.edHide;
    });
    rebuildResponsiveCss();
    setDirty();
    setStatus('已更新分端显示设置（切换手机/平板预览可查看效果）');
  }
  $('hide-phone').onclick = () => toggleHide('phone');
  $('hide-pad').onclick = () => toggleHide('pad');
  $('show-all').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(el => delete el.dataset.edHide);
    rebuildResponsiveCss();
    setDirty();
    setStatus('已清除分端隐藏');
  };

  // ================= 链接与交互 =================
  function anchorTarget(el) {
    let n = el;
    while (n && n.tagName !== 'A') n = n.parentElement;
    return n;
  }
  function fillAnchors() {
    const sel = $('prop-anchor'), d = doc();
    const cur = sel.value;
    sel.innerHTML = '<option value="">跳转到页面锚点…</option>';
    if (!d) return;
    d.querySelectorAll('[id]').forEach(el => {
      if (el.id.startsWith('__ed')) return;
      const o = document.createElement('option');
      o.value = '#' + el.id;
      o.textContent = '#' + el.id;
      sel.appendChild(o);
    });
    sel.value = cur;
  }
  function refreshLinkPanel() {
    if (!selected) return;
    const a = anchorTarget(selected);
    $('prop-href').value = a ? (a.getAttribute('href') || '') : '';
    $('prop-target').value = a ? (a.getAttribute('target') || '') : '';
    fillAnchors();
  }
  $('btn-apply-link').onclick = () => {
    if (!selOrWarn(1)) return;
    const href = $('prop-href').value.trim();
    const target = $('prop-target').value;
    if (!href) { setStatus('请先填写链接地址'); return; }
    snapshot();
    selection.forEach(el => {
      let a = anchorTarget(el);
      if (!a) {
        a = doc().createElement('a');
        a.setAttribute('href', href);
        const wrapped = el.parentNode.insertBefore(a, el);
        wrapped.appendChild(el);
      } else {
        a.setAttribute('href', href);
      }
      if (target) a.setAttribute('target', target); else a.removeAttribute('target');
      a.style.color = 'inherit';
      a.style.textDecoration = 'none';
      a.style.display = 'contents';
    });
    rebuildHoverCss();
    setDirty();
    setStatus('链接已应用到 ' + selection.length + ' 个元素（编辑时点击不会跳转，导出后生效）');
  };
  $('btn-wrap-link').onclick = () => {
    if (!selOrWarn(1)) return;
    $('btn-apply-link').click();
  };
  $('prop-anchor').onchange = () => {
    if (!$('prop-anchor').value) return;
    $('prop-href').value = $('prop-anchor').value;
  };

  // 悬停样式（写进独立的样式表，导出后仍生效）
  function rebuildHoverCss() {
    const d = doc();
    if (!d) return;
    let st = d.getElementById('__ed_hover');
    if (!st) { st = d.createElement('style'); st.id = '__ed_hover'; (d.head || d.documentElement).appendChild(st); }
    const rules = [];
    d.querySelectorAll('[data-ed-hover-id]').forEach(el => {
      const parts = [];
      if (el.dataset.edHoverBg) parts.push('background:' + el.dataset.edHoverBg + ' !important');
      if (el.dataset.edHoverColor) parts.push('color:' + el.dataset.edHoverColor + ' !important');
      if (el.dataset.edHoverOpacity) parts.push('opacity:' + el.dataset.edHoverOpacity + ' !important');
      if (parts.length) rules.push('[data-ed-hover-id="' + el.dataset.edHoverId + '"]:hover{' + parts.join(';') + '}');
    });
    st.textContent = rules.join('\n');
  }
  let hoverSeq = 0;
  function ensureHoverId(el) {
    if (!el.dataset.edHoverId) el.dataset.edHoverId = 'h' + (++hoverSeq) + '_' + Date.now().toString(36).slice(-4);
  }
  ['hover-bg', 'hover-color'].forEach(id => {
    $(id).addEventListener('change', () => {
      if (!selOrWarn(1)) return;
      snapshot();
      selection.forEach(el => {
        ensureHoverId(el);
        if (id === 'hover-bg') el.dataset.edHoverBg = $('hover-bg').value;
        else el.dataset.edHoverColor = $('hover-color').value;
      });
      rebuildHoverCss();
      setDirty();
      setStatus('悬停样式已设置（把鼠标移到元素上可预览）');
    });
  });
  $('btn-hover-clear').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(el => { delete el.dataset.edHoverBg; delete el.dataset.edHoverColor; delete el.dataset.edHoverOpacity; });
    rebuildHoverCss();
    setDirty();
    setStatus('已清除悬停样式');
  };

  // ================= 元素样式补全：内外边距 / 边框 / 背景图 =================
  ['pad-t', 'pad-r', 'pad-b', 'pad-l'].forEach((id, i) => {
    bindPanelInput(id, () => {
      const v = $(id).value;
      if (v === '') return;
      selected.style.paddingTop = selected.style.paddingRight = selected.style.paddingBottom = selected.style.paddingLeft = '';
      selected.style['padding' + ['Top', 'Right', 'Bottom', 'Left'][i]] = v + 'px';
    });
  });
  ['mar-t', 'mar-r', 'mar-b', 'mar-l'].forEach((id, i) => {
    bindPanelInput(id, () => {
      const v = $(id).value;
      if (v === '') return;
      selected.style['margin' + ['Top', 'Right', 'Bottom', 'Left'][i]] = v + 'px';
    });
  });
  bindPanelInput('bd-w', () => {
    if ($('bd-w').value === '') return;
    selected.style.borderStyle = selected.style.borderStyle || 'solid';
    selected.style.borderWidth = $('bd-w').value + 'px';
  });
  bindPanelInput('bd-style', () => {
    if (!$('bd-style').value) return;
    selected.style.borderStyle = $('bd-style').value;
    if ($('bd-style').value !== 'none' && !parseFloat(selected.style.borderWidth)) selected.style.borderWidth = '1px';
  });
  bindPanelInput('bd-color-hex', () => {
    selected.style.borderStyle = selected.style.borderStyle || 'solid';
    selected.style.borderColor = $('bd-color-hex').value;
  });
  $('bd-color').addEventListener('input', e => { $('bd-color-hex').value = e.target.value; });
  $('bg-upload').onclick = () => {
    if (!selOrWarn(1)) return;
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        snapshot();
        selection.forEach(el => {
          captureOriginal(el);
          el.style.backgroundImage = 'url("' + r.result + '")';
          el.style.backgroundSize = el.style.backgroundSize || 'cover';
          el.style.backgroundRepeat = 'no-repeat';
        });
        setDirty(); fillPanel();
        setStatus('背景图已设置为本地图片（base64 内嵌）');
      };
      r.readAsDataURL(f);
    };
    inp.click();
  };
  $('bg-clear').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    selection.forEach(el => { el.style.backgroundImage = ''; });
    setDirty(); fillPanel();
    setStatus('已清除背景图');
  };

  // ================= 主题：一键统一配色与字体 =================
  function collectColors() {
    const d = doc();
    if (!d || !d.body) return [];
    const count = new Map();
    const push = c => {
      if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return;
      const hex = rgbToHex(c);
      if (!hex) return;
      count.set(hex, (count.get(hex) || 0) + 1);
    };
    d.body.querySelectorAll('*').forEach(el => {
      push(el.style.color); push(el.style.backgroundColor); push(el.style.borderColor);
    });
    const styles = Array.from(d.querySelectorAll('style')).map(s => s.textContent).join('\n');
    (styles.match(/#[0-9a-fA-F]{6}\b/g) || []).forEach(h => count.set(h.toLowerCase(), (count.get(h.toLowerCase()) || 0) + 3));
    return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }
  function applyThemeMap(map, titleFont, bodyFont) {
    snapshot();
    const d = doc();
    const pairs = Object.entries(map).filter(([from, to]) => from.toLowerCase() !== to.toLowerCase());
    // 1) 内联样式替换
    d.body.querySelectorAll('*').forEach(el => {
      const st = el.getAttribute('style');
      if (!st) return;
      let out = st;
      pairs.forEach(([from, to]) => { out = out.replace(new RegExp(from, 'gi'), to); });
      if (out !== st) el.setAttribute('style', out);
    });
    // 2) 文档内 <style> 文本替换
    d.querySelectorAll('style').forEach(s => {
      if ((s.id || '').startsWith('__ed')) return;
      let txt = s.textContent;
      const orig = txt;
      pairs.forEach(([from, to]) => { txt = txt.replace(new RegExp(from, 'gi'), to); });
      if (txt !== orig) s.textContent = txt;
    });
    // 3) 字体
    if (bodyFont || titleFont) {
      d.body.querySelectorAll('*').forEach(el => {
        const tag = el.tagName.toLowerCase();
        const isTitle = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) ||
          (el.dataset.edName && /标题|title/i.test(el.dataset.edName)) ||
          parseFloat(win().getComputedStyle(el).fontSize) >= 24;
        const fam = isTitle ? (titleFont || bodyFont) : bodyFont;
        if (fam) el.style.fontFamily = fam;
      });
    }
    rebuildHoverCss();
    setDirty();
    setStatus('主题已应用：替换 ' + pairs.length + ' 组颜色' + (bodyFont || titleFont ? '，并统一了字体' : ''));
  }
  $('btn-theme').onclick = () => {
    const d = doc();
    if (!d || !d.body) { setStatus('请先打开或新建一个页面'); return; }
    const colors = collectColors();
    const rows = colors.length ? colors.map(([hex, cnt]) =>
      '<div class="theme-swatch"><span class="dot" style="background:' + hex + '"></span>'
      + '<span style="font-family:Consolas,monospace;font-size:12px;width:80px">' + hex + '</span>'
      + '<span class="cnt">' + cnt + ' 处</span>'
      + '<span style="flex:1"></span>'
      + '<input type="color" data-from="' + hex + '" value="' + hex + '"></div>'
    ).join('') : '<div class="mnote">页面里没有检测到颜色。</div>';
    const fonts = ['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'Arial', 'Georgia', 'Courier New'];
    const opts = sel => '<option value="">不改</option>' + fonts.map(f => '<option value="' + f + '"' + (sel === f ? ' selected' : '') + '>' + f + '</option>').join('');
    showModal(
      '<h3>主题：一键统一配色与字体</h3>'
      + '<div class="mnote">下面是页面里出现最多的颜色。把要改的色改成新色，点应用即可全页替换（含样式表内的颜色）。</div>'
      + '<div style="margin:10px 0">' + rows + '</div>'
      + '<div class="frow"><label>标题字体</label><select id="m-titlefont" style="flex:1;background:var(--input);color:var(--text);border:1px solid var(--border-2);border-radius:2px;padding:6px">' + opts() + '</select></div>'
      + '<div class="frow"><label>正文字体</label><select id="m-bodyfont" style="flex:1;background:var(--input);color:var(--text);border:1px solid var(--border-2);border-radius:2px;padding:6px">' + opts() + '</select></div>'
      + '<div class="actions"><button data-modal="cancel">取消</button><button class="primary" data-modal="ok">应用主题</button></div>',
      () => {
        const map = {};
        document.querySelectorAll('.theme-swatch input[type=color]').forEach(inp => { map[inp.dataset.from] = inp.value; });
        applyThemeMap(map, $('m-titlefont').value, $('m-bodyfont').value);
        closeModal();
      }
    );
  };

  // ================= 页面模板 =================
  const PAGE_TEMPLATES = {
    portfolio: {
      name: '作品集 / 个人主页',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>作品集</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#F6F7FC;color:#22201C;}'
        + '.wrap{max-width:960px;margin:0 auto;padding:64px 32px;}'
        + 'h1{font-size:44px;margin:0 0 12px;} .lead{font-size:17px;color:#6B6255;line-height:1.9;}'
        + '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:40px;}'
        + '.card{background:#fff;border-radius:6px;padding:20px;box-shadow:0 3px 14px rgba(0,0,0,.06);}'
        + '.card h3{margin:0 0 8px;font-size:17px;} .card p{margin:0;color:#7A7264;font-size:13px;line-height:1.8;}'
        + '</style></head><body><div class="wrap">'
        + '<h1>你的名字</h1><p class="lead">一句话介绍你自己：做什么、擅长什么、想做什么。</p>'
        + '<div class="grid"><div class="card"><h3>项目一</h3><p>项目简介与你的角色</p></div>'
        + '<div class="card"><h3>项目二</h3><p>项目简介与你的角色</p></div>'
        + '<div class="card"><h3>项目三</h3><p>项目简介与你的角色</p></div></div>'
        + '</div></body></html>'
    },
    landing: {
      name: '产品落地页',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>产品落地页</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#fff;color:#1F2733;}'
        + '.hero{padding:80px 32px;background:linear-gradient(135deg,#5B7CFA,#8B5CF6);color:#fff;text-align:center;}'
        + '.hero h1{font-size:42px;margin:0 0 14px;} .hero p{font-size:17px;opacity:.92;margin:0 0 28px;}'
        + '.btn{display:inline-block;background:#fff;color:#5B7CFA;padding:14px 32px;border-radius:4px;font-weight:600;text-decoration:none;}'
        + '.feats{display:flex;gap:24px;max-width:1000px;margin:56px auto;padding:0 32px;}'
        + '.feat{flex:1;} .feat h3{margin:0 0 8px;} .feat p{color:#5A6472;line-height:1.8;margin:0;}'
        + '</style></head><body><div class="hero"><h1>产品名称</h1><p>一句话说清它解决什么问题</p>'
        + '<a class="btn" href="#">立即开始</a></div>'
        + '<div class="feats"><div class="feat"><h3>特性一</h3><p>说明这个特性的价值。</p></div>'
        + '<div class="feat"><h3>特性二</h3><p>说明这个特性的价值。</p></div>'
        + '<div class="feat"><h3>特性三</h3><p>说明这个特性的价值。</p></div></div>'
        + '</body></html>'
    },
    deck: {
      name: '演示稿（单页一节）',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>演示稿</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#1D201D;color:#F2EEE6;}'
        + '.slide{height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 8vw;}'
        + '.slide:nth-child(even){background:#242521;}'
        + '.kicker{color:#8B5CF6;letter-spacing:4px;font-size:13px;margin-bottom:14px;}'
        + 'h1{font-size:52px;margin:0 0 18px;font-family:SimSun,serif;} p{font-size:18px;color:#BCB5AA;line-height:1.9;max-width:720px;}'
        + '</style></head><body>'
        + '<section class="slide"><div class="kicker">01 / 开篇</div><h1>演示标题</h1><p>用一两句话说明这一页想表达什么。</p></section>'
        + '<section class="slide"><div class="kicker">02 / 要点</div><h1>关键结论</h1><p>结论先行，再展开细节。</p></section>'
        + '</body></html>'
    },
    doc: {
      name: '文档 / 说明页',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>文档</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#fff;color:#242521;}'
        + '.layout{display:flex;max-width:1100px;margin:0 auto;}'
        + '.side{width:220px;padding:40px 20px;border-right:1px solid #EDE9E1;color:#6B6255;font-size:14px;line-height:2.2;}'
        + '.doc{flex:1;padding:40px 40px 80px;} h1{font-size:32px;margin:0 0 18px;} h2{font-size:20px;margin:32px 0 10px;}'
        + 'p{line-height:1.95;color:#5A6478;} code{background:#F2EEE6;padding:2px 6px;border-radius:3px;font-size:13px;}'
        + '</style></head><body><div class="layout">'
        + '<div class="side">目录<br>第一节<br>第二节<br>第三节</div>'
        + '<div class="doc"><h1>文档标题</h1><p>在这里写正文内容。</p><h2>第一节</h2><p>正文说明，可用 <code>行内代码</code> 标注。</p></div>'
        + '</div></body></html>'
    },
    resume: {
      name: '个人简历',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>个人简历</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#F2F3F5;color:#22262E;}'
        + '.cv{max-width:860px;margin:32px auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.08);}'
        + '.top{padding:36px 40px 24px;border-bottom:3px solid #2B4C7E;}'
        + '.top h1{margin:0 0 6px;font-size:30px;letter-spacing:2px;}'
        + '.top .role{color:#2B4C7E;font-size:15px;margin-bottom:12px;}'
        + '.top .meta{color:#6B7280;font-size:13px;line-height:1.9;}'
        + '.body{padding:28px 40px 40px;} h2{font-size:16px;color:#2B4C7E;margin:26px 0 12px;padding-left:10px;border-left:4px solid #2B4C7E;}'
        + '.item{margin-bottom:16px;} .item .t{font-weight:600;font-size:14px;} .item .d{color:#8A919E;font-size:12px;margin:2px 0 6px;}'
        + '.item p{margin:0;font-size:13.5px;line-height:1.9;color:#5A6478;}'
        + '.tags span{display:inline-block;background:#EEF2F8;color:#2B4C7E;font-size:12px;padding:3px 10px;border-radius:12px;margin:0 6px 6px 0;}'
        + '</style></head><body><div class="cv">'
        + '<div class="top"><h1>你的姓名</h1><div class="role">求职意向 / 职位名称</div>'
        + '<div class="meta">📱 138-0000-0000　✉️ you@example.com　📍 城市　🔗 作品集链接</div></div>'
        + '<div class="body">'
        + '<h2>个人简介</h2><p style="font-size:13.5px;line-height:1.9;color:#5A6478;margin:0">用 2-3 句话说明你的经验年限、擅长领域和最拿得出手的成果。</p>'
        + '<h2>工作经历</h2>'
        + '<div class="item"><div class="t">公司名称 · 职位</div><div class="d">2022.03 – 至今</div><p>负责什么、做了什么、拿到了什么结果（尽量量化）。</p></div>'
        + '<div class="item"><div class="t">上一家公司 · 职位</div><div class="d">2019.07 – 2022.02</div><p>核心职责与代表项目。</p></div>'
        + '<h2>项目经历</h2>'
        + '<div class="item"><div class="t">项目名称</div><div class="d">担任角色</div><p>背景、你的动作、最终结果。</p></div>'
        + '<h2>技能标签</h2><div class="tags"><span>技能一</span><span>技能二</span><span>技能三</span><span>技能四</span></div>'
        + '<h2>教育背景</h2><div class="item"><div class="t">学校 · 专业 · 学历</div><div class="d">2015 – 2019</div></div>'
        + '</div></div></body></html>'
    },
    weekly: {
      name: '周报 / 工作汇报',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>周报</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#F7F7F5;color:#23262B;}'
        + '.wrap{max-width:900px;margin:0 auto;padding:40px 32px 64px;}'
        + 'h1{font-size:26px;margin:0 0 6px;} .sub{color:#8A919E;font-size:13px;margin-bottom:28px;}'
        + '.card{background:#fff;border-radius:8px;padding:22px 24px;margin-bottom:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);}'
        + '.card h2{font-size:15px;margin:0 0 12px;color:#2B4C7E;display:flex;align-items:center;gap:8px;}'
        + '.card h2 .dot{width:8px;height:8px;border-radius:50%;background:#2B4C7E;}'
        + 'ul{margin:0;padding-left:20px;} li{font-size:13.5px;line-height:2;color:#5A6478;}'
        + '.stat{display:flex;gap:14px;margin-bottom:16px;} .stat .s{flex:1;background:#fff;border-radius:8px;padding:16px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05);}'
        + '.stat .n{font-size:24px;font-weight:700;color:#2B4C7E;} .stat .l{font-size:12px;color:#8A919E;margin-top:4px;}'
        + '</style></head><body><div class="wrap">'
        + '<h1>本周工作周报</h1><div class="sub">姓名 · 2026 年第 00 周（00.00 – 00.00）</div>'
        + '<div class="stat"><div class="s"><div class="n">0</div><div class="l">完成任务</div></div>'
        + '<div class="s"><div class="n">0</div><div class="l">进行中</div></div>'
        + '<div class="s"><div class="n">0</div><div class="l">待办事项</div></div></div>'
        + '<div class="card"><h2><span class="dot"></span>本周完成</h2><ul><li>事项一：做了什么，结果如何</li><li>事项二</li><li>事项三</li></ul></div>'
        + '<div class="card"><h2><span class="dot"></span>进行中</h2><ul><li>事项：当前进度 60%，预计下周完成</li></ul></div>'
        + '<div class="card"><h2><span class="dot"></span>问题与风险</h2><ul><li>遇到的问题，需要的支持</li></ul></div>'
        + '<div class="card"><h2><span class="dot"></span>下周计划</h2><ul><li>计划一</li><li>计划二</li></ul></div>'
        + '</div></body></html>'
    },
    pricing: {
      name: '产品定价页',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>产品定价</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#F6F7FB;color:#1F2733;}'
        + '.head{text-align:center;padding:56px 24px 8px;} .head h1{font-size:34px;margin:0 0 10px;} .head p{color:#6B7686;margin:0;}'
        + '.plans{display:flex;gap:20px;max-width:1040px;margin:36px auto 64px;padding:0 24px;align-items:stretch;}'
        + '.plan{flex:1;background:#fff;border:1px solid #E6E9F0;border-radius:10px;padding:26px 22px;display:flex;flex-direction:column;}'
        + '.plan.hot{border:2px solid #2B4C7E;box-shadow:0 8px 28px rgba(43,76,126,.14);position:relative;}'
        + '.plan.hot::after{content:"最受欢迎";position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#2B4C7E;color:#fff;font-size:11px;padding:3px 12px;border-radius:10px;}'
        + '.plan h3{margin:0 0 6px;font-size:17px;} .plan .desc{color:#8A919E;font-size:12px;margin-bottom:16px;}'
        + '.plan .price{font-size:32px;font-weight:700;color:#2B4C7E;} .plan .price span{font-size:13px;color:#8A919E;font-weight:400;}'
        + '.plan ul{list-style:none;margin:18px 0 24px;padding:0;flex:1;} .plan li{font-size:13px;line-height:2.1;color:#5A6478;}'
        + '.plan li::before{content:"✓ ";color:#2B4C7E;}'
        + '.plan a{display:block;text-align:center;padding:11px;border-radius:6px;text-decoration:none;font-size:14px;background:#EEF2F8;color:#2B4C7E;}'
        + '.plan.hot a{background:#2B4C7E;color:#fff;}'
        + '</style></head><body>'
        + '<div class="head"><h1>简单透明的定价</h1><p>按需选择，随时升级或取消</p></div>'
        + '<div class="plans">'
        + '<div class="plan"><h3>基础版</h3><div class="desc">适合个人尝试</div><div class="price">¥0<span> / 月</span></div>'
        + '<ul><li>核心功能</li><li>1 个项目</li><li>社区支持</li></ul><a href="#">开始使用</a></div>'
        + '<div class="plan hot"><h3>专业版</h3><div class="desc">适合小团队</div><div class="price">¥99<span> / 月</span></div>'
        + '<ul><li>全部功能</li><li>无限项目</li><li>优先支持</li><li>团队协作</li></ul><a href="#">立即升级</a></div>'
        + '<div class="plan"><h3>企业版</h3><div class="desc">适合规模化团队</div><div class="price">定制<span></span></div>'
        + '<ul><li>私有部署</li><li>专属客服</li><li>安全审计</li></ul><a href="#">联系我们</a></div>'
        + '</div></body></html>'
    },
    invite: {
      name: '活动邀请函',
      html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>邀请函</title><style>'
        + 'body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#141210;color:#F1E9DC;}'
        + '.card{max-width:680px;margin:0 auto;padding:80px 48px;text-align:center;}'
        + '.kicker{letter-spacing:8px;font-size:12px;color:#8B5CF6;margin-bottom:20px;}'
        + 'h1{font-family:SimSun,serif;font-size:46px;margin:0 0 18px;letter-spacing:6px;}'
        + '.line{width:60px;height:1px;background:#8B5CF6;margin:26px auto;}'
        + 'p{color:#BCB0A0;line-height:2.2;font-size:15px;margin:0 0 8px;}'
        + '.info{margin-top:36px;line-height:2.4;font-size:14px;color:#E8DCC8;}'
        + '.rsvp{display:inline-block;margin-top:36px;border:1px solid #8B5CF6;color:#8B5CF6;padding:12px 34px;letter-spacing:3px;font-size:14px;text-decoration:none;}'
        + '</style></head><body><div class="card">'
        + '<div class="kicker">INVITATION</div><h1>邀请函</h1><div class="line"></div>'
        + '<p>诚邀您出席我们的活动</p><p>与我们一同见证这个特别的时刻</p>'
        + '<div class="info">时间：2026 年 00 月 00 日 00:00<br>地点：城市 · 场地名称<br>着装：商务休闲</div>'
        + '<a class="rsvp" href="#">确认出席</a>'
        + '</div></body></html>'
    }
  };
  function showTemplates() {
    const rows = Object.entries(PAGE_TEMPLATES).map(([k, t]) =>
      '<div class="recent-item" data-tpl="' + k + '"><span>' + t.name + '</span><span>使用</span></div>'
    ).join('');
    showModal('<h3>从模板新建</h3>' + rows
      + '<div class="mnote" style="margin-top:10px">选择后会替换当前画布内容（当前内容已自动保存到本地，可从「历史版本」找回）。</div>'
      + '<div class="actions"><button data-modal="cancel">关闭</button></div>');
    document.querySelectorAll('[data-tpl]').forEach(el => {
      el.onclick = () => {
        const t = PAGE_TEMPLATES[el.dataset.tpl];
        pushHistory('模板前');
        stage.srcdoc = t.html;
        dropHint.style.display = 'none';
        undoStack = []; redoStack = []; refreshUndoButtons();
        $('project-name').textContent = t.name;
        $('doc-tab').textContent = t.name;
        $('project-state').textContent = '新建';
        closeModal();
        setStatus('已从模板创建：' + t.name);
      };
    });
  }

  // ================= 区块库（我的区块） =================
  const LS_BLOCKS = 'htmlCanvas.blocks';
  function renderMyBlocks() {
    const box = $('my-blocks');
    if (!box) return;
    const list = lsGet(LS_BLOCKS, []);
    if (!list.length) { box.innerHTML = '<div class="mnote" style="padding:6px 12px">选中画布元素后点工具栏「🧩 存为区块」</div>'; return; }
    box.innerHTML = '';
    list.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'shape-item';
      row.innerHTML = '<span class="pico"><svg viewBox="0 0 24 16"><rect x="2" y="2.5" width="8" height="8" rx="2" fill="#9B8CFF"/><rect x="12" y="2.5" width="10" height="3.4" rx="1.7" fill="#C7B7FF"/><rect x="12" y="7.6" width="7" height="3.4" rx="1.7" fill="#DCD6FF"/><rect x="2" y="12" width="20" height="2" rx="1" fill="#E4E0FF"/></svg></span>' + b.name;
      row.title = '点击插入到画布';
      row.onclick = e => {
        e.stopPropagation();
        $('shape-palette').classList.remove('open');
        insertSavedBlock(b, i);
      };
      const del = document.createElement('span');
      del.className = 'lbtn';
      del.textContent = '✕';
      del.title = '删除该区块';
      del.onclick = e => {
        e.stopPropagation();
        const arr = lsGet(LS_BLOCKS, []);
        arr.splice(i, 1);
        lsSet(LS_BLOCKS, arr);
        renderMyBlocks();
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function insertSavedBlock(b, idx) {
    const d = doc();
    if (!d || !d.body) { setStatus('请先打开或新建一个页面'); return; }
    const w = win();
    snapshot();
    const box = d.createElement('div');
    box.innerHTML = b.html;
    const inner = box.firstElementChild;
    if (!inner) return;
    inner.style.position = inner.style.position || 'absolute';
    inner.style.left = Math.round(w.scrollX + w.innerWidth / 2 - (b.w || 300) / 2) + 'px';
    inner.style.top = Math.round(w.scrollY + 80) + 'px';
    inner.style.zIndex = String(maxZ() + 1);
    d.body.appendChild(inner);
    setTool('select');
    selectElement(inner);
    setDirty();
    setStatus('已插入区块：' + b.name);
  }
  $('btn-save-block').onclick = () => {
    if (!selOrWarn(1)) return;
    const el = selected;
    const vb = visualBox(el);
    showModal(
      '<h3>存为区块</h3>'
      + '<div class="frow"><label>名称</label><input type="text" id="m-blockname" value="' + (el.dataset.edName || labelFor(el)) + '"></div>'
      + '<div class="mnote">区块会保存在本机浏览器，之后可从「形状 ▾」面板底部反复插入。当前会保存：' + Math.round(vb.w) + ' × ' + Math.round(vb.h) + ' 的元素。</div>'
      + '<div class="actions"><button data-modal="cancel">取消</button><button class="primary" data-modal="ok">保存</button></div>',
      () => {
        const name = $('m-blockname').value.trim() || '区块';
        const arr = lsGet(LS_BLOCKS, []);
        arr.unshift({ name, w: Math.round(vb.w), h: Math.round(vb.h), html: el.outerHTML });
        lsSet(LS_BLOCKS, arr.slice(0, 30));
        renderMyBlocks();
        closeModal();
        setStatus('已存为区块：' + name);
      }
    );
  };
  renderMyBlocks();

  // ================= 代码视图 =================
  let codeMode = 'html';
  function gatherCss() {
    const d = doc();
    if (!d) return '';
    return Array.from(d.querySelectorAll('style'))
      .filter(s => !(s.id || '').startsWith('__ed'))
      .map((s, i) => '/* --- style ' + (i + 1) + ' --- */\n' + s.textContent.trim())
      .join('\n\n');
  }
  function loadCode() {
    const d = doc();
    if (!d || !d.body) { $('code-area').value = ''; return; }
    $('code-area').value = codeMode === 'html' ? serializeKeep() : gatherCss();
    checkCodeSyntax();
  }
  function checkCodeSyntax() {
    const txt = $('code-area').value;
    const st = $('code-status');
    if (codeMode === 'css') {
      const open = (txt.match(/\{/g) || []).length, close = (txt.match(/\}/g) || []).length;
      if (open === close) { st.textContent = 'CSS 检查：花括号配对正常（' + open + ' 组规则）'; st.className = 'ok'; }
      else { st.textContent = 'CSS 检查：花括号不匹配（{ ' + open + ' 个 / } ' + close + ' 个）'; st.className = 'bad'; }
      return;
    }
    const VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
    const stack = [];
    const bad = [];
    const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
    let m;
    while ((m = re.exec(txt))) {
      const tag = m[1].toLowerCase();
      const isClose = m[0][1] === '/';
      const selfClose = m[2] === '/' || VOID.includes(tag);
      if (isClose) {
        if (stack.length && stack[stack.length - 1] === tag) stack.pop();
        else bad.push('多余的 </' + tag + '>');
      } else if (!selfClose) stack.push(tag);
    }
    if (!stack.length && !bad.length) { st.textContent = 'HTML 检查：标签全部闭合，结构正常'; st.className = 'ok'; }
    else {
      st.textContent = 'HTML 检查：' + (stack.length ? '未闭合 ' + stack.slice(-6).map(t => '<' + t + '>').join(' ') : '')
        + (bad.length ? '；' + bad.slice(0, 4).join('；') : '');
      st.className = 'bad';
    }
  }
  $('code-html').onclick = () => { codeMode = 'html'; $('code-html').classList.add('checked'); $('code-css').classList.remove('checked'); loadCode(); };
  $('code-css').onclick = () => { codeMode = 'css'; $('code-css').classList.add('checked'); $('code-html').classList.remove('checked'); loadCode(); };
  $('code-refresh').onclick = () => { loadCode(); setStatus('已重新读取源码'); };
  $('code-area').addEventListener('input', checkCodeSyntax);
  $('code-apply').onclick = () => {
    const d = doc();
    if (!d || !d.body) { setStatus('请先打开或新建一个页面'); return; }
    const txt = $('code-area').value;
    pushHistory('代码编辑前');
    if (codeMode === 'html') {
      stage.srcdoc = txt;
      setStatus('HTML 源码已应用');
    } else {
      const styles = Array.from(d.querySelectorAll('style')).filter(s => !(s.id || '').startsWith('__ed'));
      const parts = txt.split(/\/\* --- style \d+ --- \*\//).map(s => s.trim()).filter(Boolean);
      if (!styles.length) {
        const st = d.createElement('style');
        st.textContent = txt;
        (d.head || d.documentElement).appendChild(st);
      } else {
        styles.forEach((s, i) => { if (parts[i] !== undefined) s.textContent = parts[i]; });
      }
      checkOverflow(true);
      setStatus('CSS 已应用');
    }
    setDirty();
  };
  $('code-find-el').onclick = () => {
    if (!selected) { setStatus('请先选中一个元素'); return; }
    if (codeMode !== 'html') { codeMode = 'html'; $('code-html').classList.add('checked'); $('code-css').classList.remove('checked'); }
    loadCode();
    const outer = selected.outerHTML;
    let idx = $('code-area').value.indexOf(outer);
    if (idx < 0) {
      const head = outer.slice(0, 60);
      idx = $('code-area').value.indexOf(head);
    }
    if (idx < 0) { setStatus('源码中没有找到该元素（可能被脚本动态生成）'); return; }
    const area = $('code-area');
    area.focus();
    area.setSelectionRange(idx, idx + outer.length);
    const line = area.value.slice(0, idx).split('\n').length;
    $('code-status').textContent = '已定位到第 ' + line + ' 行';
    $('code-status').className = 'ok';
  };

  // ================= 资源打包与路径检查 =================
  function showAssets() {
    const d = doc();
    if (!d || !d.body) { setStatus('请先打开或新建一个页面'); return; }
    const imgs = Array.from(d.body.querySelectorAll('img'));
    const remote = imgs.filter(im => /^https?:/i.test(im.getAttribute('src') || ''));
    const local = imgs.filter(im => {
      const s = im.getAttribute('src') || '';
      return s && !/^(https?:|data:)/i.test(s);
    });
    const bad = imgs.filter(im => !im.complete || im.naturalWidth === 0);
    const bgRemote = Array.from(d.body.querySelectorAll('*')).filter(el => /url\(["']?https?:/i.test(el.style.backgroundImage || '')).length;
    const lines = [
      '<div class="mnote">共 ' + imgs.length + ' 张图片：外链 ' + remote.length + ' 张、相对/本地路径 ' + local.length + ' 张、加载失败 ' + bad.length + ' 张'
        + (bgRemote ? '；另有 ' + bgRemote + ' 个外链背景图' : '') + '。</div>'
    ];
    if (local.length) lines.push('<div class="check-bad" style="font-size:12px;padding:6px 0">⚠ 相对路径图片在导出后需要与图片一起移动，否则会失效；建议改为「上传本地图片」内嵌。</div>');
    if (remote.length || bgRemote) lines.push('<div class="check-bad" style="font-size:12px;padding:6px 0">⚠ 外链图片依赖对方服务器，可能被删或限流；可点下方按钮尝试抓取并内嵌为 base64（需对方允许跨域）。</div>');
    if (bad.length) lines.push('<div class="check-bad" style="font-size:12px;padding:6px 0">⚠ ' + bad.length + ' 张图片当前加载失败。</div>');
    if (!local.length && !remote.length && !bad.length) lines.push('<div class="check-ok" style="font-size:12px;padding:6px 0">✓ 图片资源都是内嵌的，单文件即可带走。</div>');
    showModal('<h3>资源打包与路径检查</h3>' + lines.join('')
      + '<div class="actions"><button data-modal="cancel">关闭</button>'
      + '<button id="m-inline" class="primary">抓取外链图片并内嵌</button></div>');
    $('m-inline').onclick = () => inlineRemoteImages();
  }
  async function inlineRemoteImages() {
    const d = doc();
    if (!d || !d.body) return;
    const imgs = Array.from(d.body.querySelectorAll('img')).filter(im => /^https?:/i.test(im.getAttribute('src') || ''));
    if (!imgs.length) { setStatus('没有需要内嵌的外链图片'); closeModal(); return; }
    snapshot();
    let ok = 0, fail = 0;
    for (const im of imgs) {
      const url = im.getAttribute('src');
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        im.src = dataUrl;
        ok++;
      } catch (e) {
        fail++;
      }
    }
    setDirty();
    closeModal();
    setStatus('外链图片内嵌完成：成功 ' + ok + ' 张' + (fail ? '，失败 ' + fail + ' 张（对方不允许跨域，请手动下载后替换）' : ''));
  }

  // ================= 音视频 / 嵌入 =================
  function showMediaInsert(kind) {
    const label = { video: '视频', audio: '音频', iframe: '嵌入网页' }[kind];
    const dw = kind === 'audio' ? 360 : kind === 'iframe' ? 560 : 640;
    const dh = kind === 'audio' ? 54 : kind === 'iframe' ? 315 : 360;
    showModal(
      '<h3>插入' + label + '</h3>'
      + '<div class="frow"><label>地址</label><input type="text" id="m-msrc" placeholder="' + (kind === 'iframe' ? 'https://…（允许被嵌入的网页地址）' : 'https://… .mp4 / .mp3') + '"></div>'
      + '<div class="frow"><label>尺寸</label>'
      + '<input type="text" id="m-mw" value="' + dw + '" style="max-width:90px"><span style="color:#98A2B3">×</span>'
      + '<input type="text" id="m-mh" value="' + dh + '" style="max-width:90px"></div>'
      + (kind === 'iframe' ? '<div class="mnote">注意：很多网站（如 B 站、YouTube）会禁止被嵌入，若空白请改用官方分享的嵌入代码地址。</div>' : '')
      + '<div class="actions"><button data-modal="cancel">取消</button>'
      + (kind === 'iframe' ? '' : '<button id="m-mfile">选本地文件</button>')
      + '<button id="m-mok" class="primary">插入</button></div>'
    );
    const sizeOf = () => ({
      w: parseInt($('m-mw').value) || dw,
      h: parseInt($('m-mh').value) || dh
    });
    const place = src => {
      const d = doc(), w = win();
      if (!d || !d.body) { setStatus('请先打开或新建一个页面'); return; }
      const s = sizeOf();
      snapshot();
      let el;
      if (kind === 'iframe') {
        el = d.createElement('iframe');
        el.src = src;
        el.setAttribute('allowfullscreen', 'true');
        el.style.cssText = 'border:1px solid #DCE2F0;background:#fff;';
      } else {
        el = d.createElement(kind);
        el.src = src;
        el.controls = true;
        el.style.cssText = 'background:#000;';
        if (kind === 'audio') el.style.background = 'transparent';
      }
      el.style.position = 'absolute';
      el.style.left = Math.round(w.scrollX + w.innerWidth / 2 - s.w / 2) + 'px';
      el.style.top = Math.round(w.scrollY + 100) + 'px';
      el.style.width = s.w + 'px';
      el.style.height = s.h + 'px';
      el.style.zIndex = String(maxZ() + 1);
      d.body.appendChild(el);
      setTool('select');
      selectElement(el);
      setDirty();
      setStatus('已插入' + label + '：可拖动、拉角缩放');
      closeModal();
    };
    $('m-mok').onclick = () => {
      const src = $('m-msrc').value.trim();
      if (!src) { setStatus('请填写地址，或点「选本地文件」'); return; }
      place(src);
    };
    const fbtn = $('m-mfile');
    if (fbtn) fbtn.onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = kind === 'video' ? 'video/*' : 'audio/*';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => place(r.result);
        r.readAsDataURL(f);
      };
      inp.click();
    };
  }

  function mediaOf(el) {
    return el && ['VIDEO', 'AUDIO', 'IFRAME'].includes(el.tagName) ? el : null;
  }
  function syncMediaPanel() {
    const m = mediaOf(selected);
    $('sec-media').style.display = m ? 'block' : 'none';
    if (!m) return;
    $('media-src').value = m.getAttribute('src') || '';
    $('media-controls').checked = m.tagName === 'IFRAME' ? false : m.controls !== false;
    $('media-autoplay').checked = !!m.autoplay;
    $('media-loop').checked = !!m.loop;
    $('media-muted').checked = !!m.muted;
    $('row-poster').style.display = m.tagName === 'VIDEO' ? 'flex' : 'none';
    $('media-poster').value = m.getAttribute('poster') || '';
    $('media-controls').parentElement.style.display = m.tagName === 'IFRAME' ? 'none' : 'flex';
  }
  $('media-apply').onclick = () => {
    const m = mediaOf(selected);
    if (!m) return;
    snapshot();
    captureOriginal(m);
    const src = $('media-src').value.trim();
    if (src) m.setAttribute('src', src);
    if (m.tagName !== 'IFRAME') {
      m.controls = $('media-controls').checked;
      m.autoplay = $('media-autoplay').checked;
      m.loop = $('media-loop').checked;
      m.muted = $('media-muted').checked;
      if (m.tagName === 'VIDEO') {
        const p = $('media-poster').value.trim();
        if (p) m.setAttribute('poster', p); else m.removeAttribute('poster');
      }
    }
    setDirty();
    setStatus('媒体属性已更新');
  };
  $('media-file').onclick = () => {
    const m = mediaOf(selected);
    if (!m || m.tagName === 'IFRAME') { setStatus('请先选中一个视频或音频元素'); return; }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = m.tagName === 'VIDEO' ? 'video/*' : 'audio/*';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        snapshot();
        captureOriginal(m);
        m.setAttribute('src', r.result);
        syncMediaPanel();
        setDirty();
        setStatus('已替换为本地文件（base64 内嵌，约 ' + Math.round(f.size / 1024) + ' KB）');
      };
      r.readAsDataURL(f);
    };
    inp.click();
  };

  // ================= 表格编辑 =================
  function tableOf(el) {
    let n = el;
    while (n && n.tagName !== 'TABLE') n = n.parentElement;
    return n;
  }
  function cellOf(el) {
    let n = el;
    while (n && !['TD', 'TH'].includes(n.tagName)) n = n.parentElement;
    return n;
  }
  function tableInfo() {
    const t = tableOf(selected);
    if (!t) return null;
    const rows = Array.from(t.rows);
    const cell = cellOf(selected);
    const row = cell ? cell.parentNode : null;
    return {
      table: t,
      rows,
      rowIndex: row ? rows.indexOf(row) : -1,
      colIndex: row && cell ? Array.from(row.cells).indexOf(cell) : -1,
      cols: rows.length ? Math.max(...rows.map(r => r.cells.length)) : 0
    };
  }
  function syncTablePanel() {
    const info = selected ? tableInfo() : null;
    $('sec-table').style.display = info ? 'block' : 'none';
    if (!info) return;
    $('tb-info').textContent = '共 ' + info.rows.length + ' 行 × ' + info.cols + ' 列'
      + (info.rowIndex >= 0 ? '　当前：第 ' + (info.rowIndex + 1) + ' 行 第 ' + (info.colIndex + 1) + ' 列' : '');
  }
  function afterTableEdit() { updateOverlay(); syncTablePanel(); setDirty(); }
  $('tb-row-above').onclick = () => tableAddRow(-1);
  $('tb-row-below').onclick = () => tableAddRow(1);
  $('tb-row-del').onclick = () => {
    const info = tableInfo();
    if (!info || info.rowIndex < 0) { setStatus('请先单击表格里的一个单元格'); return; }
    if (info.rows.length <= 1) { setStatus('至少要保留一行'); return; }
    snapshot();
    info.rows[info.rowIndex].remove();
    afterTableEdit();
    setStatus('已删除一行');
  };
  function tableAddRow(dir) {
    const info = tableInfo();
    if (!info || info.rowIndex < 0) { setStatus('请先单击表格里的一个单元格'); return; }
    snapshot();
    const src = info.rows[info.rowIndex];
    const tr = doc().createElement('tr');
    Array.from(src.cells).forEach(c => {
      const td = doc().createElement(c.tagName === 'TH' ? 'td' : c.tagName);
      td.innerHTML = c.tagName === 'TH' ? '内容' : '内容';
      td.setAttribute('style', c.getAttribute('style') || '');
      tr.appendChild(td);
    });
    if (dir < 0) src.parentNode.insertBefore(tr, src);
    else src.parentNode.insertBefore(tr, src.nextSibling);
    afterTableEdit();
    setStatus('已插入一行');
  }
  $('tb-col-left').onclick = () => tableAddCol(-1);
  $('tb-col-right').onclick = () => tableAddCol(1);
  $('tb-col-del').onclick = () => {
    const info = tableInfo();
    if (!info || info.colIndex < 0) { setStatus('请先单击表格里的一个单元格'); return; }
    if (info.cols <= 1) { setStatus('至少要保留一列'); return; }
    snapshot();
    info.rows.forEach(r => { if (r.cells[info.colIndex]) r.cells[info.colIndex].remove(); });
    afterTableEdit();
    setStatus('已删除一列');
  };
  function tableAddCol(dir) {
    const info = tableInfo();
    if (!info || info.colIndex < 0) { setStatus('请先单击表格里的一个单元格'); return; }
    snapshot();
    info.rows.forEach(r => {
      const ref = r.cells[info.colIndex];
      if (!ref) return;
      const td = doc().createElement(ref.tagName === 'TH' ? 'th' : 'td');
      td.textContent = '内容';
      td.setAttribute('style', ref.getAttribute('style') || '');
      if (dir < 0) ref.parentNode.insertBefore(td, ref);
      else ref.parentNode.insertBefore(td, ref.nextSibling);
    });
    afterTableEdit();
    setStatus('已插入一列');
  }
  $('tb-merge-right').onclick = () => {
    const c = cellOf(selected);
    if (!c) { setStatus('请先单击一个单元格'); return; }
    const next = c.nextElementSibling;
    if (!next) { setStatus('右边没有可合并的单元格'); return; }
    snapshot();
    c.colSpan = (c.colSpan || 1) + (next.colSpan || 1);
    c.innerHTML += ' ' + next.innerHTML;
    next.remove();
    afterTableEdit();
    setStatus('已合并右侧单元格');
  };
  $('tb-merge-down').onclick = () => {
    const info = tableInfo();
    if (!info || info.rowIndex < 0) { setStatus('请先单击一个单元格'); return; }
    const c = cellOf(selected);
    const below = info.rows[info.rowIndex + 1];
    if (!below || !below.cells[info.colIndex]) { setStatus('下方没有可合并的单元格'); return; }
    snapshot();
    const t = below.cells[info.colIndex];
    c.rowSpan = (c.rowSpan || 1) + (t.rowSpan || 1);
    c.innerHTML += ' ' + t.innerHTML;
    t.remove();
    afterTableEdit();
    setStatus('已合并下方单元格');
  };
  $('tb-split').onclick = () => {
    const c = cellOf(selected);
    if (!c) { setStatus('请先单击一个单元格'); return; }
    if ((c.colSpan || 1) === 1 && (c.rowSpan || 1) === 1) { setStatus('该单元格没有合并'); return; }
    snapshot();
    const rs = c.rowSpan || 1, cs = c.colSpan || 1;
    c.rowSpan = 1; c.colSpan = 1;
    const tr = c.parentNode;
    for (let i = 1; i < cs; i++) {
      const td = doc().createElement(c.tagName.toLowerCase());
      td.textContent = '内容';
      td.setAttribute('style', c.getAttribute('style') || '');
      tr.insertBefore(td, c.nextSibling);
    }
    let row = tr.nextElementSibling;
    for (let r = 1; r < rs && row; r++) {
      for (let i = 0; i < cs; i++) {
        const td = doc().createElement('td');
        td.textContent = '内容';
        td.setAttribute('style', c.getAttribute('style') || '');
        row.appendChild(td);
      }
      row = row.nextElementSibling;
    }
    afterTableEdit();
    setStatus('已拆分单元格');
  };
  $('tb-header').onclick = () => {
    const info = tableInfo();
    if (!info || !info.rows.length) { setStatus('请先单击表格里的一个单元格'); return; }
    snapshot();
    const first = info.rows[0];
    const makeHeader = first.cells[0] && first.cells[0].tagName !== 'TH';
    Array.from(first.cells).forEach(c => {
      const nt = doc().createElement(makeHeader ? 'th' : 'td');
      nt.innerHTML = c.innerHTML;
      nt.setAttribute('style', c.getAttribute('style') || '');
      if (makeHeader) nt.style.background = nt.style.background || '#F1F4FB';
      c.replaceWith(nt);
    });
    afterTableEdit();
    setStatus(makeHeader ? '首行已设为表头' : '首行已转为普通行');
  };
  $('tb-border').onclick = () => {
    const t = tableOf(selected);
    if (!t) { setStatus('请先单击表格里的一个单元格'); return; }
    snapshot();
    captureOriginal(t);
    t.style.borderCollapse = 'collapse';
    t.querySelectorAll('td,th').forEach(c => {
      c.style.border = '1px solid #DCE2F0';
      c.style.padding = c.style.padding || '8px';
    });
    setDirty();
    setStatus('已统一表格边框');
  };

  // ================= 布局与分栏 =================
  function syncFlexPanel() {
    const el = selected;
    const isBox = el && el.children.length > 0;
    $('sec-flex').style.display = isBox ? 'block' : 'none';
    if (!isBox) return;
    const cs = win().getComputedStyle(el);
    $('fx-display').value = ['flex', 'grid', 'block'].includes(cs.display) ? cs.display : '';
    $('fx-wrap').checked = cs.flexWrap === 'wrap';
    $('fx-justify').value = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'].includes(cs.justifyContent) ? cs.justifyContent : '';
    $('fx-align').value = ['flex-start', 'center', 'flex-end', 'stretch'].includes(cs.alignItems) ? cs.alignItems : '';
    $('fx-gap').value = parseFloat(cs.gap) ? Math.round(parseFloat(cs.gap)) : '';
    let cols = '';
    if (cs.display === 'grid' && cs.gridTemplateColumns) cols = cs.gridTemplateColumns.split(' ').length;
    else if (el.children.length && cs.display === 'flex') cols = el.children.length;
    $('fx-cols').value = cols || '';
  }
  $('fx-apply').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    captureOriginal(selected);
    const st = selected.style;
    const disp = $('fx-display').value;
    if (disp) st.display = disp;
    if ($('fx-gap').value !== '') st.gap = $('fx-gap').value + 'px';
    if (disp === 'block') { st.flexWrap = ''; }
    else {
      st.flexWrap = $('fx-wrap').checked ? 'wrap' : 'nowrap';
      if ($('fx-justify').value) st.justifyContent = $('fx-justify').value;
      if ($('fx-align').value) st.alignItems = $('fx-align').value;
      const cols = parseInt($('fx-cols').value);
      if (cols > 0) applyColumns(selected, cols, disp === 'grid');
    }
    updateOverlay(); fillPanel(); setDirty();
    setStatus('布局已应用' + (disp === 'grid' ? '（网格）' : disp === 'flex' ? '（弹性分栏）' : ''));
  };
  function applyColumns(container, cols, grid) {
    if (grid) {
      container.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    } else {
      container.style.display = 'flex';
      const kids = Array.from(container.children);
      const gap = parseFloat(container.style.gap) || 0;
      kids.forEach(k => {
        k.style.flex = '1 1 calc(' + (100 / cols) + '% - ' + gap + 'px)';
        k.style.minWidth = '0';
      });
    }
  }
  $('fx-equal').onclick = () => {
    if (!selOrWarn(1)) return;
    snapshot();
    captureOriginal(selected);
    const n = selected.children.length || 1;
    if (win().getComputedStyle(selected).display === 'grid') applyColumns(selected, n, true);
    else applyColumns(selected, n, false);
    setDirty();
    setStatus('已让 ' + n + ' 个子项等宽平分');
  };

  // ================= 多页面项目管理 =================
  const LS_PROJECT = 'htmlCanvas.project';
  let project = { name: '未命名项目', pages: [], activeId: null };
  let pageSeq = 0;
  const newPageId = () => 'p' + (++pageSeq) + '_' + Date.now().toString(36);

  function currentPage() {
    return project.pages.find(p => p.id === project.activeId) || null;
  }
  function syncCurrentPage() {
    const d = doc();
    const p = currentPage();
    if (!p || !d || !d.body) return;
    if (!$('project-state').textContent.includes('未打开')) {
      const html = serializeKeep();
      if (html) p.html = html;
    }
  }
  function saveProject(quiet) {
    syncCurrentPage();
    lsSet(LS_PROJECT, { name: project.name, pages: project.pages, activeId: project.activeId });
    if (!quiet) setStatus('项目已保存到本地（' + project.pages.length + ' 个页面）');
  }
  function renderTabs() {
    const box = $('page-tabs');
    if (!box) return;
    box.innerHTML = '';
    project.pages.forEach(p => {
      const t = document.createElement('div');
      t.className = 'ptab-page' + (p.id === project.activeId ? ' active' : '');
      t.textContent = p.name;
      t.title = '单击切换 · 双击重命名 · 右键删除';
      t.onclick = () => { if (p.id !== project.activeId) openPage(p.id); };
      t.ondblclick = e => {
        e.stopPropagation();
        const v = prompt('页面名称', p.name);
        if (v !== null) { p.name = v.trim() || p.name; renderTabs(); saveProject(true); if (p.id === project.activeId) $('doc-tab').textContent = project.name; }
      };
      t.oncontextmenu = e => {
        e.preventDefault();
        if (project.pages.length <= 1) { setStatus('至少保留一个页面'); return; }
        if (confirm('删除页面「' + p.name + '」？')) {
          project.pages = project.pages.filter(x => x.id !== p.id);
          if (project.activeId === p.id) {
            project.activeId = project.pages[0].id;
            loadActivePage();
          }
          renderTabs(); saveProject(true);
          setStatus('已删除页面：' + p.name);
        }
      };
      box.appendChild(t);
    });
    $('doc-tab').textContent = project.name;
  }
  function loadActivePage() {
    const p = currentPage();
    if (!p) return;
    stage.srcdoc = p.html;
    dropHint.style.display = 'none';
    undoStack = []; redoStack = []; refreshUndoButtons();
    $('project-state').textContent = '已打开';
    renderTabs();
    setStatus('已切换到页面：' + p.name);
  }
  function openPage(id) {
    syncCurrentPage();
    project.activeId = id;
    loadActivePage();
    saveProject(true);
  }
  function addPage(name, html, silent) {
    syncCurrentPage();
    const p = { id: newPageId(), name: name || ('页面 ' + (project.pages.length + 1)), html: html || BLANK_PAGE };
    project.pages.push(p);
    project.activeId = p.id;
    loadActivePage();
    saveProject(true);
    if (!silent) setStatus('已新建页面：' + p.name);
    return p;
  }
  $('page-add').onclick = () => addPage();
  function showPages() {
    const rows = project.pages.map((p, i) =>
      '<div class="recent-item" data-pid="' + p.id + '"><span>' + (i + 1) + '. ' + p.name + (p.id === project.activeId ? '（当前）' : '') + '</span>'
      + '<span><button data-pact="open" data-pid="' + p.id + '">打开</button> '
      + '<button data-pact="rename" data-pid="' + p.id + '">改名</button> '
      + '<button data-pact="dup" data-pid="' + p.id + '">复制</button> '
      + '<button data-pact="del" data-pid="' + p.id + '">删除</button></span></div>'
    ).join('');
    showModal(
      '<h3>页面管理</h3>'
      + '<div class="mnote">当前项目：' + project.name + '　共 ' + project.pages.length + ' 个页面（保存在本机浏览器）</div>'
      + '<div style="margin:10px 0">' + rows + '</div>'
      + '<div class="actions"><button id="m-page-add">＋ 新建页面</button><button data-modal="cancel">关闭</button></div>'
    );
    document.querySelectorAll('[data-pact]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = btn.dataset.pid;
        const p = project.pages.find(x => x.id === id);
        if (!p) return;
        const act = btn.dataset.pact;
        if (act === 'open') { openPage(id); closeModal(); }
        if (act === 'rename') { const v = prompt('页面名称', p.name); if (v !== null) { p.name = v.trim() || p.name; renderTabs(); saveProject(true); closeModal(); showPages(); } }
        if (act === 'dup') {
          syncCurrentPage();
          const copy = { id: newPageId(), name: p.name + ' 副本', html: p.html };
          project.pages.splice(project.pages.indexOf(p) + 1, 0, copy);
          project.activeId = copy.id;
          loadActivePage(); saveProject(true);
          closeModal(); setStatus('已复制页面：' + copy.name);
        }
        if (act === 'del') {
          if (project.pages.length <= 1) { alert('至少保留一个页面'); return; }
          if (!confirm('删除页面「' + p.name + '」？')) return;
          project.pages = project.pages.filter(x => x.id !== p.id);
          if (project.activeId === id) { project.activeId = project.pages[0].id; loadActivePage(); }
          saveProject(true); closeModal(); showPages();
          setStatus('已删除页面：' + p.name);
        }
      };
    });
    $('m-page-add').onclick = () => { addPage(); closeModal(); showPages(); };
  }
  function exportAllPages() {
    syncCurrentPage();
    if (!project.pages.length) { setStatus('没有可导出的页面'); return; }
    const list = project.pages.map(p => ({ name: p.name.replace(/[\\/:*?"<>|]/g, '_'), html: p.html }));
    const index = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + project.name + '</title>'
      + '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:48px;background:#F6F7FC;color:#242521;}'
      + 'h1{font-size:26px;} a{display:block;padding:14px 18px;margin-bottom:10px;background:#fff;border-radius:8px;'
      + 'text-decoration:none;color:#5B7CFA;box-shadow:0 2px 10px rgba(0,0,0,.06);max-width:520px;}</style></head><body>'
      + '<h1>' + project.name + '</h1>'
      + list.map(l => '<a href="' + l.name + '.html">' + l.name + '</a>').join('')
      + '</body></html>';
    const files = list.map(l => ({ name: l.name + '.html', html: l.html }));
    files.push({ name: 'index.html', html: index });
    setStatus('正在导出 ' + files.length + ' 个文件…若浏览器询问「允许多个下载」请选择允许');
    files.forEach((f, i) => {
      setTimeout(() => {
        const blob = new Blob([f.html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = f.name;
        a.click();
        URL.revokeObjectURL(a.href);
        if (i === files.length - 1) setStatus('✅ 已导出 ' + files.length + ' 个文件（含 index.html 导航页）');
      }, i * 350);
    });
    pushHistory('导出全部');
  }
  // 启动时恢复项目
  (function restoreProject() {
    const saved = lsGet(LS_PROJECT, null);
    if (saved && saved.pages && saved.pages.length) {
      project = saved;
      saved.pages.forEach((p, i) => { const n = parseInt((p.id.match(/^p(\d+)/) || [])[1]); if (n > pageSeq) pageSeq = n; });
      const active = currentPage() || project.pages[0];
      project.activeId = active.id;
      stage.srcdoc = active.html;
      dropHint.style.display = 'none';
      setTimeout(() => {
        renderTabs();
        $('project-state').textContent = '已恢复';
        $('restore-bar').classList.remove('open');
        setStatus('已恢复项目「' + project.name + '」，共 ' + project.pages.length + ' 个页面');
      }, 0);
    } else {
      project.pages = [{ id: newPageId(), name: '首页', html: BLANK_PAGE }];
      project.activeId = project.pages[0].id;
      renderTabs();
    }
  })();

  // ================= 文件/编辑快捷键 =================
  window.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); if (e.shiftKey) showSaveAs(); else saveLocal(); return; }
    if (k === 'n') { e.preventDefault(); if (confirmUnsaved()) newPage(BLANK_PAGE, '未命名项目'); return; }
    if (k === 'e' && e.shiftKey) { e.preventDefault(); if (runExportCheck()) downloadHTML(); return; }
    if (k === 'x') { e.preventDefault(); copySelection(true); return; }
    if (k === 'c') { e.preventDefault(); copySelection(false); return; }
    if (k === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (k === 'h') { e.preventDefault(); showHistory(); return; }
  });

  // ================= 序列化 / 导出 / 预览 =================
  function serializeKeep() {
    const d = doc();
    if (!d || !d.documentElement) return null;
    const clone = d.documentElement.cloneNode(true);
    clone.querySelectorAll('#__ed_style, #__ed_overlay, .__ed_ghost, .__ed_guide, .__ed_marquee, .__ed_ctx, .__ed_anchor').forEach(g => g.remove());
    clone.querySelectorAll('[class]').forEach(el => {
      el.classList.remove('__ed_hover', '__ed_editing', '__ed_drawing', '__ed_overflow', '__ed_flash');
      if (el.className === '') el.removeAttribute('class');
    });
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('[data-ed-orig]').forEach(el => el.removeAttribute('data-ed-orig'));
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }
  function serialize() {
    const d = doc();
    if (!d || !d.documentElement) return null;
    stopEditing();
    deselect();

    const edStyle = d.getElementById('__ed_style');
    if (edStyle) edStyle.remove();
    const ov = d.getElementById('__ed_overlay');
    if (ov) ov.remove();
    // 清掉编辑期临时图形（多选提示框、吸附参考线、框选橡皮筋）
    d.querySelectorAll('.__ed_ghost, .__ed_guide, .__ed_marquee, .__ed_ctx, .__ed_anchor').forEach(g => g.remove());
    d.querySelectorAll('[class]').forEach(el => {
      el.classList.remove('__ed_hover', '__ed_editing', '__ed_drawing', '__ed_overflow', '__ed_flash');
      if (el.className === '') el.removeAttribute('class');
    });
    // 移除编辑器内部记录（原始状态快照、锁定标记）
    d.querySelectorAll('[data-ed-orig]').forEach(el => el.removeAttribute('data-ed-orig'));
    d.querySelectorAll('[data-ed-locked]').forEach(el => el.removeAttribute('data-ed-locked'));
    // 隐藏标记是编辑期的，不导出
    d.querySelectorAll('.__ed_hidden').forEach(el => el.classList.remove('__ed_hidden'));
    // 保留分端显示与悬停样式表，但去掉编辑器风格的 id
    ['__ed_responsive', '__ed_hover'].forEach(id => {
      const st = d.getElementById(id);
      if (st) st.removeAttribute('id');
    });
    d.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

    return '<!DOCTYPE html>\n' + d.documentElement.outerHTML;
  }
  function reloadClean(html) {
    const backup = undoStack.slice();
    stage.addEventListener('load', function restore() {
      stage.removeEventListener('load', restore);
      undoStack = backup;
      refreshUndoButtons();
    });
    stage.srcdoc = html;
  }
  function downloadHTML() {
    const html = serialize();
    if (!html) { setStatus('还没有加载文件'); return; }
    reloadClean(html);
    const name = ($('project-name').textContent || 'page').replace(/\.html?$/i, '') || 'page';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '-edited.html';
    a.click();
    URL.revokeObjectURL(a.href);
    $('project-state').textContent = '已导出';
    rememberRecent(name + '-edited.html', html);
    pushHistory('导出');
    setStatus('✅ 已导出：' + a.download + '（已记录到「最近文件」与「历史版本」）');
  }
  $('btn-export').onclick = () => { if (runExportCheck()) downloadHTML(); };
  $('btn-preview').onclick = () => {
    const html = serialize();
    if (!html) { setStatus('还没有加载文件'); return; }
    reloadClean(html);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    window.open(URL.createObjectURL(blob), '_blank');
    setStatus('已在新标签页打开预览');
  };

  // ================= 浏览器插件模式（?mode=ext） =================
  const EXT_MODE = /[?&]mode=ext\b/.test(location.search);
  if (EXT_MODE) {
    // 头部加「退出编辑」，通知宿主页面撤掉遮罩
    const exitBtn = document.createElement('button');
    exitBtn.id = 'btn-exit-ext';
    exitBtn.textContent = '✕ 退出编辑';
    exitBtn.title = '关闭编辑器，回到原页面';
    exitBtn.onclick = () => window.parent.postMessage({ type: 'html-editor-exit' }, '*');
    const headerEl = document.getElementById('header');
    const anchor = headerEl.querySelector('.menu-wrap');
    if (anchor) headerEl.insertBefore(exitBtn, anchor); else headerEl.appendChild(exitBtn);

    // 接收宿主页面送来的 HTML
    window.addEventListener('message', ev => {
      const msg = ev.data || {};
      if (msg.type === 'html-editor-load' && typeof msg.html === 'string') {
        stage.srcdoc = msg.html;
        dropHint.style.display = 'none';
        undoStack = []; redoStack = []; refreshUndoButtons();
        $('project-name').textContent = msg.title || '当前页面';
        $('project-state').textContent = '已载入当前页面';
        const cp = currentPage();
        if (cp) { cp.name = msg.title || '当前页面'; cp.html = msg.html; }
        renderTabs();
        rebuildResponsiveCss();
        rebuildHoverCss();
        setStatus('已载入当前网页：可直接编辑，改完用「导出 HTML」保存成文件');
      }
    });
    // 告诉宿主：编辑器就绪，可以发送页面内容了
    setTimeout(() => window.parent.postMessage({ type: 'html-editor-ready' }, '*'), 80);
  }
})();
