import { DataManager } from './DataManager.js';
import { newId } from './UID.js';

const dm = new DataManager(location.origin);
let tpl = { id: "tpl.new", schema: "sys.dnd5e", title: "New Template", content: [] };

const palette = [
  {el:'input', label:'Input (text)', input:'text'},
  {el:'input', label:'Input (number)', input:'number'},
  {el:'text', label:'Text (formula)', formula:'0'},
  {el:'roller', label:'Dice Roller', expr:'1d20'},
  {el:'container', label:'Container', children:[]},
  {el:'tabs', label:'Tabs', tabs:[{label:'Tab 1', content:[]}]},
  {el:'list', label:'List', bind:'@inventory', item:{content:[{el:'input', bind:'item.name', label:'Name'}]}},
  {el:'toggle', label:'Toggle', bind:'@stance', states:['A','B','C']},
  {el:'tags', label:'Tags', bind:'@traits', options:['brave','alert'], multi:true},
  {el:'clock', label:'Clock', bind:'@clock', max:6},
  {el:'timer', label:'Timer', bind:'@timers.concentration', mode:'up'}
];

const elPalette = document.getElementById('palette');
const elCanvas = document.getElementById('canvas');
const elInspector = document.getElementById('inspector');

function renderPalette(){
  elPalette.innerHTML = '<h3>Palette</h3>';
  palette.forEach((p,i)=>{
    const a = document.createElement('div'); a.className='item'; a.textContent = p.label || p.el;
    a.draggable = true;
    a.ondragstart = (e)=>{ e.dataTransfer.setData('text/plain', JSON.stringify(p)); };
    elPalette.appendChild(a);
  });
  const actions = document.createElement('div'); actions.innerHTML = `
    <hr/>
    <button class="btn" id="btnSave">Save</button>
    <button class="btn" id="btnNew">New</button>
  `;
  elPalette.appendChild(actions);
  actions.querySelector('#btnSave').onclick = saveTemplate;
  actions.querySelector('#btnNew').onclick = ()=>{ tpl = { id:'tpl.'+prompt('Template ID (tpl.x)?','example')||'example', schema: tpl.schema, title:'New Template', content:[] }; draw(); };
}

let selectedIndex = -1;
function renderCanvas(){
  elCanvas.innerHTML = `<h3>Canvas</h3><div class="small">Drag items from the palette here</div>`;
  const dropZone = document.createElement('div'); dropZone.style.minHeight='60px';
  dropZone.ondragover = (e)=> e.preventDefault();
  dropZone.ondrop = (e)=>{ e.preventDefault(); const item = JSON.parse(e.dataTransfer.getData('text/plain')); tpl.content.push(item); draw(); };
  elCanvas.appendChild(dropZone);

  tpl.content.forEach((el, idx)=>{
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `<div class="small">${idx+1}. ${el.el} ${el.label?('— '+el.label):''}</div>`;
    card.onclick = ()=>{ selectedIndex = idx; renderInspector(); };
    // up/down/delete
    const bar = document.createElement('div');
    const up = document.createElement('button'); up.className='btn small'; up.textContent='↑'; up.onclick=(ev)=>{ ev.stopPropagation(); if(idx>0){ const t=tpl.content[idx-1]; tpl.content[idx-1]=tpl.content[idx]; tpl.content[idx]=t; draw(); } };
    const dn = document.createElement('button'); dn.className='btn small'; dn.textContent='↓'; dn.onclick=(ev)=>{ ev.stopPropagation(); if(idx<tpl.content.length-1){ const t=tpl.content[idx+1]; tpl.content[idx+1]=tpl.content[idx]; tpl.content[idx]=t; draw(); } };
    const del = document.createElement('button'); del.className='btn small'; del.textContent='✖'; del.onclick=(ev)=>{ ev.stopPropagation(); tpl.content.splice(idx,1); draw(); };
    bar.appendChild(up); bar.appendChild(dn); bar.appendChild(del); card.appendChild(bar);
    elCanvas.appendChild(card);
  });
}

function renderInspector(){
  elInspector.innerHTML = `<h3>Inspector</h3>`;
  if(selectedIndex<0){ elInspector.innerHTML += '<div class="small">Select an element</div>'; return; }
  const el = tpl.content[selectedIndex];
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>Label</label><input class="input" id="f_label" value="${el.label||''}"/></div>
    <div class="form-row"><label>Bind</label><input class="input" id="f_bind" value="${el.bind||''}" placeholder="@path"/></div>
    <div class="form-row"><label>Formula</label><input class="input" id="f_formula" value="${el.formula||''}" placeholder="expr"/></div>
  `;
  form.querySelector('#f_label').oninput = (e)=>{ el.label = e.target.value; };
  form.querySelector('#f_bind').oninput = (e)=>{ el.bind = e.target.value; };
  form.querySelector('#f_formula').oninput = (e)=>{ el.formula = e.target.value; };
  elInspector.appendChild(form);
}

async function saveTemplate(){
  const token = localStorage.getItem('token');
  if(!token){ alert('Login first'); return; }
  const res = await dm.save('templates', tpl.id, tpl);
  alert(JSON.stringify(res));
}

function draw(){ renderPalette(); renderCanvas(); renderInspector(); }
draw();
