// Selective NIST/PNNL reference import. Public-domain ownership is checked per file,
// not inferred from NIST's government status or a downloadable link.
import converter from 'jcampconverter';

export const NIST_ORIGIN='https://webbook.nist.gov';
export const nistCollections=[
 {id:'nist-pnnl-solids',title:'NIST / PNNL public-domain solid IR reference measurements',url:NIST_ORIGIN+'/chemistry/silmarils-solids-hrf-drf/',contributor:'IARPA-IR-S',citation:'https://doi.org/10.1364/ao.54.004863'},
 {id:'nist-pnnl-liquids',title:'NIST / PNNL public-domain liquid optical constants',url:NIST_ORIGIN+'/chemistry/silmarils-liquids-n-k/',contributor:'IARPA-IR-NK',citation:'https://doi.org/10.1177/0003702817742848'}
];
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
export function collectionSpecies(html,base){
 const seen=new Set();return links(html,base).filter(e=>{const u=new URL(e.url),id=u.searchParams.get('ID');if(u.pathname!=='/cgi/cbook.cgi'||!id||!e.label||!u.searchParams.get('Contrib')?.startsWith('IARPA-IR-')||seen.has(id))return false;seen.add(id);return true});
}
export function parseNistPage(html,url){
 const entities=[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m=>{try{const v=JSON.parse(m[1]);return Array.isArray(v)?v:[v]}catch{return []}}),identity=entities.find(e=>e['@type']==='MolecularEntity');
 const conditions={};for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...m[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(c=>htmlText(c[1]));if(cells.length===2)conditions[cells[0]]=cells[1]}
 const all=links(html,url),download=all.find(e=>new URL(e.url).searchParams.has('JCAMP'));
 const spectra=all.filter(e=>new URL(e.url).searchParams.get('Type')==='IR-SPEC');
 const unique=[...new Map(spectra.map(e=>[e.url,e])).values()];
 return {name:identity?.name||htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),inchikey:identity?.inChIKey||null,inchi:identity?.inChI||null,formula:identity?.molecularFormula||null,cas:htmlText(html).match(/CAS Registry Number:\s*(\d+-\d+-\d+)/)?.[1]||null,conditions,owner:conditions.Owner||null,downloadUrl:download?.url||null,spectra:unique,documentation:all.filter(e=>/documentation|particle size/i.test(e.label)),sourceUrl:nistUrl(url),publicDomain:conditions.Owner?.trim().toLowerCase()==='public domain'};
}
export function decodeNistJcamp(bytes,expectedCas){
 // NIST files may contain ISO-8859-1 symbols; retain original bytes separately.
 const raw=new TextDecoder('windows-1252').decode(bytes);
 if(!/^##TITLE=/im.test(raw)||!/^##JCAMP-DX=/im.test(raw))throw Error('Not a JCAMP-DX file');
 const result=converter.convert(raw,{keepRecordsRegExp:/.*/}),records=[];
 for(const [blockIndex,block]of(result.flatten||[]).entries()){
  const info=block.info||{},owner=String(info.OWNER||'').trim();
  if(owner.toLowerCase()!=='public domain')throw Error('JCAMP block is not explicitly public domain');
  if(info.DATATYPE!=='INFRARED SPECTRUM')throw Error('Not an infrared spectrum');
  if(!expectedCas||String(info.CASREGISTRYNO)!==expectedCas)throw Error('JCAMP CAS does not match the identified page');
  for(const [spectrumIndex,s]of(block.spectra||[]).entries()){
   if(!s.isXYdata||!s.data?.x?.length||s.data.x.length!==s.data.y?.length)throw Error('Missing continuous XY data');
   if(!/^1\/CM$|^CM-1$|^CM\^-1$/i.test(s.xUnits||''))throw Error('Unsupported wavenumber unit');
   const points=s.data.x.map((x,i)=>[Number(x),Number(s.data.y[i])]).sort((a,b)=>a[0]-b[0]);
   if(points.length<3||points.some(p=>p.some(v=>!Number.isFinite(v))))throw Error('Insufficient or non-finite numerical data');
   if(points.some((p,i)=>i&&p[0]<=points[i-1][0]))throw Error('Duplicate/nonmonotonic wavenumbers');
   if(!s.nbPoints||s.nbPoints!==points.length)throw Error('NPOINTS differs from decoded count');
   if(!Number.isFinite(s.firstX)||!Number.isFinite(s.lastX)||Math.abs(points[0][0]-Math.min(s.firstX,s.lastX))>.05||Math.abs(points.at(-1)[0]-Math.max(s.firstX,s.lastX))>.05)throw Error('Decoded range disagrees with header');
   const unit=String(s.yUnits||''),label=String(info.YLABEL||unit),combined=(unit+' '+label).toLowerCase();
   let measurementType;
   if(combined.includes('reflectance'))measurementType='reflectance';
   else if(/dispersion|refractive index|\bn\b/.test(combined)&&!/absorption|\bk\b/.test(combined))measurementType='optical-constants-n';
   else if(/extinction|\bk\b/.test(combined)&&!/absorbance/.test(combined))measurementType='optical-constants-k';
   else if(/^absorbance$/i.test(unit))measurementType='absorbance';
   else if(/transmittance/i.test(unit))measurementType='transmittance';
   else throw Error('Unrecognized physical measurement: '+unit+' / '+label);
   records.push({blockIndex,spectrumIndex,title:block.title,header:info,owner,measurementType,yUnit:label,xUnit:'cm-1',originalYUnit:unit,parsed:{points,range:[points[0][0],points.at(-1)[0]]},converterLogs:result.logs||[]});
  }
 }
 if(!records.length)throw Error('No supported public-domain spectra');return records;
}
export function duplicateCanonical(ids){return [...new Set(ids)].sort()[0]||null}
export function linkNistIdentity(page,catalog,computedKey){
 if(!page.inchikey||!page.inchi||computedKey!==page.inchikey)return null;
 return catalog.get(page.inchikey)||null;
}
