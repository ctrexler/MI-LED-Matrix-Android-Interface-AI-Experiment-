"use strict";

async function init() {
 ensureStorage();
 try {
  let v = JSON.parse(Native.load());
  if ([1, 2, 3].includes(v.version) && Array.isArray(v.sequences)) {
   db.sequences = v.sequences.map(normalizeSequence);
   if (Array.isArray(v.assignments) && v.assignments.length === 4) db.assignments = v.assignments.map(a => typeof a === 'string' ? a : '');
   if ([1, 2, 4].includes(v.layout)) db.layout = v.layout;
   db.autoConnect = !!v.autoConnect;
   db.previewCollapsed = !!v.previewCollapsed;
   if (v.editorView && ['all', 'separate'].includes(v.editorView)) db.editorView = v.editorView;
   if (v.defaults && ['contain', 'cover', 'stretch'].includes(v.defaults.fit)) db.defaults = { fit: v.defaults.fit, smooth: !!v.defaults.smooth };
   if (v.calibration && typeof v.calibration === 'object') {
    db.calibration = {
     gamma: Math.max(1, Math.min(3, Number(v.calibration.gamma) || 2.2)),
     cutoff: Math.max(0, Math.min(128, Math.round(Number(v.calibration.cutoff) || 0))),
     brightness: Math.max(10, Math.min(100, Math.round(Number(v.calibration.brightness) || 100))),
     simulate: !!v.calibration.simulate
    };
   }
   if (Number.isFinite(v.previewSeconds)) db.previewSeconds = Math.max(0.1, Math.min(30, v.previewSeconds));
   if (v.draft && v.draft.sequence) {
    current = normalizeSequence(v.draft.sequence);
    selected = Math.min(Math.max(0, Number(v.draft.selected) || 0), Math.max(0, current.steps.length - 1));
    dirty = !!v.draft.dirty;
    if (v.version === 2 && Number.isFinite(v.draft.previewSeconds)) db.previewSeconds = Math.max(0.1, Math.min(30, v.draft.previewSeconds));
   }
  }
  db.stored = validStorage(v.stored);
  if (v.pendingStorage) {
   for (let item of Object.values(v.pendingStorage)) if (item && db.stored[item.key]) db.stored[item.key].status = 'uncertain';
  }
 } catch (e) { log('Could not load saved data: ' + e.message); }

 if (!current) current = blankSequence();
 if (!db.editorView) db.editorView = 'all';

 bind('menuBtn', openDrawer);
 bind('drawerShade', closeDrawer);
 document.querySelectorAll('[data-page]').forEach(n => n.onclick = () => showPage(n.dataset.page));
 bind('closeSheetBtn', () => closeSheet(true));
 bind('sheetShade', () => closeSheet(true));
 bind('saveBtn', saveSequence);
 bind('undoBtn', undo);
 bind('redoBtn', redo);
 bind('previewCollapseBtn', () => { db.previewCollapsed = !db.previewCollapsed; store(); renderPreview(); });
 bind('newBtn', newSequence);
 bind('viewToggleBtn', toggleEditorView);
 bind('libraryNewBtn', newSequence);
 bind('playBtn', () => startPlayback('editor', current));
 bind('fasterBtn', () => changeSpeed(-0.1));
 bind('slowerBtn', () => changeSpeed(0.1));
 bind('connectionBtn', () => showPage('devices'));
 bind('sendBtn', sendPanel);
 bind('storedPlayBtn', () => { if (!busy && !working) chooseTargets('Start stored slideshow'); });
 bind('cancelTransfer', () => Native.cancel());
 bind('exportBtn', exportLibrary);
 bind('importBtn', () => Native.importLibrary());
 bind('stopLibraryBtn', () => { pausePlayback(); setLive(false); });
 bind('reconnectBtn', () => reconnect(false));
 bind('disconnectBtn', () => { pausePlayback(); setLive(false); Native.disconnect(); });
 bind('clearLogBtn', () => { $('log').textContent = ''; });
 bind('checkUpdateBtn', () => { if (Native.checkUpdate) { notify('Checking for updates…'); Native.checkUpdate(false); } else notify('Updates require the Android app.'); });

 $('sequenceName').oninput = () => { current.name = $('sequenceName').value.slice(0, 100); changed(); };
 $('liveToggle').onchange = () => setLive($('liveToggle').checked);
 $('layout').value = db.layout;
 $('layout').onchange = changeLayout;
 if ($('autoConnectToggle')) {
  $('autoConnectToggle').checked = !!db.autoConnect;
  $('autoConnectToggle').onchange = () => { db.autoConnect = $('autoConnectToggle').checked; store(); };
 }

 function syncCalUI() {
  let cal = db.calibration || { gamma: 2.2, cutoff: 0, brightness: 100, simulate: false };
  if ($('gammaSlider')) { $('gammaSlider').value = cal.gamma; $('gammaVal').textContent = Number(cal.gamma).toFixed(1); }
  if ($('cutoffSlider')) { $('cutoffSlider').value = cal.cutoff; $('cutoffVal').textContent = String(cal.cutoff); }
  if ($('brightSlider')) { $('brightSlider').value = cal.brightness; $('brightVal').textContent = cal.brightness + '%'; }
  if ($('simCalToggle')) $('simCalToggle').checked = !!cal.simulate;
 }
 function updateCal(saveNow) {
  db.calibration = { gamma: Number($('gammaSlider').value), cutoff: Number($('cutoffSlider').value), brightness: Number($('brightSlider').value), simulate: !!($('simCalToggle') && $('simCalToggle').checked) };
  simCache.clear(); syncCalUI();
  if (db.calibration.simulate) renderEditor();
  if (saveNow) store(); else draftSoon();
  if (live) previewCurrent(true);
 }
 syncCalUI();
 if ($('gammaSlider')) ['gammaSlider', 'cutoffSlider', 'brightSlider'].forEach(id => { $(id).oninput = () => updateCal(false); $(id).onchange = () => updateCal(true); });
 if ($('simCalToggle')) $('simCalToggle').onchange = () => { db.calibration.simulate = $('simCalToggle').checked; simCache.clear(); store(); renderEditor(); };
 bind('calResetBtn', () => { db.calibration = { gamma: 2.2, cutoff: 0, brightness: 100, simulate: false }; simCache.clear(); syncCalUI(); store(); renderEditor(); if (live) previewCurrent(true); notify('Calibration reset to defaults.'); });

 $('imagePicker').onchange = onPicked;
 $('largePreview').onclick = e => {
  let panel = e.target.closest('[data-panel]');
  if (panel && current.steps[selected] && !busy && !working) { pausePlayback(); openSource(current.steps[selected].id, Number(panel.dataset.panel)); }
 };
 document.addEventListener('pointermove', dragMove, { passive: false });
 document.addEventListener('pointerup', dragEnd, { passive: false });
 document.addEventListener('pointercancel', dragEnd, { passive: false });
 document.addEventListener('keydown', e => {
  if (e.key === 'Escape') handleBack();
  if (e.key === 'Tab' && !$('sheet').hidden) {
   let focusable = Array.from($('sheet').querySelectorAll('button,input,select,[tabindex]')).filter(n => !n.disabled && n.offsetParent !== null);
   if (focusable.length) {
    let first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
   }
  }
 });
 document.addEventListener('visibilitychange', () => { if (document.hidden) { pausePlayback(); flushDraft(); } });

 renderEditor(); renderAssignments(); updateSaveState(); updateUndoButtons();
 log('LED Matrix Controller ' + APP_VERSION + ' ready. Live Preview starts off; enable it to send temporary images.');
 if (db.autoConnect && db.assignments.some(Boolean)) setTimeout(() => { if (db.autoConnect && !busy) reconnect(true); }, 350);
 setTimeout(() => { if (Native.checkUpdate) Native.checkUpdate(true); }, 1500);
}

function onUpdateAvailable(code, name, url) {
 if (confirm('Update available (' + name + ', build ' + code + '). Download and install now?')) Native.installUpdate(url);
}

init();
