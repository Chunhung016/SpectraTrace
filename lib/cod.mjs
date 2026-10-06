// Crystallography Open Database (CC0) lookup and calculated-pattern storage.
// A COD entry is matched by Hill formula; only entries whose name matches the catalog
// compound are used automatically. Formula-only hits are offered for the user to choose.
import {createHash} from 'node:crypto';
import {writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {structureFromCif,powderPattern,patternLabels,XRD_CALC_VERSION} from './cif-xrd.mjs';
export const COD_ORIGIN='https://www.crystallography.net';
const sha=b=>createHash('sha256').update(b).digest('hex');
const norm=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'');

export function hillSpaced(formula){
  const counts={};for(const m of String(formula||'').replace(/[+-]\d*$/,'').matchAll(/([A-Z][a-z]?)(\d*)/g))counts[m[1]]=(counts[m[1]]||0)+(m[2]?Number(m[2]):1);
  if(!Object.keys(counts).length)return null;const order=counts.C?['C','H',...Object.keys(counts).filter(e=>e!=='C'&&e!=='H').sort()]:Object.keys(counts).sort();
  return order.filter(e=>counts[e]).map(e=>e+(counts[e]>1?counts[e]:'')).join(' ');
}
export function nameMatches(entry,names){const keys=names.map(norm).filter(k=>k.length>2);return [entry.chemname,entry.commonname,entry.mineral].some(n=>{const v=norm(n);return v&&keys.some(k=>v===k||v.includes(k)&&k.length>5)})}

export function createCodFetcher({fetchImpl=globalThis.fetch,minDelayMs=1500}={}){
  let next=0;
  return async url=>{
    const u=new URL(url);if(u.origin!==COD_ORIGIN)throw Error('Only COD URLs are allowed');
    const wait=Math.max(0,next-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));next=Date.now()+minDelayMs;
    const r=await fetchImpl(u.href,{signal:AbortSignal.timeout(60000),headers:{'User-Agent':'SpectraTrace-local-education/1.1'}});
    if(r.status===404)return null;if(!r.ok)throw Error('COD HTTP '+r.status);
    const b=Buffer.from(await r.arrayBuffer());if(b.length>20000000)throw Error('COD response too large');return b;
  };
}

export async function searchCod(compound,{get}){
  const formula=hillSpaced(compound.formula);if(!formula)return {status:'no-formula',reason:'No molecular formula to search COD',entries:[]};
  const body=await get(COD_ORIGIN+'/cod/result?formula='+encodeURIComponent(formula)+'&format=json');
  let list=[];try{list=JSON.parse(body?.toString('utf8')||'[]')}catch{throw Error('COD returned no JSON result list')}
  const names=[compound.name,...(compound.synonyms||[])];
  const entries=(Array.isArray(list)?list:[]).filter(e=>e&&e.file).map(e=>({file:String(e.file),chemname:e.chemname||'',commonname:e.commonname||'',mineral:e.mineral||'',formula:String(e.formula||'').replace(/^-\s*|\s*-$/g,''),sg:e.sg||'',cell:[e.a,e.b,e.c,e.alpha,e.beta,e.gamma].map(Number),year:e.year||'',title:e.title||'',authors:e.authors||'',temperature:e.celltemp||'',nameMatch:false,url:COD_ORIGIN+'/cod/'+e.file+'.html'}));
  for(const e of entries)e.nameMatch=nameMatches(e,names);
  entries.sort((a,b)=>Number(b.nameMatch)-Number(a.nameMatch)||String(b.year).localeCompare(String(a.year)));
  return {status:entries.length?'found':'not-found',formula,entries:entries.slice(0,25),reason:entries.length?null:'COD has no crystal structure with formula '+formula};
}

export async function saveCalculatedPattern(db,dir,compound,{cif,source,entry=null,matchKind}){
  const structure=structureFromCif(cif.toString('utf8')),pattern=powderPattern(structure);
  const folder=path.join(dir,'source-downloads','cif');await mkdir(folder,{recursive:true});
  const hash=sha(cif),filename=hash.slice(0,24)+'.cif';if(!(await stat(path.join(folder,filename)).catch(()=>null)))await writeFile(path.join(folder,filename),cif,{flag:'wx'});
  const sourceId=source==='cod'?'cod':'cif-upload';
  db.prepare('INSERT INTO external_sources VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(sourceId,source==='cod'?'Crystallography Open Database (calculated powder patterns)':'User-supplied CIF (calculated powder patterns)',source==='cod'?COD_ORIGIN+'/cod/':'local:cif',source==='cod'?'COD data are CC0 / public domain':'User-supplied crystal structure',JSON.stringify({archives:[],notes:'Powder patterns are calculated from crystal structures ('+XRD_CALC_VERSION+'): Cu Kα1, kinematic intensities, Cromer–Mann form factors, isotropic B, Lorentz-polarisation; Gaussian FWHM 0.12°. Not measured patterns.'}));
  const id=sha(sourceId+'|'+(entry?.file||hash)+'|'+compound.inchikey).slice(0,32),labels=patternLabels(pattern.reflections);
  const metadata={sourceLabel:(source==='cod'?'COD '+entry.file:'Your CIF')+' · calculated (Cu Kα)'+(matchKind==='formula-only'?' · formula match only':''),sourceUrl:entry?.url||'',xUnit:'2theta-deg',yMode:'intensity',format:'continuous',calculated:true,radiation:'Cu Kα1 (1.5406 Å)',polymorph:entry?(entry.sg?'Space group '+entry.sg:'')+(entry.year?' · '+entry.year:''):structure.spaceGroup,cell:{a:structure.cell[0],b:structure.cell[1],c:structure.cell[2],alpha:structure.angles[0],beta:structure.angles[1],gamma:structure.angles[2],volume:Number(pattern.volume.toFixed(2))},spaceGroup:structure.spaceGroup||entry?.sg||'',atomsInCell:structure.atoms.length,symmetryOperators:structure.ops,cifFormula:structure.formula,identityLinkage:matchKind==='name'?'COD entry name matches the catalog compound; formula '+(entry?.formula||'')+' matches':matchKind==='formula-only'?'Formula match chosen by the user; identity not confirmed (isomers share formulas)':'Structure supplied by the user for this compound',citation:entry?(entry.authors?entry.authors+' ':'')+(entry.year?'('+entry.year+') ':'')+(entry.title||'')+' · COD '+entry.file:'',license:source==='cod'?'CC0 (COD)':'User-supplied',method:XRD_CALC_VERSION,peakLabels:labels,reflections:pattern.reflections.slice(0,400),eligibleForMatching:false,review:'Calculated from a crystal structure; not a measured powder pattern',limitations:'Preferred orientation, absorption, crystallite size, instrument profile and impurities are not modelled; polymorph and temperature of the CIF apply.'};
  db.prepare("INSERT INTO external_evidence_aux VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,parsed=excluded.parsed WHERE status!='quarantined'").run(id,sourceId,entry?.file||filename,compound.id??null,compound.name,compound.inchikey||null,compound.smiles||null,'xrd','calculated-pattern','imported',entry?.url||'',path.join('source-downloads','cif',filename),filename,hash,JSON.stringify(metadata),JSON.stringify({points:pattern.points,range:[pattern.points[0][0],pattern.points.at(-1)[0]]}),null);
  return {id,reflections:pattern.reflections.length,label:metadata.sourceLabel};
}
