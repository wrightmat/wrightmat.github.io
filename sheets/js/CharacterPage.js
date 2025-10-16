import { DataManager } from './DataManager.js';
import { RenderingEngine } from './RenderingEngine.js';
import { CharacterStore } from './CharacterStore.js';
import { newId } from './UID.js';
import { initAppShell } from './ui/AppShell.js';
import { populateSelect } from './ui/components.js';

const dm = new DataManager(location.origin);
const offlineKey = 'sessionNotes';
const shell = initAppShell({
  title: 'Character',
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
shell.actionBar.innerHTML = '';

let system = null;
let template = null;
let store = null;
let engine = null;
let storeSub = null;
let baselinePointer = 0;

const catalogs = {
  systems: [],
  templates: [],
  characters: []
};

const state = {
  systemId: '',
  templateId: '',
  characterId: ''
};

const controls = {
  system: null,
  template: null,
  character: null
};

async function init(){
  await refreshCatalogs();
  renderLeftPanel();
  renderRightPanel();
  restoreNotes();
}

async function refreshCatalogs(){
  try{
    const [sysCat, tplCat, chaCat] = await Promise.all([
      dm.catalog('systems'),
      dm.catalog('templates'),
      dm.catalog('characters')
    ]);
    catalogs.systems = sysCat.entries;
    catalogs.templates = tplCat.entries;
    catalogs.characters = chaCat.entries;
    if(!state.systemId && catalogs.systems.length){
      state.systemId = catalogs.systems[0].id;
    }
    if(!state.templateId){
      state.templateId = pickTemplateForSystem(state.systemId);
    }
    if(!state.characterId && catalogs.characters.length){
      state.characterId = catalogs.characters[0].id;
    }
  }catch(err){
    console.warn('Failed to refresh catalogs', err);
  }
}

function renderLeftPanel(){
  elTools.innerHTML = `
    <section class="panel-section">
      <p class="section-heading">Source</p>
      <div class="stack-sm">
        <label for="sysSelect">System</label>
        <select id="sysSelect" class="input-control"></select>
      </div>
      <div class="stack-sm">
        <label for="tplSelect">Template</label>
        <select id="tplSelect" class="input-control"></select>
      </div>
      <div class="stack-sm">
        <label for="chaSelect">Character</label>
        <select id="chaSelect" class="input-control"></select>
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
  controls.system = elTools.querySelector('#sysSelect');
  controls.template = elTools.querySelector('#tplSelect');
  controls.character = elTools.querySelector('#chaSelect');
  configureSourceSelectors();
  bindLeftPanelActions();
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
  if(controls.system){
    controls.system.onchange = ()=>{
      state.systemId = controls.system.value;
      state.templateId = pickTemplateForSystem(state.systemId);
      configureTemplateOptions();
      configureCharacterOptions();
    };
  }
  if(controls.template){
    controls.template.onchange = ()=>{
      state.templateId = controls.template.value;
      configureCharacterOptions();
    };
  }
  if(controls.character){
    controls.character.onchange = ()=>{
      state.characterId = controls.character.value;
    };
  }
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

function configureSourceSelectors(){
  configureSystemOptions();
  configureTemplateOptions();
  configureCharacterOptions();
}

function configureSystemOptions(){
  if(!controls.system) return;
  const fallback = system ? { id: system.id, label: formatSystemLabel(system) } : null;
  const selection = populateSelect(controls.system, catalogs.systems, {
    selected: state.systemId || fallback?.id,
    fallback
  });
  state.systemId = selection || '';
}

function configureTemplateOptions(){
  if(!controls.template) return;
  const entries = getTemplatesForSystem(state.systemId);
  const fallback = template ? { id: template.id, label: formatTemplateLabel(template) } : null;
  const selection = populateSelect(controls.template, entries, {
    selected: state.templateId || fallback?.id,
    fallback
  });
  state.templateId = selection || '';
}

function configureCharacterOptions(){
  if(!controls.character) return;
  const entries = getCharactersForSelection(state.systemId, state.templateId);
  const fallback = store ? { id: store.getCharacter().id, label: formatCharacterLabel(store.getCharacter()) } : null;
  const selection = populateSelect(controls.character, entries, {
    selected: state.characterId || fallback?.id,
    fallback,
    placeholder: '— New character —'
  });
  state.characterId = selection || '';
  if(!state.characterId){
    controls.character.value = '';
  }
}

function pickTemplateForSystem(systemId){
  if(!systemId) return catalogs.templates[0]?.id || '';
  const match = catalogs.templates.find(entry => entry.meta?.schema === systemId);
  if(match) return match.id;
  return catalogs.templates[0]?.id || '';
}

function getTemplatesForSystem(systemId){
  if(!systemId) return catalogs.templates;
  const filtered = catalogs.templates.filter(entry => {
    const meta = entry.meta || {};
    return meta.schema === systemId || meta.system === systemId;
  });
  return filtered.length ? filtered : catalogs.templates;
}

function getCharactersForSelection(systemId, templateId){
  let entries = catalogs.characters;
  if(systemId){
    const filtered = entries.filter(entry => {
      const meta = entry.meta || {};
      return meta.system === systemId;
    });
    if(filtered.length) entries = filtered;
  }
  if(templateId){
    const filtered = entries.filter(entry => {
      const meta = entry.meta || {};
      return meta.template === templateId;
    });
    if(filtered.length) entries = filtered;
  }
  return entries;
}

function formatSystemLabel(obj){
  if(!obj) return '';
  const id = obj.id || obj.system || '';
  const title = obj.title || obj.name;
  return title && title !== id ? `${title} (${id})` : id;
}

function formatTemplateLabel(obj){
  if(!obj) return '';
  const id = obj.id;
  const title = obj.title;
  return title && title !== id ? `${title} (${id})` : id;
}

function formatCharacterLabel(obj){
  if(!obj) return '';
  const id = obj.id;
  const name = obj.data?.name || obj.name;
  return name && name !== id ? `${name} (${id})` : id;
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
  const sysId = (controls.system?.value || state.systemId || '').trim();
  const tplId = (controls.template?.value || state.templateId || '').trim();
  const chaId = (controls.character?.value || state.characterId || '').trim();
  if(!sysId || !tplId){
    shell.setStatus('Select a system and template before loading', 'warning');
    return;
  }
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
  state.systemId = sysId;
  state.templateId = tplId;
  state.characterId = loadedChar.id;
  attachStore(loadedChar);
  mountEngine();
  configureSourceSelectors();
}

async function createNew(){
  const sysId = (controls.system?.value || state.systemId || '').trim();
  const tplId = (controls.template?.value || state.templateId || '').trim();
  if(!sysId || !tplId){
    shell.setStatus('Select a system and template before creating a character', 'warning');
    return;
  }
  if(!system) system = await requireResource('systems', sysId);
  if(!template) template = await requireResource('templates', tplId);
  const fresh = createCharacter(sysId, tplId);
  state.systemId = sysId;
  state.templateId = tplId;
  state.characterId = fresh.id;
  attachStore(fresh);
  mountEngine();
  configureSourceSelectors();
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
    state.characterId = current.id;
    await refreshCatalogs();
    configureCharacterOptions();
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
