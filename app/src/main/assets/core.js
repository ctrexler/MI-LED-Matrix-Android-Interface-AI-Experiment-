"use strict";
const APP_VERSION = '0.6.0';
const $ = id => document.getElementById(id);
const clone = x => typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x));
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

let db = {
 version: 3,
 sequences: [],
 assignments: ['', '', '', ''],
 layout: 2,
 autoConnect: false,
 previewCollapsed: false,
 defaults: { fit: 'contain', smooth: false },
 calibration: { gamma: 2.2, cutoff: 0, brightness: 100, simulate: false },
 previewSeconds: 1.5,
 draft: null,
 stored: {}
};

let current, selected = 0, dirty = true, page = 'editor', busy = false, working = false, live = false;
let editorSession = null, pickerCallback = null, scanSlot = 0, scanSession = false, saveTimer = null;
let states = ['Not connected', 'Not connected', 'Not connected', 'Not connected'];
let ready = [false, false, false, false];
let playback = null, playTimer = null, frameEpoch = 0, liveTimer = null;
let pendingTiles = [undefined, undefined, undefined, undefined];
let lastTiles = [undefined, undefined, undefined, undefined];
let liveVersions = [0, 0, 0, 0];
let storedSlot = 0, storageDraft = null, undoStack = [], redoStack = [];
const imageCache = new Map(), simCache = new Map();
const extraPatterns = ['heart', 'star', 'circle', 'square', 'diamond', 'triangle', 'arrow', 'diamonds', 'dots', 'zigzag'];

const blankLayer = (mode = 'panels', source = null, panels = [null, null, null, null], name = 'Layer 1') => ({ id: uid(), name, visible: true, mode, source, panels });
const blankFrame = () => ({ id: uid(), mode: 'panels', source: null, panels: [null, null, null, null], tiles: ['', '', '', ''], bgMode: 'none', bgSource: null, bgPanels: [null, null, null, null], layers: [blankLayer('panels', null, [null, null, null, null], 'Layer 1')] });
const blankSequence = () => ({ id: uid(), name: 'New sequence', cols: db.layout, steps: [], gifGroups: {} });
const imageSpec = (src, fit = db.defaults.fit) => ({ type: 'image', src, fit, smooth: db.defaults.smooth, alignX: 0.5, alignY: 0.5, zoom: 1 });
const patternSpec = () => ({ type: 'pattern', pattern: 'gradient', a: '#ff3377', b: '#3377ff', colors: ['#ff3377', '#3377ff'], background: '#000000', direction: 'diagonal', size: 4, thickness: 1, rotation: 0, tiled: false, outline: false, spacing: 0, cycle: false });
const imageData = t => typeof t === 'string' && t.length <= 24_000_000 && /^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=]+$/.test(t);
const isColor = c => c === 'transparent' || (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
function palette(s) { return Array.isArray(s.colors) && s.colors.length ? s.colors : [s.a || '#ff3377', s.b || '#3377ff']; }

function normalizeSource(s) {
 if (s == null) return null;
 if (typeof s !== 'object') throw Error('Invalid image source');
 if (s.type === 'pattern') {
  const validPatterns = ['solid', 'gradient', 'checker', 'stripes', 'border', 'diamonds', 'zigzag', 'dots', 'heart', 'star', 'circle', 'square', 'diamond', 'triangle', 'arrow'];
  if (!validPatterns.includes(s.pattern)) throw Error('Invalid pattern');
  let colors = Array.isArray(s.colors) ? s.colors.slice(0, 8) : [s.a || '#ff3377', s.b || '#3377ff'];
  if (colors.length < 1 || colors.some(c => !isColor(c))) throw Error('Invalid palette');
  let a = isColor(s.a) ? s.a : colors[0];
  let b = isColor(s.b) ? s.b : (colors[1] || colors[0]);
  let background = isColor(s.background) ? s.background : '#000000';
  let direction = ['horizontal', 'vertical', 'diagonal', 'antidiagonal'].includes(s.direction) ? s.direction : 'diagonal';
  let rotation = [0, 90, 180, 270].includes(Number(s.rotation)) ? Number(s.rotation) : 0;
  let spacing = Math.max(0, Math.min(32, Math.round(Number(s.spacing) || 0)));
  let size = Math.max(1, Math.min(64, Math.round(Number(s.size) || 4)));
  let thickness = Math.max(1, Math.min(8, Number(s.thickness) || 1));
  return { type: 'pattern', pattern: s.pattern, a, b, colors, background, direction, rotation, tiled: !!s.tiled, outline: !!s.outline, cycle: !!s.cycle, spacing, size, thickness };
 }
 if (!imageData(s.src) || !['contain', 'cover', 'stretch', 'actual'].includes(s.fit) || typeof s.smooth !== 'boolean') throw Error('Invalid image');
 let alignX = Number.isFinite(s.alignX) ? Math.max(0, Math.min(1, s.alignX)) : 0.5;
 let alignY = Number.isFinite(s.alignY) ? Math.max(0, Math.min(1, s.alignY)) : 0.5;
 let zoom = Number.isFinite(s.zoom) ? Math.max(0.25, Math.min(4, s.zoom)) : 1;
 let img = { type: 'image', src: s.src, fit: s.fit, smooth: s.smooth, alignX, alignY, zoom };
 if (typeof s.gifGroupId === 'string') img.gifGroupId = s.gifGroupId;
 if (typeof s.gifFrameId === 'string') img.gifFrameId = s.gifFrameId;
 return img;
}

function ensureStepLayers(f) {
 if (Array.isArray(f.layers) && f.layers.length) return f.layers;
 let list = [];
 if (f.bgMode && f.bgMode !== 'none') {
  list.push(blankLayer(f.bgMode, f.bgSource || null, Array.isArray(f.bgPanels) ? f.bgPanels : [null, null, null, null], 'Background'));
 }
 list.push(blankLayer(f.mode || 'panels', f.source || null, Array.isArray(f.panels) ? f.panels : [null, null, null, null], list.length ? 'Foreground' : 'Layer 1'));
 f.layers = list;
 return list;
}

function syncLegacyFields(f) {
 let layers = ensureStepLayers(f);
 let top = layers[layers.length - 1] || blankLayer();
 f.mode = top.mode; f.source = top.source; f.panels = top.panels;
 if (layers.length > 1) {
  let bot = layers[0];
  f.bgMode = bot.mode; f.bgSource = bot.source; f.bgPanels = bot.panels;
 } else {
  f.bgMode = 'none'; f.bgSource = null; f.bgPanels = [null, null, null, null];
 }
}

function normalizeLayer(L, idx) {
 if (!L || typeof L !== 'object') throw Error('Invalid layer');
 let mode = ['span', 'repeat', 'panels'].includes(L.mode) ? L.mode : 'panels';
 let source = mode !== 'panels' ? normalizeSource(L.source) : null;
 let panels = Array.isArray(L.panels) && L.panels.length === 4 ? L.panels.map(normalizeSource) : [null, null, null, null];
 if (mode !== 'panels' && !source) mode = 'panels';
 return { id: typeof L.id === 'string' ? L.id : uid(), name: typeof L.name === 'string' && L.name.trim() ? L.name.slice(0, 40) : 'Layer ' + (idx + 1), visible: L.visible !== false, mode, source, panels };
}

function normalizeSequence(s) {
 if (!s || typeof s.name !== 'string' || !Array.isArray(s.steps) || s.steps.length > 200) throw Error('Invalid sequence');
 let cols = [1, 2, 4].includes(s.cols) ? s.cols : 2;
 let gifGroups = {};
 if (s.gifGroups && typeof s.gifGroups === 'object' && !Array.isArray(s.gifGroups)) {
  for (let [gid, g] of Object.entries(s.gifGroups)) {
   if (!g || typeof g !== 'object' || !Array.isArray(g.frames) || g.frames.length > 25) continue;
   let target = (g.target === 'span' || g.target === 'repeat') ? g.target : ([0, 1, 2, 3].includes(Number(g.target)) ? Number(g.target) : 'span');
   let fit = ['contain', 'cover', 'stretch', 'actual'].includes(g.fit) ? g.fit : 'contain';
   let alignX = Number.isFinite(g.alignX) ? Math.max(0, Math.min(1, g.alignX)) : 0.5;
   let alignY = Number.isFinite(g.alignY) ? Math.max(0, Math.min(1, g.alignY)) : 0.5;
   let zoom = Number.isFinite(g.zoom) ? Math.max(0.25, Math.min(4, g.zoom)) : 1;
   let layer = g.layer === 'bg' ? 'bg' : 'fg';
   let frames = g.frames.filter(fr => fr && typeof fr === 'object' && imageData(fr.src)).map(fr => ({ id: typeof fr.id === 'string' ? fr.id : uid(), src: fr.src, deleted: !!fr.deleted }));
   if (frames.length) gifGroups[gid] = { id: gid, target, layer, fit, smooth: !!g.smooth, alignX, alignY, zoom, frames };
  }
 }
 return {
  id: typeof s.id === 'string' ? s.id : uid(),
  name: s.name.slice(0, 100),
  cols,
  gifGroups,
  steps: s.steps.map(f => {
   if (!f || !Array.isArray(f.tiles) || f.tiles.length !== 4 || f.tiles.some(t => t !== '' && !imageData(t))) throw Error('Invalid rendered tiles');
   if (!f.mode && !f.kind && !Array.isArray(f.layers)) {
    let panels = f.tiles.map(t => t ? { type: 'image', src: t, fit: 'contain', smooth: false } : null);
    let step = { id: uid(), mode: 'panels', source: null, panels, tiles: f.tiles.slice(), bgMode: 'none', bgSource: null, bgPanels: [null, null, null, null] };
    ensureStepLayers(step);
    return step;
   }
   let mode = f.mode || (f.kind === 'wall' ? 'span' : 'panels');
   if (!['span', 'repeat', 'panels'].includes(mode) || !Array.isArray(f.panels) || f.panels.length !== 4) throw Error('Invalid step mode');
   let source = normalizeSource(f.source || f.wall), panels = f.panels.map(normalizeSource);
   if (mode !== 'panels' && !source) throw Error('Missing source');
   let bgMode = ['none', 'span', 'repeat', 'panels'].includes(f.bgMode) ? f.bgMode : 'none';
   let bgSource = bgMode === 'span' || bgMode === 'repeat' ? normalizeSource(f.bgSource) : null;
   let bgPanels = Array.isArray(f.bgPanels) && f.bgPanels.length === 4 ? f.bgPanels.map(normalizeSource) : [null, null, null, null];
   if ((bgMode === 'span' || bgMode === 'repeat') && !bgSource) bgMode = 'none';
   let step = { id: typeof f.id === 'string' ? f.id : uid(), mode, source, panels, tiles: f.tiles.slice(), bgMode, bgSource, bgPanels };
   if (Array.isArray(f.layers) && f.layers.length) step.layers = f.layers.slice(0, 8).map(normalizeLayer);
   ensureStepLayers(step);
   syncLegacyFields(step);
   return step;
  })
 };
}

function validStorage(value) {
 let out = {};
 if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
 for (let [key, r] of Object.entries(value)) {
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(key) || !r || !Array.isArray(r.images) || r.images.length > 10000) continue;
  let images = r.images.map(t => {
   if (!t || !(t.tile === '' || imageData(t.tile))) throw Error('Invalid tracked image');
   return { id: typeof t.id === 'string' ? t.id : uid(), tile: t.tile, name: typeof t.name === 'string' ? t.name.slice(0, 150) : 'Image' };
  });
  out[key] = { status: ['tracked', 'partial', 'uncertain', 'unknown'].includes(r.status) ? r.status : 'unknown', images, updated: typeof r.updated === 'string' ? r.updated : null };
 }
 return out;
}

function log(s) { $('log').textContent = (new Date().toLocaleTimeString() + ' ' + s + '\n' + $('log').textContent).slice(0, 65000); }
function notify(s) { $('notice').textContent = s; log(s); }
function progress(n, total) { $('transferProgress').max = total; $('transferProgress').value = n; }
function transferLabel(text) { $('transferText').textContent = text; }
function store() { let error = Native.save(JSON.stringify(db)); if (error) { $('saveState').textContent = 'Save failed — export'; log(error); return false; } return true; }
function updateSaveState() { $('saveState').textContent = dirty ? 'Draft saved · Save to library' : 'Saved to library'; }
function flushDraft() { clearTimeout(saveTimer); if (!current) return; db.draft = { sequence: clone(current), selected, dirty }; if (store()) updateSaveState(); }
function draftSoon() { clearTimeout(saveTimer); $('saveState').textContent = 'Saving draft…'; saveTimer = setTimeout(flushDraft, 650); }
function changed() { dirty = true; draftSoon(); }

function el(tag, text, cls) { let n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function button(text, fn, cls) { let b = el('button', text, cls); b.type = 'button'; b.onclick = fn; return b; }
function hint(t) { return el('p', t, 'hint'); }
function buttons(parent, items) { let row = el('div', undefined, 'sheetButtons'); for (let [text, fn, cls] of items) row.append(button(text, fn, cls)); parent.append(row); return row; }
function field(text, node) { let l = el('label', text, 'field'); l.append(node); return l; }
function select(options, value) { let n = document.createElement('select'); for (let [v, t] of options) { let o = el('option', t); o.value = v; n.append(o); } n.value = String(value); return n; }
function bind(id, fn) { let node = $(id); if (node) node.addEventListener('click', fn); }

function showPage(p) {
 if (page === 'stored' && p !== 'stored' && storageDraft) { if (!confirm('Discard unapplied stored-image edits?')) return; storageDraft = null; }
 if (page === 'editor') flushDraft();
 if (playback && playback.kind === 'editor' && p !== 'editor') pausePlayback();
 page = p;
 document.querySelectorAll('.page').forEach(n => n.hidden = n.id !== p);
 $('pageTitle').textContent = { editor: 'Editor', library: 'Library', devices: 'Displays', logs: 'Logs', stored: 'Stored Images', about: 'About' }[p] || 'LED Matrix Controller';
 $('saveBtn').hidden = p !== 'editor';
 closeDrawer();
 if (p === 'library') renderLibrary();
 if (p === 'stored') { pausePlayback(); renderStored(); }
}

function openDrawer() {
 if (!$('sheet').hidden) return;
 $('drawer').hidden = $('drawerShade').hidden = false;
 $('menuBtn').setAttribute('aria-expanded', 'true');
 document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
 $('drawer').querySelector('button').focus();
}
function closeDrawer() { $('drawer').hidden = $('drawerShade').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
function openSheet(title) { pausePlayback(); if (scanSession) { Native.stopScanNow(); scanSession = false; } closeDrawer(); editorSession = null; $('sheetTitle').textContent = title; $('sheetBody').replaceChildren(); $('sheet').hidden = $('sheetShade').hidden = false; $('sheet').focus(); }
function closeSheet(restore = true) { if (working) return; if (scanSession) { Native.stopScanNow(); scanSession = false; } let wasEdit = !!editorSession; editorSession = null; frameEpoch++; $('sheet').hidden = $('sheetShade').hidden = true; if (wasEdit && restore && live) previewCurrent(true); }
function handleBack() { if (!$('sheet').hidden) { closeSheet(); return true; } if (!$('drawer').hidden) { closeDrawer(); return true; } if (page !== 'editor') { showPage('editor'); return true; } flushDraft(); return false; }
