import { DataManager } from './DataManager.js';
import { RenderingEngine } from './RenderingEngine.js';
import { CharacterStore } from './CharacterStore.js';
import { newId } from './UID.js';

const dm = new DataManager(location.origin);
const elTools = document.getElementById('tools');
const elSheet = document.getElementById('sheet');
const elLog = document.getElementById('log');

let system = null;
let template = null;
let store = null;
let engine = null;
let storeSub = null;

function init(){
  elTools.innerHTML = `<h3>Tools</h3>
    <div class="form-row"><label>System ID</label><input id="sys" class="input" value="sys.dnd5e"/></div>
    <div class="form-row"><label>Template ID</label><input id="tpl" class="input" value="tpl.5e.flex-basic"/></div>
    <div class="form-row"><label>Character ID</label><input id="cha" class="input" placeholder="cha_* or leave empty to create"/></div>
    <div class="actions">
      <button class="btn" id="btnLoad">Load</button>
      <button class="btn" id="btnCreate">Create New</button>
      <button class="btn" id="btnSave">Save</button>
    </div>
    <div class="actions">
      <button class="btn" id="btnUndo" disabled>Undo</button>
      <button class="btn" id="btnRedo" disabled>Redo</button>
    </div>
    <div class="form-row">
      <label>Import / Export</label>
      <textarea id="ioArea" class="input" rows="6" placeholder="Paste character JSON"></textarea>
    </div>
    <div class="actions">
      <button class="btn" id="btnExport">Copy from Sheet</button>
      <button class="btn" id="btnImport">Apply to Sheet</button>
    </div>`;
  elLog.innerHTML = `<h3>Roll Log</h3><div id="rolls" class="small"></div>`;

  document.getElementById('btnLoad').onclick = loadAll;
  document.getElementById('btnCreate').onclick = createNew;
  document.getElementById('btnSave').onclick = saveChar;
  document.getElementById('btnUndo').onclick = ()=> { if(store) store.undo(); updateHistoryButtons(); };
  document.getElementById('btnRedo').onclick = ()=> { if(store) store.redo(); updateHistoryButtons(); };
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
  });
}

async function loadAll(){
  const sysId = document.getElementById('sys').value.trim();
  const tplId = document.getElementById('tpl').value.trim();
  const chaId = document.getElementById('cha').value.trim();
  system = await dm.read('systems', sysId);
  template = await dm.read('templates', tplId);
  let loadedChar = null;
  if(chaId){
    loadedChar = await dm.read('characters', chaId);
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
  if(!system) system = await dm.read('systems', sysId);
  if(!template) template = await dm.read('templates', tplId);
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
}

async function saveChar(){
  if(!store) return;
  const token = localStorage.getItem('token');
  if(!token){ alert('Login first'); return; }
  const current = store.getCharacter();
  const res = await dm.save('characters', current.id, current);
  alert(JSON.stringify(res));
}

function createCharacter(systemId, templateId){
  return {
    id: newId('cha'),
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

init();
