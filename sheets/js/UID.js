// ULID-ish, URL-safe IDs with prefix
const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function enc32(num, width){ let s=""; for(let i=0;i<width;i++){ s = CROCK[num & 31] + s; num = Math.floor(num/32);} return s; }
export function newId(prefix="cha"){
  const ts = Date.now();
  const rand = new Uint8Array(10);
  (crypto || window.msCrypto).getRandomValues(rand);
  let r = 0n; for(const b of rand){ r = (r<<8n) | BigInt(b); }
  const tsStr = enc32(ts,10).toLowerCase();
  let rStr=""; for(let i=0;i<16;i++){ rStr = CROCK[Number(r & 31n)] + rStr; r >>= 5n; }
  return `${prefix}_${tsStr}${rStr}`;
}
