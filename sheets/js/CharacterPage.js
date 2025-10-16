import { DataManager } from './DataManager.js';
import { RenderingEngine } from './RenderingEngine.js';
import { CharacterStore } from './CharacterStore.js';
import { newId } from './UID.js';
import { initAppShell } from './ui/AppShell.js';

const dm = new DataManager(location.origin);
const offlineKey = 'sessionNotes';
const shell = initAppShell({
  title: 'Character',
  subtitle: 'Play Session',
  current: 'character',
  panes: {
    left: { title: 'Session Controls' },
    center: { title: 'Character Sheet' },
    right: { title: 'Play Tools', description: 'Utilities stay in sync with the active character.' }
  }
});

const elTools = shell.panes.left;
const elSheet = shell.panes.center;
const elLog = shell.panes.right;
shell.actions.innerHTML = '';

let system = null;
let template = null;
let store = null;
let engine = null;
let storeSub = null;
let baselinePointer = 0;

function init(){
  renderLeftPanel();
  renderRightPanel();
  bindLeftPanelActions();
  restoreNotes();
}

function renderLeftPanel(){
  elTools.innerHTML = `
    <section class="panel-section">
      <p class="section-heading">Source</p>
      <div class="stack-sm">
        <label for="sys">System ID</label>
        <input id="sys" class="input-control" value="sys.dnd5e"/>
      </div>
      <div class="stack-sm">
        <label for="tpl">Template ID</label>
        <input id="tpl" class="input-control" value="tpl.5e.flex-basic"/>
      </div>
      <div class="stack-sm">
        <label for="cha">Character ID</label>
        <input id="cha" class="input-control" placeholder="cha_* or leave empty to create"/>
      </div>
      <div class="toolbar" role="group" aria-label="Session actions">
        <button class="btn primary" id="btnLoad">Load</button>
        <button class="btn" id="btnCreate">Create New</button>
        <button class="btn" id="btnSave">Save</button>
      </div>
    </section>
    <section class="panel-section">
      <p class="section-heading">History</p>
      <div class="toolbar" role="group" aria-label="Undo and redo">
        <button class="btn" id="btnUndo" disabled>Undo</button>
        <button class="btn" id="btnRedo" disabled>Redo</button>
      </div>
    </section>
    <section class="panel-section">
      <p class="section-heading">Import / Export</p>
      <textarea id="ioArea" class="textarea-control" rows="8" placeholder="Paste character JSON"></textarea>
      <div class="toolbar" role="group" aria-label="Import export actions">
        <button class="btn" id="btnExport">Copy from sheet</button>
        <button class="btn" id="btnImport">Apply to sheet</button>
      </div>
    </section>
  `;
}

function renderRightPanel(){
  elLog.innerHTML = `
    <section class="panel-section">
      <p class="section-heading">Dice log</p>
      <div id="rolls" class="stack-sm muted-text"></div>
    </section>
    <section class="panel-section">
      <p class="section-heading">Session notes</p>
      <textarea id="sessionNotes" class="textarea-control" placeholder="Quick session notes (stored locally)"></textarea>
    </section>
  `;
  const notes = document.getElementById('sessionNotes');
  if(notes){
    notes.addEventListener('input', ()=> persistNotes(notes.value));
  }
}

function bindLeftPanelActions(){
  document.getElementById('btnLoad').onclick = loadAll;
  document.getElementById('btnCreate').onclick = createNew;
  document.getElementById('btnSave').onclick = saveChar;
  document.getElementById('btnUndo').onclick = ()=> { if(store) store.undo(); updateHistoryButtons(); reflectDirtyState(); };
  document.getElementById('btnRedo').onclick = ()=> { if(store) store.redo(); updateHistoryButtons(); reflectDirtyState(); };
  document.getElementById('btnExport').onclick = ()=> {
    if(!store) return;
    const io = document.getElementById('ioArea');
    io.value = JSON.stringify(store.exportData(), null, 2);
  };
  document.getElementById('btnImport').onclick = ()=> {
    if(!store) return;
    const io = document.getElementById('ioArea');
    try{
      const data = JSON.parse(io.value || '{}');
      store.importData(data);
      updateHistoryButtons();
      reflectDirtyState();
    }catch(err){
      alert('Invalid JSON');
    }
  };
}

function attachStore(charObj){
  if(storeSub) storeSub();
  store = new CharacterStore(charObj);
  storeSub = store.subscribe(()=>{
    updateHistoryButtons();
    syncIoArea();
    reflectDirtyState();
  });
  baselinePointer = store.pointer;
  reflectDirtyState();
}

async function loadAll(){
  const sysId = document.getElementById('sys').value.trim();
  const tplId = document.getElementById('tpl').value.trim();
  const chaId = document.getElementById('cha').value.trim();
  try{
    system = await requireResource('systems', sysId);
    template = await requireResource('templates', tplId);
  }catch(err){
    console.error(err);
    shell.setStatus('Failed to load system or template', 'danger');
    return;
  }
  let loadedChar = null;
  if(chaId){
    loadedChar = await loadCharacter(chaId, sysId, tplId);
  }else{
    loadedChar = createCharacter(sysId, tplId);
  }
  document.getElementById('cha').value = loadedChar.id;
  attachStore(loadedChar);
  mountEngine();
}

async function createNew(){
  const sysId = document.getElementById('sys').value.trim();
  const tplId = document.getElementById('tpl').value.trim();
  if(!system) system = await requireResource('systems', sysId);
  if(!template) template = await requireResource('templates', tplId);
  const fresh = createCharacter(sysId, tplId);
  document.getElementById('cha').value = fresh.id;
  attachStore(fresh);
  mountEngine();
}

function mountEngine(){
  if(engine) engine.dispose();
  engine = new RenderingEngine(system, template, store, { log });
  engine.mount(elSheet, 'runtime');
  syncIoArea();
  updateHistoryButtons();
  reflectDirtyState();
  syncNotes();
}

async function saveChar(){
  if(!store) return;
  const current = store.getCharacter();
  const res = await dm.save('characters', current.id, current);
  if(res?.ok){
    baselinePointer = store.pointer;
    reflectDirtyState(true);
    shell.setStatus(res.local ? 'Saved locally' : 'Character saved', res.local ? 'info' : 'success');
    setTimeout(()=> shell.clearStatus(), 1600);
  }else{
    shell.setStatus(res?.error || 'Save failed', 'danger');
  }
}

function createCharacter(systemId, templateId, forcedId){
  return {
    id: forcedId || newId('cha'),
    system: systemId,
    template: templateId,
    data: { name: 'New Hero' },
    state: { timers: {}, log: [] }
  };
}

function updateHistoryButtons(){
  const undo = document.getElementById('btnUndo');
  const redo = document.getElementById('btnRedo');
  if(!store){
    undo.disabled = true;
    redo.disabled = true;
    return;
  }
  undo.disabled = !store.canUndo();
  redo.disabled = !store.canRedo();
}

function syncIoArea(){
  const io = document.getElementById('ioArea');
  if(!io || !store) return;
  io.value = JSON.stringify(store.exportData(), null, 2);
}

function log(msg){
  const r = document.getElementById('rolls');
  if(!r) return;
  const d = document.createElement('div');
  d.textContent = msg;
  r.prepend(d);
}

function reflectDirtyState(saved = false){
  if(!store){
    shell.clearStatus();
    return;
  }
  const dirty = store.pointer !== baselinePointer;
  if(dirty){
    shell.setStatus('Unsaved changes', 'warning');
  }else if(!saved){
    shell.clearStatus();
  }
}

async function requireResource(bucket, id){
  const payload = await dm.read(bucket, id);
  if(payload && !payload.error){
    return payload;
  }
  const local = dm.readLocal(bucket, id);
  if(local){
    return local;
  }
  throw new Error(payload?.error || `Missing ${bucket} ${id}`);
}

async function loadCharacter(id, systemId, templateId){
  const payload = await dm.read('characters', id);
  if(payload && !payload.error){
    return payload;
  }
  const local = dm.readLocal('characters', id);
  if(local){
    return { ...local, system: local.system || systemId, template: local.template || templateId };
  }
  shell.setStatus(payload?.error || 'Character not accessible', 'danger');
  return createCharacter(systemId, templateId, id);
}

function notesKey(){
  const id = store?.getCharacter()?.id || 'scratch';
  return `${offlineKey}:${id}`;
}

function restoreNotes(){
  const el = document.getElementById('sessionNotes');
  if(!el) return;
  const existing = localStorage.getItem(notesKey());
  if(existing){
    el.value = existing;
  }
}

function persistNotes(value){
  try{
    localStorage.setItem(notesKey(), value || '');
  }catch(err){
    console.warn('Failed to persist notes', err);
  }
}

function syncNotes(){
  const el = document.getElementById('sessionNotes');
  if(!el) return;
  const existing = localStorage.getItem(notesKey());
  el.value = existing || '';
}

init();
