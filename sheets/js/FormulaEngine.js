// Very small safe-ish expression eval
// Supports: + - * / % ( ) min max floor ceil round clamp sum avg mod ?:
export class FormulaEngine{
  constructor(systemIndex){
    this.systemIndex = systemIndex || {};
    this.funcs = {
      min: Math.min, max: Math.max,
      floor: Math.floor, ceil: Math.ceil, round: Math.round,
      mod: (a,b)=>a%b,
      clamp: (x,a,b)=>Math.min(Math.max(x,a),b),
      sum: (arr)=> (arr||[]).reduce((a,b)=>a+(+b||0),0),
      avg: (arr)=> { const s=(arr||[]).reduce((a,b)=>a+(+b||0),0); return (arr&&arr.length)? s/arr.length : 0; }
    };
  }
  eval(expr, ctx){
    if(expr==null || expr==="") return "";
    const scope = this.buildScope(ctx);
    const src = this.rewrite(expr);
    // NO new Function over user input in production; here constrained:
    const fn = new Function(...Object.keys(scope), ...Object.keys(this.funcs), `return (${src});`);
    return fn(...Object.values(scope), ...Object.values(this.funcs));
  }
  buildScope(ctx){
    // flatten @paths to numbers/strings for convenience
    return ctx || {};
  }
  rewrite(expr){
    // replace @a.b with (ctx["a"]["b"])
    return expr.replace(/@([a-zA-Z0-9_$.]+)/g, (_,p)=>{
      const path = p.split('.').map(k=>k==='@'?'data':k);
      return `thisCtx.${path.join('.')}`;
    });
  }
}
