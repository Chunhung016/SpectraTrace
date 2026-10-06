import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import initRDKit from '@rdkit/rdkit';
import {openBank} from '../lib/bank.mjs';
import {createLogicEngine,LOGIC_VERSION} from '../lib/logic.mjs';
import {createStructuralSpectrumReader} from '../lib/structural-spectra.mjs';
import {simulationRecord} from '../lib/simulation.mjs';
import {createCodFetcher,searchCod,COD_ORIGIN} from '../lib/cod.mjs';
import {parseJcamp,normalizeNistBlock} from '../lib/jcamp.mjs';
import {lookupNist} from '../lib/nist-webbook.mjs';

const uv=(xUnit='Wavelength (nm)',yUnit='Logarithm epsilon',xs=[200,210,220])=>'##TITLE=Test UV fixture\n##DATA TYPE=UV/VIS SPECTRUM\n##CAS REGISTRY NO=50-78-2\n##XUNITS='+xUnit+'\n##YUNITS='+yUnit+'\n##XYPOINTS=(XY..XY)\n'+xs.map((x,i)=>x+','+[2,3,2][i]).join('\n')+'\n##END=';

test('NIST UV accepts advertised nm and wavenumber spellings without changing source ordinates',async()=>{
  for(const unit of ['Wavelength (nm)','NM','Nanometres']){const n=normalizeNistBlock(parseJcamp(uv(unit))[0]);assert.equal(n.xUnit,'nm');assert.equal(n.yMode,'log-epsilon');assert.deepEqual(n.points,[[200,2],[210,3],[220,2]])}
  for(const unit of ['1/CM','CM^-1','Wavenumber (cm-1)']){const n=normalizeNistBlock(parseJcamp(uv(unit,'Molar extinction coefficient',[40000,45000,50000]))[0]);assert.equal(n.points[0][0],200);assert.equal(n.points.at(-1)[0],250);assert.equal(n.yMode,'epsilon')}
  assert.throws(()=>normalizeNistBlock(parseJcamp(uv('FURLONGS'))[0]),/Unsupported UV/);
  const key='BSYNRYMUTXBXSQ-UHFFFAOYSA-N';
  const get=async url=>Buffer.from(new URL(url).searchParams.has('JCAMP')?uv():new URL(url).searchParams.has('ID')?'<a href="/cgi/cbook.cgi?JCAMP=C50782&Index=0&Type=UVVis">Download spectrum</a>':'<h1>Aspirin</h1>InChIKey: '+key+' CAS Registry Number: 50-78-2 <a href="/cgi/cbook.cgi?ID=C50782&Mask=400">UV/Visible spectrum</a>');
  const result=await lookupNist({inchikey:key},{get});assert.equal(result.spectra.length,1);assert.equal(result.spectra[0].technique,'uv');assert.equal(result.spectra[0].yMode,'log-epsilon');assert.deepEqual(result.errors,[]);
});

test('COD connection retries transient failures, follows only same-origin redirects and uses JSON search',async()=>{
  let calls=0;
  const get=createCodFetcher({minDelayMs:0,fetchImpl:async url=>{calls++;if(calls===1)throw new TypeError('fetch failed');if(calls===2)return new Response('busy',{status:503});assert.ok(url.startsWith(COD_ORIGIN));return new Response('[{"file":"7247818","commonname":"Aspirin","formula":"- C9 H8 O4 -"}]')}});
  const result=await searchCod({name:'Aspirin',formula:'C9H8O4'},{get});assert.equal(calls,3);assert.equal(result.entries[0].nameMatch,true);
  const redirect=createCodFetcher({minDelayMs:0,fetchImpl:async url=>url.endsWith('/cod/test')?new Response(null,{status:302,headers:{location:'/cod/test.cif'}}):new Response('data_test')});
  assert.equal((await redirect(COD_ORIGIN+'/cod/test')).toString(),'data_test');
  let forbiddenCalls=0;const forbidden=createCodFetcher({minDelayMs:0,fetchImpl:async()=>{forbiddenCalls++;return new Response(null,{status:302,headers:{location:'https://example.com/private'}})}});
  await assert.rejects(()=>forbidden(COD_ORIGIN+'/cod/test'),/Only COD URLs/);assert.equal(forbiddenCalls,1);
  await assert.rejects(()=>forbidden('http://127.0.0.1/private'),/Only COD URLs/);
  await assert.rejects(()=>searchCod({formula:'C9H8O4'},{get:async()=>Buffer.from('{"error":"busy"}')}),/unexpected result/);
});

test('UV and carbon T records work from local structure rules without a saved T dataset',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'st-rule-fallback-')),db=openBank(dir),rdkit=await initRDKit(),engine=createLogicEngine(rdkit);
  const c={id:1,name:'TEST fixture: aspirin',inchikey:'BSYNRYMUTXBXSQ-UHFFFAOYSA-N',smiles:'CC(=O)Oc1ccccc1C(=O)O'};
  try{
    db.prepare('INSERT INTO compounds(id,name,inchikey,smiles) VALUES(?,?,?,?)').run(c.id,c.name,c.inchikey,c.smiles);
    const profile=engine.profile(c.smiles);db.prepare('INSERT INTO compound_logic VALUES(?,?,?,?)').run(c.id,LOGIC_VERSION,JSON.stringify(profile),'test');
    let loads=0;const read=createStructuralSpectrumReader(db,{loadRdkit:async()=>{loads++;return rdkit}}),window={};vm.runInNewContext(await readFile(new URL('../dist/focus-data.js',import.meta.url),'utf8'),{window});
    for(const technique of ['uv','c13']){
      const record=simulationRecord(await read(c),technique,c),data=window.focusSpectraData.spectrumData(record,technique);
      assert.equal(record.status,'theoretical');assert.equal(record.eligibleForMatching,false);assert.ok(record.parsed.points.some(p=>p[1]>0));
      assert.ok(window.focusSpectraData.svg(data,{compact:true}).includes('<svg'));assert.doesNotMatch(record.metadata.yMode,/illustrat/i);
      if(technique==='uv'){assert.equal(data.yUnit,'Absorbance');assert.equal(record.metadata.yMode,'Absorbance')}
      else{assert.ok(record.nmrModel.signals.length>1);assert.match(window.focusSpectraData.svg(data),/Intensity \(a\.u\.\)/);assert.doesNotMatch(record.nmrModel.limitations.join(' '),/illustrat/i)}
    }
    assert.equal(loads,1);assert.equal(db.prepare('SELECT count(*) n FROM compound_simulations').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM samples').get().n,0);
    const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const server=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:String(port),SPECTRATRACE_DATA_DIR:dir,SPECTRATRACE_SKIP_BUNDLED_MS:'1'}});
    try{
      await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Test server startup timed out')),10000);server.stdout.on('data',data=>{if(data.toString().includes('local data bank:')){clearTimeout(timeout);resolve()}});server.once('exit',code=>{clearTimeout(timeout);reject(Error('Test server exited '+code))})});
      for(const technique of ['uv','c13']){const response=await fetch('http://127.0.0.1:'+port+'/api/compounds/1/theory?technique='+technique),record=await response.json();assert.equal(response.status,200);assert.equal(record.status,'theoretical');assert.equal(record.eligibleForMatching,false);assert.ok(record.parsed.points.length>1)}
      const legacy=await fetch('http://127.0.0.1:'+port+'/api/compounds/1/simulation?technique=c13');assert.equal(legacy.status,200);
      assert.equal(db.prepare('SELECT count(*) n FROM compound_simulations').get().n,0);
    }finally{server.kill();await new Promise(resolve=>server.once('exit',resolve))}
    const input={kind:'curve',technique:'ftir',xUnit:'cm-1',yUnit:'Absorbance',isSimulated:true,points:[[1000,0],[1100,1],[1200,0]]},saved=JSON.stringify(input),trans=window.focusSpectraData.displayData(input,'transmittance');assert.equal(trans.yUnit,'Transmittance (%)');assert.equal(trans.points[1][1],10);assert.equal(JSON.stringify(input),saved);
  }finally{engine.close();db.close()}
});
