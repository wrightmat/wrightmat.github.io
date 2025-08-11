import { DataManager } from './DataManager.js';
import { RenderingEngine } from './RenderingEngine.js';
import { newId } from './UID.js';

const dm = new DataManager(location.origin);
const elTools = document.getElementById('tools');
const elSheet = document.getElementById('sheet');
const elLog = document.getElementById('log');

let system=null, template=null, character=null;

async function init(){
  elTools.innerHTML = `<h3>Tools</h3>
    <div class="form-row"><label>System ID</label><input id="sys" class="input" value="sys.dnd5e"/></div>
    <div class="form-row"><label>Template ID</label><input id="tpl" class="input" value="tpl.5e.flex-basic"/></div>
    <div class="form-row"><label>Character ID</label><input id="cha" class="input" placeholder="cha_* or leave empty to create"/></div>
    <button class="btn" id="btnLoad">Load</button>
    <button class="btn" id="btnCreate">Create New</button>
    <button class="btn" id="btnSave">Save</button>
  `;
  elLog.innerHTML = `<h3>Roll Log</h3><div id="rolls" class="small"></div>`;

  document.getElementById('btnLoad').onclick = loadAll;
  document.getElementById('btnCreate').onclick = createNew;
  document.getElementById('btnSave').onclick = saveChar;
}

async function loadAll(){
  const sysId = document.getElementById('sys').value.trim();
  const tplId = document.getElementById('tpl').value.trim();
  const chaId = document.getElementById('cha').value.trim();
  system = await dm.read('systems', sysId);
  template = await dm.read('templates', tplId);
  if(chaId){
    character = await dm.read('characters', chaId);
  }else{
    character = { id:newId('cha'), system: sysId, template: tplId, data:{ name:'New Hero' }, state:{ timers:{}, log:[] } };
  }
  const engine = new RenderingEngine(system, template, character, { log: (msg)=> log(msg) });
  engine.mount(elSheet, 'runtime');
}

async function createNew(){
  const sysId = document.getElementById('sys').value.trim();
  const tplId = document.getElementById('tpl').value.trim();
  character = { id:newId('cha'), system: sysId, template: tplId, data:{ name:'New Hero' }, state:{ timers:{}, log:[] } };
  document.getElementById('cha').value = character.id;
  const engine = new RenderingEngine(system || await dm.read('systems', sysId), template || await dm.read('templates', tplId), character, { log: log });
  engine.mount(elSheet, 'runtime');
}

async function saveChar(){
  if(!character) return;
  const token = localStorage.getItem('token'); if(!token){ alert('Login first'); return; }
  const res = await dm.save('characters', character.id, character);
  alert(JSON.stringify(res));
}

function log(msg){
  const r = document.getElementById('rolls'); const d = document.createElement('div'); d.textContent = msg; r.prepend(d);
}

init();
