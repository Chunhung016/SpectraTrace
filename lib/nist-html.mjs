// Dependency-free NIST WebBook HTML helpers shared by the bulk importer and on-demand lookup.
export const NIST_ORIGIN='https://webbook.nist.gov';
export function htmlText(s=''){
 const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',times:'×',deg:'°',plusmn:'±',beta:'β',alpha:'α',epsilon:'ε'};
 return s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(_,key)=>{if(key[0]==='#'){const cp=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):''}return entities[key.toLowerCase()]??'&'+key+';'}).replace(/\s+/g,' ').trim();
}
export function nistUrl(value,base=NIST_ORIGIN){
 const u=new URL(value.replaceAll('&amp;','&'),base);
 if(u.origin!==NIST_ORIGIN||u.pathname.startsWith('/cdn-cgi/'))throw Error('Only advertised NIST WebBook URLs are allowed');
 u.hash='';return u.href;
}
export function links(html,base=NIST_ORIGIN){
 return [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{try{return [{url:nistUrl(m[1],base),label:htmlText(m[2])}]}catch{return []}});
}
