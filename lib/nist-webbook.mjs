// On-demand NIST Chemistry WebBook lookup for one catalog compound at a time.
// Exact InChIKey identity only; robots.txt rules and crawl delay are honoured;
// downloaded files are kept unaltered in the local data folder and shown with
// NIST attribution. Records are unreviewed and never used for unknown matching.
import {createHash} from 'node:crypto';
import {writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {NIST_ORIGIN,htmlText,nistUrl,links} from './nist-html.mjs';
import {parseJcamp,normalizeNistBlock} from './jcamp.mjs';

export const NIST_WEBBOOK_VERSION='nist-webbook-on-demand-v1';
export const NIST_SOURCE_ID='nist-webbook';
const sha=b=>createHash('sha256').update(b).digest('hex');
const TYPES=[{key:'ir',mask:'80',jcampType:'IR',pageType:'IR-SPEC',label:'IR spectrum'},{key:'ms',mask:'200',jcampType:'Mass',pageType:'Mass',label:'Mass spectrum (electron ionization)'},{key:'uv',mask:'400',jcampType:'UVVis',pageType:'UVVis',label:'UV/Visible spectrum'}];

export function createNistFetcher({fetchImpl=globalThis.fetch,minDelayMs=1000,userAgent='SpectraTrace-local-education/1.1 (single-compound, user-initiated)'}={}){
  let next=0,robots=null;
  async function raw(url){
    const wait=Math.max(0,next-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));
    next=Date.now()+Math.max(minDelayMs,robots?.delay||0);
    const r=await fetchImpl(url,{signal:AbortSignal.timeout(45000),redirect:'manual',headers:{'User-Agent':userAgent}});
    if(r.status>=300&&r.status<400&&r.headers.get('location'))return raw(nistUrl(r.headers.get('location'),url));
    if(r.status===404)return null;
    if(!r.ok){const e=Error('NIST WebBook HTTP '+r.status);e.stop=r.status===429||r.status===503;throw e}
    const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>10000000)throw Error('NIST response exceeds 10 MB');return bytes;
  }
  return async function get(url){
    url=nistUrl(url);
    if(!robots||Date.now()-robots.at>86400000){
      const text=(await raw(NIST_ORIGIN+'/robots.txt'))?.toString('utf8')||'';
      const star=text.split(/^User-agent:/im).find(g=>/^\s*\*/.test(g))||'';
      robots={at:Date.now(),delay:Number(star.match(/^Crawl-delay:\s*(\d+(?:\.\d+)?)/im)?.[1]||0)*1000,disallow:[...star.matchAll(/^Disallow:\s*(\S+)/gim)].map(m=>m[1])};
      next=Date.now()+Math.max(minDelayMs,robots.delay);
    }
    const target=new URL(url);if(robots.disallow.some(p=>p&&target.pathname.startsWith(p)))throw Error('NIST robots.txt disallows '+target.pathname);
    return raw(url);
  };
}

export function parseSpecies(html,url){
  const text=htmlText(html);
  if(/No matching species found/i.test(text))return {found:false};
  const ld=[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m=>{try{const v=JSON.parse(m[1]);return Array.isArray(v)?v:[v]}catch{return []}}).find(e=>e['@type']==='MolecularEntity');
  const all=links(html,url),ids=new Set();
  for(const l of all){const id=new URL(l.url).searchParams.get('ID');if(id&&/^[A-Z]\d+$/.test(id))ids.add(id)}
  const inchikey=ld?.inChIKey||text.match(/InChIKey:\s*([A-Z]{14}-[A-Z]{10}-[A-Z])/)?.[1]||null;
  const masks=new Set(all.map(l=>new URL(l.url).searchParams.get('Mask')).filter(Boolean));
  return {found:true,multiple:ids.size>1&&!inchikey,id:[...ids][0]||null,name:ld?.name||htmlText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||''),inchikey,formula:ld?.molecularFormula||null,cas:text.match(/CAS Registry Number:\s*(\d+-\d+-\d)/)?.[1]||null,available:TYPES.filter(t=>masks.has(t.mask)).map(t=>t.key),sourceUrl:nistUrl(url)};
}

// JCAMP download links on a data page, plus links built from listed spectrum indices.
export function jcampLinks(html,url,type,id){
  const out=new Map(),add=u=>{try{out.set(nistUrl(u),true)}catch{}};
  for(const l of links(html,url)){const u=new URL(l.url),p=u.searchParams;
    if(p.get('JCAMP')&&(p.get('Type')||'').toLowerCase()===type.jcampType.toLowerCase())add(l.url);
    else if(p.get('Index')!=null&&(p.get('Type')||'').toLowerCase()===type.pageType.toLowerCase())add('/cgi/cbook.cgi?JCAMP='+id+'&Index='+p.get('Index')+'&Type='+type.jcampType);
  }
  return [...out.keys()];
}

export async function lookupNist(compound,{get,onStep=()=>{},maxPerType=3}){
  onStep('Searching NIST WebBook by InChIKey');
  const pageUrl=nistUrl('/cgi/cbook.cgi?InChI='+encodeURIComponent(compound.inchikey)+'&Units=SI'),pageBytes=await get(pageUrl);
  if(!pageBytes)return {status:'not-found',reason:'NIST WebBook has no species for this exact InChIKey'};
  const species=parseSpecies(pageBytes.toString('utf8'),pageUrl);
  if(!species.found)return {status:'not-found',reason:'NIST WebBook has no species for this exact InChIKey'};
  if(species.multiple||!species.id)return {status:'not-found',reason:'NIST returned several species; no exact single identity'};
  if(species.inchikey!==compound.inchikey)return {status:'identity-mismatch',reason:'NIST page InChIKey '+(species.inchikey||'missing')+' differs from the catalog identity',species};
  const spectra=[],errors=[];
  for(const type of TYPES.filter(t=>species.available.includes(t.key))){
    onStep('Reading NIST '+type.label+' page');
    const maskUrl=nistUrl('/cgi/cbook.cgi?ID='+species.id+'&Units=SI&Mask='+type.mask),html=(await get(maskUrl))?.toString('utf8');if(!html)continue;
    for(const url of jcampLinks(html,maskUrl,type,species.id).slice(0,maxPerType)){
      onStep('Downloading '+type.label+' (JCAMP-DX)');
      try{
        const bytes=await get(url);if(!bytes)continue;
        const blocks=parseJcamp(new TextDecoder('windows-1252').decode(bytes));if(!blocks.length)throw Error('No spectral data block');
        for(const [blockIndex,block]of blocks.entries()){
          const cas=String(block.info.CASREGISTRYNO||'').trim();if(cas&&species.cas&&cas!==species.cas)throw Error('JCAMP CAS '+cas+' differs from the species page');
          spectra.push({type:type.key,url,pageUrl:maskUrl,bytes,sha256:sha(bytes),blockIndex,...normalizeNistBlock(block)});
        }
      }catch(e){if(e.stop)throw e;errors.push({url,error:e.message})}
    }
  }
  return {status:spectra.length?'imported':'no-spectra',reason:spectra.length?null:'NIST lists no downloadable IR, mass or UV/Vis spectrum for this species',species,spectra,errors};
}

const yLabel={'transmittance-fraction':'transmittance','transmittance-percent':'transmittance (%)',absorbance:'absorbance','relative-abundance':'relative abundance','log-epsilon':'log ε',epsilon:'ε'};
export async function saveNistLookup(db,dir,compound,result){
  const folder=path.join(dir,'source-downloads','nist-webbook');await mkdir(folder,{recursive:true});
  db.prepare('INSERT INTO external_sources VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(NIST_SOURCE_ID,'NIST Chemistry WebBook (on-demand, single compound)',NIST_ORIGIN+'/chemistry/','Data © U.S. Secretary of Commerce / listed owners (NIST SRD 69); cached locally for educational viewing, not redistributed',JSON.stringify({archives:[],citation:'NIST Chemistry WebBook, NIST Standard Reference Database Number 69, https://doi.org/10.18434/T4D303',notes:'Fetched one compound at a time on user request; exact InChIKey identity; original JCAMP-DX kept unaltered; unreviewed and excluded from matching.'}));
  const saved=[];
  for(const s of result.spectra||[]){
    const filename=s.sha256.slice(0,24)+'.jdx',file=path.join(folder,filename);
    if(!(await stat(file).catch(()=>null)))await writeFile(file,s.bytes,{flag:'wx'});
    const id=sha(NIST_SOURCE_ID+'|'+s.url+'#'+s.blockIndex).slice(0,32),h=s.header;
    const state=h.STATE||h.SAMPLINGPROCEDURE||'';
    const metadata={sourceLabel:'NIST WebBook · '+(s.technique==='ftir'?'IR':s.technique==='ms'?'EI-MS':'UV/Vis')+(state?' · '+state.slice(0,60):''),sourceUrl:s.pageUrl,downloadUrl:s.url,nistId:result.species.id,sourceName:result.species.name,cas:result.species.cas,xUnit:s.xUnit,yMode:s.yMode,yLabel:yLabel[s.yMode]||s.yMode,format:s.format,measurementType:s.technique==='ftir'?(s.yMode==='absorbance'?'absorbance':'transmittance'):'',owner:h.OWNER||'',origin:h.ORIGIN||'',phase:state,instrument:h['SPECTROMETER/DATASYSTEM']||h.SPECTROMETERDATASYSTEM||h.INSTRUMENTNAME||'',resolution:h.RESOLUTION||'',date:h.DATE||'',conditions:Object.fromEntries(Object.entries(h).filter(([k])=>!['TITLE','JCAMPDX','END'].includes(k)).slice(0,40)),license:'© '+(h.OWNER||'NIST / data owner')+' · NIST SRD 69; local educational viewing only',citation:'NIST Chemistry WebBook, SRD 69, https://doi.org/10.18434/T4D303',identityLinkage:'Exact InChIKey: NIST species page = catalog identity',processing:s.note+'JCAMP-DX decoded by SpectraTrace jcamp.mjs; original file retained unaltered',eligibleForMatching:false,review:'Imported NIST reference; not independently reviewed, excluded from unknown matching',retrievedAt:new Date().toISOString()};
    const table=s.technique==='ms'?'external_evidence_extra':'external_evidence',representation=s.technique==='ms'?'mass-spectrum':'continuous';
    db.prepare('INSERT INTO '+table+' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,parsed=excluded.parsed WHERE status!=\'quarantined\'').run(id,NIST_SOURCE_ID,s.url+'#block='+s.blockIndex,compound.id,compound.name,compound.inchikey,compound.smiles,s.technique,representation,'imported',s.pageUrl,path.join('source-downloads','nist-webbook',filename),filename,s.sha256,JSON.stringify(metadata),JSON.stringify({points:s.points,range:s.range}),null);
    saved.push({id,technique:s.technique,points:s.points.length,label:metadata.sourceLabel});
  }
  const payload={version:NIST_WEBBOOK_VERSION,status:result.status,reason:result.reason||null,species:result.species?{id:result.species.id,name:result.species.name,cas:result.species.cas,available:result.species.available,url:result.species.sourceUrl}:null,saved,errors:result.errors||[]};
  db.prepare('INSERT INTO nist_lookups VALUES(?,?,?) ON CONFLICT(compound_id) DO UPDATE SET payload=excluded.payload,retrieved_at=excluded.retrieved_at').run(compound.id,JSON.stringify(payload),new Date().toISOString());
  return payload;
}
