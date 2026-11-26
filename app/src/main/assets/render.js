"use strict";

let scratch16 = null;
function getScratch16() {
 if (!scratch16) scratch16 = canvas(16, 16, false);
 return scratch16;
}

function canvas(w, h, transparent = false) {
 let c = document.createElement('canvas');
 c.width = w; c.height = h;
 if (!transparent) {
  let x = c.getContext('2d');
  x.fillStyle = 'black';
  x.fillRect(0, 0, w, h);
 }
 return c;
}

function blackTile() { return canvas(16, 16).toDataURL('image/png'); }

function loadImage(src) {
 if (imageCache.has(src)) return imageCache.get(src);
 let p = new Promise((ok, no) => {
  let i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => no(Error('Cannot decode image'));
  i.src = src;
 });
 imageCache.set(src, p);
 if (imageCache.size > 24) imageCache.delete(imageCache.keys().next().value);
 return p;
}

function calibrationLut() {
 let cal = db.calibration || { gamma: 2.2, cutoff: 0, brightness: 100 };
 let gamma = Math.max(1, Math.min(3, Number(cal.gamma) || 2.2));
 let cutoff = Math.max(0, Math.min(128, Math.round(Number(cal.cutoff) || 0)));
 let bright = Math.max(0.1, Math.min(1, (Number(cal.brightness) || 100) / 100));
 let lut = new Uint8Array(256);
 for (let v = 0; v < 256; v++) {
  if (v <= cutoff) { lut[v] = 0; continue; }
  let norm = (v - cutoff) / (255 - cutoff);
  lut[v] = Math.min(255, Math.max(0, Math.round(Math.pow(norm, gamma) * 255 * bright)));
 }
 return lut;
}

function displayTileSrc(imgEl, rawSrc) {
 imgEl.src = rawSrc;
 let cal = db.calibration;
 if (!cal || !cal.simulate || !rawSrc) return;
 let key = rawSrc + '|' + cal.gamma + '|' + cal.cutoff + '|' + cal.brightness;
 if (simCache.has(key)) { imgEl.src = simCache.get(key); return; }
 loadImage(rawSrc).then(im => {
  let c = getScratch16(), x = c.getContext('2d');
  x.fillStyle = 'black';
  x.fillRect(0, 0, 16, 16);
  x.drawImage(im, 0, 0, 16, 16);
  let d = x.getImageData(0, 0, 16, 16), a = d.data, lut = calibrationLut();
  for (let k = 0; k < a.length; k += 4) { a[k] = lut[a[k]]; a[k + 1] = lut[a[k + 1]]; a[k + 2] = lut[a[k + 2]]; }
  x.putImageData(d, 0, 0);
  let out = c.toDataURL('image/png');
  if (simCache.size > 250) simCache.clear();
  simCache.set(key, out);
  imgEl.src = out;
 }).catch(() => {});
}

async function rgbTile(t) {
 let c = getScratch16(), x = c.getContext('2d');
 x.fillStyle = 'black';
 x.fillRect(0, 0, 16, 16);
 if (t) x.drawImage(await loadImage(t), 0, 0, 16, 16);
 let a = x.getImageData(0, 0, 16, 16).data, lut = calibrationLut(), b = '';
 for (let i = 0; i < 256; i++) b += String.fromCharCode(lut[a[i * 4]], lut[a[i * 4 + 1]], lut[a[i * 4 + 2]]);
 return btoa(b);
}

function makeWall(frame, cols = 2, interactive = true) {
 let wall = el('div', undefined, 'wall');
 wall.style.gridTemplateColumns = 'repeat(' + cols + ',minmax(0,1fr))';
 for (let i = 0; i < 4; i++) {
  let t = el(interactive ? 'button' : 'div', undefined, 'tile' + (!frame || !frame.tiles[i] ? ' empty' : ''));
  t.dataset.panel = i;
  if (interactive) { t.type = 'button'; t.setAttribute('aria-label', 'Display ' + (i + 1)); }
  if (frame && frame.tiles[i]) {
   let img = document.createElement('img');
   img.alt = '';
   img.draggable = false;
   displayTileSrc(img, frame.tiles[i]);
   t.append(img);
  }
  wall.append(t);
 }
 return wall;
}

function shapePath(x, k, r) {
 x.beginPath();
 if (k === 'circle') x.arc(0, 0, r, 0, Math.PI * 2);
 else if (k === 'heart') { x.moveTo(0, r * 0.85); x.bezierCurveTo(-r * 1.6, -r * 0.1, -r * 0.9, -r * 1.4, 0, -r * 0.5); x.bezierCurveTo(r * 0.9, -r * 1.4, r * 1.6, -r * 0.1, 0, r * 0.85); }
 else if (k === 'star') {
  for (let i = 0; i < 10; i++) {
   let a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
   let px = Math.cos(a) * rad, py = Math.sin(a) * rad;
   if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
 } else if (k === 'triangle') { x.moveTo(0, -r); x.lineTo(r, r); x.lineTo(-r, r); }
 else if (k === 'diamond') { x.moveTo(0, -r); x.lineTo(r, 0); x.lineTo(0, r); x.lineTo(-r, 0); }
 else if (k === 'arrow') { x.moveTo(0, -r); x.lineTo(r, 0); x.lineTo(r * 0.4, 0); x.lineTo(r * 0.4, r); x.lineTo(-r * 0.4, r); x.lineTo(-r * 0.4, 0); x.lineTo(-r, 0); }
 else x.rect(-r, -r, r * 2, r * 2);
 x.closePath();
}

function rotatedPalette(s, stepOffset = 0) {
 let p = palette(s);
 if (s.cycle && stepOffset > 0 && p.length > 1) {
  let r = ((stepOffset % p.length) + p.length) % p.length;
  p = p.slice(r).concat(p.slice(0, r));
 }
 return p;
}

function drawPattern(s, w, h, stepOffset = 0, transparent = false) {
 let c = canvas(w, h, transparent), x = c.getContext('2d'), p = rotatedPalette(s, stepOffset), size = Math.max(1, Math.round(s.size || 4));
 let shapes = ['heart', 'star', 'circle', 'square', 'diamond', 'triangle', 'arrow'];
 if (shapes.includes(s.pattern) || s.pattern === 'dots') {
  if (s.background !== 'transparent') { x.fillStyle = s.background || '#000000'; x.fillRect(0, 0, w, h); }
  let tiled = s.tiled || s.pattern === 'dots', step = size + (s.spacing || 0), points = [];
  if (tiled) { for (let y = size / 2; y < h; y += Math.max(1, step)) for (let z = size / 2; z < w; z += Math.max(1, step)) points.push([z, y]); }
  else points = [[w / 2, h / 2]];
  points.forEach(([z, y], i) => {
   let col = p[i % p.length];
   x.save(); x.translate(z, y); x.rotate((s.rotation || 0) * Math.PI / 180);
   shapePath(x, s.pattern === 'dots' ? 'circle' : s.pattern, Math.max(0.5, size / 2 - 0.5));
   x.lineWidth = s.thickness || 1;
   if (col === 'transparent') {
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = x.strokeStyle = 'rgba(0,0,0,1)';
    if (s.outline) x.stroke(); else x.fill();
   } else {
    x.fillStyle = x.strokeStyle = col;
    if (s.outline) x.stroke(); else x.fill();
   }
   x.restore();
  });
  return c;
 }
 if (s.pattern === 'gradient') {
  let coords = s.direction === 'horizontal' ? [0, 0, w, 0] : s.direction === 'vertical' ? [0, 0, 0, h] : s.direction === 'antidiagonal' ? [w, 0, 0, h] : [0, 0, w, h];
  let g = x.createLinearGradient(...coords);
  if (p.length === 1) { if (p[0] === 'transparent') return c; x.fillStyle = p[0]; }
  else { p.forEach((color, i) => g.addColorStop(i / (p.length - 1), color === 'transparent' ? 'rgba(0,0,0,0)' : color)); x.fillStyle = g; }
  x.fillRect(0, 0, w, h);
  return c;
 }
 if (s.pattern === 'solid') { if (p[0] !== 'transparent') { x.fillStyle = p[0]; x.fillRect(0, 0, w, h); } return c; }
 if (s.pattern === 'border') {
  let t = Math.max(1, Math.round(s.thickness || 1));
  if (p[0] !== 'transparent') { x.fillStyle = p[0]; x.fillRect(t, t, Math.max(0, w - 2 * t), Math.max(0, h - 2 * t)); }
  let edge = p[1] || p[0];
  if (edge !== 'transparent') { x.fillStyle = edge; x.fillRect(0, 0, w, t); x.fillRect(0, h - t, w, t); x.fillRect(0, t, t, Math.max(0, h - 2 * t)); x.fillRect(w - t, t, t, Math.max(0, h - 2 * t)); }
  return c;
 }
 if (s.pattern === 'checker') {
  for (let y = 0; y < h; y += size) for (let z = 0; z < w; z += size) {
   let col = ((Math.floor(y / size) + Math.floor(z / size)) % 2) ? (p[1] || p[0]) : p[0];
   if (col !== 'transparent') { x.fillStyle = col; x.fillRect(z, y, size, size); }
  }
  return c;
 }
 for (let y = 0; y < h; y++) for (let z = 0; z < w; z++) {
  let n;
  if (s.pattern === 'diamonds') n = Math.floor(Math.abs(z - w / 2) + Math.abs(y - h / 2) / size);
  else if (s.pattern === 'zigzag') {
   let a = s.direction === 'horizontal' ? y : z, b = s.direction === 'horizontal' ? z : y;
   let diag = (s.direction === 'diagonal' || s.direction === 'antidiagonal') ? (s.direction === 'antidiagonal' ? z - y + h : z + y) : a;
   n = Math.floor((diag + Math.abs((b % (size * 2)) - size)) / size);
  } else {
   let axis = s.direction === 'vertical' ? z : s.direction === 'horizontal' ? y : s.direction === 'antidiagonal' ? z - y + h : z + y;
   n = Math.floor(axis / size);
  }
  let col = p[((n % p.length) + p.length) % p.length];
  if (col !== 'transparent') { x.fillStyle = col; x.fillRect(z, y, 1, 1); }
 }
 return c;
}

async function renderSource(s, w, h, stepOffset = 0, transparent = false) {
 if (!s) return canvas(w, h, transparent);
 if (s.type === 'pattern') return drawPattern(s, w, h, stepOffset, transparent);
 let c = canvas(w, h, transparent), x = c.getContext('2d'), i = await loadImage(s.src);
 x.imageSmoothingEnabled = s.smooth;
 x.imageSmoothingQuality = 'high';
 if (s.fit === 'stretch') x.drawImage(i, 0, 0, w, h);
 else {
  let zoom = (s.fit === 'actual' && Number.isFinite(s.zoom)) ? Math.max(0.25, Math.min(4, s.zoom)) : 1;
  let scale = s.fit === 'actual' ? zoom : (s.fit === 'cover' ? Math.max : Math.min)(w / i.width, h / i.height);
  let iw = Math.max(1, Math.round(i.width * scale)), ih = Math.max(1, Math.round(i.height * scale));
  let ax = Number.isFinite(s.alignX) ? s.alignX : 0.5, ay = Number.isFinite(s.alignY) ? s.alignY : 0.5;
  x.drawImage(i, Math.round((w - iw) * ax), Math.round((h - ih) * ay), iw, ih);
 }
 return c;
}

function sourceCycles(s) { return !!(s && s.type === 'pattern' && s.cycle); }
function stepCycles(f) {
 if (!f) return false;
 if ((f.mode === 'span' || f.mode === 'repeat') && sourceCycles(f.source)) return true;
 if (f.mode === 'panels' && Array.isArray(f.panels) && f.panels.some(sourceCycles)) return true;
 if ((f.bgMode === 'span' || f.bgMode === 'repeat') && sourceCycles(f.bgSource)) return true;
 if (f.bgMode === 'panels' && Array.isArray(f.bgPanels) && f.bgPanels.some(sourceCycles)) return true;
 return false;
}
async function refreshCyclingSteps() {
 for (let i = 0; i < current.steps.length; i++) if (stepCycles(current.steps[i])) await regenerate(current.steps[i], db.layout, i);
}

async function regenerate(f, cols = db.layout, stepIndex = null) {
 let idx = stepIndex !== null ? stepIndex : (current ? Math.max(0, current.steps.indexOf(f)) : 0);
 let bgMode = f.bgMode || 'none', bg = [null, null, null, null];
 if (bgMode === 'span' && f.bgSource) {
  let bc = await renderSource(f.bgSource, cols * 16, 64 / cols, idx, false);
  for (let i = 0; i < 4; i++) { bg[i] = canvas(16, 16, false); bg[i].getContext('2d').drawImage(bc, (i % cols) * 16, Math.floor(i / cols) * 16, 16, 16, 0, 0, 16, 16); }
 } else if (bgMode === 'repeat' && f.bgSource) {
  let tile = await renderSource(f.bgSource, 16, 16, idx, false);
  for (let i = 0; i < 4; i++) bg[i] = tile;
 } else if (bgMode === 'panels' && Array.isArray(f.bgPanels)) {
  for (let i = 0; i < 4; i++) if (f.bgPanels[i]) bg[i] = await renderSource(f.bgPanels[i], 16, 16, idx, false);
 }
 const composite = (fg, i) => {
  let out = canvas(16, 16, false), ox = out.getContext('2d');
  if (bg[i]) ox.drawImage(bg[i], 0, 0, 16, 16);
  if (fg) ox.drawImage(fg, 0, 0, 16, 16);
  return out.toDataURL('image/png');
 };
 if (f.mode === 'span') {
  let c = await renderSource(f.source, cols * 16, 64 / cols, idx, bgMode !== 'none');
  for (let i = 0; i < 4; i++) {
   let t = canvas(16, 16, true);
   t.getContext('2d').drawImage(c, (i % cols) * 16, Math.floor(i / cols) * 16, 16, 16, 0, 0, 16, 16);
   f.tiles[i] = composite(t, i);
  }
 } else if (f.mode === 'repeat') {
  let fg = await renderSource(f.source, 16, 16, idx, bgMode !== 'none');
  for (let i = 0; i < 4; i++) f.tiles[i] = composite(fg, i);
 } else {
  for (let i = 0; i < 4; i++) {
   if (f.panels[i]) {
    let fg = await renderSource(f.panels[i], 16, 16, idx, bgMode !== 'none');
    f.tiles[i] = composite(fg, i);
   } else f.tiles[i] = bg[i] ? composite(null, i) : '';
  }
 }
}

function clearPending() { clearTimeout(liveTimer); pendingTiles = [undefined, undefined, undefined, undefined]; liveVersions = liveVersions.map(n => n + 1); lastTiles = [undefined, undefined, undefined, undefined]; }
function setLive(enabled) {
 live = enabled; clearPending(); Native.setLive(enabled); renderPreview();
 if (enabled) {
  if (!ready.some(Boolean)) notify('Live Preview enabled. Connect displays to see it on hardware.');
  previewCurrent(true);
 } else if (playback && playback.kind === 'library') pausePlayback();
}

function queueTiles(tiles, mask = [0, 1, 2, 3], force = false, immediate = false) {
 if (!live || busy) return;
 for (let i of mask) {
  if (!ready[i]) continue;
  if (force) lastTiles[i] = undefined;
  pendingTiles[i] = tiles[i] || '';
  liveVersions[i]++;
 }
 clearTimeout(liveTimer);
 if (immediate) flushLive();
 else liveTimer = setTimeout(flushLive, 180);
}

async function flushLive() {
 if (!live || busy) return;
 let batch = pendingTiles.slice(), versions = liveVersions.slice(), encoded = [null, null, null, null];
 pendingTiles = [undefined, undefined, undefined, undefined];
 try {
  await Promise.all([0, 1, 2, 3].map(async i => {
   if (batch[i] !== undefined && ready[i] && batch[i] !== lastTiles[i]) {
    let rgb = await rgbTile(batch[i]);
    if (versions[i] === liveVersions[i] && live && !busy) { encoded[i] = rgb; lastTiles[i] = batch[i]; }
   }
  }));
  if (live && !busy && encoded.some(x => x !== null)) Native.preview(JSON.stringify(encoded));
 } catch (e) { log('Live preview preparation: ' + e.message); }
}

function previewCurrent(force = false) {
 let f = playback ? playback.sequence.steps[playback.index] : current.steps[selected];
 queueTiles(f ? f.tiles : ['', '', '', ''], [0, 1, 2, 3], force, force);
}

function liveError(i) { lastTiles[i] = undefined; log('Temporary image transfer failed on display ' + (i + 1) + '.'); }
function pausePlayback() {
 let wasPlaying = !!playback;
 clearTimeout(playTimer); playTimer = null; playback = null;
 if (current) { renderPreview(); if (wasPlaying) updateGridSelection(); }
 updateLibraryPlayback();
}

function startPlayback(kind, sequence) {
 if (busy || working) return;
 if (kind === 'editor' && playback && playback.kind === 'editor') { pausePlayback(); return; }
 if (!sequence.steps.length) return notify('This sequence is empty.');
 pausePlayback(); closeSheet(false);
 if (!live) { live = true; clearPending(); Native.setLive(true); }
 else clearPending();
 playback = { kind, sequence: kind === 'library' ? clone(sequence) : sequence, index: kind === 'editor' ? selected : 0 };
 function tick() {
  if (!playback) return;
  if (playback.kind === 'editor') { selected = playback.index; updateGridSelection(); renderPreview(); }
  queueTiles(playback.sequence.steps[playback.index].tiles, [0, 1, 2, 3], true, true);
  updateLibraryPlayback();
  playTimer = setTimeout(() => {
   if (!playback) return;
   playback.index = (playback.index + 1) % playback.sequence.steps.length;
   tick();
  }, db.previewSeconds * 1000);
 }
 tick(); renderPreview();
}

function updateLibraryPlayback() {
 let active = playback && playback.kind === 'library';
 $('libraryPlayback').hidden = !active;
 if (active) $('libraryPlaybackText').textContent = playback.sequence.name + ' · ' + (playback.index + 1) + '/' + playback.sequence.steps.length;
 document.querySelectorAll('.libraryCard').forEach(n => n.classList.toggle('active', !!active && n.dataset.id === playback.sequence.id));
}

function changeSpeed(delta) {
 db.previewSeconds = Math.max(0.1, Math.min(30, Math.round((db.previewSeconds + delta) * 10) / 10));
 let p = playback ? { kind: playback.kind, sequence: playback.sequence } : null;
 pausePlayback(); renderPreview(); draftSoon();
 if (p) startPlayback(p.kind, p.sequence);
}
