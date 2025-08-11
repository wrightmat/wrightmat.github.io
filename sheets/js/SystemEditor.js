import { DataManager } from './DataManager.js';

const dm = new DataManager(location.origin);
let sys = { id:'sys.dnd5e', title:'New System', version:'0.1.0', fields:[], formulas:[], importers:[] };

const elTree = document.getElementById('tree');
const elForm = document.getElementById('form');
const elActions = document.getElementById('actions');

function draw(){
  elTree.innerHTML = '<h3>Fields</h3>';
  sys.fields.forEach((f, i)=>{
    const d = document.createElement('div'); d.className='card';
    d.textContent = `${i+1}. ${f.key} (${f.type})`;
    d.onclick = ()=> editField(i);
    elTree.appendChild(d);
  });
  const add = document.createElement('button'); add.className='btn'; add.textContent='Add field'; add.onclick=()=>{
    sys.fields.push({key:'newField', type:'string'}); draw();
  };
  elTree.appendChild(add);

  elActions.innerHTML = `<h3>Actions</h3>
    <div class="form-row"><label>System ID</label><input id="sysid" class="input" value="${sys.id}"/></div>
    <div class="form-row"><label>Title</label><input id="systitle" class="input" value="${sys.title||''}"/></div>
    <button class="btn" id="save">Save</button>`;
  elActions.querySelector('#save').onclick = saveSystem;
  elActions.querySelector('#sysid').oninput = (e)=> sys.id = e.target.value;
  elActions.querySelector('#systitle').oninput = (e)=> sys.title = e.target.value;
}

function editField(i){
  const f = sys.fields[i];
  elForm.innerHTML = `<h3>Edit Field</h3>
    <div class="form-row"><label>Key</label><input id="fkey" class="input" value="${f.key}"/></div>
    <div class="form-row"><label>Type</label>
      <select id="ftype" class="input">
        ${['string','integer','number','boolean','array','object','group'].map(t=>`<option ${f.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <button class="btn" id="del">Delete</button>
  `;
  elForm.querySelector('#fkey').oninput = (e)=> f.key = e.target.value;
  elForm.querySelector('#ftype').onchange = (e)=> f.type = e.target.value;
  elForm.querySelector('#del').onclick = ()=>{ sys.fields.splice(i,1); draw(); };
}

async function saveSystem(){
  const token = localStorage.getItem('token'); if(!token) return alert('Login first');
  const res = await dm.save('systems', sys.id, sys);
  alert(JSON.stringify(res));
}

draw();
