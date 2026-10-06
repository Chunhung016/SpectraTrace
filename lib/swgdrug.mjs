// Imports the SWGDRUG Infrared Library (JCAMP-DX download, FTIR-ATR) supplied by the user.
// Spectra are linked to catalog compounds only by an unambiguous name match whose
// molecular formula (when the file states one) agrees; everything else stays unlinked
// but searchable. Originals are kept unaltered in the local data folder, never in Git.
// Records are unreviewed and excluded from unknown-compound matching.
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readZip} from './zip.mjs';
import {parseJcamp,normalizeNistBlock} from './jcamp.mjs';

export const SWGDRUG_VERSION='swgdrug-ir-import-v1';
export const SWGDRUG_SOURCE_ID='swgdrug-ir';
const sha=b=>createHash('sha256').update(b).digest('hex');
const JCAMP=/\.(jdx|dx|jcm|jcamp)$/i;
const SALTS=[[/\bhcl\b|\bhydrochloride\b|\bhydrogen chloride\b/g,'hydrochloride'],[/\bhbr\b|\bhydrobromide\b/g,'hydrobromide']];

// "Cocaine HCl" and "(-)-Cocaine hydrochloride" → "cocaine hydrochloride"; "Cocaine base" → "cocaine".
export function nameKey(name){
  let s=String(name||'').normalize('NFKC').toLowerCase().trim();
  s=s.replace(/^\s*\((?:[+\-−±]|rs|r,s)\)\s*-?\s*/u,'');
  for(const [re,to]of SALTS)s=s.replace(re,to);
  s=s.replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+(?:free\s+)?base$/,'').replace(/\s+/g,' ');
  return s;
}

// Element counts from "C17H22ClNO4", "C 17 H 21 N O 4" or "C17H21NO4.HCl" (dot parts are summed).
export function formulaCounts(formula){
  const text=String(formula||'').replace(/\s+/g,'');if(!text)return null;
  const counts={};
  for(const part of text.split(/[.·*]/)){
    const m=part.match(/^(\d*)(.*)$/),mult=Number(m[1]||1),body=m[2];
    if(!/^(?:[A-Z][a-z]?\d*)+$/.test(body))return null;
    for(const [,el,n]of body.matchAll(/([A-Z][a-z]?)(\d*)/g))counts[el]=(counts[el]||0)+mult*Number(n||1);
  }
  return Object.keys(counts).length?counts:null;
}
const sameFormula=(a,b)=>{const x=formulaCounts(a),y=formulaCounts(b);if(!x||!y)return null;const k=new Set([...Object.keys(x),...Object.keys(y)]);return [...k].every(e=>(x[e]||0)===(y[e]||0))};

// Collect JCAMP files from .jdx files, folders and (nested) .zip archives.
export async function swgdrugInputs(paths){
  const out=[];
  const fromZip=(bytes,label)=>{for(const [name,data]of readZip(bytes)){if(JCAMP.test(name))out.push({file:label+'#'+name,bytes:data});else if(/\.zip$/i.test(name))fromZip(data,label+'#'+name)}};
  for(const p of paths){
    const info=await stat(p).catch(()=>null);if(!info)throw Error('Not found: '+p);
    if(info.isDirectory()){const names=(await readdir(p)).sort();out.push(...await swgdrugInputs(names.filter(n=>JCAMP.test(n)||/\.zip$/i.test(n)).map(n=>path.join(p,n))))}
    else if(/\.zip$/i.test(p))fromZip(await readFile(p),path.basename(p));
    else if(JCAMP.test(p))out.push({file:path.basename(p),bytes:await readFile(p)});
  }
  return out;
}

export function swgdrugCatalogIndex(compounds){
  const index=new Map();
  for(const c of compounds){const k=nameKey(c.name);if(!k)continue;if(!index.has(k))index.set(k,new Map());index.get(k).set(c.inchikey,c)}
  return index;
}

// Decide the catalog link for one block. Returns {compound,linkage} or {compound:null,reason}.
export function linkSwgdrug(header,index,overrides=new Map()){
  const title=String(header.TITLE||'').trim(),names=[title,...String(header.NAMES||'').split(/\n/)].map(s=>s.trim()).filter(Boolean);
  const formula=header.MOLFORM||header.MOLECULARFORMULA||header.$MOLFORM||'';
  const forced=overrides.get(nameKey(title));
  let candidates;
  if(forced)candidates=[...(index.get(nameKey(forced))?.values()||[])];
  else{const keys=[...new Set(names.map(nameKey).filter(Boolean))];candidates=[...new Map(keys.flatMap(k=>[...(index.get(k)?.values()||[])]).map(c=>[c.inchikey,c])).values()]}
  if(!candidates.length)return {compound:null,reason:forced?'Override target "'+forced+'" is not a catalog name':'No catalog compound with this name'};
  if(candidates.length>1)return {compound:null,reason:'Name matches several catalog identities ('+candidates.map(c=>c.name).join('; ')+')'};
  const c=candidates[0],check=formula?sameFormula(formula,c.formula):null;
  if(check===false)return {compound:null,reason:'File formula '+String(formula).replace(/\s+/g,'')+' differs from catalog '+c.name+' ('+c.formula+')'};
  return {compound:c,linkage:(forced?'Manual name override':'Exact name match after salt/rotation-prefix normalisation')+(check?'; molecular formula agrees':'; no formula in file to cross-check')};
}

function irBlock(block){
  const info={...block.info};
  if(!info.DATATYPE&&/1\/CM|CM-1|CM\^-1/i.test(info.XUNITS||''))info.DATATYPE='INFRARED SPECTRUM';
  const s=normalizeNistBlock({...block,info});
  if(s.technique!=='ftir')throw Error('Not an IR spectrum ('+info.DATATYPE+')');
  return s;
}

const yLabel={'transmittance-fraction':'transmittance','transmittance-percent':'transmittance (%)',absorbance:'absorbance'};
export async function importSwgdrug(db,dir,paths,{overrides=new Map(),log=()=>{}}={}){
  const inputs=await swgdrugInputs(paths);if(!inputs.length)throw Error('No JCAMP-DX (.jdx/.dx) files found. Download the JCAMP version of the SWGDRUG IR Library.');
  const folder=path.join(dir,'source-downloads','swgdrug-ir');await mkdir(folder,{recursive:true});
  const index=swgdrugCatalogIndex(db.prepare('SELECT id,inchikey,name,formula,smiles FROM compounds').all());
  const archives=[];for(const p of paths)if(/\.zip$/i.test(p)){const bytes=await readFile(p),hash=sha(bytes),name=hash.slice(0,16)+'-'+path.basename(p).replace(/[^\w.-]+/g,'_');archives.push({filename:path.basename(p),bytes:bytes.length,sha256:hash});const target=path.join(folder,name);if(!(await stat(target).catch(()=>null)))await writeFile(target,bytes,{flag:'wx'})}
  db.prepare('INSERT INTO external_sources VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata').run(SWGDRUG_SOURCE_ID,'SWGDRUG Infrared Library (FTIR-ATR, JCAMP-DX)','https://www.swgdrug.org/ir.htm','© SWGDRUG, all rights reserved; user-downloaded copy kept locally for educational viewing, not redistributed',JSON.stringify({archives:archives.map(a=>({...a,retrievedAt:'Supplied by the user; imported '+new Date().toISOString()})),citation:'SWGDRUG Infrared Library, Scientific Working Group for the Analysis of Seized Drugs, https://www.swgdrug.org/ir.htm',notes:'Measured FTIR-ATR spectra of reference materials (maintained by the DEA Special Testing and Research Laboratory). Linked to catalog compounds by exact normalised name with formula cross-check; unreviewed and excluded from unknown matching. '+SWGDRUG_VERSION}));
  const put=db.prepare("INSERT INTO external_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET compound_id=excluded.compound_id,name=excluded.name,inchikey=excluded.inchikey,smiles=excluded.smiles,metadata=excluded.metadata,parsed=excluded.parsed WHERE external_evidence.status!='quarantined'");
  const report={version:SWGDRUG_VERSION,files:inputs.length,imported:[],skipped:[]};
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const input of inputs){
      const hash=sha(input.bytes),filename=hash.slice(0,24)+'.jdx',original=path.join(folder,filename);
      if(!(await stat(original).catch(()=>null)))await writeFile(original,input.bytes,{flag:'wx'});
      let blocks;try{blocks=parseJcamp(new TextDecoder('windows-1252').decode(input.bytes))}catch(e){report.skipped.push({file:input.file,reason:'JCAMP decode failed: '+e.message});continue}
      if(!blocks.length){report.skipped.push({file:input.file,reason:'No spectral data block'});continue}
      for(const [blockIndex,block]of blocks.entries()){
        const h=block.info,title=String(h.TITLE||path.basename(input.file)).trim();
        let s;try{s=irBlock(block)}catch(e){report.skipped.push({file:input.file,title,reason:e.message});continue}
        const link=linkSwgdrug(h,index,overrides),c=link.compound;
        const sampling=h.SAMPLINGPROCEDURE||'',atr=!sampling||/ATR|attenuated/i.test(sampling);
        const metadata={sourceLabel:'SWGDRUG · ATR-FTIR',sourceUrl:'https://www.swgdrug.org/ir.htm',sourceName:title,cas:String(h.CASREGISTRYNO||'').trim(),formula:String(h.MOLFORM||'').replace(/\s+/g,''),xUnit:s.xUnit,yMode:s.yMode,yLabel:yLabel[s.yMode]||s.yMode,format:'continuous',measurementType:s.yMode==='absorbance'?'absorbance':'transmittance',phase:String(h.STATE||'solid').slice(0,60),measurement:atr?'ATR':sampling.slice(0,60),instrument:h['SPECTROMETER/DATASYSTEM']||h.SPECTROMETERDATASYSTEM||h.INSTRUMENTNAME||'',resolution:h.RESOLUTION||'',date:h.DATE||h.LONGDATE||'',owner:h.OWNER||'',origin:h.ORIGIN||'',comment:String(h.COMMENT||h.$COMMENT||'').slice(0,2000),conditions:Object.fromEntries(Object.entries(h).filter(([k])=>!['TITLE','JCAMPDX','END'].includes(k)).slice(0,40)),license:'© SWGDRUG (all rights reserved); local educational viewing only',citation:'SWGDRUG Infrared Library, https://www.swgdrug.org/ir.htm',identityLinkage:c?link.linkage:'Not linked: '+link.reason,processing:s.note+'JCAMP-DX decoded by SpectraTrace jcamp.mjs; original file retained unaltered',eligibleForMatching:false,review:'Imported SWGDRUG reference spectrum; not independently reviewed, excluded from unknown matching',retrievedAt:new Date().toISOString()};
        const id=sha(SWGDRUG_SOURCE_ID+'|'+hash+'#'+blockIndex).slice(0,32);
        put.run(id,SWGDRUG_SOURCE_ID,input.file+'#block='+blockIndex,c?.id??null,(c?c.name+' · ':'')+title.slice(0,250),c?.inchikey??null,c?.smiles??null,'ftir','continuous','imported','https://www.swgdrug.org/ir.htm',path.join('source-downloads','swgdrug-ir',filename),filename,hash,JSON.stringify(metadata),JSON.stringify({points:s.points,range:s.range}),null);
        report.imported.push({id,title,compound:c?.name||null,compoundId:c?.id??null,reason:c?null:link.reason,points:s.points.length});
      }
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  const linked=report.imported.filter(r=>r.compoundId);
  report.counts={spectra:report.imported.length,linked:linked.length,linkedCompounds:new Set(linked.map(r=>r.compoundId)).size,skipped:report.skipped.length};
  log('SWGDRUG IR: '+report.counts.spectra+' spectra imported, '+report.counts.linked+' linked to '+report.counts.linkedCompounds+' catalog compounds, '+report.counts.skipped+' skipped');
  return report;
}
