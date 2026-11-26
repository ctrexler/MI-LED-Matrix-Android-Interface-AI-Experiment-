"use strict";

function saveSequence() {
 if (busy || working) return;
 current.name = $('sequenceName').value.trim() || 'Untitled';
 current.cols = db.layout;
 let old = clone(db.sequences), wasDirty = dirty, i = db.sequences.findIndex(s => s.id === current.id);
 if (i < 0) db.sequences.push(clone(current)); else db.sequences[i] = clone(current);
 dirty = false; db.draft = { sequence: clone(current), selected, dirty }; clearTimeout(saveTimer);
 if (!store()) { db.sequences = old; dirty = wasDirty; return; }
 updateSaveState(); notify('Saved to Library.');
}

function newSequence() {
 if (busy || working) return;
 if (current.steps.length && dirty && !confirm('Start a new sequence? Save the current draft to Library first to keep it.')) return;
 pausePlayback(); clearHistory(); current = blankSequence(); selected = 0; dirty = true; imageCache.clear();
 renderEditor(); showPage('editor'); draftSoon(); previewCurrent(true);
}

async function changeLayout() {
 if (busy || working) return;
 let cols = Number($('layout').value); if (cols === db.layout) return;
 if (!confirm('Change arrangement for all sequences and re-split spanning sources?')) { $('layout').value = db.layout; return; }
 pausePlayback(); working = true;
 let old = { layout: db.layout, sequences: clone(db.sequences), current: clone(current) };
 try {
  let saved = clone(db.sequences), draft = clone(current);
  for (let seq of [...saved, draft]) { seq.cols = cols; for (let f of seq.steps) if (f.mode === 'span') await regenerate(f, cols); }
  db.layout = cols; db.sequences = saved; current = draft;
  changed(); flushDraft(); renderEditor(); renderAssignments(); previewCurrent(true);
  notify('Display arrangement updated.');
 } catch (e) {
  db.layout = old.layout; db.sequences = old.sequences; current = old.current;
  $('layout').value = db.layout; renderAssignments();
  notify('Layout change failed: ' + e.message);
 } finally { working = false; }
}

function renderLibrary() {
 let list = $('libraryList'), scroll = list.scrollTop; list.replaceChildren();
 if (!db.sequences.length) { list.append(hint('No saved sequences yet. Compose in Editor and tap Save.')); return; }
 db.sequences.forEach(s => {
  let card = el('article', undefined, 'libraryCard'); card.dataset.id = s.id;
  let title = el('div', undefined, 'row'); title.append(el('h3', s.name), el('small', s.steps.length + ' steps', 'muted')); card.append(title);
  let strip = el('div', undefined, 'filmstrip');
  s.steps.forEach((f, i) => {
   let frame = el('div', undefined, 'filmFrame' + (i >= 10 ? ' overLimit' : ''));
   frame.append(el('small', String(i + 1)), makeWall(f, 2, false));
   strip.append(frame);
  });
  card.append(strip);
  let row = el('div', undefined, 'row');
  row.append(
   button('Open', () => {
    if (busy || working) return;
    if (dirty && current.steps.length && !confirm('Replace the active draft with this saved sequence?')) return;
    pausePlayback(); clearHistory(); current = clone(s); selected = 0; dirty = false; imageCache.clear();
    renderEditor(); showPage('editor'); draftSoon(); previewCurrent(true);
   }),
   button('Preview on displays', () => startPlayback('library', s), 'primary'),
   button('More', () => libraryOptions(s))
  );
  row.querySelectorAll('button').forEach(b => b.disabled = busy);
  card.append(row); list.append(card);
 });
 list.scrollTop = scroll; updateLibraryPlayback();
}

function libraryOptions(s) {
 if (busy || working) return;
 openSheet(s.name); let b = $('sheetBody');
 buttons(b, [
  ['Duplicate', () => { let copy = clone(s); copy.id = uid(); copy.name += ' (copy)'; db.sequences.push(copy); if (!store()) db.sequences.pop(); closeSheet(false); renderLibrary(); }],
  ['Rename', () => {
   b.replaceChildren();
   let input = document.createElement('input'); input.value = s.name; input.maxLength = 100;
   b.append(field('Name', input));
   buttons(b, [['Cancel', () => closeSheet()], ['Save', () => {
    let old = s.name; s.name = input.value.trim() || 'Untitled';
    if (!store()) { s.name = old; return; }
    if (current.id === s.id) { current.name = s.name; renderEditor(); draftSoon(); }
    closeSheet(false); renderLibrary();
   }, 'primary']]);
  }]
 ]);
 buttons(b, [['Delete sequence', () => {
  if (!confirm('Delete this saved sequence? The active draft will remain.')) return;
  let old = db.sequences; db.sequences = db.sequences.filter(x => x.id !== s.id);
  if (!store()) { db.sequences = old; return; }
  if (current.id === s.id) { dirty = true; draftSoon(); }
  closeSheet(false); renderLibrary();
 }, 'danger']]);
}

function address(i) { return db.assignments[i] || ''; }
function record(i) { return (db.stored || {})[address(i)] || { status: 'unknown', images: [], updated: null }; }
function statusText(r) { return ({ tracked: 'Tracked (not read back)', partial: 'Partially tracked', uncertain: 'Uncertain — upload interrupted', unknown: 'Contents unknown' })[r.status] || 'Contents unknown'; }
function ensureStorage() { if (!db.stored || typeof db.stored !== 'object' || Array.isArray(db.stored)) db.stored = {}; }

function exportLibrary() {
 if (busy || working) return;
 flushDraft();
 Native.exportLibrary(JSON.stringify({ version: 3, appVersion: APP_VERSION, layout: db.layout, previewSeconds: db.previewSeconds, defaults: db.defaults, calibration: db.calibration, sequences: db.sequences, draft: db.draft, stored: db.stored }));
 notify('Backup includes library, draft, and storage records keyed by display Bluetooth address. Assignments are not changed on import.');
}

async function receiveBackup(text) {
 if (busy || working) return notify('Wait for the current operation.');
 try {
  let v = JSON.parse(text);
  if (![1, 2, 3].includes(v.version) || !Array.isArray(v.sequences) || v.sequences.length > 500) throw Error('Unsupported backup');
  let incoming = v.sequences.map(normalizeSequence);
  if (v.draft && v.draft.sequence) {
   let d = normalizeSequence(v.draft.sequence);
   if (d.steps.length && !incoming.some(s => JSON.stringify(s) === JSON.stringify(d))) { d.name += ' (draft backup)'; incoming.push(d); }
  }
  if (!confirm('Import ' + incoming.length + ' sequences? Existing sequences and active draft stay unchanged.')) return;
  working = true;
  for (let s of incoming) { s.id = uid(); s.cols = db.layout; for (let f of s.steps) { f.id = uid(); if (f.mode !== 'panels') await regenerate(f); } }
  let old = db.sequences; db.sequences = db.sequences.concat(incoming);
  if (!store()) { db.sequences = old; return; }
  working = false; renderLibrary(); showPage('library');
  notify('Backup imported. Old backups keep their rendered tiles, not lost source detail.');
  if (v.stored) {
   try {
    let incStored = validStorage(v.stored);
    if (Object.keys(incStored).length && confirm('Also import stored-image records? Imported records will be marked uncertain until you rebuild or check the physical displays. Existing records for matching addresses will be replaced.')) {
     ensureStorage();
     for (let r of Object.values(incStored)) r.status = 'uncertain';
     db.stored = { ...db.stored, ...incStored }; store();
    }
   } catch (e) { notify('Sequences imported; storage records rejected: ' + e.message); }
  }
 } catch (e) { notify('Import failed: ' + e.message); }
 finally { working = false; }
}

function displayStatusClass(i) {
 if (ready[i]) return 'statusConnected';
 let s = (states[i] || '').toLowerCase();
 if (s.startsWith('connecting') || s.startsWith('negotiating')) return 'statusConnecting';
 if (s === 'not connected' || !db.assignments[i]) return 'statusUnconnected';
 return 'statusDisconnected';
}

function renderConnectionBadge() {
 let grid = $('connGrid'), btn = $('connectionBtn'); if (!grid || !btn) return;
 let cols = [1, 2, 4].includes(db.layout) ? db.layout : 2;
 grid.className = 'connGrid cols' + cols;
 grid.replaceChildren();
 for (let i = 0; i < 4; i++) grid.append(el('span', undefined, 'connDot ' + displayStatusClass(i)));
 let count = ready.filter(Boolean).length;
 btn.title = count + '/4 connected';
 btn.setAttribute('aria-label', count + ' of 4 displays connected');
}

function syncConnActionBtn(i) {
 let btn = $('connAction' + i); if (!btn) return;
 let cls = displayStatusClass(i), isConn = cls === 'statusConnected' || cls === 'statusConnecting';
 btn.textContent = isConn ? 'Disconnect' : 'Connect';
 btn.disabled = !isConn && !db.assignments[i];
}

function renderAssignments() {
 let out = $('assignments'); out.replaceChildren();
 out.className = 'assignmentsGrid'; out.style.display = 'grid';
 out.style.gridTemplateColumns = 'repeat(' + db.layout + ',minmax(0,1fr))'; out.style.gap = '10px';
 for (let i = 0; i < 4; i++) {
  let c = el('article', undefined, 'deviceCard ' + displayStatusClass(i)); c.id = 'deviceCard' + i;
  c.append(el('h3', 'Display ' + (i + 1)), el('p', db.assignments[i] || 'Not assigned', 'muted'));
  let state = el('p', states[i], 'deviceStatus'); state.id = 'status' + i; c.append(state);
  let row = el('div', undefined, 'row');
  let connBtn = button('', () => {
   if (busy) return;
   let cls = displayStatusClass(i);
   if (cls === 'statusConnected' || cls === 'statusConnecting') Native.disconnectDisplay(i);
   else if (db.assignments[i]) Native.connectDisplay(i, db.assignments[i]);
  });
  connBtn.id = 'connAction' + i;
  row.append(connBtn, button('Scan / assign', () => scanFor(i)), button('Forget', () => {
   if (!confirm('Forget this assignment and close all connections?')) return;
   setLive(false); Native.disconnect(); db.assignments[i] = ''; store(); renderAssignments();
  }));
  c.append(row); out.append(c); syncConnActionBtn(i);
 }
 renderConnectionBadge();
}

function scanFor(i) {
 if (busy || working) return;
 scanSlot = i; openSheet('Choose device for Display ' + (i + 1)); scanSession = true;
 let b = $('sheetBody'); b.append(hint('Showing nearby MI Matrix Display devices.'));
 let state = el('p', 'Scanning…'); state.id = 'scanState';
 let devices = el('div'); devices.id = 'scanDevices';
 b.append(state, devices);
 buttons(b, [['Rescan', () => { clearDevices(); Native.scan(); }], ['Cancel', () => closeSheet(false)]]);
 Native.scan();
}
function clearDevices() { let n = $('scanDevices'); if (n) n.replaceChildren(); let s = $('scanState'); if (s) s.textContent = 'Scanning for 10 seconds…'; }
function scanFinished() { let s = $('scanState'), d = $('scanDevices'); if (s) s.textContent = d && d.children.length ? 'Select a device, or rescan.' : 'No MI Matrix Displays found. Check power/Bluetooth and rescan.'; }
function deviceFound(address, name) {
 if (!scanSession) return;
 if (!(name + ' ' + address).toLowerCase().includes('mi matrix display')) return;
 let out = $('scanDevices'); if (!out) return;
 out.append(button(name + ' · ' + address, () => {
  if (db.assignments.some((a, i) => i !== scanSlot && a === address)) return notify('Already assigned to another slot.');
  let slot = scanSlot; db.assignments[slot] = address; store(); closeSheet(false); renderAssignments(); Native.connectDisplay(slot, address);
 }, 'scanDevice'));
}

function setStatus(i, text, isReady = false) {
 let was = ready[i]; states[i] = text; ready[i] = isReady;
 let n = $('status' + i); if (n) n.textContent = text;
 let card = $('deviceCard' + i); if (card) card.className = 'deviceCard ' + displayStatusClass(i);
 syncConnActionBtn(i); renderConnectionBadge(); renderPreview();
 if (!was && isReady && live) { lastTiles[i] = undefined; let f = playback ? playback.sequence.steps[playback.index] : current.steps[selected]; queueTiles(f ? f.tiles : ['', '', '', ''], [i], true); }
 if (page === 'stored') renderStored();
}

function reconnect(silent = false) {
 if (busy) return;
 if (!db.assignments.some(Boolean)) return;
 db.assignments.forEach((a, i) => { if (a) Native.connectDisplay(i, a); });
 if (silent) log('Auto-connecting saved displays…');
 else notify('Connecting saved displays. Check readiness in Displays.');
}

function setBusy(value) {
 busy = value; if (value) { pausePlayback(); clearPending(); }
 document.querySelectorAll('main button,main input,main select,#saveBtn').forEach(n => n.disabled = value);
 $('cancelTransfer').disabled = !value; $('transfer').hidden = !value;
 if (!value) { renderGrid(); renderPreview(); if (live) { clearPending(); Native.setLive(true); previewCurrent(true); } }
 if (!$('sheet').hidden) closeSheet(false);
}

function destGrid(chosen, onChange, allowDisconnected = false) {
 let g = el('div', undefined, 'destinationGrid'); g.style.gridTemplateColumns = 'repeat(' + db.layout + ',minmax(0,1fr))';
 for (let i = 0; i < 4; i++) {
  let n = button('', () => { if (chosen.has(i)) chosen.delete(i); else chosen.add(i); draw(); onChange && onChange(); }, 'destination');
  function draw() {
   n.classList.toggle('chosen', chosen.has(i)); n.setAttribute('aria-pressed', String(chosen.has(i)));
   n.replaceChildren(el('strong', 'Display ' + (i + 1)), el('small', ready[i] ? 'Connected' : states[i]), el('small', record(i).status === 'unknown' ? 'Unknown' : record(i).images.length + ' tracked'));
   n.disabled = !allowDisconnected && !ready[i];
  }
  draw(); g.append(n);
 }
 return g;
}

function chooseTargets(title, callback, extra) {
 openSheet(title);
 let chosen = new Set(ready.flatMap((r, i) => r ? [i] : [])), b = $('sheetBody'), holder = el('div');
 function draw() { holder.replaceChildren(destGrid(chosen, draw)); }
 b.append(hint('Select destinations. Only selected displays need to be connected. Spanning images keep their existing display sections.'), holder);
 draw();
 buttons(b, [['All connected', () => { chosen = new Set(ready.flatMap((r, i) => r ? [i] : [])); draw(); }], ['Clear selection', () => { chosen.clear(); draw(); }]]);
 if (extra) extra(b, () => Array.from(chosen).sort());
 else buttons(b, [['Start selected slideshows', () => {
  let ids = Array.from(chosen).sort();
  if (!ids.length) return notify('Select a connected display.');
  pausePlayback(); setLive(false); closeSheet(false); Native.playSelected(JSON.stringify(ids));
 }, 'primary']]);
}

function sendPanel() {
 if (busy || working) return;
 if (!current.steps.length) return notify('Add a step first.');
 chooseTargets('Send stored slideshow', null, (b, getIds) => {
  b.append(hint('Replace clears selected displays. Append keeps the existing device command sequence unchanged.'));
  if (current.steps.length > 10) b.append(hint('Displays hold up to 10 stored images; only the first 10 steps will be uploaded (steps 11+ are skipped).'));
  buttons(b, [['Replace selected', () => sendSelected(true, getIds()), 'danger'], ['Append to selected', () => sendSelected(false, getIds())]]);
 });
}

async function sendSelected(replace, ids, custom = null) {
 if (busy || working) return;
 if (!ids.length || ids.some(i => !ready[i])) return notify('Select at least one ready display.');
 if (!confirm((replace ? 'Erase and replace images on ' : 'Append images to ') + ids.map(i => 'Display ' + (i + 1)).join(', ') + (replace ? '? This cannot be undone.' : '?'))) return;
 const frames = custom ? null : clone(current.steps.slice(0, 10));
 closeSheet(false); flushDraft(); pausePlayback(); setBusy(true);
 let oldStored;
 try {
  let rows = [], per = {};
  if (custom) { for (let i of ids) per[i] = custom.map(t => t || ''); }
  else for (let i of ids) per[i] = frames.map(f => f.tiles[i] || '');
  let count = per[ids[0]].length; if (count < 1 || count > 10) throw Error('Displays hold 1–10 stored images');
  for (let f = 0; f < count; f++) { let row = [null, null, null, null]; for (let i of ids) row[i] = await rgbTile(per[i][f]); rows.push(row); }
  ensureStorage(); oldStored = clone(db.stored); let pending = {};
  for (let i of ids) {
   let key = address(i); if (!key) throw Error('Assign Display ' + (i + 1) + ' before uploading.');
   let previous = record(i), images = per[i].map((tile, k) => ({ id: uid(), tile, name: 'Image ' + (k + 1) }));
   let complete = replace || previous.status === 'tracked';
   let list = replace ? images : ((previous.status === 'tracked' || previous.status === 'partial') ? [...previous.images, ...images] : images);
   pending[i] = { key, desired: { status: complete ? 'tracked' : 'partial', images: list, updated: new Date().toISOString() } };
   db.stored[key] = { ...clone(previous), status: 'uncertain', pending: pending[i].desired };
  }
  db.pendingStorage = pending;
  if (!store()) { db.stored = oldStored; delete db.pendingStorage; throw Error('Could not save tracking journal; upload not started.'); }
  progress(0, 1); Native.upload(JSON.stringify({ frames: rows, targets: ids }), replace);
 } catch (e) {
  if (oldStored) { db.stored = oldStored; delete db.pendingStorage; store(); }
  setBusy(false); notify('Upload preparation failed: ' + e.message);
 }
}

function storageDisplayComplete(i) { ensureStorage(); let entry = db.pendingStorage && db.pendingStorage[i]; if (entry) { db.stored[entry.key] = entry.desired; delete db.pendingStorage[i]; store(); } if (page === 'stored') renderStored(); }
function storageUploadFinished() { delete db.pendingStorage; store(); if (page === 'stored') renderStored(); }

function renderStored() {
 let out = $('storedContent'); if (!out) return; out.replaceChildren();
 let chooser = el('div', undefined, 'destinationGrid'); chooser.style.gridTemplateColumns = 'repeat(' + db.layout + ',minmax(0,1fr))';
 for (let i = 0; i < 4; i++) {
  let r = record(i), n = button('', () => { if (storageDraft && !confirm('Discard unapplied edits?')) return; storedSlot = i; storageDraft = null; renderStored(); }, 'destination' + (i === storedSlot ? ' chosen' : ''));
  n.append(el('strong', 'Display ' + (i + 1)), el('small', ready[i] ? 'Connected' : 'Disconnected'), el('small', r.status === 'unknown' ? 'Unknown' : r.images.length + ' tracked'));
  chooser.append(n);
 }
 out.append(chooser);
 let key = address(storedSlot), r = record(storedSlot);
 out.append(el('h2', 'Display ' + (storedSlot + 1)), hint(statusText(r) + (r.updated ? ' · ' + new Date(r.updated).toLocaleString() : '')), hint('App-maintained records, not device read-back. Changes from another controller are not detected. Unknown prior images cannot be recovered here.'));
 if (!key) { out.append(hint('Assign a physical display in Displays first.')); return; }
 if (r.status === 'uncertain') out.append(hint('The last transfer may have changed device contents. The list below is the previous record, not a verified current list. Rebuild from a complete collection to establish tracking.'));
 let images = storageDraft || r.images, bar = el('div', undefined, 'row'); out.append(bar);
 if (storageDraft) {
  bar.append(button('Discard edits', () => { storageDraft = null; renderStored(); }), button('Apply to Display ' + (storedSlot + 1), () => {
   if (!storageDraft.length) return notify('An empty draft cannot be uploaded. Keep at least one image.');
   if (!ready[storedSlot]) return notify('Connect this display first.');
   let tiles = storageDraft.map(t => t.tile), i = storedSlot;
   sendSelected(true, [i], tiles); storageDraft = null; renderStored();
  }, 'danger'), button('Add from library', addStoredFromLibrary));
  out.append(hint('Local draft only. Applying erases and rewrites this display’s complete stored list.'));
 } else {
  let edit = button('Edit collection', () => { if (r.status !== 'tracked' && !confirm('This collection is not complete or certain. Applying an edited list will erase any other images on this display. Continue?')) return; storageDraft = clone(r.images); renderStored(); });
  bar.append(edit, button('Add from library', () => { if (r.status !== 'tracked' && !confirm('Build a replacement list? Any untracked images will be erased when you apply it.')) return; storageDraft = clone(r.images); addStoredFromLibrary(); }), button('Start slideshow', () => { if (!ready[storedSlot]) return notify('Connect this display first.'); setLive(false); Native.playSelected(JSON.stringify([storedSlot])); }));
 }
 let grid = el('div', undefined, 'storedGrid');
 images.forEach((item, index) => {
  let card = el('article', undefined, 'storedCard'), preview = button('', () => {
   openSheet('Image ' + (index + 1) + ' · Display ' + (storedSlot + 1));
   let img = el('img', undefined, 'storedLarge'); img.src = item.tile || blackTile(); img.alt = 'Stored image';
   $('sheetBody').append(img, hint(item.name || ''));
   if (!storageDraft) buttons($('sheetBody'), [['Copy to another display', () => copyStoredImage(item)]]);
  });
  let img = el('img'); img.src = item.tile || blackTile(); img.alt = 'Image ' + (index + 1); preview.append(img); card.append(preview, el('small', String(index + 1)));
  if (storageDraft) {
   let row = el('div', undefined, 'row'), up = button('Earlier', () => { [storageDraft[index - 1], storageDraft[index]] = [storageDraft[index], storageDraft[index - 1]]; renderStored(); }), down = button('Later', () => { [storageDraft[index + 1], storageDraft[index]] = [storageDraft[index], storageDraft[index + 1]]; renderStored(); });
   up.disabled = index === 0; down.disabled = index === images.length - 1; row.append(up, down, button('Remove', () => { storageDraft.splice(index, 1); renderStored(); }, 'danger')); card.append(row);
  }
  grid.append(card);
 });
 out.append(grid);
 if (!images.length) out.append(hint('No images tracked for this display. Existing device contents may still be present.'));
}

function addStoredFromLibrary() {
 if (busy || working) return;
 openSheet('Add from a saved sequence'); let b = $('sheetBody');
 b.append(hint('Adds this display’s rendered tile from each sequence step to the local replacement draft.'));
 if (!db.sequences.length) b.append(hint('Save a sequence to Library first.'));
 for (let seq of db.sequences) b.append(button(seq.name + ' · ' + seq.steps.length + ' images', () => {
  if ((storageDraft || []).length + seq.steps.length > 10) return notify('Maximum 10 images per display collection.');
  storageDraft = storageDraft || [];
  storageDraft.push(...seq.steps.map((f, k) => ({ id: uid(), tile: f.tiles[storedSlot] || '', name: seq.name + ' / ' + (k + 1) })));
  closeSheet(false); renderStored();
 }));
}

function copyStoredImage(item) {
 openSheet('Copy image to a display draft'); let b = $('sheetBody');
 for (let i = 0; i < 4; i++) if (i !== storedSlot) {
  b.append(button('Display ' + (i + 1), () => {
   let r = record(i); if (!address(i)) return notify('Assign this display first.');
   if (r.images.length >= 10) return notify('Destination already has 10 tracked images.');
   if (r.status !== 'tracked' && !confirm('Destination contents are not fully known. Applying its draft will replace all its device images. Continue?')) return;
   storedSlot = i; storageDraft = clone(r.images); storageDraft.push({ ...clone(item), id: uid() });
   closeSheet(false); showPage('stored');
  }));
 }
}
