import test from 'node:test';
import assert from 'node:assert/strict';
import initRDKit from '@rdkit/rdkit';
import {buildNmrModel} from '../lib/nmr.mjs';
import {splitSignal,multiplicity,modelLines,referenceSignals,solventId,view,lineSpacing,csvView} from '../dist/nmr-core.mjs';
import {createLogicEngine} from '../lib/logic.mjs';
import {buildSimulation,simulationRecord} from '../lib/simulation.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const rdkit=await initRDKit();
test('T NMR: ethyl triplet/quartet, graph classes, symmetry heuristic and exact J/MHz spacing',()=>{
 const m=buildNmrModel(rdkit,'CCO'),carbonH=m.h1.signals.filter(s=>!s.exchangeable);assert.equal(carbonH.length,2);const triplet=carbonH.find(s=>s.area===3),quartet=carbonH.find(s=>s.area===2);assert.equal(multiplicity(triplet),'t');assert.equal(multiplicity(quartet),'q');
 const t=splitSignal(triplet,400),q=splitSignal(quartet,400);assert.equal(t.length,3);assert.equal(q.length,4);assert.ok(Math.abs(lineSpacing(t[0].x,t[1].x,400)-7)<1e-10);assert.ok(Math.abs(splitSignal(triplet,800)[1].x-splitSignal(triplet,800)[0].x-(t[1].x-t[0].x)/2)<1e-10);assert.deepEqual(t.map(l=>l.y/t[0].y),[1,2,1]);assert.deepEqual(q.map(l=>l.y/q[0].y),[1,3,3,1]);assert.equal(modelLines(m.h1,400,false,false).length,2);
 const benzene=buildNmrModel(rdkit,'c1ccccc1');assert.equal(benzene.h1.signals.length,1);assert.equal(benzene.h1.signals[0].area,6);assert.equal(benzene.h1.signals[0].couplings.length,0);assert.equal(benzene.c13.signals.length,1);
 const aspirin=buildNmrModel(rdkit,'CC(=O)Oc1ccccc1C(=O)O');assert.equal(aspirin.c13.signals.length,9);assert.equal(aspirin.h1.signals.reduce((n,s)=>n+s.area,0),8);assert.ok(aspirin.h1.signals.some(s=>s.exchangeable));assert.ok(aspirin.c13.signals.every(s=>!s.couplings.length));assert.equal(aspirin.eligibleForMatching,false);assert.deepEqual(aspirin,buildNmrModel(rdkit,'CC(=O)Oc1ccccc1C(=O)O'));
});
test('Residual solvent patterns use spin-1 D; D2O has no carbon solvent peak',()=>{
 const chl=referenceSignals('c13',{solvent:'cdcl3'})[0],c=splitSignal(chl,100.6);assert.equal(c.length,3);assert.deepEqual(c.map(l=>l.y/c[0].y),[1,1,1]);assert.ok(Math.abs(lineSpacing(c[0].x,c[1].x,100.6)-32)<1e-9);
 const dmso=referenceSignals('c13',{solvent:'dmso'})[0],d=splitSignal(dmso,100);assert.equal(d.length,7);assert.deepEqual(d.map(l=>Math.round(l.y/d[0].y)),[1,3,6,7,6,3,1]);const h=splitSignal(referenceSignals('h1',{solvent:'dmso'})[0],400);assert.equal(h.length,5);assert.deepEqual(h.map(l=>Math.round(l.y/h[0].y)),[1,2,3,2,1]);assert.equal(referenceSignals('c13',{solvent:'d2o'}).length,0);assert.equal(referenceSignals('h1',{solvent:'none',water:true}).length,0);assert.equal(solventId('DMSO-d6'),'dmso');assert.equal(solventId('CDCl₃'),'cdcl3');assert.equal(solventId('chloroform / methanol'),'none');assert.equal(lineSpacing(1,2,0),null);
});
test('NMR guides preserve measured values and reported coupling; T exports carry origins',()=>{
 const context={window:{}};vm.runInNewContext(readFileSync(new URL('../dist/focus-data.js',import.meta.url),'utf8'),context);const f=context.window.focusSpectraData;
 const record={technique:'h1',kind:'curve',points:[[1,0],[1.001,2],[1.002,0],[1.0185,2],[1.0195,0]],yUnit:'intensity',xUnit:'ppm'},before=JSON.stringify(record),shown=view(record,{solvent:'cdcl3',frequency:400,solventPeaks:true});assert.deepEqual(shown.points,record.points);assert.equal(shown.referenceLines.length,0);assert.equal(shown.referenceSignals.length,1);assert.equal(JSON.stringify(record),before);assert.equal(f.detectPeaks(record).length,2);assert.deepEqual(csvView(record,shown).points,record.points);
 const positions=f.spectrumData({representation:'assigned-shifts',data:[{shift:1.2,atom:'H1',multiplicity:'t',couplingText:'7.0 Hz'}]},'h1'),pv=view(f.displayData(positions,'sticks'),{solvent:'dmso',frequency:400});const csv=f.csv(csvView(positions,pv));assert.ok(csv.includes('7.0 Hz'));assert.doesNotMatch(csv,/intensity/);
 const engine=createLogicEngine(rdkit);try{const d=buildSimulation(engine.profile('CCO'),buildNmrModel(rdkit,'CCO')),r=simulationRecord(d,'h1'),data=f.spectrumData(r,'h1'),v=view(data,{solvent:'dmso',frequency:400,coupling:true});assert.ok(v.nmrLines.length>2);assert.equal(v.referenceLines.length,5);assert.ok(f.csv(v).includes('solvent reference'));assert.ok(f.csv(v).includes('T compound'));assert.ok(f.chart(v).path.split('M').length-1===v.points.length);assert.ok(f.chart(v).yPosition(0)<300);assert.equal(r.metadata.format,'peaks');assert.equal(r.eligibleForMatching,false)}finally{engine.close()}
});
