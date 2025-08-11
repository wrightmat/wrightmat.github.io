// Minimal Roll20-ish dice: XdY, +/-, kh/kl, exploding !
export class DiceEngine{
  roll(expr){
    const tokens = expr.replace(/\s+/g,'').match(/(\d+d\d+!?(kh\d+|kl\d+)?|[()+\-*/]|\d+)/gi);
    if(!tokens) return { total: 0, parts: [], text: 'invalid' };
    const stack = [];
    let i=0;
    function parseTerm(){
      let tok = tokens[i++];
      if(!tok) return 0;
      if(/^\d+$/.test(tok)) return +tok;
      if(/^\d+d\d+/.test(tok)){
        // dice block
        const m = tok.match(/^(\d+)d(\d+)(!?)(kh\d+|kl\d+)?$/i);
        let [_, n, sides, bang, keep] = m;
        n = +n; sides = +sides;
        const rolls = [];
        for(let r=0;r<n;r++){
          let v = 1+Math.floor(Math.random()*sides);
          rolls.push(v);
          if(bang==='!'){
            while(v===sides){ v = 1+Math.floor(Math.random()*sides); rolls.push(v); }
          }
        }
        let used = [...rolls];
        if(keep){
          const k = +keep.slice(2);
          used.sort((a,b)=>a-b);
          if(keep.startsWith('kh')) used = used.slice(-k);
          else used = used.slice(0,k);
        }
        return used.reduce((a,b)=>a+b,0);
      }
      if(tok==='('){
        const val = parseExpr();
        i++; // consume ')'
        return val;
      }
      if(tok==='-') return -parseTerm();
      return 0;
    }
    function parseFactor(){
      let val = parseTerm();
      while(i<tokens.length && (tokens[i]==='*' || tokens[i]==='/')){
        const op = tokens[i++];
        const rhs = parseTerm();
        val = op==='*' ? val*rhs : Math.floor(val/rhs);
      }
      return val;
    }
    function parseExpr(){
      let val = parseFactor();
      while(i<tokens.length && (tokens[i]=='=' || tokens[i]=='+' || tokens[i]=='-')){
        const op = tokens[i++];
        const rhs = parseFactor();
        val = op==='+' ? val+rhs : val-rhs;
      }
      return val;
    }
    const total = parseExpr();
    return { total, text: expr };
  }
}
