import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import http from 'node:http';
import {proposeIdentification} from '../lib/identification.mjs';
import {parseSpectrum,compareSpectra} from '../lib/spectra.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const meta={xUnit:'cm-1',yMode:'absorbance',format:'continuous',phase:'solid',measurement:'ATR',solvent:'none',sampleType:'single',instrument:'SOFTWARE FIXTURE ONLY',date:'2026-10-06',resolution:'4'};
const trace=centres=>Buffer.from('Wavenumber,Absorbance\n'+Array.from({length:1801},(_,i)=>{const x=400+2*i,y=.02+centres.reduce((v,c)=>v+Math.exp(-.5*((x-c)/18)**2),0);return x+','+y}).join('\n'));
const raw=trace([750,1120,1720]),other=trace([1460,2500,3420]);
const ftir=()=>({technique:'ftir',metadata:{...meta},parsed:parseSpectrum(raw,'ftir',meta)});
const unknown=()=>({label:'Misleading label: NOT evidence',kind:'unknown',compound_id:null,spectra:[ftir()]});
const result=(id,score)=>({compound:{id},referenceId:'TEST ONLY '+id,scores:[{technique:'ftir',similarity:score,coverage:1}],mean:score,matchedModalities:1});

test('Automatic opening is a provisional separated reference suggestion, never name inference',()=>{
 const q=unknown(),before=JSON.stringify(q),r=[result(1,1),result(2,.6)];
 const d=proposeIdentification(q,r);assert.equal(d.autoOpen,true);assert.equal(d.compoundId,1);assert.equal(d.confirmed,false);assert.equal(d.status,'reference-suggestion');assert.equal(JSON.stringify(q),before);
 assert.equal(proposeIdentification({...q,label:'aspirin',spectra:q.spectra},[]).autoOpen,false);
 assert.match(proposeIdentification(q,[result(1,1),result(1,.999)]).reason,/distinct/);
 assert.match(proposeIdentification(q,[result(1,1),result(2,.97)]).reason,/Several/);
 assert.equal(proposeIdentification(q,[result(1,.96),result(2,.6)]).autoOpen,false);
 assert.equal(proposeIdentification(q,[{...r[0],scores:[{technique:'ftir',similarity:1,coverage:undefined}]},r[1]]).autoOpen,false);
 assert.equal(proposeIdentification(q,[{...r[0],scores:[{technique:'ftir',similarity:1,coverage:1,referenceNormalized:true}]},r[1]]).autoOpen,false);
 assert.equal(proposeIdentification(q,[{...r[0],scores:[{technique:'ftir',similarity:1,coverage:.8}]},r[1]]).autoOpen,false);
 const mixture=unknown();mixture.spectra[0].metadata.sampleType='mixture';assert.match(proposeIdentification(mixture,r).reason,/mixtures/);
 const normalized=unknown();normalized.spectra[0].metadata.normalized='true';assert.match(proposeIdentification(normalized,r).reason,/non-normalized/);
 const prior={...unknown(),selection:{compound_id:2}};assert.match(proposeIdentification(prior,r).reason,/existing student hypothesis/);
 const extra=unknown();extra.spectra.push({technique:'h1',parsed:{points:[[1,1],[2,2],[3,1]]}});assert.match(proposeIdentification(extra,r).reason,/every uploaded technique/);
 const sparse=unknown();sparse.spectra[0].parsed.points=sparse.spectra[0].parsed.points.filter((_,i)=>i%50===0);assert.match(proposeIdentification(sparse,r).reason,/sampling/);
 const ambiguousAxis=ftir();ambiguousAxis.metadata.yMode='intensity';assert.equal(compareSpectra(ambiguousAxis,ftir()).eligible,false);
 const t=unknown();t.spectra[0].metadata.yMode='transmittance-percent';t.spectra[0].parsed.points=t.spectra[0].parsed.points.map(([x,a])=>[x,100*10**-a]);assert.equal(proposeIdentification(t,r).autoOpen,true);
});

test('Browser route automatically opens the suggestion, and review explicitly bypasses it',async()=>{
 const js=await readFile(path.join(root,'dist/focus.js'),'utf8'),start=js.indexOf('  async function unknown('),end=js.indexOf('  async function route(',start);
 const calls=[],q={id:'TEST ONLY',spectra:[]},window={studentWorkflow:{results:async()=>calls.push('candidates')}};
 const ctx={api:async url=>url.endsWith('/matches')?{identification:{autoOpen:true,compoundId:540}}:url.includes('/compounds/')?{id:540,name:'aspirin'}:q};
 const context=vm.createContext({ctx,version:1,current:null,window,progress:()=>{},pause:async()=>{},openSpectrum:()=>{},displayCompound:async(c,run,notice,s)=>calls.push({c,notice,s})});
 vm.runInContext(js.slice(start,end),context);await context.unknown(q.id,1);assert.equal(calls[0].c.id,540);assert.match(calls[0].notice,/not confirmed/);assert.equal(calls[0].s,q);
 calls.length=0;await context.unknown(q.id,1,true);assert.deepEqual(calls,['candidates']);
 assert.match(js,/link\.href='#unknown\/'.*\/review/);assert.match(js,/mode==='review'/);
});

test('Upload API compares numerical evidence and leaves unknown identity, selection and originals intact',async()=>{
 const work=path.resolve(root,'../../work');await mkdir(work,{recursive:true});const scratch=await mkdtemp(path.join(work,'identification-test-'));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port;
 const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),SPECTRATRACE_SKIP_BUNDLED_MS:'1',SPECTRATRACE_DATA_DIR:path.join(scratch,'data')},windowsHide:true});let logs='';proc.stderr.on('data',b=>logs+=b);proc.stdout.on('data',b=>logs+=b);
 async function api(url,data,status=200){const res=await fetch(base+url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-SpectraTrace':'1'},body:JSON.stringify(data)}),j=await res.json();assert.equal(res.status,status,JSON.stringify(j));return j}
 const upload=(kind,id,compoundId,bytes=raw,m=meta)=>({id,kind,compoundId,label:'SOFTWARE FIXTURE — NOT RESEARCH',metadata:{contributor:'Automated test',provenance:'Generated numerical software fixture; not an aspirin measurement',license:'Test only'},files:[{name:'misleading-name.csv',technique:'ftir',base64:bytes.toString('base64'),metadata:m}]});
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Isolated test server did not start: '+logs)),10000);proc.stdout.on('data',b=>{if(b.toString().includes('local data bank:')){clearTimeout(timeout);resolve()}});proc.once('exit',code=>{clearTimeout(timeout);reject(Error('Isolated test server exited '+code+': '+logs))});proc.once('error',reject)});
  const a=(await api('/api/compounds?q=aspirin')).rows[0],b=(await api('/api/compounds?q=benzoic')).rows.find(z=>z.id!==a.id);assert.ok(b);
  const qid=randomUUID(),ref=randomUUID();await api('/api/samples',upload('unknown',qid,undefined),201);
  assert.equal((await api('/api/samples/'+qid+'/matches',{})).identification.autoOpen,false);
  await api('/api/samples',upload('reference',ref,a.id),201);
  assert.equal((await api('/api/samples/'+qid+'/matches',{})).results.length,0); // Pending refs excluded.
  await api('/api/samples/'+ref+'/approve',{reviewer:'SOFTWARE TEST ONLY',evidence:'Synthetic numerical fixture, not chemical validation',confirmed:true});
  assert.equal((await api('/api/samples/'+qid+'/matches',{})).identification.autoOpen,false); // One identity is not a separated match.
  const rid=randomUUID();await api('/api/samples',upload('reference',rid,b.id,other),201);await api('/api/samples/'+rid+'/approve',{reviewer:'SOFTWARE TEST ONLY',evidence:'Synthetic numerical fixture',confirmed:true});
  const matched=await api('/api/samples/'+qid+'/matches',{});assert.equal(matched.identification.autoOpen,true);assert.equal(matched.identification.compoundId,a.id);assert.equal(matched.identification.confirmed,false);
  const saved=await api('/api/samples/'+qid);assert.equal(saved.compound_id,null);assert.equal(saved.selection,null);assert.equal(saved.status,'unknown');assert.deepEqual(Buffer.from(await(await fetch(base+'/api/files/'+saved.spectra[0].id)).arrayBuffer()),raw);
  const wrong=randomUUID();await api('/api/samples',upload('unknown',wrong,undefined,raw,{...meta,phase:'gas'}),201);assert.equal((await api('/api/samples/'+wrong+'/matches',{})).identification.autoOpen,false);
  const tied=randomUUID();await api('/api/samples',upload('reference',tied,b.id),201);await api('/api/samples/'+tied+'/approve',{reviewer:'SOFTWARE TEST ONLY',evidence:'Deliberate ambiguity fixture',confirmed:true});assert.equal((await api('/api/samples/'+qid+'/matches',{})).identification.autoOpen,false);
 }finally{if(proc.exitCode===null&&proc.signalCode===null){const done=new Promise(r=>proc.once('exit',r));proc.kill();await done}}
 console.log('Identification test uses only the isolated fixture bank: '+scratch);
});
