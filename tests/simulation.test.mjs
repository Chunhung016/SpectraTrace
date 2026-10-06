import test from 'node:test';
import assert from 'node:assert/strict';
import initRDKit from '@rdkit/rdkit';
import {createLogicEngine} from '../lib/logic.mjs';
import {buildSimulation,simulationRecord,simulationGrids} from '../lib/simulation.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('Four deterministic fine-grid envelopes preserve the measured/simulated boundary',async()=>{
 const rdkit=await initRDKit(),engine=createLogicEngine(rdkit);
 try{const p=engine.profile('CC(=O)Oc1ccccc1C(=O)O'),before=JSON.stringify(p),d=buildSimulation(p);assert.deepEqual(d,buildSimulation(p));assert.equal(JSON.stringify(p),before);assert.equal(d.eligibleForMatching,false);assert.equal(p.ftir.fullSpectrum,null);assert.equal(p.uv.lambdaMaxNm,null);
  assert.deepEqual(Object.keys(d.spectra).sort(),['c13','ftir','h1','uv']);for(const [t,s]of Object.entries(d.spectra)){assert.equal(s.eligibleForMatching,false);assert.equal(s.y.length,Math.round((s.grid.end-s.grid.start)/s.grid.step)+1);assert.ok(s.y.every(y=>Number.isFinite(y)&&y>=0&&y<=1));const r=simulationRecord(d,t);assert.equal(r.status,'theoretical');assert.equal(r.parsed.points.length,s.y.length);assert.equal(r.parsed.points.at(-1)[0],simulationGrids[t].end);assert.ok(r.parsed.points.every((p,i,a)=>!i||p[0]>a[i-1][0]));}
  assert.equal(d.spectra.h1.omitted.length,1);assert.ok(d.limitations.some(x=>x.includes('not scientific resolution')));
 }finally{engine.close()}
});

test('CSV preserves all measured points; position-only records never gain intensities',async()=>{
 const context=vm.createContext({window:{}});vm.runInContext(await readFile(new URL('../dist/focus-data.js',import.meta.url),'utf8'),context);const f=context.window.focusSpectraData;
 const curve=f.spectrumData({parsed:{points:[[200,0],[210,.5],[220,1]]},metadata:{xUnit:'nm',format:'continuous',yMode:'absorbance'}},'uv');assert.equal(f.csv(curve).trim().split('\r\n').length,4);assert.match(f.csv(curve,{status:'simulated'}),/# status: simulated/);
 const positions=f.spectrumData({representation:'assigned-shifts',data:[{shift:7.2,atom:'C1'},{shift:null,atom:'C2'}]},'h1');assert.equal(positions.kind,'positions');assert.equal(positions.values.length,1);assert.doesNotMatch(f.csv(positions),/intensity/);assert.ok(f.chart(positions).positionOnly);
 assert.equal(f.spectrumData({status:'quarantined',parsed:{points:[[1,1]]}},'h1'),null);
});

test('FTIR conversion, NMR sticks and tentative peak suggestions do not mutate source values',async()=>{
 const context=vm.createContext({window:{}});vm.runInContext(await readFile(new URL('../dist/focus-data.js',import.meta.url),'utf8'),context);const f=context.window.focusSpectraData;
 const source={technique:'ftir',kind:'curve',xUnit:'cm-1',yUnit:'absorbance',points:[[1700,0],[1710,.2],[1720,1],[1730,.2],[1740,0]]};const saved=JSON.stringify(source);const trans=f.displayData(source,'transmittance');assert.equal(trans.points[2][1],10);assert.equal(trans.points[0][1],100);assert.equal(JSON.stringify(source),saved);assert.equal(f.detectPeaks(source).length,1);assert.equal(f.detectPeaks(trans).length,1);
 const positions={technique:'h1',kind:'positions',xUnit:'ppm',values:[{x:3},{x:7.2}]};const sticks=f.displayData(positions,'sticks');assert.equal(sticks.kind,'peaks');assert.equal(sticks.points.length,2);assert.match(sticks.yUnit,/not intensity/);assert.ok(f.chart(sticks).path.includes('V'));
 const assignments=f.assignPeaks(f.detectPeaks(source),'ftir',null,source);assert.ok(assignments.get(1720).endsWith('?'));
 const empty={technique:'uv',kind:'curve',xUnit:'nm',yUnit:'intensity',points:[[200,0],[201,0],[202,0]]};assert.equal(f.detectPeaks(empty).length,0);
});

test('NIST reflectance and optical constants retain their physical observable and provenance',async()=>{
 const context=vm.createContext({window:{}});vm.runInContext(await readFile(new URL('../dist/focus-data.js',import.meta.url),'utf8'),context);const f=context.window.focusSpectraData;
 for(const [measurementType,yMode]of [['reflectance','Reflectance (%)'],['optical-constants-n','Refractive index n (dimensionless)'],['optical-constants-k','Extinction coefficient k (dimensionless)']]){
  const record={status:'imported',representation:'continuous',source_url:'https://webbook.nist.gov/cgi/cbook.cgi?ID=C65850&Index=0&Type=IR-SPEC',parsed:{points:[[400,.5],[410,1],[420,.5]]},metadata:{sourceLabel:'NIST · PNNL',measurementType,xUnit:'cm-1',yMode,conditions:{phase:'solid',temperature:'298 K'},license:'Public domain',eligibleForMatching:false}};
  const before=JSON.stringify(record),data=f.spectrumData(record,'ftir');assert.equal(data.yUnit,yMode);assert.equal(data.measurementType,measurementType);assert.equal(f.canSwitchFtir(data),false);assert.equal(f.canAssignPeaks(data),false);
  assert.strictEqual(f.displayData(data,'transmittance'),data);assert.strictEqual(f.displayData(data,'absorbance'),data);assert.equal(f.assignPeaks(f.detectPeaks(data),'ftir',null,data).size,0);assert.equal(JSON.stringify(record),before);
  const exported=f.csv(data,f.exportProvenance(record,data));assert.ok(exported.includes('# measurementType: '+measurementType));assert.ok(exported.includes('# source: '+record.source_url));assert.ok(exported.includes('# conditions: {"phase":"solid","temperature":"298 K"}'));assert.ok(exported.includes('# eligibleForMatching: false'));assert.doesNotMatch(exported,/\[object Object\]/);assert.ok(exported.includes('"cm-1","'+yMode+'"'));
 }
 assert.equal(f.sourcePriority({status:'reviewed',record:{parsed:{points:[]}}}),0);
 const conventional={status:'unreviewed',summary:{representation:'continuous',metadata:{measurementType:'absorbance',yMode:'Absorbance'}}},reference={status:'unreviewed',summary:{representation:'continuous',metadata:{measurementType:'reflectance'}}};assert.ok(f.sourcePriority(conventional)<f.sourcePriority(reference));assert.ok(f.sourcePriority(reference)<f.sourcePriority({simulation:true}));
});
