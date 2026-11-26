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
     if (selected === i) openSource(f.id, d);
     else { pausePlayback(); selected = i; updateGridSelection(); renderPreview(); draftSoon(); previewCurrent(); }
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
 chooseType(s => {
  openSheet('Choose placement');
  let b = $('sheetBody'), layerSel = select([['fg', 'Foreground (main layer)'], ['bg', 'Background layer']], 'fg');
  b.append(field('Layer', layerSel), hint('Add one image across the wall, repeat it on every display, or place it on one display.'));
  const choose = target => {
   let isBg = layerSel.value === 'bg';
   if (s.type === 'gif') {
    openGifEditor({ groupId: null, target, layer: isBg ? 'bg' : 'fg', insertIndex: current.steps.length, isNew: true, frames: s.frames, fit: s.fit || db.defaults.fit, smooth: db.defaults.smooth, alignX: 0.5, alignY: 0.5, zoom: 1, truncated: s.truncated });
    return;
   }
   let f = blankFrame();
   if (isBg) {
    if (typeof target === 'string') { f.bgMode = target; f.bgSource = clone(s); }
    else { f.bgMode = 'panels'; f.bgPanels[target] = clone(s); }
    if (s.type === 'pattern') advancedPattern(f, target, true, s, { applyAll: false, isNewStep: true });
    else openBackgroundEditor(f, false, true);
    return;
   }
   if (typeof target === 'string') { f.mode = target; f.source = clone(s); } else f.panels[target] = clone(s);
   editSource(f, target, true);
  };
  buttons(b, [['Span all four', () => choose('span'), 'primary'], ['Repeat on all four', () => choose('repeat')]]);
  let positions = el('div', undefined, 'placement');
  for (let i = 0; i < 4; i++) positions.append(button('Display ' + (i + 1), () => choose(i)));
  b.append(positions);
 });
}

function openSource(id, index) {
 if (busy || working) return;
 let f = current.steps.find(x => x.id === id); if (!f) return;
 let src = f.mode !== 'panels' ? f.source : f.panels[index];
 if (src && src.gifGroupId && current.gifGroups && current.gifGroups[src.gifGroupId]) {
  let g = current.gifGroups[src.gifGroupId];
  openGifEditor({ groupId: g.id, target: g.target, layer: g.layer || 'fg', insertIndex: current.steps.indexOf(f), isNew: false, frames: clone(g.frames), fit: g.fit, smooth: g.smooth, alignX: g.alignX ?? 0.5, alignY: g.alignY ?? 0.5, zoom: g.zoom ?? 1, truncated: false });
  return;
 }
 if (f.mode !== 'panels') editSource(clone(f), f.mode, false);
 else if (f.panels[index]) editSource(clone(f), index, false);
 else chooseType(s => {
  if (s.type === 'gif') {
   openGifEditor({ groupId: null, target: index, layer: 'fg', insertIndex: current.steps.indexOf(f), isNew: false, frames: s.frames, fit: s.fit || db.defaults.fit, smooth: db.defaults.smooth, alignX: 0.5, alignY: 0.5, zoom: 1, truncated: s.truncated });
   return;
  }
  let copy = clone(f); copy.panels[index] = s; editSource(copy, index, false);
 });
}

function editSource(frame, target, isNew) {
 let src = typeof target === 'string' ? frame.source : frame.panels[target];
 if (src && src.type === 'pattern') { advancedPattern(frame, target, isNew, src); return; }
 if (src && src.gifGroupId && current.gifGroups && current.gifGroups[src.gifGroupId]) {
  let g = current.gifGroups[src.gifGroupId], idx = current.steps.findIndex(x => x.id === frame.id);
  openGifEditor({ groupId: g.id, target: g.target, insertIndex: idx >= 0 ? idx : 0, isNew: false, frames: clone(g.frames), fit: g.fit, smooth: g.smooth, alignX: g.alignX ?? 0.5, alignY: g.alignY ?? 0.5, zoom: g.zoom ?? 1, truncated: false });
  return;
 }
 openSheet(isNew ? 'New step' : 'Edit image / pattern');
 let session = { frame, target, isNew, revision: 0 }; editorSession = session;
 const b = $('sheetBody');
 let tools = el('div', undefined, 'advancedPattern');
 tools.append(button('Use shapes / advanced patterns', () => advancedPattern(frame, target, isNew, patternSpec())));
 if (!isNew) tools.append(' ', button('Background layer', () => openBackgroundEditor(clone(frame))));
 b.append(tools);
 let s = clone(src); const settings = el('div'); b.append(settings);
 let placement = select([['span', 'Span across all four'], ['repeat', 'Repeat on all four'], ['0', 'Display 1'], ['1', 'Display 2'], ['2', 'Display 3'], ['3', 'Display 4']], target);
 let view = el('div', undefined, 'wall miniPreview');
 b.append(field('Placement', placement), hint('Span makes one continuous wall. Repeat duplicates it on every panel. Moving a wall source to one panel clears the other panels.'), view);

 function candidate() {
  let f = clone(frame), dest = ['span', 'repeat'].includes(placement.value) ? placement.value : Number(placement.value);
  if (typeof dest === 'string') { f.mode = dest; f.source = clone(s); f.panels = [null, null, null, null]; }
  else { if (typeof target === 'string') f.panels = [null, null, null, null]; else if (dest !== target) f.panels[target] = null; f.mode = 'panels'; f.source = null; f.panels[dest] = clone(s); }
  return f;
 }
 async function refresh() {
  let revision = ++session.revision;
  try {
   let f = candidate(), stepIdx = isNew ? current.steps.length : Math.max(0, current.steps.findIndex(x => x.id === f.id));
   await regenerate(f, db.layout, stepIdx);
   if (editorSession !== session || revision !== session.revision) return;
   session.rendered = f;
   let w = makeWall(f, db.layout, false);
   view.style.gridTemplateColumns = w.style.gridTemplateColumns; view.replaceChildren(...Array.from(w.children));
   let mask = (!isNew && frame.mode === 'panels' && f.mode === 'panels' && String(target) === placement.value) ? [Number(target)] : [0, 1, 2, 3];
   queueTiles(f.tiles, mask);
  } catch (e) { notify(e.message); }
 }
 function onChosenImage(next) {
  if (next.type === 'gif') {
   let dest = ['span', 'repeat'].includes(placement.value) ? placement.value : Number(placement.value);
   let idx = current.steps.findIndex(x => x.id === frame.id);
   openGifEditor({ groupId: null, target: dest, insertIndex: idx >= 0 ? idx : current.steps.length, isNew, frames: next.frames, fit: next.fit || db.defaults.fit, smooth: db.defaults.smooth, alignX: 0.5, alignY: 0.5, zoom: 1, truncated: next.truncated });
   return;
  }
  s = next; resetPlacement(); rebuildSettings(); refresh();
 }
 function rebuildSettings() {
  settings.replaceChildren();
  if (s.type === 'image') {
   let img = el('img', undefined, 'sourcePreview'); img.src = s.src; img.alt = 'Source image'; settings.append(img);
   buttons(settings, [['Change image', () => pickImage(onChosenImage)], ['Use pattern', () => { s = patternSpec(); resetPlacement(); rebuildSettings(); refresh(); }]]);
   buildImageControls(settings, s, refresh);
  } else {
   let type = select([['solid', 'Solid color'], ['gradient', 'Gradient'], ['checker', 'Checkerboard'], ['stripes', 'Stripes'], ['border', 'Border']], s.pattern);
   type.onchange = () => { s.pattern = type.value; rebuildSettings(); refresh(); };
   settings.append(field('Pattern', type));
   let colors = el('div', undefined, 'colorRow');
   for (let key of ['a', 'b']) {
    if (key === 'b' && s.pattern === 'solid') continue;
    let isTrans = s[key] === 'transparent', input = document.createElement('input');
    input.type = 'color'; input.value = isTrans ? '#000000' : s[key]; if (isTrans) input.classList.add('isTransparent');
    input.oninput = () => { s[key] = input.value; if (Array.isArray(s.colors)) s.colors[key === 'a' ? 0 : 1] = input.value; refresh(); };
    let tBtn = button('∅', () => { s[key] = s[key] === 'transparent' ? '#ffffff' : 'transparent'; if (Array.isArray(s.colors)) s.colors[key === 'a' ? 0 : 1] = s[key]; rebuildSettings(); refresh(); }, 'colorTransBtn' + (isTrans ? ' active' : ''));
    tBtn.title = 'Toggle transparent';
    let label = el('label', key === 'a' ? 'Color 1' : 'Color 2'); label.append(input, tBtn); colors.append(label);
   }
   settings.append(colors);
   buttons(settings, [['Swap colors', () => { [s.a, s.b] = [s.b, s.a]; if (Array.isArray(s.colors) && s.colors.length >= 2) [s.colors[0], s.colors[1]] = [s.colors[1], s.colors[0]]; rebuildSettings(); refresh(); }], ['Use image', () => pickImage(onChosenImage)]]);
   if (['gradient', 'stripes'].includes(s.pattern)) {
    const dirs = [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['diagonal', 'Top-left to bottom-right'], ['antidiagonal', 'Top-right to bottom-left']];
    let lbl = el('label', undefined, 'calRow'), top = el('span', 'Direction'), val = el('b', (dirs.find(d => d[0] === s.direction) || dirs[0])[1]);
    top.append(val);
    let r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = dirs.length - 1; r.step = 1; r.value = Math.max(0, dirs.findIndex(d => d[0] === s.direction));
    r.oninput = () => { let d = dirs[Number(r.value)] || dirs[0]; s.direction = d[0]; val.textContent = d[1]; refresh(); };
    lbl.append(top, r); settings.append(lbl);
   }
   if (['checker', 'stripes', 'border'].includes(s.pattern)) {
    let key = s.pattern === 'border' ? 'thickness' : 'size', max = key === 'thickness' ? 8 : 16;
    let lbl = el('label', undefined, 'calRow'), top = el('span', s.pattern === 'checker' ? 'Square size' : s.pattern === 'stripes' ? 'Stripe width' : 'Border thickness'), val = el('b', s[key] + ' px');
    top.append(val);
    let n = document.createElement('input'); n.id = 'patternSize'; n.type = 'range'; n.min = 1; n.max = max; n.step = 1; n.value = s[key];
    n.oninput = () => { s[key] = Number(n.value); val.textContent = s[key] + ' px'; refresh(); };
    lbl.append(top, n); settings.append(lbl);
   }
   let cyc = document.createElement('input'); cyc.type = 'checkbox'; cyc.checked = !!s.cycle; cyc.onchange = () => { s.cycle = cyc.checked; refresh(); };
   let cycLbl = el('label', undefined, 'check'); cycLbl.append(cyc, document.createTextNode('Rotate colors across steps')); settings.append(cycLbl);
  }
 }
 function resetPlacement() {
  let old = placement.value, n = select([['span', 'Span across all four'], ['repeat', 'Repeat on all four'], ['0', 'Display 1'], ['1', 'Display 2'], ['2', 'Display 3'], ['3', 'Display 4']], old);
  let chosen = n.value; placement.replaceChildren(...Array.from(n.children)); placement.value = chosen;
 }
 placement.onchange = refresh; rebuildSettings();
 buttons(b, [['Cancel', () => closeSheet(true)], ['Done', async () => {
  if (working || busy) return;
  let f = candidate();
  if (typeof target !== 'string' && f.mode !== 'panels' && frame.panels.some((p, i) => i !== target && p) && !confirm('Replace the other panel images with this source?')) return;
  working = true;
  try {
   await commitStep(f, isNew);
   if (s.type === 'image' && s.fit !== 'actual') db.defaults = { fit: s.fit, smooth: s.smooth };
   working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  } catch (e) { notify(e.message); } finally { working = false; }
 }, 'primary']]);

 if (!isNew) {
  b.append(el('div', undefined, 'separator'));
  buttons(b, [['Remove image', () => {
   if (!confirm('Remove this image or pattern?')) return;
   let i = current.steps.findIndex(f => f.id === frame.id); if (i < 0) return;
   pushUndo();
   if (typeof target === 'string') current.steps[i] = { ...blankFrame(), id: frame.id };
   else { current.steps[i].panels[target] = null; current.steps[i].tiles[target] = ''; }
   closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  }, 'danger'], ['Delete entire step', () => deleteStep(frame.id), 'danger']]);
  buttons(b, [['Move earlier', () => { closeSheet(); moveStep(frame.id, -1); }], ['Move later', () => { closeSheet(); moveStep(frame.id, 1); }]]);
 }
 refresh();
}

function advancedPattern(frame, target, isNew, source, bgOpts = null) {
 openSheet(bgOpts ? 'Background pattern' : 'Shapes and multicolor patterns');
 let b = $('sheetBody'), s = normalizeSource(source), view = el('div', undefined, 'wall miniPreview');
 if (!bgOpts && !isNew) { let tools = el('div', undefined, 'advancedPattern'); tools.append(button('Background layer', () => openBackgroundEditor(clone(frame)))); b.append(tools); }
 const opts = [['solid', 'Solid'], ['gradient', 'Gradient'], ['checker', 'Checkerboard'], ['stripes', 'Stripes'], ['border', 'Border'], ['diamonds', 'Diamond bands'], ['zigzag', 'Zigzag stripes'], ['dots', 'Dots'], ['heart', 'Hearts'], ['star', 'Stars'], ['circle', 'Circles'], ['square', 'Squares'], ['diamond', 'Diamonds'], ['triangle', 'Triangles'], ['arrow', 'Arrows']];
 let type = select(opts, s.pattern), placement = select([['span', 'Span wall'], ['repeat', 'Repeat on each display'], ['0', 'Display 1'], ['1', 'Display 2'], ['2', 'Display 3'], ['3', 'Display 4']], target);
 b.append(field('Pattern / shape', type), field('Placement', placement));
 let controls = el('div'); b.append(controls, view);
 let advancedSession = { advanced: true }; editorSession = advancedSession; let revision = 0;

 function candidate() {
  let f = clone(frame), dest = placement.value;
  if (bgOpts) {
   if (dest === 'span' || dest === 'repeat') { f.bgMode = dest; f.bgSource = clone(s); f.bgPanels = [null, null, null, null]; }
   else { if (f.bgMode !== 'panels') f.bgPanels = [null, null, null, null]; f.bgMode = 'panels'; f.bgSource = null; f.bgPanels[Number(dest)] = clone(s); }
   return f;
  }
  if (dest === 'span' || dest === 'repeat') { f.mode = dest; f.source = clone(s); f.panels = [null, null, null, null]; }
  else { if (typeof target === 'string') f.panels = [null, null, null, null]; else if (Number(dest) !== target) f.panels[target] = null; f.mode = 'panels'; f.source = null; f.panels[Number(dest)] = clone(s); }
  return f;
 }
 async function refresh() {
  let rev = ++revision;
  try {
   let f = candidate(), stepIdx = isNew ? current.steps.length : Math.max(0, current.steps.findIndex(x => x.id === f.id));
   await regenerate(f, db.layout, stepIdx);
   if (rev !== revision || editorSession !== advancedSession) return;
   let w = makeWall(f, db.layout, false); view.style.gridTemplateColumns = w.style.gridTemplateColumns; view.replaceChildren(...Array.from(w.children));
   queueTiles(f.tiles);
  } catch (e) { notify(e.message); }
 }
 function number(label, key, min, max) {
  let lbl = el('label', undefined, 'calRow'), top = el('span', label), val = el('b', s[key] + ' px'); top.append(val);
  let n = document.createElement('input'); n.type = 'range'; n.min = min; n.max = max; n.step = 1; n.value = s[key];
  n.oninput = () => { s[key] = Math.max(min, Math.min(max, Math.round(Number(n.value) || min))); val.textContent = s[key] + ' px'; refresh(); };
  lbl.append(top, n); controls.append(lbl);
 }
 function choiceSlider(label, options, key) {
  let lbl = el('label', undefined, 'calRow'), top = el('span', label), idx = Math.max(0, options.findIndex(o => String(o[0]) === String(s[key])));
  let val = el('b', options[idx][1]); top.append(val);
  let r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = options.length - 1; r.step = 1; r.value = idx;
  r.oninput = () => { let chosen = options[Number(r.value)] || options[0]; s[key] = chosen[0]; val.textContent = chosen[1]; refresh(); };
  lbl.append(top, r); controls.append(lbl);
 }
 function check(label, key, onExtra) { let n = document.createElement('input'); n.type = 'checkbox'; n.checked = !!s[key]; n.onchange = () => { s[key] = n.checked; if (key === 'outline' || onExtra) rebuild(); refresh(); }; controls.append(field(label, n)); }
 function swapColors(from, to) { if (from < 0 || from >= s.colors.length || to < 0 || to >= s.colors.length || from === to) return; let [m] = s.colors.splice(from, 1); s.colors.splice(to, 0, m); s.a = s.colors[0]; s.b = s.colors[1] || s.a; rebuild(); refresh(); }

 let colorDrag = null;
 function startColorDrag(e, index, item) { if (e.button !== 0 && e.pointerType === 'mouse') return; colorDrag = { index, item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, targetIndex: index }; try { item.setPointerCapture(e.pointerId); } catch (_) {} }
 function moveColorDrag(e) {
  if (!colorDrag || e.pointerId !== colorDrag.pointerId) return;
  if (!colorDrag.active) { if (Math.hypot(e.clientX - colorDrag.startX, e.clientY - colorDrag.startY) < 5) return; colorDrag.active = true; colorDrag.item.classList.add('dragging'); }
  let hit = document.elementFromPoint(e.clientX, e.clientY), t = hit ? hit.closest('.colorItem') : null;
  document.querySelectorAll('.colorItem').forEach(n => n.classList.remove('dropTarget'));
  if (t && t.dataset.index !== undefined) { colorDrag.targetIndex = Number(t.dataset.index); if (colorDrag.targetIndex !== colorDrag.index) t.classList.add('dropTarget'); }
  else colorDrag.targetIndex = colorDrag.index;
 }
 function endColorDrag(e) {
  if (!colorDrag || e.pointerId !== colorDrag.pointerId) return;
  let { index, targetIndex, active, item } = colorDrag; colorDrag = null;
  item.classList.remove('dragging'); document.querySelectorAll('.colorItem').forEach(n => n.classList.remove('dropTarget'));
  try { item.releasePointerCapture(e.pointerId); } catch (_) {}
  if (active && targetIndex !== index && targetIndex >= 0 && targetIndex < s.colors.length) swapColors(index, targetIndex);
 }

 async function generateFullCycle() {
  if (busy || working) return;
  let count = s.colors.length; if (count < 2) return notify('Add at least 2 colors to generate a cycle.');
  s.cycle = true; working = true;
  try {
   pushUndo();
   let f = candidate(), startIdx;
   if (isNew) {
    if (current.steps.length + count > 200) throw Error('Exceeds maximum 200 steps');
    startIdx = current.steps.length;
    for (let k = 0; k < count; k++) { let step = clone(f); step.id = uid(); await regenerate(step, db.layout, startIdx + k); current.steps.push(step); }
   } else {
    startIdx = current.steps.findIndex(x => x.id === f.id);
    if (startIdx < 0) throw Error('Step missing');
    if (startIdx + count > 200) throw Error('Exceeds maximum 200 steps');
    current.steps[startIdx] = f;
    for (let k = 1; k < count; k++) {
     let targetIdx = startIdx + k;
     if (targetIdx >= current.steps.length) current.steps.push(clone(f));
     else {
      let dst = current.steps[targetIdx];
      if (bgOpts) { dst.bgMode = f.bgMode; dst.bgSource = clone(f.bgSource); dst.bgPanels = clone(f.bgPanels); }
      else if (f.mode === 'span' || f.mode === 'repeat') { dst.mode = f.mode; dst.source = clone(f.source); dst.panels = [null, null, null, null]; }
      else { if (dst.mode !== 'panels') { dst.mode = 'panels'; dst.source = null; } dst.panels[Number(placement.value)] = clone(s); }
     }
    }
    for (let k = 0; k < count; k++) await regenerate(current.steps[startIdx + k], db.layout, startIdx + k);
   }
   selected = startIdx; revision++; working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
   notify('Generated ' + count + '-step color cycle.');
  } catch (e) { notify(e.message); } finally { working = false; }
 }

 function rebuild() {
  controls.replaceChildren();
  let shaped = ['heart', 'star', 'circle', 'square', 'diamond', 'triangle', 'arrow', 'dots'].includes(s.pattern), colors = el('div', undefined, 'colorRow');
  s.colors.forEach((color, i) => {
   let isTrans = color === 'transparent', item = el('div', undefined, 'colorItem'); item.dataset.index = i; item.draggable = true;
   let header = el('div', undefined, 'colorItemHeader'), handle = el('span', '⠿', 'colorDragHandle'), label = el('span', '#' + (i + 1), 'colorIndex'), nav = el('div', undefined, 'colorNav');
   handle.title = 'Drag to reorder';
   let leftBtn = document.createElement('button'); leftBtn.type = 'button'; leftBtn.className = 'colorMoveBtn'; leftBtn.textContent = '◀'; leftBtn.title = 'Move earlier'; leftBtn.disabled = i === 0;
   leftBtn.onclick = e => { e.stopPropagation(); swapColors(i, i - 1); };
   let rightBtn = document.createElement('button'); rightBtn.type = 'button'; rightBtn.className = 'colorMoveBtn'; rightBtn.textContent = '▶'; rightBtn.title = 'Move later'; rightBtn.disabled = i === s.colors.length - 1;
   rightBtn.onclick = e => { e.stopPropagation(); swapColors(i, i + 1); };
   nav.append(leftBtn, rightBtn); header.append(handle, label, nav);
   let input = document.createElement('input'); input.type = 'color'; input.value = isTrans ? '#000000' : color; if (isTrans) input.classList.add('isTransparent');
   input.oninput = () => { s.colors[i] = input.value; s.a = s.colors[0]; s.b = s.colors[1] || s.a; refresh(); };
   let transBtn = button('∅', e => { e.stopPropagation(); s.colors[i] = s.colors[i] === 'transparent' ? '#ffffff' : 'transparent'; s.a = s.colors[0]; s.b = s.colors[1] || s.a; rebuild(); refresh(); }, 'colorTransBtn' + (isTrans ? ' active' : ''));
   transBtn.title = isTrans ? 'Transparent (tap to set color)' : 'Make transparent';
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
  buttons(controls, [['Add color', () => { if (s.colors.length < 8) { s.colors.push('#ffffff'); rebuild(); refresh(); } }], ['Remove last', () => { if (s.colors.length > 1) { s.colors.pop(); rebuild(); refresh(); } }]]);
  if (s.colors.length > 1) controls.append(hint('Drag ⠿ or use ◀ / ▶ to reorder. Tap ∅ for transparent.'));
  if (s.pattern === 'solid') controls.append(hint('Solid uses the first palette color.'));
  if (s.pattern === 'border') controls.append(hint('Border uses the first color inside and second color on the edge.'));
  if (shaped) {
   let bgTrans = s.background === 'transparent', bgRow = el('div', undefined, 'bgColorRow');
   let bg = document.createElement('input'); bg.type = 'color'; bg.value = bgTrans ? '#000000' : s.background; if (bgTrans) bg.classList.add('isTransparent');
   bg.oninput = () => { s.background = bg.value; refresh(); };
   let bgTBtn = button(bgTrans ? 'Transparent (∅)' : 'Make transparent (∅)', () => { s.background = s.background === 'transparent' ? '#000000' : 'transparent'; rebuild(); refresh(); }, 'colorTransBtn' + (bgTrans ? ' active' : ''));
   bgRow.append(bg, bgTBtn); controls.append(field('Shape background', bgRow));
   choiceSlider('Direction / rotation', [[0, 'Up / 0°'], [90, 'Right / 90°'], [180, 'Down / 180°'], [270, 'Left / 270°']], 'rotation');
   check('Repeat shapes in a grid', 'tiled'); check('Outline instead of filled', 'outline'); number('Spacing', 'spacing', 0, 32);
  }
  if (['gradient', 'stripes', 'zigzag'].includes(s.pattern)) choiceSlider('Direction', [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['diagonal', 'Diagonal'], ['antidiagonal', 'Opposite diagonal']], 'direction');
  if (!['solid', 'gradient'].includes(s.pattern)) number(shaped ? 'Shape size' : 'Pattern width', 'size', 1, 64);
  if (s.outline || s.pattern === 'border') number('Outline / border thickness', 'thickness', 1, 8);
  check('Rotate colors across steps', 'cycle', true);
  if (s.cycle && s.colors.length > 1) buttons(controls, [['Generate full cycle (' + s.colors.length + ' steps)', generateFullCycle]]);
 }
 type.onchange = () => { s.pattern = type.value; if (!s.size) s.size = 4; rebuild(); refresh(); };
 placement.onchange = refresh; rebuild();

 buttons(b, [['Cancel', () => { revision++; closeSheet(true); if (live) previewCurrent(true); }], ['Done', async () => {
  if (busy || working) return;
  working = true;
  try {
   let f = candidate();
   if (!bgOpts && !isNew && f.mode !== 'panels' && frame.mode === 'panels' && frame.panels.some((p, i) => i !== target && p) && !confirm('Replace other panel images with this wall source?')) return;
   await commitStep(f, !!(bgOpts ? bgOpts.isNewStep : isNew));
   if (bgOpts && bgOpts.applyAll) {
    for (let k = 0; k < current.steps.length; k++) {
     current.steps[k].bgMode = f.bgMode; current.steps[k].bgSource = clone(f.bgSource); current.steps[k].bgPanels = clone(f.bgPanels);
     await regenerate(current.steps[k], db.layout, k);
    }
   }
   revision++; working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  } catch (e) { notify(e.message); } finally { working = false; }
 }, 'primary']]);

 if (!isNew && !bgOpts) {
  b.append(el('div', undefined, 'separator'));
  buttons(b, [['Remove pattern', () => {
   if (!confirm('Remove this pattern?')) return;
   let i = current.steps.findIndex(f => f.id === frame.id); if (i < 0) return;
   pushUndo();
   if (typeof target === 'string') {
    let prevBg = { bgMode: current.steps[i].bgMode, bgSource: current.steps[i].bgSource, bgPanels: current.steps[i].bgPanels };
    current.steps[i] = { ...blankFrame(), id: frame.id, ...prevBg };
   } else { current.steps[i].panels[target] = null; current.steps[i].tiles[target] = ''; }
   closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  }, 'danger'], ['Delete entire step', () => deleteStep(frame.id), 'danger']]);
  buttons(b, [['Move earlier', () => { closeSheet(); moveStep(frame.id, -1); }], ['Move later', () => { closeSheet(); moveStep(frame.id, 1); }]]);
 }
 refresh();
}

function openBackgroundEditor(frame, applyAllDefault = false, isNewStep = false) {
 openSheet('Background layer');
 let b = $('sheetBody'), f = clone(frame);
 if (!f.bgMode) f.bgMode = 'none';
 if (!Array.isArray(f.bgPanels)) f.bgPanels = [null, null, null, null];
 let session = { bg: true, rev: 0 }; editorSession = session;
 let bgType = select([['none', 'None (Black)'], ['image', 'Image'], ['pattern', 'Custom pattern / shapes']], f.bgMode === 'none' ? 'none' : ((f.bgMode === 'panels' ? f.bgPanels.find(Boolean) : f.bgSource)?.type || 'image'));
 let placement = select([['span', 'Span across all four'], ['repeat', 'Repeat on all four'], ['0', 'Display 1'], ['1', 'Display 2'], ['2', 'Display 3'], ['3', 'Display 4']], f.bgMode === 'none' ? 'span' : f.bgMode === 'panels' ? Math.max(0, f.bgPanels.findIndex(Boolean)) : f.bgMode);
 let controls = el('div'), view = el('div', undefined, 'wall miniPreview');
 b.append(field('Background type', bgType), field('Background placement', placement), controls, view);
 let activeBgSrc = (f.bgMode === 'panels' ? f.bgPanels.find(Boolean) : f.bgSource) || null;

 function syncFrame() {
  let out = clone(f), t = bgType.value, dest = ['span', 'repeat'].includes(placement.value) ? placement.value : Number(placement.value);
  if (t === 'none' || !activeBgSrc) { out.bgMode = 'none'; out.bgSource = null; out.bgPanels = [null, null, null, null]; }
  else if (typeof dest === 'string') { out.bgMode = dest; out.bgSource = clone(activeBgSrc); out.bgPanels = [null, null, null, null]; }
  else { out.bgMode = 'panels'; out.bgSource = null; out.bgPanels = [0, 1, 2, 3].map(i => i === dest ? clone(activeBgSrc) : null); }
  return out;
 }
 async function refresh() {
  let rev = ++session.rev;
  try {
   let cand = syncFrame(), idx = Math.max(0, current.steps.findIndex(x => x.id === cand.id));
   await regenerate(cand, db.layout, idx);
   if (editorSession !== session || rev !== session.rev) return;
   let w = makeWall(cand, db.layout, false); view.style.gridTemplateColumns = w.style.gridTemplateColumns; view.replaceChildren(...Array.from(w.children));
   queueTiles(cand.tiles, [0, 1, 2, 3], false, true);
  } catch (e) { notify(e.message); }
 }
 function rebuild() {
  controls.replaceChildren();
  placement.parentElement.hidden = bgType.value === 'none';
  if (bgType.value === 'none') return;
  if (bgType.value === 'image') {
   let pickBgGif = next => {
    let dest = ['span', 'repeat'].includes(placement.value) ? placement.value : Number(placement.value);
    let idx = isNewStep ? current.steps.length : Math.max(0, current.steps.findIndex(x => x.id === f.id));
    openGifEditor({ groupId: null, target: dest, layer: 'bg', insertIndex: idx, isNew: isNewStep, frames: next.frames, fit: next.fit || db.defaults.fit, smooth: db.defaults.smooth, alignX: 0.5, alignY: 0.5, zoom: 1, truncated: next.truncated });
   };
   if (activeBgSrc && activeBgSrc.gifGroupId && current.gifGroups && current.gifGroups[activeBgSrc.gifGroupId]) {
    let g = current.gifGroups[activeBgSrc.gifGroupId];
    buttons(controls, [['Edit background GIF', () => openGifEditor({ groupId: g.id, target: g.target, layer: 'bg', insertIndex: Math.max(0, current.steps.findIndex(x => x.id === f.id)), isNew: false, frames: clone(g.frames), fit: g.fit, smooth: g.smooth, alignX: g.alignX ?? 0.5, alignY: g.alignY ?? 0.5, zoom: g.zoom ?? 1, truncated: false }), 'primary']]);
   }
   if (!activeBgSrc || activeBgSrc.type !== 'image') {
    buttons(controls, [['Choose background image', () => pickImage(next => { if (next.type === 'gif') { pickBgGif(next); return; } activeBgSrc = next; rebuild(); refresh(); }), 'primary']]);
   } else {
    let img = el('img', undefined, 'sourcePreview'); img.src = activeBgSrc.src; img.alt = 'Background'; controls.append(img);
    buttons(controls, [['Change image', () => pickImage(next => { if (next.type === 'gif') { pickBgGif(next); return; } activeBgSrc = next; rebuild(); refresh(); })]]);
    buildImageControls(controls, activeBgSrc, refresh);
   }
  } else {
   if (!activeBgSrc || activeBgSrc.type !== 'pattern') activeBgSrc = patternSpec();
   buttons(controls, [['Edit pattern & colors', () => {
    let cand = syncFrame();
    advancedPattern(cand, placement.value === 'span' || placement.value === 'repeat' ? placement.value : Number(placement.value), false, activeBgSrc, { applyAll: applyAllDefault });
   }, 'primary']]);
  }
 }
 bgType.onchange = () => { if (bgType.value === 'pattern' && (!activeBgSrc || activeBgSrc.type !== 'pattern')) activeBgSrc = patternSpec(); rebuild(); refresh(); };
 placement.onchange = refresh; rebuild();

 async function commitBg(allSteps) {
  if (working || busy) return;
  working = true;
  try {
   let cand = syncFrame();
   await commitStep(cand, isNewStep);
   if (allSteps) {
    for (let k = 0; k < current.steps.length; k++) {
     current.steps[k].bgMode = cand.bgMode; current.steps[k].bgSource = clone(cand.bgSource); current.steps[k].bgPanels = clone(cand.bgPanels);
     await regenerate(current.steps[k], db.layout, k);
    }
   }
   working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  } catch (e) { notify(e.message); } finally { working = false; }
 }
 buttons(b, [['Cancel', () => closeSheet(true)], ['Apply to this step', () => commitBg(false), applyAllDefault ? '' : 'primary'], ['Apply to all steps', () => commitBg(true), applyAllDefault ? 'primary' : '']]);
 refresh();
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
    if (step.mode !== 'panels') {
     let oldTiles = step.tiles.slice(); step.mode = 'panels'; step.source = null;
     step.panels = [0, 1, 2, 3].map(p => oldTiles[p] ? { type: 'image', src: oldTiles[p], fit: 'actual', smooth: false, alignX: 0.5, alignY: 0.5, zoom: 1 } : null);
    }
    step.panels[slot] = clone(srcSpec); step.tiles[slot] = outTile;
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
 openSheet('Step ' + (current.steps.indexOf(f) + 1));
 let b = $('sheetBody');
 if (f.mode !== 'panels') buttons(b, [['Edit source', () => openSource(id, 0), 'primary']]);
 else { let positions = el('div', undefined, 'placement'); for (let i = 0; i < 4; i++) positions.append(button('Display ' + (i + 1), () => openSource(id, i))); b.append(positions); }
 buttons(b, [['Background layer', () => openBackgroundEditor(clone(f))], ['Copy / mirror tile', () => copyTileSheet(id)]]);
 buttons(b, [['Move earlier', () => { closeSheet(false); moveStep(id, -1); }], ['Move later', () => { closeSheet(false); moveStep(id, 1); }]]);
 buttons(b, [['Duplicate', async () => {
  if (current.steps.length >= 200) return;
  pushUndo();
  let copy = clone(f); copy.id = uid();
  let i = current.steps.findIndex(x => x.id === id);
  current.steps.splice(i + 1, 0, copy); selected = i + 1;
  await refreshCyclingSteps(); closeSheet(false); changed(); renderEditor(); previewCurrent(true);
 }], ['Delete step', () => deleteStep(id), 'danger']]);
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
