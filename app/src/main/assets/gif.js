"use strict";

function decodeGif(buffer, maxFrames = 25) {
 let b = new Uint8Array(buffer), p = 0;
 const u16 = o => b[o] | (b[o + 1] << 8);
 const hdr = String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5]);
 if (hdr !== 'GIF87a' && hdr !== 'GIF89a') throw Error('Not a valid GIF');
 let width = u16(6), height = u16(8), packed = b[10]; p = 13;
 if (width < 1 || height < 1) throw Error('Invalid GIF dimensions');
 let gct = null;
 if (packed & 0x80) { let sz = 1 << ((packed & 7) + 1); gct = b.subarray(p, p + sz * 3); p += sz * 3; }
 const readBlocks = () => {
  let chunks = [], total = 0;
  while (p < b.length) { let len = b[p++]; if (!len) break; chunks.push(b.subarray(p, p + len)); total += len; p += len; }
  let out = new Uint8Array(total), off = 0;
  for (let c of chunks) { out.set(c, off); off += c.length; }
  return out;
 };
 const lzw = (minSize, data, count) => {
  let clear = 1 << minSize, eoi = clear + 1, size = minSize + 1, nextCode = eoi + 1, mask = (1 << size) - 1;
  let prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4096);
  let out = new Uint8Array(count), outPos = 0, bitBuf = 0, bitCnt = 0, bytePos = 0, oldCode = -1, firstChar = 0;
  const reset = () => { size = minSize + 1; nextCode = eoi + 1; mask = (1 << size) - 1; oldCode = -1; };
  const readCode = () => {
   while (bitCnt < size) { if (bytePos >= data.length) return -1; bitBuf |= data[bytePos++] << bitCnt; bitCnt += 8; }
   let code = bitBuf & mask; bitBuf >>= size; bitCnt -= size; return code;
  };
  while (outPos < count) {
   let code = readCode();
   if (code < 0 || code === eoi) break;
   if (code === clear) { reset(); continue; }
   if (oldCode === -1) { if (code < clear) { out[outPos++] = code; firstChar = code; oldCode = code; } continue; }
   let cur = code, sp = 0;
   if (cur >= nextCode) { stack[sp++] = firstChar; cur = oldCode; }
   while (cur >= clear && sp < 4095) { stack[sp++] = suffix[cur]; cur = prefix[cur]; }
   firstChar = cur & 0xff; stack[sp++] = firstChar;
   while (sp > 0 && outPos < count) out[outPos++] = stack[--sp];
   if (nextCode < 4096) {
    prefix[nextCode] = oldCode; suffix[nextCode] = firstChar; nextCode++;
    if (nextCode > mask && size < 12) { size++; mask = (1 << size) - 1; }
   }
   oldCode = code;
  }
  return out;
 };
 const deinterlace = (px, w, h) => {
  let out = new Uint8Array(px.length), row = 0;
  for (let [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) { out.set(px.subarray(row * w, (row + 1) * w), y * w); row++; }
  return out;
 };
 let comp = document.createElement('canvas'); comp.width = width; comp.height = height;
 let ctx = comp.getContext('2d'), fc = document.createElement('canvas'), fctx = fc.getContext('2d');
 let outScale = Math.min(1, 256 / Math.max(width, height)), oc = document.createElement('canvas');
 oc.width = Math.max(1, Math.round(width * outScale)); oc.height = Math.max(1, Math.round(height * outScale));
 let octx = oc.getContext('2d'), frames = [], truncated = false, gce = { disposal: 0, trans: false, transIdx: 0 };
 while (p < b.length) {
  let sep = b[p++];
  if (sep === 0x3B) break;
  if (sep === 0x21) {
   let label = b[p++];
   if (label === 0xF9) {
    let blk = readBlocks();
    if (blk.length >= 4) { gce.disposal = (blk[0] >> 2) & 7; gce.trans = !!(blk[0] & 1); gce.transIdx = blk[3]; }
   } else readBlocks();
  } else if (sep === 0x2C) {
   if (frames.length >= 300) { truncated = true; break; }
   let left = u16(p), top = u16(p + 2), w = u16(p + 4), h = u16(p + 6), ip = b[p + 8]; p += 9;
   let ct = gct; if (ip & 0x80) { let sz = 1 << ((ip & 7) + 1); ct = b.subarray(p, p + sz * 3); p += sz * 3; }
   let minCode = b[p++], raw = readBlocks();
   if (!ct || w < 1 || h < 1) { gce = { disposal: 0, trans: false, transIdx: 0 }; continue; }
   let idx = lzw(minCode, raw, w * h); if (ip & 0x40) idx = deinterlace(idx, w, h);
   let prev = gce.disposal === 3 ? ctx.getImageData(0, 0, width, height) : null;
   fc.width = w; fc.height = h;
   let imgData = fctx.createImageData(w, h), d = imgData.data;
   for (let i = 0; i < w * h; i++) {
    let ci = idx[i];
    if (gce.trans && ci === gce.transIdx) continue;
    let o = i * 4, co = ci * 3;
    d[o] = ct[co]; d[o + 1] = ct[co + 1]; d[o + 2] = ct[co + 2]; d[o + 3] = 255;
   }
   fctx.putImageData(imgData, 0, 0); ctx.drawImage(fc, left, top);
   octx.clearRect(0, 0, oc.width, oc.height); octx.drawImage(comp, 0, 0, oc.width, oc.height);
   frames.push(oc.toDataURL('image/png'));
   if (gce.disposal === 2) ctx.clearRect(left, top, w, h);
   else if (gce.disposal === 3 && prev) ctx.putImageData(prev, 0, 0);
   gce = { disposal: 0, trans: false, transIdx: 0 };
  } else break;
 }
 if (frames.length > maxFrames) {
  let sampled = [];
  for (let k = 0; k < maxFrames; k++) {
   let idx = maxFrames === 1 ? 0 : Math.round(k * (frames.length - 1) / (maxFrames - 1));
   sampled.push(frames[idx]);
  }
  frames = sampled; truncated = true;
 }
 return { frames, truncated, small: width < 16 || height < 16 };
}

function pickImage(callback) { if (busy || working) return; pickerCallback = callback; $('imagePicker').value = ''; $('imagePicker').click(); }
async function onPicked(e) {
 let file = e.target.files[0]; if (!file) return;
 let callback = pickerCallback; pickerCallback = null; if (!callback) return;
 if (file.size > 12 * 1024 * 1024) return notify('Choose an image under 12 MB.');
 let isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
 if (!isGif && !/^image\/(png|jpeg|webp|bmp|avif)$/.test(file.type)) return notify('Choose PNG, JPEG, WebP, GIF, BMP or AVIF.');
 working = true;
 try {
  if (isGif) {
   let buf = await file.arrayBuffer(), res = decodeGif(buf, 25);
   if (!res.frames.length) throw Error('GIF had no readable frames');
   if (res.frames.length > 1) {
    working = false;
    callback({ type: 'gif', frames: res.frames.map(src => ({ id: uid(), src, deleted: false })), truncated: res.truncated, fit: res.small ? 'actual' : db.defaults.fit });
    return;
   }
   if (res.frames.length === 1) { working = false; callback(imageSpec(res.frames[0], res.small ? 'actual' : db.defaults.fit)); return; }
  }
  let data = await new Promise((ok, no) => { let r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
  let img = await loadImage(data), scale = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let src = c.toDataURL('image/png'); if (src.length > 12_000_000) throw Error('Source copy too large');
  let small = img.width < 16 || img.height < 16;
  working = false; callback(imageSpec(src, small ? 'actual' : db.defaults.fit));
 } catch (error) { notify('Import failed: ' + error.message); }
 finally { working = false; e.target.value = ''; }
}

function openGifEditor(opts) {
 let groupId = opts.groupId, target = opts.target, layer = opts.layer === 'bg' ? 'bg' : 'fg', insertIndex = opts.insertIndex;
 let frames = clone(opts.frames);
 if (opts.isNew && frames.length > 10) {
  let keep = new Set();
  for (let k = 0; k < 10; k++) keep.add(Math.round(k * (frames.length - 1) / 9));
  frames.forEach((fr, idx) => { fr.deleted = !keep.has(idx); });
 }
 let gifState = {
  fit: opts.fit || db.defaults.fit,
  smooth: !!opts.smooth,
  alignX: Number.isFinite(opts.alignX) ? opts.alignX : 0.5,
  alignY: Number.isFinite(opts.alignY) ? opts.alignY : 0.5,
  zoom: Number.isFinite(opts.zoom) ? opts.zoom : 1
 };
 openSheet(groupId ? 'Edit GIF animation' : (layer === 'bg' ? 'Preview background GIF' : 'Preview GIF frames'));
 let session = { gif: true, playing: true, animIdx: 0, timer: null, rev: 0, thumbTimer: null };
 editorSession = session;
 const b = $('sheetBody');
 if (opts.truncated) b.append(hint('GIF frames were proportionally reduced to ' + frames.length + ' frames.'));
 if (opts.isNew && frames.length > 10) b.append(hint('Displays store up to 10 frames; 10 evenly spaced frames are active and the rest are greyed out (tap ↺/✕ to swap).'));
 b.append(hint((target === 'span' ? 'Spanning all 4 displays' : target === 'repeat' ? 'Repeating on all 4 displays' : 'Display ' + (target + 1)) + ' · Tap a frame to preview, ◀/▶ to reorder, ✕ to delete or ↺ to restore.'));

 let previewBox = el('div', undefined, 'gifPreviewBox');
 let previewWrap = el('div', undefined, (target === 'span' || target === 'repeat') ? 'gifPreviewWall' : 'gifPreviewSingle');
 let previewControls = el('div', undefined, 'gifPreviewControls');
 let statusLine = el('b', 'Frame 1');
 let speedRow = el('div', undefined, 'controls');
 let playBtn = button('Pause', () => { session.playing = !session.playing; playBtn.textContent = session.playing ? 'Pause' : 'Play'; if (session.playing) scheduleTick(); else clearTimeout(session.timer); });
 let speedLabel = el('span', db.previewSeconds.toFixed(1) + ' s');
 let slower = button('+', () => changeGifSpeed(0.1)), faster = button('−', () => changeGifSpeed(-0.1));
 function changeGifSpeed(delta) {
  db.previewSeconds = Math.max(0.1, Math.min(30, Math.round((db.previewSeconds + delta) * 10) / 10));
  speedLabel.textContent = db.previewSeconds.toFixed(1) + ' s';
  draftSoon(); renderPreview();
  if (session.playing) { clearTimeout(session.timer); scheduleTick(); }
 }
 speedRow.append(playBtn, faster, speedLabel, slower);
 previewControls.append(statusLine, speedRow);
 previewBox.append(previewWrap, previewControls);
 b.append(previewBox);

 let renderedFrames = [];
 async function buildPreviewStep(src) {
  let f = blankFrame();
  let spec = { type: 'image', src, fit: gifState.fit, smooth: gifState.smooth, alignX: gifState.alignX, alignY: gifState.alignY, zoom: gifState.zoom };
  if (layer === 'bg') {
   if (target === 'span' || target === 'repeat') { f.bgMode = target; f.bgSource = spec; }
   else { f.bgMode = 'panels'; f.bgPanels[target] = spec; }
  } else {
   if (target === 'span' || target === 'repeat') { f.mode = target; f.source = spec; }
   else { f.mode = 'panels'; f.panels[target] = spec; }
  }
  await regenerate(f);
  return f;
 }
 function activeIndices() { return frames.map((fr, i) => fr.deleted ? -1 : i).filter(i => i >= 0); }
 function drawAnimFrame() {
  let act = activeIndices();
  if (!act.length) { previewWrap.replaceChildren(hint('No active frames')); statusLine.textContent = '0 active frames'; return; }
  if (session.animIdx >= act.length) session.animIdx = 0;
  let fi = act[session.animIdx], rf = renderedFrames[fi];
  if (!rf) return;
  if (target === 'span' || target === 'repeat') previewWrap.replaceChildren(makeWall(rf, db.layout, false));
  else {
   let w = el('div', undefined, 'wall'); w.style.gridTemplateColumns = '1fr';
   let t = el('div', undefined, 'tile');
   if (rf.tiles[target]) { let img = document.createElement('img'); img.src = rf.tiles[target]; img.alt = ''; t.append(img); }
   w.append(t); previewWrap.replaceChildren(w);
  }
  statusLine.textContent = 'Frame ' + (session.animIdx + 1) + ' / ' + act.length + ' (#' + (fi + 1) + ')';
  grid.querySelectorAll('.gifFrameCard').forEach((n, i) => n.classList.toggle('active', i === fi));
  if (live) queueTiles(rf.tiles, (target === 'span' || target === 'repeat') ? [0, 1, 2, 3] : [target], false, true);
 }
 async function refreshActiveOnly() {
  let act = activeIndices();
  if (!act.length) return;
  let fi = act[Math.min(session.animIdx, act.length - 1)];
  let rf = await buildPreviewStep(frames[fi].src);
  if (editorSession !== session) return;
  renderedFrames[fi] = rf;
  drawAnimFrame();
  clearTimeout(session.thumbTimer);
  session.thumbTimer = setTimeout(() => { if (editorSession === session) renderAll(); }, 200);
 }
 function scheduleTick() {
  clearTimeout(session.timer);
  if (editorSession !== session || !session.playing) return;
  session.timer = setTimeout(() => {
   if (editorSession !== session || !session.playing) return;
   let act = activeIndices();
   if (act.length) { session.animIdx = (session.animIdx + 1) % act.length; drawAnimFrame(); }
   scheduleTick();
  }, db.previewSeconds * 1000);
 }

 buildImageControls(b, gifState, refreshActiveOnly, renderAll);
 let grid = el('div', undefined, 'gifFramesGrid');
 b.append(grid);

 async function renderAll() {
  let rev = ++session.rev;
  let next = await Promise.all(frames.map(fr => buildPreviewStep(fr.src)));
  if (editorSession !== session || rev !== session.rev) return;
  renderedFrames = next;
  grid.replaceChildren();
  frames.forEach((fr, i) => {
   let card = el('div', undefined, 'gifFrameCard' + (fr.deleted ? ' deleted' : ''));
   let top = el('div', undefined, 'gifFrameTop');
   top.append(el('span', '#' + (i + 1)), el('span', fr.deleted ? 'Deleted' : ''));
   let preview;
   if (target === 'span' || target === 'repeat') preview = makeWall(renderedFrames[i], db.layout, false);
   else {
    preview = el('div', undefined, 'wall'); preview.style.gridTemplateColumns = '1fr';
    let t = el('div', undefined, 'tile');
    if (renderedFrames[i].tiles[target]) { let img = document.createElement('img'); img.src = renderedFrames[i].tiles[target]; img.alt = ''; t.append(img); }
    preview.append(t);
   }
   let actRow = el('div', undefined, 'gifFrameActions');
   let mvL = button('◀', e => { e.stopPropagation(); if (i === 0) return; [frames[i - 1], frames[i]] = [frames[i], frames[i - 1]]; renderAll(); }); mvL.disabled = i === 0; mvL.title = 'Move earlier';
   let mvR = button('▶', e => { e.stopPropagation(); if (i === frames.length - 1) return; [frames[i + 1], frames[i]] = [frames[i], frames[i + 1]]; renderAll(); }); mvR.disabled = i === frames.length - 1; mvR.title = 'Move later';
   let del = button(fr.deleted ? '↺' : '✕', e => { e.stopPropagation(); fr.deleted = !fr.deleted; renderAll(); }); del.title = fr.deleted ? 'Restore frame' : 'Delete frame';
   actRow.append(mvL, mvR, del);
   card.append(top, preview, actRow);
   card.onclick = () => {
    if (fr.deleted) return;
    let act = activeIndices(), pos = act.indexOf(i);
    if (pos >= 0) { session.animIdx = pos; drawAnimFrame(); }
   };
   grid.append(card);
  });
  drawAnimFrame();
 }

 buttons(b, [['Cancel', () => { clearTimeout(session.timer); clearTimeout(session.thumbTimer); closeSheet(true); }], ['Apply', async () => {
  if (working || busy) return;
  let act = frames.filter(fr => !fr.deleted);
  if (!groupId && !act.length) return notify('Keep at least one frame to apply.');
  clearTimeout(session.timer); clearTimeout(session.thumbTimer); working = true;
  try {
   pushUndo();
   await applyGifGroup({ groupId, target, layer, insertIndex, frames, ...gifState });
   if (gifState.fit !== 'actual') db.defaults = { fit: gifState.fit, smooth: gifState.smooth };
   working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
  } catch (e) { notify(e.message); } finally { working = false; }
 }, 'primary']]);

 if (groupId) {
  b.append(el('div', undefined, 'separator'));
  buttons(b, [
   ...(layer === 'fg' ? [['Background layer', () => {
    let firstStep = current.steps.find(f => target === 'span' || target === 'repeat' ? (f.mode === target && f.source && f.source.gifGroupId === groupId) : (f.mode === 'panels' && f.panels[target] && f.panels[target].gifGroupId === groupId));
    if (firstStep) openBackgroundEditor(clone(firstStep), true);
   }]] : []),
   ['Remove GIF from sequence', async () => {
    if (working || busy || !confirm('Remove all frames of this GIF from the sequence?')) return;
    clearTimeout(session.timer); clearTimeout(session.thumbTimer); working = true;
    try {
     pushUndo();
     frames.forEach(fr => fr.deleted = true);
     await applyGifGroup({ groupId, target, layer, insertIndex, frames, ...gifState });
     working = false; closeSheet(false); changed(); renderEditor(); previewCurrent(true);
    } catch (e) { notify(e.message); } finally { working = false; }
   }, 'danger']
  ]);
 }
 renderAll().then(() => { if (editorSession === session && session.playing) scheduleTick(); });
}

async function applyGifGroup({ groupId, target, layer = 'fg', insertIndex, frames, fit, smooth, alignX = 0.5, alignY = 0.5, zoom = 1 }) {
 if (!current.gifGroups) current.gifGroups = {};
 let gid = groupId || uid();
 let active = frames.filter(fr => !fr.deleted);
 let existing = [];
 if (groupId) {
  current.steps.forEach((f, idx) => {
   let match = layer === 'bg'
    ? ((target === 'span' || target === 'repeat') ? (f.bgMode === target && f.bgSource && f.bgSource.gifGroupId === gid) : (f.bgMode === 'panels' && f.bgPanels && f.bgPanels[target] && f.bgPanels[target].gifGroupId === gid))
    : ((target === 'span' || target === 'repeat') ? (f.mode === target && f.source && f.source.gifGroupId === gid) : (f.mode === 'panels' && f.panels[target] && f.panels[target].gifGroupId === gid));
   if (match) existing.push(idx);
  });
 }
 let startIdx = existing.length ? existing[0] : Math.max(0, Math.min(insertIndex, current.steps.length));
 let slots = [];
 if (existing.length) {
  for (let k = 0; k < active.length; k++) slots.push(k < existing.length ? existing[k] : existing[existing.length - 1] + 1 + (k - existing.length));
 } else {
  for (let k = 0; k < active.length; k++) slots.push(startIdx + k);
 }
 if (slots.length && slots[slots.length - 1] >= 200) throw Error('Exceeds maximum 200 steps in sequence.');
 while (slots.length && current.steps.length <= slots[slots.length - 1]) current.steps.push(blankFrame());

 for (let k = 0; k < active.length; k++) {
  let step = current.steps[slots[k]];
  let srcObj = { type: 'image', src: active[k].src, fit, smooth, alignX, alignY, zoom, gifGroupId: gid, gifFrameId: active[k].id };
  if (layer === 'bg') {
   if (target === 'span' || target === 'repeat') { step.bgMode = target; step.bgSource = srcObj; step.bgPanels = [null, null, null, null]; }
   else { if (step.bgMode !== 'panels') { step.bgMode = 'panels'; step.bgSource = null; step.bgPanels = [null, null, null, null]; } step.bgPanels[target] = srcObj; }
  } else {
   if (target === 'span' || target === 'repeat') { step.mode = target; step.source = srcObj; step.panels = [null, null, null, null]; }
   else {
    if (step.mode !== 'panels') {
     let oldTiles = step.tiles.slice(); step.mode = 'panels'; step.source = null;
     step.panels = [0, 1, 2, 3].map(p => p === target ? null : (oldTiles[p] ? { type: 'image', src: oldTiles[p], fit: 'contain', smooth: false } : null));
    }
    step.panels[target] = srcObj;
   }
  }
  await regenerate(step, db.layout, slots[k]);
 }

 if (existing.length > active.length) {
  let toClean = existing.slice(active.length).sort((a, b) => b - a);
  for (let idx of toClean) {
   let step = current.steps[idx];
   if (layer === 'bg') {
    if (target === 'span' || target === 'repeat') { step.bgMode = 'none'; step.bgSource = null; step.bgPanels = [null, null, null, null]; }
    else { step.bgPanels[target] = null; if (step.bgPanels.every(p => p === null)) step.bgMode = 'none'; }
    if (step.bgMode === 'none' && step.mode === 'panels' && step.panels.every(p => p === null)) current.steps.splice(idx, 1);
    else await regenerate(step, db.layout, idx);
   } else {
    if (target === 'span' || target === 'repeat') current.steps.splice(idx, 1);
    else {
     step.panels[target] = null; step.tiles[target] = '';
     if (step.panels.every(p => p === null) && (!step.bgMode || step.bgMode === 'none')) current.steps.splice(idx, 1);
     else await regenerate(step, db.layout, idx);
    }
   }
  }
 }
 await refreshCyclingSteps();
 if (active.length) {
  current.gifGroups[gid] = { id: gid, target, layer, fit, smooth, alignX, alignY, zoom, frames: clone(frames) };
  selected = Math.min(startIdx, Math.max(0, current.steps.length - 1));
 } else {
  delete current.gifGroups[gid];
  selected = Math.min(selected, Math.max(0, current.steps.length - 1));
 }
}
