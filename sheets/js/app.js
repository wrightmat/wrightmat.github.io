import { DataManager } from './DataManager.js';
import { seed5e } from './seeds.js';

const out = document.getElementById('output');
const dm = new DataManager(location.origin);

function log(obj){ out.textContent = JSON.stringify(obj, null, 2); }

async function ensureAuth(){
  const who = document.getElementById('whoami');
  const token = localStorage.getItem('token');
  if(!token){ who.textContent = '(anon)'; return; }
  // naive check by listing public
  who.textContent = '(logged in)';
}

document.getElementById('btnRegister').onclick = async () => {
  const email = prompt('Email?','demo@example.com'); if(!email) return;
  const username = prompt('Username?','demo'); if(!username) return;
  const password = prompt('Password?','demo'); if(!password) return;
  const r = await dm.register(email, username, password);
  if(r.token){ localStorage.setItem('token', r.token); alert('Registered!'); ensureAuth(); }
  else alert(JSON.stringify(r));
};

document.getElementById('btnLogin').onclick = async () => {
  const u = prompt('Username or Email?','demo'); if(!u) return;
  const p = prompt('Password?','demo'); if(!p) return;
  const r = await dm.login(u, p);
  if(r.token){ localStorage.setItem('token', r.token); alert('Logged in!'); ensureAuth(); }
  else alert(JSON.stringify(r));
};

document.getElementById('seed5e').onclick = async () => {
  const res = await seed5e(dm);
  log(res);
};

document.getElementById('listSystems').onclick = async () => log(await dm.list('systems'));
document.getElementById('listTemplates').onclick = async () => log(await dm.list('templates'));
document.getElementById('listCharacters').onclick = async () => log(await dm.list('characters'));

ensureAuth();
