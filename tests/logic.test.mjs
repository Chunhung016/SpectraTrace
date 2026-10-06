import test from 'node:test';
import assert from 'node:assert/strict';
import initRDKit from '@rdkit/rdkit';
import {createLogicEngine} from '../lib/logic.mjs';
const rdkit=await initRDKit(),engine=createLogicEngine(rdkit);
test('Rule-derived profiles reflect structure, not invented measured data',()=>{
 const aspirin=engine.profile('CC(=O)Oc1ccccc1C(=O)O'),ids=aspirin.functionalGroups.map(g=>g.id);
 assert.ok(ids.includes('acid'));assert.ok(ids.includes('ester'));assert.ok(!ids.includes('alcohol'));assert.ok(!ids.includes('ether'));assert.ok(!ids.includes('amide'));
 assert.equal(aspirin.structure.carbonAtoms,9);assert.equal(aspirin.structure.carbonBoundHydrogens,7);assert.equal(aspirin.structure.exchangeSensitiveHydrogens,1);assert.equal(aspirin.c13.atomEnvironments.length,9);
 assert.equal(aspirin.eligibleForMatching,false);assert.equal(aspirin.ftir.fullSpectrum,null);assert.equal(aspirin.uv.lambdaMaxNm,null);assert.equal(aspirin.h1.splitting,null);assert.equal(aspirin.c13.resonanceCount,null);assert.ok(aspirin.ftir.regions.every(r=>r.exactPeak===null&&r.intensity===null));
 const benzene=engine.profile('c1ccccc1');assert.equal(benzene.structure.carbonAtoms,6);assert.equal(benzene.structure.carbonBoundHydrogens,6);assert.equal(benzene.c13.resonanceCount,null); // six carbons ≠ six observed resonances
 const amide=engine.profile('CC(=O)N(C)C');assert.ok(amide.functionalGroups.some(g=>g.id==='amide'));assert.ok(!amide.functionalGroups.some(g=>g.id==='amine'));assert.ok(!amide.ftir.regions.some(r=>r.ruleId==='neutral-nh'));
 const carboxylate=engine.profile('CC(=O)[O-]');assert.ok(carboxylate.functionalGroups.some(g=>g.id==='carboxylate'));assert.ok(!carboxylate.ftir.regions.some(r=>r.ruleId==='acid-oh'));assert.ok(carboxylate.warnings.some(w=>w.includes('Charged')));
 assert.equal(engine.profile('not a molecule').status,'unresolved-structure');
});
test.after(()=>engine.close());
