import { newId } from './UID.js';
export async function seed5e(dm){
  const token = localStorage.getItem('token'); if(!token) return {error:'Login first'};
  const sys = await (await fetch('data/systems/sys.dnd5e.json')).json();
  const tpl = await (await fetch('data/templates/tpl.5e.flex-basic.json')).json();
  const cha = { id: newId('cha'), system: sys.id, template: tpl.id, data:{ name:'Elandra', abilities:{strength:8,dexterity:14}, inventory:[{name:'Rope',qty:1}] }, state:{ timers:{}, log:[] } };
  const a = await dm.save('systems', sys.id, sys);
  const b = await dm.save('templates', tpl.id, tpl);
  const c = await dm.save('characters', cha.id, cha);
  return { a,b,c, chaId: cha.id };
}
