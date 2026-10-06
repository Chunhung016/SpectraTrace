import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {parseSpectrum,compareSpectra} from '../lib/spectra.mjs';
import {openBank,stats,sample} from '../lib/bank.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const work=path.resolve(root,'../../work');
const meta={xUnit:'cm-1',yMode:'absorbance',format:'continuous',phase:'solid',measurement:'ATR',resolution:'4',instrument:'TEST fixture, not research data',date:'2026-10-03'};
const raw=Buffer.from('wavenumber,intensity\n4000,0.1\n3000,0.2\n2000,1\n1000,0.2\n500,0.1\n');
test('Parser rejects unsupported or misleading data, preserves equal-intensity NMR peaks',()=>{
  const a=parseSpectrum(raw,'ftir',meta);assert.equal(a.points.length,5);assert.deepEqual(a.range,[500,4000]);
  assert.throws(()=>parseSpectrum(Buffer.from('##TITLE=Test\n##XYDATA=(X++(Y..Y))'),'ftir',meta),/JCAMP/);
  assert.throws(()=>parseSpectrum(raw,'ftir',{...meta,xUnit:'nm'}),/units/);
  assert.throws(()=>parseSpectrum(Buffer.from('500,1\n500,2\n1000,3'),'ftir',meta),/Duplicate/);
  assert.throws(()=>parseSpectrum(Buffer.from('500,1\n1000,1\n2000,1'),'ftir',meta),/variation/);
  assert.equal(parseSpectrum(Buffer.from('1,1\n4,1\n7,1'),'h1',{xUnit:'ppm',yMode:'intensity',format:'peaks'}).points.length,3);
  const cmp=compareSpectra({technique:'ftir',metadata:meta,parsed:a},{technique:'ftir',metadata:meta,parsed:a});assert.ok(cmp.similarity>.99999);
  assert.equal(compareSpectra({technique:'ftir',metadata:meta,parsed:a},{technique:'ftir',metadata:{...meta,phase:'gas'},parsed:a}).eligible,false);
});
test('Local bank integration: 500 each, review gating, originals, backup, restart durability',async()=>{
  await mkdir(work,{recursive:true});const scratch=await mkdtemp(path.join(work,'bank-test-'));const dir=path.join(scratch,'data'),backups=path.join(scratch,'backups');
  const port=4192,base=`http://127.0.0.1:${port}`;let proc;
  async function start(){proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),SPECTRATRACE_DATA_DIR:dir,SPECTRATRACE_BACKUP_DIR:backups,SPECTRATRACE_EXPORT_DIR:path.join(scratch,'exports')},windowsHide:true});let logs='';proc.stderr.on('data',b=>logs+=b);proc.stdout.on('data',b=>logs+=b);for(let n=0;n<60;n++){try{const r=await fetch(base+'/api/stats');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Test server failed: '+logs)}
  async function stop(){if(!proc||proc.exitCode!==null||proc.signalCode!==null)return;const done=new Promise(r=>proc.once('exit',r));proc.kill();await done;}
  async function api(url,data,expected=200){const r=await fetch(base+url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-SpectraTrace':'1'},body:JSON.stringify(data)});const j=await r.json();assert.equal(r.status,expected,JSON.stringify(j));return j}
  try {
    await start();const initial=await api('/api/stats');assert.equal(initial.uniqueIdentities,1461);assert.deepEqual(initial.collections.map(c=>c.identities),[500,500,500]);assert.equal(initial.samples.length,0);
    const c=(await api('/api/compounds?q=aspirin')).rows[0];assert.ok(c);
    // Imported public evidence is distinct from a reviewed reference, even with an exact identity link.
    await mkdir(path.join(dir,'source-downloads'),{recursive:true});await writeFile(path.join(dir,'source-downloads','fixture.csv'),raw);
    const imports=openBank(dir),eid='a'.repeat(32);imports.prepare('INSERT INTO external_sources VALUES(?,?,?,?,?)').run('test-only','SYNTHETIC TEST SOURCE','https://example.org','TEST ONLY',JSON.stringify({notes:'Fixture, not measured data',archives:[]}));
    imports.prepare('INSERT INTO compound_logic VALUES(?,?,?,?)').run(c.id,'test-only',JSON.stringify({kind:'rule-derived',eligibleForMatching:false,ftir:{fullSpectrum:null}}),new Date().toISOString());
    imports.prepare('INSERT INTO external_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eid,'test-only','fixture',c.id,c.name,c.inchikey,c.smiles,'ftir','continuous','imported','https://example.org',path.join('source-downloads','fixture.csv'),'fixture.csv',createHash('sha256').update(raw).digest('hex'),JSON.stringify({xUnit:'cm-1',yMode:'absorbance',format:'continuous'}),JSON.stringify(parseSpectrum(raw,'ftir',meta)),null);imports.close();
    assert.equal((await api('/api/stats')).external.total,1);assert.equal((await api('/api/evidence?source=test-only&technique=ftir&linked=1')).total,1);assert.equal((await api('/api/evidence?q=NOT_A_REAL_COMPOUND')).total,0);
    assert.equal((await api('/api/logic-info')).counts.identities,1);const exported=await api('/api/logic-dataset');assert.equal(exported.entries.length,1);assert.ok(exported.memberships.every(m=>m.compound_id===c.id));assert.equal(exported.entries[0].logic.eligibleForMatching,false);assert.equal((await api('/api/compounds/'+c.id)).logic.kind,'rule-derived');
    const localExport=await api('/api/exports',{format:'csv',name:'TEST_ONLY',base64:raw.toString('base64')},201);assert.ok(localExport.path.startsWith(path.join(scratch,'exports')));assert.deepEqual(Buffer.from(await(await fetch(base+localExport.url)).arrayBuffer()),raw);await api('/api/exports',{format:'png',name:'TEST_INVALID',base64:raw.toString('base64')},400);
    const external=await api('/api/evidence/'+eid);assert.equal(external.parsed.points.length,5);assert.equal((await api('/api/compounds/'+c.id)).external.length,1);assert.deepEqual(Buffer.from(await (await fetch(base+'/api/evidence/'+eid+'/original')).arrayBuffer()),raw);
    const payload={id:randomUUID(),kind:'reference',label:'SYNTHETIC SOFTWARE TEST — NOT RESEARCH',compoundId:c.id,metadata:{contributor:'Automated test',provenance:'Numerical software fixture only',license:'Private test'},files:[{technique:'ftir',name:'fixture.csv',base64:raw.toString('base64'),metadata:meta}]};
    await api('/api/samples',payload,201);await api('/api/samples',payload,201);const all=await api('/api/samples');assert.equal(all.length,1);
    const ref=await api('/api/samples/'+payload.id);assert.equal(ref.status,'pending');assert.equal(ref.spectra[0].sha256,createHash('sha256').update(raw).digest('hex'));const downloaded=Buffer.from(await (await fetch(base+'/api/files/'+ref.spectra[0].id)).arrayBuffer());assert.deepEqual(downloaded,raw);
    const unknown={...payload,id:randomUUID(),kind:'unknown',label:'SYNTHETIC UNKNOWN TEST',compoundId:undefined};await api('/api/samples',unknown,201);
    const before=await api('/api/samples/'+unknown.id+'/matches',{});assert.equal(before.results.length,0);
    const inspected=await api('/api/inspect-spectrum',{base64:raw.toString('base64')});assert.equal(inspected.rows,5);
    const smallAnalysis=await api('/api/samples/'+unknown.id+'/analysis');assert.equal(smallAnalysis.total,0);assert.match(smallAnalysis.reason,/coverage/);
    await api('/api/samples/'+unknown.id+'/selection',{compoundId:c.id});const selected=await api('/api/samples/'+unknown.id);assert.equal(selected.compound_id,null);assert.equal(selected.status,'unknown');assert.equal(selected.selection.compound_id,c.id);await api('/api/samples/'+unknown.id+'/selection',{compoundId:null});
    const xrdRaw=Buffer.from('2theta,intensity\n10,1\n20,20\n30,3\n'),extra={file:{technique:'xrd',name:'TEST_ONLY_xrd.csv',base64:xrdRaw.toString('base64'),metadata:{xUnit:'2theta-deg',yMode:'intensity',format:'continuous',phase:'solid',radiation:'TEST ONLY Cu Ka',polymorph:'unknown'}}};
    const expanded=await api('/api/samples/'+unknown.id+'/add-spectrum',extra,201),xrd=expanded.spectra.find(s=>s.technique==='xrd');assert.equal(xrd.parsed.points.length,3);assert.deepEqual(Buffer.from(await(await fetch(base+'/api/files/'+xrd.id)).arrayBuffer()),xrdRaw);await api('/api/samples/'+unknown.id+'/add-spectrum',extra,409);await api('/api/samples/'+payload.id+'/add-spectrum',extra,400);
    await api('/api/samples/'+payload.id+'/approve',{reviewer:'Software test',evidence:'Fixture',confirmed:false},400);
    await api('/api/samples/'+unknown.id+'/approve',{reviewer:'Software test',evidence:'Fixture',confirmed:true},400);
    await api('/api/samples/'+payload.id+'/approve',{reviewer:'Software test',evidence:'Synthetic fixture; test isolated from real bank',confirmed:true});
    const after=await api('/api/samples/'+unknown.id+'/matches',{});assert.equal(after.results.length,1);assert.ok(after.results[0].mean>.99999);assert.equal(after.results[0].scores.length,1);
    const catalog=await api('/api/compounds/'+c.id);assert.deepEqual(catalog.coverage.map(z=>z.technique),['ftir']);
    const archived={...unknown,id:randomUUID(),files:[{technique:'uv',name:'native.bin',base64:Buffer.from([0,1,2,0]).toString('base64'),metadata:{}}]};await api('/api/samples',archived,201);const binary=await api('/api/samples/'+archived.id);assert.equal(binary.spectra[0].parsed,null);assert.ok(binary.spectra[0].parse_error);
    const blocked=await fetch(base+'/api/backups',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example','X-SpectraTrace':'1'},body:'{}'});assert.equal(blocked.status,403);
    const backup=await api('/api/backups',{},201);const archive=await fetch(base+backup.url);assert.equal(archive.status,200);assert.ok(Number(archive.headers.get('content-length'))>0 || (await archive.arrayBuffer()).byteLength>1000);
    const restore=path.join(scratch,'restored');await mkdir(restore);await new Promise((resolve,reject)=>{const unpack=spawn('tar',['-xzf',path.join(backups,backup.name),'-C',restore],{windowsHide:true});unpack.on('error',reject);unpack.on('close',n=>n===0?resolve():reject(Error('Restore extraction failed')))});
    const restored=openBank(restore);assert.equal(stats(restored).uniqueIdentities,1461);assert.equal(stats(restored).external.total,1);assert.equal(sample(restored,payload.id).status,'approved');assert.deepEqual(await readFile(path.join(restore,'uploads',ref.spectra[0].id)),raw);assert.deepEqual(await readFile(path.join(restore,'uploads',xrd.id)),xrdRaw);assert.equal(sample(restored,unknown.id).spectra.length,2);assert.deepEqual(await readFile(path.join(restore,'source-downloads','fixture.csv')),raw);restored.close();assert.equal(JSON.parse(await readFile(path.join(restore,'catalog-identities.json'),'utf8')).entries.length,1500);
    await stop();await start();assert.equal((await api('/api/samples')).length,3);assert.equal((await api('/api/samples/'+payload.id)).status,'approved');assert.equal((await api('/api/stats')).uniqueIdentities,1461);
    await stop();const reopened=openBank(dir);assert.equal(stats(reopened).samples.reduce((n,x)=>n+x.n,0),3);assert.equal(sample(reopened,payload.id).spectra[0].parsed.points.length,5);assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');reopened.close();
    console.log('Isolated test artifacts retained at '+scratch+'; none inserted into your real research bank.');
  }finally{await stop()}
});
