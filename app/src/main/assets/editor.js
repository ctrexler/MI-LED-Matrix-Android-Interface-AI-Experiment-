"use strict";

const FIT_OPTS = [['contain', 'Fit with black borders'], ['actual', 'Original size (1:1)'], ['cover', 'Fill and crop'], ['stretch', 'Stretch']];

function imageAlignControls(parent, obj, onChange) {
 const wrap = el('div', undefined, 'pos1to1Controls');
 const fmt = (v, low, high) => v === 0 ? low : v === 1 ? high : v === 0.5 ? 'Center' : Math.round(v * 100) + '%';
 let zCur = Number.isFinite(obj.zoom) ? Math.max(0.25, Math.min(4, obj.zoom)) : 1;
 let zLbl = el('label', undefined, 'calRow'), zTop = el('span', 'Zoom (1:1)'), zVal = el('b', Math.round(zCur * 100) + '%');
 zTop.append(zVal);
 let zr = document.createElement('input'); zr.type = 'range'; zr.min = 25; zr.max = 400; zr.step = 5; zr.value = Math.round(zCur * 100);
 zr.oninput = () => { let v = Number(zr.value) / 100; obj.zoom = v; zVal.textContent = Math.round(v * 100) + '%'; onChange(); };
 zLbl.append(zTop, zr); wrap.append(zLbl);
 for (let [key, title, low, high] of [['alignX', 'Horizontal position', 'Left', 'Right'], ['alignY', 'Vertical position', 'Top', 'Bottom']]) {
  let cur = Number.isFinite(obj[key]) ? obj[key] : 0.5;
  let lbl = el('label', undefined, 'calRow'), top = el('span', title), val = el('b', fmt(cur, low, high));
  top.append(val);
  let r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 100; r.step = 5; r.value = Math.round(cur * 100);
  r.oninput = () => { let v = Number(r.value) / 100; obj[key] = v; val.textContent = fmt(v, low, high); onChange(); };
  lbl.append(top, r); wrap.append(lbl);
 }
 wrap.hidden = obj.fit !== 'actual';
 parent.append(wrap);
 return { update: () => { wrap.hidden = obj.fit !== 'actual'; } };
}

function buildImageControls(parent, obj, onLive, onCommit = onLive) {
 let fitSel = select(FIT_OPTS, obj.fit), posCtl;
 fitSel.onchange = () => { obj.fit = fitSel.value; if (posCtl) posCtl.update(); onCommit(); };
 let smoothChk = document.createElement('input'); smoothChk.type = 'checkbox'; smoothChk.checked = !!obj.smooth;
 smoothChk.onchange = () => { obj.smooth = smoothChk.checked; onCommit(); };
 let checkLbl = el('label', undefined, 'check'); checkLbl.append(smoothChk, document.createTextNode('Smooth resizing'));
 parent.append(field('Image fitting', fitSel));
 posCtl = imageAlignControls(parent, obj, onLive);
 parent.append(checkLbl);
 return posCtl;
}

async function commitStep(f, isNew) {
 pushUndo();
 let idx = isNew ? current.steps.length : current.steps.findIndex(x => x.id === f.id);
 if (!isNew && idx < 0) throw Error('Step missing');
 if (isNew && current.steps.length >= 200) throw Error('Maximum 200 steps');
 await regenerate(f, db.layout, idx);
 if (isNew) { current.steps.push(f); selected = current.steps.length - 1; }
 else { current.steps[idx] = f; selected = idx; }
}

function toggleEditorView() { db.editorView = db.editorView === 'separate' ? 'all' : 'separate'; store(); updateViewToggleBtn(); renderGrid(); }
function updateViewToggleBtn() {
 let btn = $('viewToggleBtn'); if (!btn) return;
 let isSep = db.editorView === 'separate';
 btn.textContent = isSep ? '☰ One per line' : '🔲 All together';
 btn.title = isSep ? 'Viewing each display on its own line. Click to view all displays together.' : 'Viewing all displays together in each card. Click to view each display on its own line.';
}

function updateGridSelection() {
 let isPlaying = !!(playback && playback.kind === 'editor');
 document.querySelectorAll('#storyboard .stepCard').forEach(card => {
  let idx = Number(card.dataset.stepIndex);
  card.classList.toggle('selected', idx === selected);
  card.classList.toggle('playing', isPlaying && idx === selected);
 });
}

function renderGrid() {
 let g = $('storyboard'), scroll = g.scrollTop;
 g.replaceChildren();
 updateViewToggleBtn();
 let isPlaying = !!(playback && playback.kind === 'editor');
 if (db.editorView === 'separate') {
  g.className = 'storyboard viewLanes';
  let lanesContainer = el('div', undefined, 'lanesContainer'), trackElements = [];
  for (let d = 0; d < 4; d++) {
   let lane = el('div', undefined, 'displayLane');
   let header = el('div', undefined, 'laneHeader');
   header.append(el('strong', 'Display ' + (d + 1)), el('span', ready[d] ? '● Ready' : (db.assignments[d] ? 'Assigned' : 'Off'), 'laneStatus' + (ready[d] ? ' ready' : '')));
   let track = el('div', undefined, 'laneTrack'); trackElements.push(track);
   current.steps.forEach((f, i) => {
    let card = el('div', undefined, 'laneCard stepCard' + (i === selected ? ' selected' : '') + (i >= 10 ? ' overLimit' : '') + (isPlaying && i === selected ? ' playing' : ''));
    card.dataset.id = f.id; card.dataset.stepIndex = String(i); card.tabIndex = 0;
    card.setAttribute('aria-label', 'Step ' + (i + 1) + ' Display ' + (d + 1));
    let top = el('div', undefined, 'laneCardTop');
    top.append(el('small', '#' + (i + 1))); if (i >= 10) top.append(el('small', 'Live'));
    let tileBox = el('div', undefined, 'laneTile' + (!f.tiles[d] ? ' empty' : ''));
    if (f.tiles[d]) { let img = document.createElement('img'); img.alt = ''; img.draggable = false; displayTileSrc(img, f.tiles[d]); tileBox.append(img); }
    card.append(top, tileBox);
    card.onpointerdown = e => dragStart(e, card);
    card.onclick = () => {
     if (suppressClick || busy || working) return;
     pausePlayback(); selected = i; updateGridSelection(); renderPreview(); draftSoon(); previewCurrent();
     openSource(f.id, d);
    };
    card.onkeydown = e => { if (e.key === 'Enter' && e.target === card) { selected = i; openSource(f.id, d); } };
    track.append(card);
   });
   let add = button('+', addStep, 'laneAddCard'); add.title = 'Add step'; add.disabled = busy || working;
   track.append(add); lane.append(header, track); lanesContainer.append(lane);
  }
  let syncing = false;
  trackElements.forEach(track => {
   track.onscroll = () => {
    if (syncing) return; syncing = true;
    let pos = track.scrollLeft;
    trackElements.forEach(t => { if (t !== track) t.scrollLeft = pos; });
    syncing = false;
   };
  });
  g.append(lanesContainer);
 } else {
  g.className = 'storyboard';
  current.steps.forEach((f, i) => {
   let card = el('div', undefined, 'stepCard' + (i === selected ? ' selected' : '') + (i >= 10 ? ' overLimit' : '') + (isPlaying && i === selected ? ' playing' : ''));
   card.dataset.id = f.id; card.dataset.stepIndex = String(i); card.tabIndex = 0;
   card.setAttribute('aria-label', 'Step ' + (i + 1) + '. Enter for options. Hold to reorder.');
   let top = el('div', undefined, 'cardTop');
   top.append(el('span', String(i + 1)), el('span', (i >= 10 ? 'Live · ' : '') + (f.mode === 'panels' ? 'Panels' : f.mode === 'repeat' ? 'Repeat' : 'Spanning')));
   card.append(top, makeWall(f, db.layout));
   card.onpointerdown = e => dragStart(e, card);
   card.onclick = e => {
    if (suppressClick || busy || working) return;
    pausePlayback(); selected = i; updateGridSelection(); renderPreview(); draftSoon(); previewCurrent();
    let panel = e.target.closest('[data-panel]');
    if (panel) openSource(f.id, Number(panel.dataset.panel)); else stepOptions(f.id);
   };
   card.onkeydown = e => { if (e.key === 'Enter' && e.target === card) { selected = i; stepOptions(f.id); } };
   g.append(card);
  });
  let add = button('', addStep, 'addCard'); add.id = 'addCard'; add.append(el('span', '+'), el('small', 'Add step')); add.disabled = busy || working;
  g.append(add); g.scrollTop = scroll;
 }
 $('count').textContent = current.steps.length + ' steps' + (current.steps.length > 10 ? ' (10 stored max)' : '');
}

function renderPreview() {
 let f = current.steps[selected], w = makeWall(f, db.layout);
 $('largePreview').replaceChildren(...Array.from(w.children));
 $('largePreview').style.gridTemplateColumns = w.style.gridTemplateColumns;
 $('position').textContent = f ? 'Step ' + (selected + 1) + ' / ' + current.steps.length : 'No steps';
 $('speed').textContent = db.previewSeconds.toFixed(1) + ' s';
 $('playBtn').textContent = playback && playback.kind === 'editor' ? 'Pause' : 'Play';
 $('liveToggle').checked = live;
 $('liveState').textContent = busy ? 'Live suspended for transfer' : live ? 'Live on · ' + ready.filter(Boolean).length + '/4 ready' : 'Displays off · phone only';
 let box = $('previewBox'), colBtn = $('previewCollapseBtn');
 if (box) box.classList.toggle('collapsed', !!db.previewCollapsed);
 if (colBtn) {
  colBtn.textContent = db.previewCollapsed ? '▴' : '▾';
  colBtn.title = db.previewCollapsed ? 'Expand phone preview' : 'Minimize phone preview';
  colBtn.setAttribute('aria-expanded', String(!db.previewCollapsed));
 }
}

function renderEditor() { $('sequenceName').value = current.name; renderGrid(); renderPreview(); }

function updateUndoButtons() {
 if ($('undoBtn')) $('undoBtn').disabled = !undoStack.length || busy || working;
 if ($('redoBtn')) $('redoBtn').disabled = !redoStack.length || busy || working;
}
function pushUndo() {
 if (!current) return;
 undoStack.push({ steps: clone(current.steps), name: current.name, selected, gifGroups: clone(current.gifGroups || {}) });
 if (undoStack.length > 20) undoStack.shift();
 redoStack = [];
 updateUndoButtons();
}
function clearHistory() { undoStack = []; redoStack = []; updateUndoButtons(); }
function undo() {
 if (busy || working || !undoStack.length) return;
 pausePlayback();
 redoStack.push({ steps: clone(current.steps), name: current.name, selected, gifGroups: clone(current.gifGroups || {}) });
 let snap = undoStack.pop();
 current.steps = snap.steps; current.name = snap.name; current.gifGroups = snap.gifGroups || {};
 selected = Math.min(Math.max(0, snap.selected || 0), Math.max(0, current.steps.length - 1));
 updateUndoButtons(); changed(); renderEditor(); previewCurrent(true);
}
function redo() {
 if (busy || working || !redoStack.length) return;
 pausePlayback();
 undoStack.push({ steps: clone(current.steps), name: current.name, selected, gifGroups: clone(current.gifGroups || {}) });
 let snap = redoStack.pop();
 current.steps = snap.steps; current.name = snap.name; current.gifGroups = snap.gifGroups || {};
 selected = Math.min(Math.max(0, snap.selected || 0), Math.max(0, current.steps.length - 1));
 updateUndoButtons(); changed(); renderEditor(); previewCurrent(true);
}

function chooseType(callback) {
 openSheet('Add image or pattern');
 let b = $('sheetBody'); b.append(hint('Choose a gallery image or create a color pattern.'));
 buttons(b, [['Choose image', () => pickImage(callback), 'primary'], ['Create pattern', () => callback(patternSpec())]]);
}

function addStep() {
 if (busy || working) return;
 if (current.steps.length >= 200) return notify('Maximum 200 steps.');
 openStepStudio(blankFrame(), { isNew: true, layerIdx: 0, panelIdx: 0 });
}

function openSource(id, index) {
 if (busy || working) return;
 let f = current.steps.find(x => x.id === id); if (!f) return;
 let layers = ensureStepLayers(f), topIdx = layers.length - 1, top = layers[topIdx];
 let src = top.mode !== 'panels' ? top.source : top.panels[index];
 if (src && src.gifGroupId && current.gifGroups && current.gifGroups[src.gifGroupId]) {
  let g = current.gifGroups[src.gifGroupId];
  openGifEditor({ groupId: g.id, target: g.target, layer: g.layer || 'fg', insertIndex: current.steps.indexOf(f), isNew: false, frames: clone(g.frames), fit: g.fit, smooth: g.smooth, alignX: g.alignX ?? 0.5, alignY: g.alignY ?? 0.5, zoom: g.zoom ?? 1, truncated: false });
  return;
 }
 let matchIdx = topIdx;
 for (let k = layers.length - 1; k >= 0; k--) {
  if (layerAppearsOn(layers[k], index)) { matchIdx = k; break; }
 }
 openStepStudio(clone(f), { isNew: false, layerIdx: matchIdx, panelIdx: index, filterPanel: index });
}

function editSource(frame, target, isNew) {
 let f = clone(frame), layers = ensureStepLayers(f), topIdx = layers.length - 1;
 openStepStudio(f, { isNew, layerIdx: topIdx, panelIdx: typeof target === 'number' ? target : 0 });
}

function openBackgroundEditor(frame) {
 let f = clone(frame), layers = ensureStepLayers(f);
 if (layers.length < 2) layers.unshift(blankLayer('panels', null, [null, null, null, null], 'Background'));
 openStepStudio(f, { isNew: false, layerIdx: 0, panelIdx: 0 });
}

function layerAppearsOn(L, panelIdx) {
 if (!L) return false;
 if (L.mode === 'span' || L.mode === 'repeat') return !!L.source;
 return Array.isArray(L.panels) && !!L.panels[panelIdx];
}

function layerScopeLabel(L) {
 if (!L) return 'Empty';
 if (L.mode === 'span') return L.source ? 'Span all 4' : 'Span (empty)';
 if (L.mode === 'repeat') return L.source ? 'Repeat all 4' : 'Repeat (empty)';
 let active = [0, 1, 2, 3].filter(i => L.panels && L.panels[i]).map(i => 'D' + (i + 1));
 return active.length ? active.join(', ') : 'Empty';
}

async function renderLayerThumb(L, container, stepIdx) {
 try {
  let tmp = { id: 'thumb', mode: L.mode, source: L.source, panels: L.panels, tiles: ['', '', '', ''], layers: [{ ...L, visible: true }] };
  await regenerate(tmp, db.layout, stepIdx);
  if (!container.isConnected) return;
  let w = makeWall(tmp, db.layout, false);
  container.replaceChildren(w);
 } catch (_) {}
}

const STUDIO_PATTERNS = [['solid', 'Solid'], ['gradient', 'Gradient'], ['checker', 'Checkerboard'], ['stripes', 'Stripes'], ['border', 'Border'], ['diamonds', 'Diamond bands'], ['zigzag', 'Zigzag stripes'], ['dots', 'Dots'], ['heart', 'Hearts'], ['star', 'Stars'], ['circle', 'Circles'], ['square', 'Squares'], ['diamond', 'Diamonds'], ['triangle', 'Triangles'], ['arrow', 'Arrows']];

function openStepStudio(frame, opts = {}) {
 let isNew = !!opts.isNew;
 let f = clone(frame), layers = ensureStepLayers(f);
 let activeLayerIdx = Math.max(0, Math.min(layers.length - 1, opts.layerIdx ?? (layers.length - 1)));
 let activePanelIdx = Math.max(0, Math.min(3, opts.panelIdx ?? 0));
 let filterPanel = Number.isInteger(opts.filterPanel) ? opts.filterPanel : null;
 let activeCat = 'source';

 openSheet(isNew ? 'New step studio' : 'Step ' + (current.steps.findIndex(x => x.id === f.id) + 1) + ' studio');
 let session = { studio: true, rev: 0 }; editorSession = session;
 const b = $('sheetBody');

 let sticky = el('div', undefined, 'studioSticky');
 let view = el('div', undefined, 'wall studioPreview');
 sticky.append(view);
 b.append(sticky);

 let layerHead = el('div', undefined, 'layerHeadRow');
 let layerTitle = el('strong', '');
 let filterBtn = button('', () => { filterPanel = null; rebuildAll(); renderPreviewWall(f); }, 'filterPill');
 let addLayerBtn = button('+ Add layer', () => {
  if (layers.length >= 8) return notify('Maximum 8 layers per step.');
  let nl = blankLayer('panels', null, [null, null, null, null], 'Layer ' + (layers.length + 1));
  layers.push(nl);
  activeLayerIdx = layers.length - 1;
  filterPanel = null;
  activeCat = 'source';
  rebuildAll(); refresh();
 }, 'layerMiniBtn');
 let headActions = el('div', undefined, 'row');
 headActions.append(filterBtn, addLayerBtn);
 layerHead.append(layerTitle, headActions);
 let layerStack = el('div', undefined, 'layerStack');
 let catBar = el('div', undefined, 'catBar');
 let tray = el('div', undefined, 'toolTray');
 b.append(layerHead, layerStack, catBar, tray);

 function renderPreviewWall(step) {
  let w = makeWall(step, db.layout, true);
  view.style.gridTemplateColumns = w.style.gridTemplateColumns;
  view.replaceChildren(...Array.from(w.children));
  view.querySelectorAll('[data-panel]').forEach(tile => {
   let p = Number(tile.dataset.panel);
   tile.classList.toggle('focused', filterPanel === p);
   tile.onclick = () => {
    filterPanel = (filterPanel === p) ? null : p;
    activePanelIdx = p;
    if (filterPanel !== null) {
     let match = -1;
     for (let k = layers.length - 1; k >= 0; k--) if (layerAppearsOn(layers[k], p)) { match = k; break; }
     if (match >= 0) activeLayerIdx = match;
    }
    rebuildAll();
    renderPreviewWall(f);
   };
  });
 }

 renderPreviewWall(f);

 function currentLayer() { return layers[activeLayerIdx] || layers[0]; }
 function currentSrc() {
  let L = currentLayer();
  return L.mode === 'panels' ? L.panels[activePanelIdx] : L.source;
 }
 function setSrc(next) {
  let L = currentLayer();
  if (L.mode === 'panels') L.panels[activePanelIdx] = next;
  else L.source = next;
 }

 function ensureValidCat() {
  let s = currentSrc();
  if (activeCat === 'fit' && (!s || s.type !== 'image')) activeCat = 'source';
  if ((activeCat === 'colors' || activeCat === 'style') && (!s || s.type !== 'pattern')) activeCat = 'source';
 }

 async function refresh() {
  let rev = ++session.rev;
  try {
   syncLegacyFields(f);
   let stepIdx = isNew ? current.steps.length : Math.max(0, current.steps.findIndex(x => x.id === f.id));
   await regenerate(f, db.layout, stepIdx);
   if (editorSession !== session || rev !== session.rev) return;
   renderPreviewWall(f);
   queueTiles(f.tiles, [0, 1, 2, 3]);
  } catch (e) { notify(e.message); }
 }

 function renderLayers() {
  let stepIdx = isNew ? current.steps.length : Math.max(0, current.steps.findIndex(x => x.id === f.id));
  let visibleIndices = [];
  for (let idx = layers.length - 1; idx >= 0; idx--) {
   if (filterPanel === null || layerAppearsOn(layers[idx], filterPanel)) visibleIndices.push(idx);
  }
  layerTitle.textContent = filterPanel !== null ? 'D' + (filterPanel + 1) + ' layers (' + visibleIndices.length + '/' + layers.length + ')' : 'Layers (' + layers.length + '/8)';
  filterBtn.hidden = filterPanel === null;
  if (filterPanel !== null) filterBtn.textContent = 'D' + (filterPanel + 1) + ' only ×';
  layerStack.replaceChildren();
  if (!visibleIndices.length) {
   layerStack.append(hint('No layers on Display ' + (filterPanel + 1) + ' yet. Tap + Add layer or clear the filter.'));
   return;
  }
  for (let idx of visibleIndices) {
   let L = layers[idx];
   let row = el('div', undefined, 'layerRow' + (idx === activeLayerIdx ? ' active' : '') + (L.visible === false ? ' hiddenLayer' : ''));
   let thumb = el('div', undefined, 'layerThumb');
   renderLayerThumb(L, thumb, stepIdx);
   let selBtn = el('button', undefined, 'layerSelectBtn');
   selBtn.type = 'button';
   selBtn.append(el('span', L.name || 'Layer ' + (idx + 1)), el('small', layerScopeLabel(L)));
   selBtn.onclick = () => { activeLayerIdx = idx; ensureValidCat(); rebuildAll(); };
   let visBtn = button(L.visible === false ? '🚫' : '👁️', e => {
    e.stopPropagation(); L.visible = L.visible === false; renderLayers(); refresh();
   }, 'layerMiniBtn'); visBtn.title = 'Toggle visibility';
   let upBtn = button('▲', e => {
    e.stopPropagation(); if (idx >= layers.length - 1) return;
    [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
    if (activeLayerIdx === idx) activeLayerIdx++; else if (activeLayerIdx === idx + 1) activeLayerIdx--;
    renderLayers(); refresh();
   }, 'layerMiniBtn'); upBtn.disabled = idx >= layers.length - 1; upBtn.title = 'Move layer up';
   let dnBtn = button('▼', e => {
    e.stopPropagation(); if (idx <= 0) return;
    [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]];
    if (activeLayerIdx === idx) activeLayerIdx--; else if (activeLayerIdx === idx - 1) activeLayerIdx++;
    renderLayers(); refresh();
   }, 'layerMiniBtn'); dnBtn.disabled = idx <= 0; dnBtn.title = 'Move layer down';
   let delBtn = button('✕', e => {
    e.stopPropagation();
    if (layers.length > 1) {
     layers.splice(idx, 1);
     activeLayerIdx = Math.min(activeLayerIdx, layers.length - 1);
    } else {
     L.mode = 'panels'; L.source = null; L.panels = [null, null, null, null];
    }
    ensureValidCat(); rebuildAll(); refresh();
   }, 'layerMiniBtn danger'); delBtn.title = layers.length > 1 ? 'Delete layer' : 'Clear layer';
   row.append(thumb, selBtn, visBtn, upBtn, dnBtn, delBtn);
   layerStack.append(row);
  }
 }

 function renderCategories() {
  ensureValidCat();
  let s = currentSrc();
  let cats = [['source', '🖼️', 'Source'], ['place', '⊞', 'Placement']];
  if (s && s.type === 'image') cats.push(['fit', '📐', 'Fit & Zoom']);
  if (s && s.type === 'pattern') cats.push(['colors', '🎨', 'Colors'], ['style', '⚙️', 'Style']);
  cats.push(['step', '⚡', 'Step']);
  catBar.replaceChildren();
  for (let [id, icon, label] of cats) {
   let btn = el('button', undefined, 'catBtn' + (activeCat === id ? ' active' : ''));
   btn.type = 'button';
   btn.append(el('span', icon), el('span', label));
   btn.onclick = () => { activeCat = id; renderCategories(); renderTray(); };
   catBar.append(btn);
  }
 }

 function renderTray() {
  tray.replaceChildren();
  let L = currentLayer(), s = currentSrc();
  if (L.mode === 'panels' && ['source', 'fit', 'colors', 'style'].includes(activeCat)) {
   let pRow = el('div', undefined, 'row');
   for (let i = 0; i < 4; i++) {
    let pb = button('D' + (i + 1) + (L.panels[i] ? ' ●' : ''), () => {
     activePanelIdx = i; ensureValidCat(); renderCategories(); renderTray();
    }, i === activePanelIdx ? 'primary' : '');
    pb.style.flex = '1'; pb.style.minHeight = '32px'; pb.style.fontSize = '11px';
    pRow.append(pb);
   }
   tray.append(pRow);
  }

  const pickLayerImg = () => pickImage(next => {
   if (next.type === 'gif') {
    let dest = L.mode === 'panels' ? activePanelIdx : L.mode;
    let idx = isNew ? current.steps.length : Math.max(0, current.steps.findIndex(x => x.id === f.id));
    openGifEditor({ groupId: null, target: dest, layer: activeLayerIdx === 0 && layers.length > 1 ? 'bg' : 'fg', insertIndex: idx, isNew, frames: next.frames, fit: next.fit || db.defaults.fit, smooth: db.defaults.smooth, alignX: 0.5, alignY: 0.5, zoom: 1, truncated: next.truncated });
    return;
   }
   setSrc(next); ensureValidCat(); rebuildAll(); refresh();
  });

  if (activeCat === 'source') {
   if (!s) {
    tray.append(hint('This layer slot is empty. Choose an image/GIF or create a pattern/shape.'));
    buttons(tray, [['Choose image / GIF', pickLayerImg, 'primary'], ['Create pattern / shape', () => { setSrc(patternSpec()); activeCat = 'colors'; rebuildAll(); refresh(); }]]);
   } else if (s.type === 'image') {
    if (s.gifGroupId && current.gifGroups && current.gifGroups[s.gifGroupId]) {
     let g = current.gifGroups[s.gifGroupId];
     buttons(tray, [['Edit GIF frames', () => openGifEditor({ groupId: g.id, target: g.target, layer: g.layer || 'fg', insertIndex: Math.max(0, current.steps.findIndex(x => x.id === f.id)), isNew: false, frames: clone(g.frames), fit: g.fit, smooth: g.smooth, alignX: g.alignX ?? 0.5, alignY: g.alignY ?? 0.5, zoom: g.zoom ?? 1, truncated: false }), 'primary']]);
    }
    let img = el('img', undefined, 'sourcePreview'); img.src = s.src; img.alt = 'Source image'; tray.append(img);
    buttons(tray, [['Change image', pickLayerImg], ['Switch to pattern', () => { setSrc(patternSpec()); activeCat = 'colors'; rebuildAll(); refresh(); }], ['Clear slot', () => { setSrc(null); rebuildAll(); refresh(); }, 'danger']]);
   } else {
    let typeSel = select(STUDIO_PATTERNS, s.pattern);
    typeSel.onchange = () => { s.pattern = typeSel.value; if (!s.size) s.size = 4; rebuildAll(); refresh(); };
    tray.append(field('Pattern / shape', typeSel));
    buttons(tray, [['Switch to image', pickLayerImg], ['Clear slot', () => { setSrc(null); rebuildAll(); refresh(); }, 'danger']]);
   }
  } else if (activeCat === 'place') {
   const setMode = dest => {
    let src = currentSrc() || patternSpec();
    if (dest === 'span' || dest === 'repeat') {
     L.mode = dest; L.source = clone(src); L.panels = [null, null, null, null];
    } else {
     L.mode = 'panels'; L.source = null; L.panels[dest] = clone(src); activePanelIdx = dest;
    }
    rebuildAll(); refresh();
   };
   buttons(tray, [['Span all 4', () => setMode('span'), L.mode === 'span' ? 'primary' : ''], ['Repeat all 4', () => setMode('repeat'), L.mode === 'repeat' ? 'primary' : '']]);
   let pGrid = el('div', undefined, 'placement');
   for (let i = 0; i < 4; i++) pGrid.append(button('Display ' + (i + 1), () => setMode(i), L.mode === 'panels' && activePanelIdx === i ? 'primary' : ''));
   tray.append(pGrid);
  } else if (activeCat === 'fit' && s && s.type === 'image') {
   buildImageControls(tray, s, refresh);
  } else if (activeCat === 'colors' && s && s.type === 'pattern') {
   renderPatternColors(tray, s, () => { renderTray(); refresh(); }, refresh, async () => {
    if (busy || working) return;
    let count = palette(s).length; if (count < 2) return notify('Add at least 2 colors to generate a cycle.');
    s.cycle = true; working = true;
    try {
     pushUndo();
     let startIdx = isNew ? current.steps.length : Math.max(0, current.steps.findIndex(x => x.id === f.id));
     if (startIdx + count > 200) throw Error('Exceeds maximum 200 steps');
     for (let k = 0; k < count; k++) {
      let step = clone(f); step.id = isNew || k > 0 ? uid() : f.id;
      let ti = startIdx + k;
      if (ti >= current.steps.length) current.steps.push(step);
      else current.steps[ti] = step;
      await regenerate(current.steps[ti], db.layout, ti);
     }
     selected = startIdx; working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
     notify('Generated ' + count + '-step color cycle.');
    } catch (e) { notify(e.message); } finally { working = false; }
   });
  } else if (activeCat === 'style' && s && s.type === 'pattern') {
   renderPatternStyle(tray, s, () => { renderTray(); refresh(); }, refresh);
  } else if (activeCat === 'step') {
   buttons(tray, [['Apply this layer to all steps', async () => {
    if (working || busy) return;
    working = true;
    try {
     await commitStep(clone(f), isNew);
     for (let k = 0; k < current.steps.length; k++) {
      let st = current.steps[k], stLayers = ensureStepLayers(st);
      if (activeLayerIdx < stLayers.length) stLayers[activeLayerIdx] = clone(L);
      else stLayers.push(clone(L));
      syncLegacyFields(st);
      await regenerate(st, db.layout, k);
     }
     working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
     notify('Applied layer to all steps.');
    } catch (e) { notify(e.message); } finally { working = false; }
   }, 'primary']]);
   if (!isNew) {
    buttons(tray, [['Copy / mirror tile', () => copyTileSheet(f.id)], ['Duplicate step', async () => {
     if (current.steps.length >= 200) return;
     pushUndo(); let copy = clone(f); copy.id = uid();
     let i = current.steps.findIndex(x => x.id === f.id);
     current.steps.splice(i + 1, 0, copy); selected = i + 1;
     await refreshCyclingSteps(); closeSheet(false); changed(); renderEditor(); previewCurrent(true);
    }]]);
    buttons(tray, [['Move step earlier', () => { closeSheet(); moveStep(f.id, -1); }], ['Move step later', () => { closeSheet(); moveStep(f.id, 1); }]]);
    buttons(tray, [['Delete entire step', () => deleteStep(f.id), 'danger']]);
   }
  }
 }

 function rebuildAll() { renderLayers(); renderCategories(); renderTray(); }
 rebuildAll();

 buttons(b, [['Cancel', () => { session.rev++; closeSheet(true); }], ['Done', async () => {
  if (working || busy) return;
  working = true;
  try {
   await commitStep(f, isNew);
   let s = currentSrc();
   if (s && s.type === 'image' && s.fit !== 'actual') db.defaults = { fit: s.fit, smooth: s.smooth };
   working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  } catch (e) { notify(e.message); } finally { working = false; }
 }, 'primary']]);
}

function renderPatternColors(controls, s, rebuildTray, refresh, onGenerateCycle) {
 if (!Array.isArray(s.colors) || !s.colors.length) s.colors = [s.a || '#ff3377', s.b || '#3377ff'];
 let shaped = ['heart', 'star', 'circle', 'square', 'diamond', 'triangle', 'arrow', 'dots'].includes(s.pattern);
 let colors = el('div', undefined, 'colorRow');
 const swapColors = (from, to) => {
  if (from < 0 || from >= s.colors.length || to < 0 || to >= s.colors.length || from === to) return;
  let [m] = s.colors.splice(from, 1); s.colors.splice(to, 0, m);
  s.a = s.colors[0]; s.b = s.colors[1] || s.a; rebuildTray();
 };
 let colorDrag = null;
 const startColorDrag = (e, index, item) => { if (e.button !== 0 && e.pointerType === 'mouse') return; colorDrag = { index, item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, targetIndex: index }; try { item.setPointerCapture(e.pointerId); } catch (_) {} };
 const moveColorDrag = e => {
  if (!colorDrag || e.pointerId !== colorDrag.pointerId) return;
  if (!colorDrag.active) { if (Math.hypot(e.clientX - colorDrag.startX, e.clientY - colorDrag.startY) < 5) return; colorDrag.active = true; colorDrag.item.classList.add('dragging'); }
  let hit = document.elementFromPoint(e.clientX, e.clientY), t = hit ? hit.closest('.colorItem') : null;
  document.querySelectorAll('.colorItem').forEach(n => n.classList.remove('dropTarget'));
  if (t && t.dataset.index !== undefined) { colorDrag.targetIndex = Number(t.dataset.index); if (colorDrag.targetIndex !== colorDrag.index) t.classList.add('dropTarget'); }
  else colorDrag.targetIndex = colorDrag.index;
 };
 const endColorDrag = e => {
  if (!colorDrag || e.pointerId !== colorDrag.pointerId) return;
  let { index, targetIndex, active, item } = colorDrag; colorDrag = null;
  item.classList.remove('dragging'); document.querySelectorAll('.colorItem').forEach(n => n.classList.remove('dropTarget'));
  try { item.releasePointerCapture(e.pointerId); } catch (_) {}
  if (active && targetIndex !== index && targetIndex >= 0 && targetIndex < s.colors.length) swapColors(index, targetIndex);
 };

 s.colors.forEach((color, i) => {
  let isTrans = color === 'transparent', item = el('div', undefined, 'colorItem'); item.dataset.index = i; item.draggable = true;
  let header = el('div', undefined, 'colorItemHeader'), handle = el('span', '⠿', 'colorDragHandle'), label = el('span', '#' + (i + 1), 'colorIndex'), nav = el('div', undefined, 'colorNav');
  handle.title = 'Drag to reorder';
  let leftBtn = document.createElement('button'); leftBtn.type = 'button'; leftBtn.className = 'colorMoveBtn'; leftBtn.textContent = '◀'; leftBtn.disabled = i === 0;
  leftBtn.onclick = e => { e.stopPropagation(); swapColors(i, i - 1); };
  let rightBtn = document.createElement('button'); rightBtn.type = 'button'; rightBtn.className = 'colorMoveBtn'; rightBtn.textContent = '▶'; rightBtn.disabled = i === s.colors.length - 1;
  rightBtn.onclick = e => { e.stopPropagation(); swapColors(i, i + 1); };
  nav.append(leftBtn, rightBtn); header.append(handle, label, nav);
  let input = document.createElement('input'); input.type = 'color'; input.value = isTrans ? '#000000' : color; if (isTrans) input.classList.add('isTransparent');
  input.oninput = () => { s.colors[i] = input.value; s.a = s.colors[0]; s.b = s.colors[1] || s.a; refresh(); };
  let transBtn = button('∅', e => { e.stopPropagation(); s.colors[i] = s.colors[i] === 'transparent' ? '#ffffff' : 'transparent'; s.a = s.colors[0]; s.b = s.colors[1] || s.a; rebuildTray(); }, 'colorTransBtn' + (isTrans ? ' active' : ''));
  handle.onpointerdown = e => startColorDrag(e, i, item);
  item.onpointermove = moveColorDrag; item.onpointerup = endColorDrag; item.onpointercancel = endColorDrag;
  item.ondragstart = e => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); };
  item.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.colorItem').forEach(n => n.classList.remove('dropTarget')); item.classList.add('dropTarget'); };
  item.ondragleave = () => item.classList.remove('dropTarget');
  item.ondrop = e => { e.preventDefault(); item.classList.remove('dropTarget'); let from = Number(e.dataTransfer.getData('text/plain')); if (Number.isFinite(from)) swapColors(from, i); };
  item.ondragend = () => { item.classList.remove('dragging'); document.querySelectorAll('.colorItem').forEach(n => n.classList.remove('dropTarget')); };
  item.append(header, input, transBtn); colors.append(item);
 });
 controls.append(colors);
 buttons(controls, [['Add color', () => { if (s.colors.length < 8) { s.colors.push('#ffffff'); rebuildTray(); } }], ['Remove last', () => { if (s.colors.length > 1) { s.colors.pop(); rebuildTray(); } }]]);
 if (shaped) {
  let bgTrans = s.background === 'transparent', bgRow = el('div', undefined, 'bgColorRow');
  let bg = document.createElement('input'); bg.type = 'color'; bg.value = bgTrans ? '#000000' : s.background; if (bgTrans) bg.classList.add('isTransparent');
  bg.oninput = () => { s.background = bg.value; refresh(); };
  let bgTBtn = button(bgTrans ? 'Transparent (∅)' : 'Make transparent (∅)', () => { s.background = s.background === 'transparent' ? '#000000' : 'transparent'; rebuildTray(); }, 'colorTransBtn' + (bgTrans ? ' active' : ''));
  bgRow.append(bg, bgTBtn); controls.append(field('Shape background', bgRow));
 }
 let cyc = document.createElement('input'); cyc.type = 'checkbox'; cyc.checked = !!s.cycle;
 cyc.onchange = () => { s.cycle = cyc.checked; rebuildTray(); };
 let cycLbl = el('label', undefined, 'check'); cycLbl.append(cyc, document.createTextNode('Rotate colors across steps'));
 controls.append(cycLbl);
 if (s.cycle && s.colors.length > 1) buttons(controls, [['Generate full cycle (' + s.colors.length + ' steps)', onGenerateCycle]]);
}

function renderPatternStyle(controls, s, rebuildTray, refresh) {
 let shaped = ['heart', 'star', 'circle', 'square', 'diamond', 'triangle', 'arrow', 'dots'].includes(s.pattern);
 const number = (label, key, min, max) => {
  let lbl = el('label', undefined, 'calRow'), top = el('span', label), val = el('b', s[key] + ' px'); top.append(val);
  let n = document.createElement('input'); n.type = 'range'; n.min = min; n.max = max; n.step = 1; n.value = s[key];
  n.oninput = () => { s[key] = Math.max(min, Math.min(max, Math.round(Number(n.value) || min))); val.textContent = s[key] + ' px'; refresh(); };
  lbl.append(top, n); controls.append(lbl);
 };
 const choiceSlider = (label, options, key) => {
  let lbl = el('label', undefined, 'calRow'), top = el('span', label), idx = Math.max(0, options.findIndex(o => String(o[0]) === String(s[key])));
  let val = el('b', options[idx][1]); top.append(val);
  let r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = options.length - 1; r.step = 1; r.value = idx;
  r.oninput = () => { let chosen = options[Number(r.value)] || options[0]; s[key] = chosen[0]; val.textContent = chosen[1]; refresh(); };
  lbl.append(top, r); controls.append(lbl);
 };
 const check = (label, key, rebuildOnChange) => {
  let n = document.createElement('input'); n.type = 'checkbox'; n.checked = !!s[key];
  n.onchange = () => { s[key] = n.checked; if (rebuildOnChange) rebuildTray(); else refresh(); };
  let lbl = el('label', undefined, 'check'); lbl.append(n, document.createTextNode(label)); controls.append(lbl);
 };
 if (shaped) {
  choiceSlider('Direction / rotation', [[0, 'Up / 0°'], [90, 'Right / 90°'], [180, 'Down / 180°'], [270, 'Left / 270°']], 'rotation');
  check('Repeat shapes in a grid', 'tiled', false);
  check('Outline instead of filled', 'outline', true);
  number('Spacing', 'spacing', 0, 32);
 }
 if (['gradient', 'stripes', 'zigzag'].includes(s.pattern)) choiceSlider('Direction', [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['diagonal', 'Diagonal'], ['antidiagonal', 'Opposite diagonal']], 'direction');
 if (!['solid', 'gradient'].includes(s.pattern)) number(shaped ? 'Shape size' : 'Pattern width', 'size', 1, 64);
 if (s.outline || s.pattern === 'border') number('Outline / border thickness', 'thickness', 1, 8);
 if (['solid', 'gradient'].includes(s.pattern) && !shaped && s.pattern === 'solid') controls.append(hint('Solid uses the first color in the Colors tab.'));
}

async function flipTileDataUrl(src, dir) {
 if (!src) return '';
 let im = await loadImage(src), c = canvas(16, 16, false), x = c.getContext('2d');
 x.save();
 if (dir === 'h') { x.translate(16, 0); x.scale(-1, 1); }
 else if (dir === 'v') { x.translate(0, 16); x.scale(1, -1); }
 x.drawImage(im, 0, 0, 16, 16); x.restore();
 return c.toDataURL('image/png');
}

function copyTileSheet(id) {
 if (busy || working) return;
 let f = current.steps.find(x => x.id === id); if (!f) return;
 let stepIdx = current.steps.indexOf(f);
 openSheet('Copy / mirror tile · Step ' + (stepIdx + 1));
 let b = $('sheetBody');
 let fromSel = select([['0', 'Display 1'], ['1', 'Display 2'], ['2', 'Display 3'], ['3', 'Display 4']], '0');
 let tfSel = select([['copy', 'Exact copy'], ['h', 'Mirror horizontally'], ['v', 'Mirror vertically']], 'copy');
 b.append(field('From display', fromSel), field('Transform', tfSel));
 async function applyCopy(destMode) {
  if (working || busy) return;
  let srcIdx = Number(fromSel.value), tf = tfSel.value;
  if (!f.tiles[srcIdx]) return notify('Source display has no image in this step.');
  working = true;
  try {
   pushUndo();
   let outTile = tf === 'copy' ? f.tiles[srcIdx] : await flipTileDataUrl(f.tiles[srcIdx], tf);
   let srcSpec = (tf === 'copy' && f.mode === 'panels' && f.panels[srcIdx]) ? clone(f.panels[srcIdx]) : { type: 'image', src: outTile, fit: 'actual', smooth: false, alignX: 0.5, alignY: 0.5, zoom: 1 };
   if (srcSpec.gifGroupId) delete srcSpec.gifGroupId;
   const writePanel = (step, slot) => {
    let layers = ensureStepLayers(step), top = layers[layers.length - 1];
    if (top.mode !== 'panels') {
     let oldTiles = step.tiles.slice(); top.mode = 'panels'; top.source = null;
     top.panels = [0, 1, 2, 3].map(p => oldTiles[p] ? { type: 'image', src: oldTiles[p], fit: 'actual', smooth: false, alignX: 0.5, alignY: 0.5, zoom: 1 } : null);
    }
    top.panels[slot] = clone(srcSpec); step.tiles[slot] = outTile; syncLegacyFields(step);
   };
   if (destMode === 'allOther') { for (let p = 0; p < 4; p++) if (p !== srcIdx) writePanel(f, p); }
   else if (destMode === 'allSteps') { for (let st of current.steps) writePanel(st, srcIdx); }
   else if (destMode === 'nextStep') { if (stepIdx + 1 < current.steps.length) writePanel(current.steps[stepIdx + 1], srcIdx); else throw Error('No next step'); }
   else writePanel(f, Number(destMode));
   working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  } catch (e) { notify(e.message); } finally { working = false; }
 }
 b.append(el('p', 'To display in this step:'));
 let grid = el('div', undefined, 'placement');
 for (let i = 0; i < 4; i++) grid.append(button('Display ' + (i + 1), () => applyCopy(i)));
 b.append(grid);
 buttons(b, [['All other displays (this step)', () => applyCopy('allOther')], ['Next step (same display)', () => applyCopy('nextStep')], ['All steps (same display)', () => applyCopy('allSteps')]]);
}

async function deleteStep(id) {
 if (busy || working || !confirm('Delete this entire step?')) return;
 pushUndo();
 current.steps = current.steps.filter(f => f.id !== id);
 selected = Math.min(selected, Math.max(0, current.steps.length - 1));
 await refreshCyclingSteps(); closeSheet(false); changed(); renderEditor(); previewCurrent(true);
}
async function moveStep(id, delta) {
 let i = current.steps.findIndex(f => f.id === id), dest = i + delta;
 if (i < 0 || dest < 0 || dest >= current.steps.length) return;
 pushUndo();
 let f = current.steps.splice(i, 1)[0]; current.steps.splice(dest, 0, f);
 selected = dest; await refreshCyclingSteps(); changed(); renderEditor(); previewCurrent();
}
function stepOptions(id) {
 if (busy || working) return;
 let f = current.steps.find(x => x.id === id); if (!f) return;
 openStepStudio(clone(f), { isNew: false, panelIdx: 0 });
}

let drag = null, suppressClick = false, suppressTimer = null;
function dragStart(e, card) {
 if (drag || busy || working || e.button !== 0) return;
 let rect = card.getBoundingClientRect();
 drag = { id: card.dataset.id, card, track: card.closest('.laneTrack'), rect, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, scrollAxis: null, pointer: e.pointerId, active: false, scrolling: false, target: null };
 drag.hold = setTimeout(() => {
  if (!drag) return;
  if (playback) pausePlayback();
  drag.active = true; drag.ghost = card.cloneNode(true); drag.ghost.classList.add('dragging'); drag.ghost.setAttribute('aria-hidden', 'true');
  drag.ghost.style.width = rect.width + 'px'; drag.ghost.style.left = rect.left + 'px'; drag.ghost.style.top = rect.top + 'px';
  document.body.append(drag.ghost); card.style.opacity = '.3'; suppressClick = true;
  if (navigator.vibrate) navigator.vibrate(25);
 }, 450);
}
function dragMove(e) {
 if (!drag || e.pointerId !== drag.pointer) return;
 let dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y), grid = $('storyboard');
 if (!drag.active) {
  if (dist > 9 || drag.scrolling) {
   clearTimeout(drag.hold); drag.scrolling = true; suppressClick = true; e.preventDefault();
   if (!drag.scrollAxis) drag.scrollAxis = (drag.track && Math.abs(e.clientX - drag.x) >= Math.abs(e.clientY - drag.y)) ? 'x' : 'y';
   if (drag.scrollAxis === 'x' && drag.track) drag.track.scrollLeft += drag.lastX - e.clientX;
   else grid.scrollTop += drag.lastY - e.clientY;
   drag.lastX = e.clientX; drag.lastY = e.clientY;
  }
  return;
 }
 e.preventDefault();
 drag.ghost.style.left = (drag.rect.left + e.clientX - drag.x) + 'px';
 drag.ghost.style.top = (drag.rect.top + e.clientY - drag.y) + 'px';
 document.querySelectorAll('.dropTarget').forEach(n => n.classList.remove('dropTarget'));
 let hit = document.elementFromPoint(e.clientX, e.clientY), card = hit && hit.closest('.stepCard'), add = hit && hit.closest('#addCard');
 drag.target = card ? card.dataset.id : add ? 'end' : null;
 if (card && card.dataset.id !== drag.id) card.classList.add('dropTarget');
 if (add) add.classList.add('dropTarget');
 let r = grid.getBoundingClientRect();
 if (e.clientY > r.bottom - 40) grid.scrollTop += 10; else if (e.clientY < r.top + 40) grid.scrollTop -= 10;
}
async function dragEnd(e) {
 if (!drag || e.pointerId !== drag.pointer) return;
 let d = drag; drag = null; clearTimeout(d.hold);
 if (d.active) {
  e.preventDefault(); d.card.style.opacity = ''; d.ghost.remove();
  document.querySelectorAll('.dropTarget').forEach(n => n.classList.remove('dropTarget'));
  if (e.type !== 'pointercancel' && d.target && d.target !== d.id) {
   let from = current.steps.findIndex(f => f.id === d.id), to = d.target === 'end' ? current.steps.length - 1 : current.steps.findIndex(f => f.id === d.target);
   if (from >= 0 && to >= 0 && from !== to) {
    pushUndo();
    let f = current.steps.splice(from, 1)[0]; current.steps.splice(to, 0, f);
    selected = to; await refreshCyclingSteps(); changed(); renderEditor(); previewCurrent();
   }
  }
 }
 if (d.active || d.scrolling) { clearTimeout(suppressTimer); suppressTimer = setTimeout(() => suppressClick = false, 400); }
}
