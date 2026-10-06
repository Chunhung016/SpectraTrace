import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,mkdir,writeFile,rm,cp,stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {openBank,stats,compound,sample,logicCounts} from './lib/bank.mjs';
import {parseSpectrum,compareSpectra,inspectSpectrum} from './lib/spectra.mjs';
import {interpretFtir,screenCatalog} from './lib/interpret.mjs';
import {proposeIdentification} from './lib/identification.mjs';
import {microscopy,MICROSCOPY_VERSION} from './lib/microscopy.mjs';
import {listEvidence,evidence} from './lib/external.mjs';
import {exportLogicDataset,logicSources,groupRules,LOGIC_VERSION} from './lib/logic.mjs';
import {simulationRecord,SIMULATION_VERSION} from './lib/simulation.mjs';
import {createStructuralSpectrumReader} from './lib/structural-spectra.mjs';
import {importBundledLibraries,importMassBankBundle} from './lib/mslib-import.mjs';
import {createNistFetcher,lookupNist,saveNistLookup} from './lib/nist-webbook.mjs';
import {theoreticalMs,theoreticalRaman,theoreticalFluorescence,theoryRecord} from './lib/theory.mjs';
import {createCodFetcher,searchCod,saveCalculatedPattern,COD_ORIGIN} from './lib/cod.mjs';
import {useSystemCertificates} from './lib/net.mjs';
// Trust the Windows/macOS certificate store too, as browsers do (fixes sites that open in a browser but not in Node).
const certificateStore=await useSystemCertificates();
const root=fileURLToPath(new URL('.',import.meta.url));
const dir=path.resolve(process.env.SPECTRATRACE_DATA_DIR||path.join(root,'data'));
const backupDir=path.resolve(process.env.SPECTRATRACE_BACKUP_DIR||path.join(root,'backups'));
const exportDir=path.resolve(process.env.SPECTRATRACE_EXPORT_DIR||path.join(root,'exports'));
const db=openBank(dir,path.join(root,'catalog','identities.json'));
const structuralSpectrum=createStructuralSpectrumReader(db);
const port=Number(process.env.PORT||4174), origin=`http://127.0.0.1:${port}`;
const techniques=['ftir','h1','c13','uv','xrd','fluorescence','raman','ms'];
const sampleTable=t=>t==='ms'?'ms_spectra':['xrd','fluorescence','raman'].includes(t)?'auxiliary_spectra':'spectra';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const clean=(x,max=1000)=>String(x||'').trim().slice(0,max);
async function body(req){let bytes=0,parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>75000000)fail('Upload too large; total request maximum 75 MB.',413);parts.push(chunk)}try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{fail('Invalid JSON')}}
function sampleCreate(data) {
  if(!['reference','unknown'].includes(data.kind))fail('Choose reference or unknown');
  if(!clean(data.label))fail('Sample label is required');
  const id=clean(data.id,36);if(!/^[a-f0-9-]{36}$/.test(id))fail('Valid request UUID required');
  if(db.prepare('SELECT id FROM samples WHERE id=?').get(id))return {id,alreadySaved:true};
  if(data.kind==='reference'&&!db.prepare('SELECT id FROM compounds WHERE id=?').get(Number(data.compoundId)))fail('Select a real catalog compound for the reference');
  const metadata=Object.fromEntries(['contributor','provenance','license','purity','batch','notes'].map(k=>[k,clean(data.metadata?.[k],5000)]));
  if(data.kind==='reference'&&(!clean(metadata.contributor)||!clean(metadata.provenance)||!clean(metadata.license)))fail('Reference requires contributor, provenance and reuse permission/license');
  if(!Array.isArray(data.files)||!data.files.length||data.files.length>techniques.length)fail('Supply 1 to '+techniques.length+' spectral files, one per technique');
  const seen=new Set();
  const files=data.files.map(f=>{
    if(!techniques.includes(f.technique)||seen.has(f.technique))fail('One file per supported technique');seen.add(f.technique);
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64||''))fail('Invalid file encoding');
    const bytes=Buffer.from(f.base64,'base64');if(!bytes.length||bytes.length>25000000)fail('Each file must be 1 byte to 25 MB');
    const meta=Object.fromEntries(['xUnit','format','yMode','instrument','date','phase','measurement','resolution','solvent','frequency','concentration','pathLength','notes','yColumn','normalized','temperature','scans','background','sampleType','processing','radiation','polymorph','excitation','ionization'].map(k=>[k,clean(f.metadata?.[k])]));let parsed=null,error=null;
    try{parsed=parseSpectrum(bytes,f.technique,meta)}catch(e){error=e.message}
    return {id:randomUUID(),technique:f.technique,bytes,filename:path.basename(clean(f.name,250)).replace(/[\r\n"]/g,'_'),hash:createHash('sha256').update(bytes).digest('hex'),metadata:meta,parsed,error};
  });
  return {id,files,kind:data.kind,label:clean(data.label,200),compoundId:data.kind==='reference'?Number(data.compoundId):null,metadata};
}
async function saveSample(data) {
  const value=sampleCreate(data);if(value.alreadySaved)return value;
  // Write originals before committing DB rows; clean up these exact new UUID files on failure.
  const written=[];
  try {
    for(const f of value.files){const p=path.join(dir,'uploads',f.id);await writeFile(p,f.bytes,{flag:'wx'});written.push(p)}
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO samples(id,kind,label,compound_id,status,metadata,created_at) VALUES(?,?,?,?,?,?,?)').run(value.id,value.kind,value.label,value.compoundId,value.kind==='reference'?'pending':'unknown',JSON.stringify(value.metadata),new Date().toISOString());
      for(const f of value.files)db.prepare('INSERT INTO '+sampleTable(f.technique)+' VALUES(?,?,?,?,?,?,?,?,?)').run(f.id,value.id,f.technique,f.filename,f.bytes.length,f.hash,JSON.stringify(f.metadata),f.parsed?JSON.stringify(f.parsed):null,f.error);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }catch(e){for(const p of written)await rm(p,{force:true});throw e;}
  return {id:value.id};
}
function matches(id) {
  const query=sample(db,id);if(!query)fail('Sample not found',404);
  if(query.kind!=='unknown')fail('Only unknown samples can be compared');
  const usable=query.spectra.filter(s=>s.parsed);if(!usable.length)return {results:[],reason:'No parseable spectra. Originals are safely archived.',skipped:0,identification:proposeIdentification(query)};
  const refs=db.prepare("SELECT id FROM samples WHERE status='approved'").all();const results=[];let skipped=0;
  for(const r of refs){const ref=sample(db,r.id),scores=[];
    for(const a of usable){const b=ref.spectra.find(s=>s.technique===a.technique&&s.parsed);if(!b)continue;const cmp=compareSpectra(a,b);if(cmp.eligible)scores.push({technique:a.technique,...cmp,referenceNormalized:b.metadata.normalized==='true'||/normaliz/i.test(b.parsed.selectedHeader||'')})}
    if(!scores.length){skipped++;continue;}
    const c=compound(db,ref.compound_id);
    results.push({compound:{id:c.id,name:c.name,formula:c.formula},referenceId:ref.id,referenceLabel:ref.label,scores,mean:scores.reduce((s,v)=>s+v.similarity,0)/scores.length,matchedModalities:scores.length,queryModalities:usable.length,referenceModalities:ref.spectra.filter(s=>s.parsed).map(s=>s.technique)});
  }
  // Count matched techniques first, then equal-weight score. Do not fill missing modalities.
  results.sort((a,b)=>b.matchedModalities-a.matchedModalities||b.mean-a.mean);
  return {results:results.slice(0,20),identification:proposeIdentification(query,results),skipped,approvedSamples:refs.length,reason:!results.length?'No reviewed, parseable references with compatible conditions and ≥70% shared range. The identity catalog alone cannot identify this sample.':null,warning:'Similarity is not identification confidence. Candidate NMR/UV belongs to the reference, not your unknown. Closely related compounds and mixtures may be indistinguishable.',algorithm:'cosine-v1'};
}
// One NIST WebBook lookup at a time per server, honouring the site's crawl delay.
const nistGet=createNistFetcher(),nistJobs=new Map();
function nistStatus(id){const job=nistJobs.get(id);if(job)return job;const saved=db.prepare('SELECT payload,retrieved_at FROM nist_lookups WHERE compound_id=?').get(id);return saved?{state:'done',retrievedAt:saved.retrieved_at,...JSON.parse(saved.payload)}:{state:'never'}}
function startNist(c){
  if([...nistJobs.values()].some(j=>j.state==='running'))fail('Another NIST lookup is running; try again shortly',409);
  const job={state:'running',step:'Starting',startedAt:new Date().toISOString()};nistJobs.set(c.id,job);
  lookupNist(c,{get:nistGet,onStep:s=>job.step=s}).then(r=>saveNistLookup(db,dir,c,r)).then(p=>{nistJobs.delete(c.id)}).catch(e=>{Object.assign(job,{state:'error',error:'NIST lookup failed: '+e.message});setTimeout(()=>nistJobs.get(c.id)===job&&nistJobs.delete(c.id),60000)});
  return job;
}
// COD crystal structures → calculated powder patterns (theory from a real structure).
const codGet=createCodFetcher(),codJobs=new Map();
const synonymsOf=c=>c.sources.flatMap(s=>[s.provenance?.name,...(s.provenance?.synonyms||[])]).filter(Boolean);
function codStatus(id){const job=codJobs.get(id);if(job)return job;const saved=db.prepare('SELECT payload,retrieved_at FROM cod_lookups WHERE compound_id=?').get(id);return saved?{state:'done',retrievedAt:saved.retrieved_at,...JSON.parse(saved.payload)}:{state:'never'}}
function startCod(c,file){
  if([...codJobs.values()].some(j=>j.state==='running'))fail('Another COD lookup is running; try again shortly',409);
  const job={state:'running',step:'Searching COD by formula',startedAt:new Date().toISOString()};codJobs.set(c.id,job);
  (async()=>{
    const result=await searchCod({...c,synonyms:synonymsOf(c)},{get:codGet}),saved=[],errors=[];
    const chosen=file?result.entries.filter(e=>e.file===String(file)):result.entries.filter(e=>e.nameMatch).slice(0,3);
    if(file&&!chosen.length)throw Error('COD entry '+file+' is not a formula match for this compound');
    for(const e of chosen){job.step='Downloading CIF '+e.file+' and calculating the powder pattern';try{const cif=await codGet(COD_ORIGIN+'/cod/'+e.file+'.cif');if(!cif)throw Error('CIF not found');saved.push(await saveCalculatedPattern(db,dir,c,{cif,source:'cod',entry:e,matchKind:e.nameMatch?'name':'formula-only'}))}catch(err){errors.push({file:e.file,error:err.message})}}
    const prior=db.prepare('SELECT payload FROM cod_lookups WHERE compound_id=?').get(c.id),payload={status:result.status,reason:result.reason,formula:result.formula,entries:result.entries,saved:[...(prior?JSON.parse(prior.payload).saved||[]:[]).filter(p=>!saved.some(s=>s.id===p.id)),...saved],errors};
    db.prepare('INSERT INTO cod_lookups VALUES(?,?,?) ON CONFLICT(compound_id) DO UPDATE SET payload=excluded.payload,retrieved_at=excluded.retrieved_at').run(c.id,JSON.stringify(payload),new Date().toISOString());codJobs.delete(c.id);
  })().catch(e=>{Object.assign(job,{state:'error',error:'COD lookup failed: '+e.message});setTimeout(()=>codJobs.get(c.id)===job&&codJobs.delete(c.id),60000)});
  return job;
}
let backupInProgress=false;
async function backup() {
  if(backupInProgress)fail('Backup already running',409);backupInProgress=true;
  const key=`spectratrace-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
  const backups=backupDir, staging=path.join(backups,key);await mkdir(staging,{recursive:true});
  try {
    // Immutable originals; concurrent new uploads not in the DB snapshot are harmless extras.
    const snapshot=path.join(staging,'spectratrace.sqlite');db.prepare('VACUUM INTO ?').run(snapshot);
    const catalogMeta=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='catalog_sources'").get()?.value||'{}');
    await writeFile(path.join(staging,'catalog-identities.json'),JSON.stringify({schemaVersion:1,...catalogMeta,entries:db.prepare('SELECT provenance FROM memberships ORDER BY collection_id,compound_id').all().map(r=>JSON.parse(r.provenance))},null,2));
    await cp(path.join(dir,'uploads'),path.join(staging,'uploads'),{recursive:true});
    if(await stat(path.join(dir,'source-downloads')).catch(()=>null))await cp(path.join(dir,'source-downloads'),path.join(staging,'source-downloads'),{recursive:true});
    await writeFile(path.join(staging,'RESTORE.txt'),'Stop all SpectraTrace servers. Preserve the existing data folder in a safe location. Extract this archive to a separate folder; copy spectratrace.sqlite, uploads and source-downloads (if present) into a new data directory WITHOUT old WAL/SHM files. Preserve the current catalog file, then copy catalog-identities.json to catalog/identities.json to use the backed-up identity selection. Restart node server.mjs. Keep application source code separately. Never overwrite a running database.');
    const name=key+'.tar.gz';
    await new Promise((resolve,reject)=>{const proc=spawn('tar',['-czf',path.join(backups,name),'-C',staging,'.'],{windowsHide:true});let err='';proc.stderr.on('data',s=>err+=s);proc.on('error',reject);proc.on('close',n=>n===0?resolve():reject(Error(err||'Archive failed')))});
    await rm(staging,{recursive:true,force:true});return {name,url:'/api/backups/'+name};
  }finally{backupInProgress=false;}
}
const server=http.createServer(async(req,res)=>{
  try {
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))fail('Invalid host',403);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    if(req.method==='POST'&&(req.headers['x-spectratrace']!=='1'||req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin)))fail('Local-origin request required',403);
    const url=new URL(req.url,origin),p=url.pathname;
    if(req.method==='POST'&&p==='/api/inspect-spectrum'){const data=await body(req);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64||''))fail('Invalid file encoding');const bytes=Buffer.from(data.base64,'base64');if(bytes.length>25000000)fail('Maximum 25 MB');try{return json(res,inspectSpectrum(bytes))}catch(e){fail(e.message)}}
    if(req.method==='POST'&&/^\/api\/samples\/[a-f0-9-]+\/add-spectrum$/.test(p)){
      const s=sample(db,p.split('/')[3]),data=await body(req);if(!s||s.kind!=='unknown')fail('Add-on uploads are only allowed for unknown samples');if(s.spectra.some(z=>z.technique===data.file?.technique))fail('This sample already has that technique; originals will not be overwritten',409);
      const value=sampleCreate({id:randomUUID(),kind:'unknown',label:s.label,files:[data.file],metadata:{}}),f=value.files[0];if(!f.parsed)fail(f.error);const original=path.join(dir,'uploads',f.id);await writeFile(original,f.bytes,{flag:'wx'});
      try{db.prepare('INSERT INTO '+sampleTable(f.technique)+' VALUES(?,?,?,?,?,?,?,?,?)').run(f.id,s.id,f.technique,f.filename,f.bytes.length,f.hash,JSON.stringify(f.metadata),JSON.stringify(f.parsed),null)}catch(e){await rm(original,{force:true});throw e}return json(res,sample(db,s.id),201);
    }
    if(req.method==='GET'&&/^\/api\/samples\/[a-f0-9-]+\/analysis$/.test(p)){
      const s=sample(db,p.split('/')[3]);if(!s||s.kind!=='unknown')fail('Unknown sample not found',404);
      const z=s.spectra.find(r=>r.technique==='ftir');let analysis;try{analysis=interpretFtir(z)}catch(e){return json(res,{analysis:null,rows:[],total:0,reason:e.message})}
      const rows=screenCatalog(analysis,db.prepare('SELECT c.id,c.name,c.formula,c.smiles,l.profile FROM compounds c JOIN compound_logic l ON l.compound_id=c.id').all().filter(c=>{try{return Array.isArray(JSON.parse(c.profile).functionalGroups)}catch{return false}})),offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
      const query=clean(url.searchParams.get('q'),100).toLowerCase(),filtered=query?rows.filter(r=>[r.compound.name,r.compound.formula].some(s=>String(s).toLowerCase().includes(query))):rows;
      return json(res,{analysis,rows:filtered.slice(offset,offset+18),offset,total:filtered.length,broadTotal:rows.length,scope:db.prepare('SELECT count(*) n FROM compound_logic').get().n,reason:filtered.length?null:query?'No suggestions match this filter.':'No discriminating functional-group clue detected; no structures proposed.'});
    }
    if(req.method==='POST'&&/^\/api\/samples\/[a-f0-9-]+\/selection$/.test(p)){
      const s=sample(db,p.split('/')[3]),data=await body(req),id=data.compoundId==null?null:Number(data.compoundId);if(!s||s.kind!=='unknown')fail('Unknown sample not found',404);if(id!=null&&!compound(db,id))fail('Compound not found',404);
      db.prepare('INSERT INTO student_selections VALUES(?,?,?,?) ON CONFLICT(sample_id) DO UPDATE SET compound_id=excluded.compound_id,selected_at=excluded.selected_at,note=excluded.note').run(s.id,id,new Date().toISOString(),'Student-selected hypothesis, not confirmed identification; never a reference approval');return json(res,{sampleId:s.id,compoundId:id,status:'student-hypothesis'});
    }
    if(req.method==='GET'&&/^\/api\/compounds\/\d+\/microscopy$/.test(p)){const c=compound(db,Number(p.split('/')[3]));if(!c)fail('Compound not found',404);const saved=db.prepare('SELECT * FROM microscopy_searches WHERE compound_id=?').get(c.id);if(saved&&Date.now()-Date.parse(saved.retrieved_at)<86400000&&JSON.parse(saved.payload).version===MICROSCOPY_VERSION)return json(res,JSON.parse(saved.payload));try{const result=await microscopy(c.name);db.prepare('INSERT INTO microscopy_searches VALUES(?,?,?) ON CONFLICT(compound_id) DO UPDATE SET payload=excluded.payload,retrieved_at=excluded.retrieved_at').run(c.id,JSON.stringify(result),new Date().toISOString());return json(res,result)}catch(e){fail('Literature lookup unavailable: '+e.message,502)}}
    if(/^\/api\/compounds\/\d+\/nist$/.test(p)&&['GET','POST'].includes(req.method)){const c=compound(db,Number(p.split('/')[3]));if(!c)fail('Compound not found',404);if(req.method==='GET')return json(res,nistStatus(c.id));const current=nistStatus(c.id);return json(res,current.state==='running'?current:startNist(c),202)}
    if(req.method==='GET'&&/^\/api\/compounds\/\d+\/theory$/.test(p)){
      const c=compound(db,Number(p.split('/')[3]));if(!c)fail('Compound not found',404);const technique=url.searchParams.get('technique'),profile=c.logic;
      if(['ftir','h1','c13','uv'].includes(technique))return json(res,simulationRecord(await structuralSpectrum(c),technique,c));
      if(!profile||profile.status==='unresolved-structure')fail('Build the structural guide first (npm run build:logic)',404);
      const result=technique==='ms'?theoreticalMs(c.formula,profile,c.smiles):technique==='raman'?theoreticalRaman(profile):technique==='fluorescence'?theoreticalFluorescence(profile):fail('Unsupported theory technique');
      if(!result)fail('No theory rule applies to this structure',404);if(!result.points)return json(res,{status:'theoretical',none:true,reason:result.reason});
      return json(res,theoryRecord(technique,result,c));
    }
    if(/^\/api\/compounds\/\d+\/cod$/.test(p)&&['GET','POST'].includes(req.method)){const c=compound(db,Number(p.split('/')[3]));if(!c)fail('Compound not found',404);if(req.method==='GET')return json(res,codStatus(c.id));const data=await body(req),current=codStatus(c.id);return json(res,current.state==='running'?current:startCod(c,data.file),202)}
    if(req.method==='POST'&&/^\/api\/compounds\/\d+\/cif$/.test(p)){const c=compound(db,Number(p.split('/')[3])),data=await body(req);if(!c)fail('Compound not found',404);if(!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64||''))fail('Invalid file encoding');const cif=Buffer.from(data.base64,'base64');if(!cif.length||cif.length>5000000)fail('CIF must be 1 byte to 5 MB');try{return json(res,await saveCalculatedPattern(db,dir,c,{cif,source:'upload',matchKind:'user'}),201)}catch(e){fail('CIF not usable: '+e.message)}}
    if(req.method==='POST'&&p==='/api/exports'){
      const data=await body(req),format=data.format;if(!['png','jpeg','csv'].includes(format))fail('Unsupported export format');
      if(!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64||''))fail('Invalid file encoding');const bytes=Buffer.from(data.base64||'','base64');if(!bytes.length||bytes.length>10000000)fail('Export must be 1 byte to 10 MB');
      if(format==='png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('Invalid PNG');if(format==='jpeg'&&(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217))fail('Invalid JPEG');if(format==='csv'&&bytes.includes(0))fail('Invalid CSV');
      const stem=clean(data.name,120).replace(/[^\p{L}\p{N}_.-]+/gu,'_').replace(/^\.+/,'')||'spectrum',id=randomUUID(),name=id+'-'+stem+'.'+format;
      await mkdir(exportDir,{recursive:true});await writeFile(path.join(exportDir,name),bytes,{flag:'wx'});return json(res,{url:'/api/exports/'+encodeURIComponent(name),path:path.join(exportDir,name),bytes:bytes.length,name},201);
    }
    if(req.method==='GET'&&p.startsWith('/api/exports/')){
      const name=decodeURIComponent(p.slice(13));if(!/^[a-f0-9-]{36}-[\p{L}\p{N}_.-]+\.(png|jpeg|csv)$/u.test(name))fail('Invalid export path');
      const bytes=await readFile(path.join(exportDir,name)).catch(()=>null);if(!bytes)fail('Export not found',404);const format=name.split('.').at(-1);res.writeHead(200,{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'image/'+format,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name.slice(37))}`,'Cache-Control':'no-store'});return res.end(bytes);
    }
    if(req.method==='GET'&&p==='/api/simulations-info')return json(res,{version:SIMULATION_VERSION,kind:'rule-simulation',eligibleForMatching:false,identities:db.prepare('SELECT count(*) n FROM compound_simulations').get().n,memberships:db.prepare('SELECT count(*) n FROM memberships m JOIN compound_simulations s ON s.compound_id=m.compound_id').get().n});
    if(req.method==='GET'&&/^\/api\/compounds\/\d+\/simulation$/.test(p)){const c=compound(db,Number(p.split('/')[3]));if(!c)fail('Compound not found',404);const technique=url.searchParams.get('technique');if(technique&&!['ftir','h1','c13','uv'].includes(technique))fail('Unsupported technique');const data=await structuralSpectrum(c);return json(res,technique?simulationRecord(data,technique,c):data)}
    if(req.method==='GET'&&p==='/api/logic-info')return json(res,{method:LOGIC_VERSION,sources:logicSources,rules:groupRules.map(([id,label,smarts])=>({id,label,smarts})),counts:logicCounts(db)});
    if(req.method==='GET'&&p==='/api/logic-dataset'){res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="spectratrace-1500-rule-derived.json"','Cache-Control':'no-store'});return res.end(JSON.stringify(exportLogicDataset(db),null,2))}
    if(req.method==='GET'&&p==='/api/evidence')return json(res,listEvidence(db,Object.fromEntries(url.searchParams)));
    if(req.method==='GET'&&/^\/api\/evidence\/[a-f0-9]{32}$/.test(p)){const e=evidence(db,p.split('/').at(-1));if(!e)fail('Evidence not found',404);return json(res,e)}
    if(req.method==='GET'&&/^\/api\/evidence\/[a-f0-9]{32}\/original$/.test(p)){
      const e=evidence(db,p.split('/')[3]);if(!e)fail('Evidence not found',404);const original=path.resolve(dir,e.original_path);if(!original.startsWith(path.join(dir,'source-downloads')+path.sep))fail('Invalid original path',403);
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(e.filename)}`,'X-SHA256':e.sha256});return res.end(await readFile(original));
    }
    if(req.method==='GET'&&p==='/api/stats')return json(res,stats(db));
    if(req.method==='GET'&&p==='/api/catalog'){res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="spectratrace-1500-identities.json"'});return res.end(await readFile(path.join(root,'catalog','identities.json')))}
    if(req.method==='GET'&&p==='/api/settings')return json(res,{database:dir,originals:path.join(dir,'uploads'),maxFileMB:25,backupFolder:backupDir,localOnly:true,aiEnabled:false});
    if(req.method==='GET'&&p==='/api/compounds'){
      const q=clean(url.searchParams.get('q'),100).replace(/[\\%_]/g,c=>'\\'+c),collection=clean(url.searchParams.get('collection'),80);
      const off=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));
      const where="WHERE (?='' OR c.name LIKE ? ESCAPE '\\' OR c.inchikey LIKE ? ESCAPE '\\' OR c.formula LIKE ? ESCAPE '\\') AND (?='' OR EXISTS(SELECT 1 FROM memberships m WHERE m.compound_id=c.id AND m.collection_id=?))";
      const args=[q,`%${q}%`,`%${q}%`,`%${q}%`,collection,collection];
      const rows=db.prepare(`SELECT c.*, (SELECT group_concat(DISTINCT z.technique) FROM all_sample_spectra z JOIN samples s ON s.id=z.sample_id WHERE s.compound_id=c.id AND s.status='approved' AND z.parsed IS NOT NULL) available FROM compounds c ${where} ORDER BY c.name COLLATE NOCASE LIMIT 30 OFFSET ?`).all(...args,off);
      return json(res,{rows,total:db.prepare(`SELECT count(*) n FROM compounds c ${where}`).get(...args).n,offset:off});
    }
    if(req.method==='GET'&&/^\/api\/compounds\/\d+$/.test(p)){const c=compound(db,Number(p.split('/').at(-1)));if(!c)fail('Compound not found',404);return json(res,c)}
    if(req.method==='GET'&&p==='/api/samples')return json(res,db.prepare('SELECT s.*,c.name compound_name FROM samples s LEFT JOIN compounds c ON c.id=s.compound_id ORDER BY created_at DESC LIMIT 200').all().map(s=>({...s,metadata:JSON.parse(s.metadata)})));
    if(req.method==='GET'&&/^\/api\/samples\/[a-f0-9-]+$/.test(p)){const s=sample(db,p.split('/').at(-1));if(!s)fail('Sample not found',404);return json(res,s)}
    if(req.method==='GET'&&/^\/api\/files\/[a-f0-9-]+$/.test(p)){
      const id=p.split('/').at(-1),f=db.prepare('SELECT filename,sha256 FROM all_sample_spectra WHERE id=?').get(id);if(!f)fail('File not found',404);
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,'X-SHA256':f.sha256});return res.end(await readFile(path.join(dir,'uploads',id)));
    }
    if(req.method==='GET'&&/^\/api\/backups\/spectratrace-[A-Za-z0-9-]+\.tar\.gz$/.test(p)){const name=p.split('/').at(-1);res.writeHead(200,{'Content-Type':'application/gzip','Content-Disposition':`attachment; filename="${name}"`});return res.end(await readFile(path.join(backupDir,name)))}
    if(req.method==='POST'&&p==='/api/samples')return json(res,await saveSample(await body(req)),201);
    if(req.method==='POST'&&/^\/api\/samples\/[a-f0-9-]+\/approve$/.test(p)){
      const s=sample(db,p.split('/')[3]),review=await body(req);
      if(!s||s.kind!=='reference')fail('Only named reference submissions can be approved');
      if(!clean(review.reviewer)||!clean(review.evidence)||review.confirmed!==true)fail('Reviewer, independent identification evidence and explicit confirmation required');
      if(!s.spectra.some(z=>z.parsed))fail('No parseable spectra to approve');
      for(const z of s.spectra.filter(z=>z.parsed)) {
        const m=z.metadata;if(!clean(m.instrument)||!clean(m.date))fail('Instrument and acquisition date required for every parseable spectrum');
        if(z.technique==='ftir'&&(!clean(m.phase)||!clean(m.measurement)||!clean(m.resolution)))fail('FTIR phase, measurement mode and resolution required');
        if(['h1','c13'].includes(z.technique)&&(!clean(m.solvent)||!clean(m.frequency)))fail('NMR solvent and spectrometer frequency required');
        if(z.technique==='uv'&&(!clean(m.solvent)||!clean(m.concentration)||!clean(m.pathLength)))fail('UV solvent, concentration and path length required');
        if(z.technique==='xrd'&&(!clean(m.phase)||!clean(m.radiation)||!clean(m.polymorph)||m.polymorph==='unknown'))fail('XRD phase, radiation / wavelength and known polymorph required');
        if(z.technique==='fluorescence'&&(!clean(m.solvent)||!clean(m.excitation)))fail('Fluorescence solvent and excitation wavelength required');
      }
      db.prepare("UPDATE samples SET status='approved',review=?,reviewed_at=? WHERE id=?").run(JSON.stringify({reviewer:clean(review.reviewer),evidence:clean(review.evidence,5000),confirmed:true}),new Date().toISOString(),s.id);return json(res,{id:s.id,status:'approved'});
    }
    if(req.method==='POST'&&/^\/api\/samples\/[a-f0-9-]+\/matches$/.test(p))return json(res,matches(p.split('/')[3]));
    if(req.method==='POST'&&p==='/api/backups')return json(res,await backup(),201);
    if(req.method!=='GET')fail('Route not found',404);
    let target,mime;
    if(p==='/vendor/RDKit_minimal.js'||p==='/vendor/RDKit_minimal.wasm'){target=path.join(root,'node_modules','@rdkit','rdkit','dist',path.basename(p));mime=p.endsWith('.wasm')?'application/wasm':'text/javascript'}
    else if(p==='/'||p==='/bank.html'){target=path.join(root,'dist','bank.html');mime='text/html; charset=utf-8'}
    else if(['/bank.js','/bank.css','/focus.js','/focus-data.js','/student.js','/nmr-core.mjs','/nmr-ui.js'].includes(p)){target=path.join(root,'dist',p.slice(1));mime=/\.m?js$/.test(p)?'text/javascript':'text/css'}
    else fail('Route not found',404);
    const content=await readFile(target);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(content);
  }catch(e){if(!res.headersSent)json(res,{error:e.status?e.message:'Server error; no successful save was confirmed.'},e.status||500);else res.end();if(!e.status)console.error(e);}
});
server.listen(port,'127.0.0.1',()=>{console.log(`SpectraTrace local data bank: ${origin}\nDatabase: ${dir}\nCatalog: ${stats(db).uniqueIdentities} unique identities. Originals stay on this computer.\nHTTPS certificates: ${certificateStore}`);
  // Bundled EI-MS libraries (sources/ms-libraries) are imported once per archive checksum.
  if(process.env.SPECTRATRACE_SKIP_BUNDLED_MS!=='1')importBundledLibraries(db,dir,root,m=>console.log('MS library · '+m)).then(()=>importMassBankBundle(db,dir,root,m=>console.log(m))).catch(e=>console.error('Bundled spectra import failed: '+e.message));});
function stop(){server.close(()=>{db.close();process.exit()})}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
