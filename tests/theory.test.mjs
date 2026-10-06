import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {theoreticalMs,theoreticalRaman,theoreticalFluorescence,theoryRecord} from '../lib/theory.mjs';
import {structureFromCif,powderPattern,parseSymop,patternLabels} from '../lib/cif-xrd.mjs';
import {parseMassBank} from '../lib/massbank.mjs';
import {hillSpaced,nameMatches,saveCalculatedPattern} from '../lib/cod.mjs';
import {openBank,compound} from '../lib/bank.mjs';
import {importMassBankBundle} from '../lib/mslib-import.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const aspirin={canonicalSmiles:'CC(=O)Oc1ccccc1C(=O)O',functionalGroups:[{id:'acid'},{id:'ester'},{id:'carbonyl'},{id:'aromatic'}],structure:{aromaticRings:1,carbonAtoms:9},h1:{atomEnvironments:[{environment:'Aromatic carbon-bound H',count:4}]},ftir:{regions:[{ruleId:'carbonyl-region',label:'C=O',broadRegionCm1:[1600,1900]},{ruleId:'unsaturation',label:'C=C / aromatic',broadRegionCm1:[1450,1700]},{ruleId:'acid-oh',label:'Acid O–H',broadRegionCm1:[2500,3600]}]}};
const nacl=`data_x\n_cell_length_a 5.6402\n_cell_length_b 5.6402\n_cell_length_c 5.6402\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_symmetry_equiv_pos_as_xyz\n'x,y,z'\n'x+1/2,y+1/2,z'\n'x+1/2,y,z+1/2'\n'x,y+1/2,z+1/2'\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nNa1 Na 0 0 0\nCl1 Cl 0.5 0.5 0.5\n`;

test('T mass spectrum follows textbook cleavages and keeps the molecular ion',()=>{
  const ms=theoreticalMs('C9H8O4',aspirin),mz=new Map(ms.points);
  for(const m of [180,163,138,120,43])assert.ok(mz.get(m)>100,'expected ion '+m);
  assert.equal(ms.ionLabels[138],'[M−CH₂=C=O]⁺·');assert.ok(!mz.has(105),'no benzoyl ion for a disubstituted ring');
  const toluene=theoreticalMs('C7H8',{canonicalSmiles:'Cc1ccccc1',functionalGroups:[{id:'aromatic'}],structure:{aromaticRings:1},h1:{atomEnvironments:[{environment:'Aromatic carbon-bound H',count:5}]}});
  assert.ok(new Map(toluene.points).get(91)>900);
  const r=theoryRecord('ms',ms,{name:'aspirin'});assert.equal(r.status,'theoretical');assert.equal(r.eligibleForMatching,false);assert.equal(r.metadata.format,'peaks');
});

test('T Raman and fluorescence apply activity and fluorophore rules',()=>{
  const raman=theoreticalRaman(aspirin),at=x=>raman.points.find(p=>p[0]===x)[1];
  assert.ok(at(1000)>at(3000),'ring breathing stronger than O–H region in Raman');
  const fl=theoreticalFluorescence(aspirin);assert.ok(fl.points.length>50);assert.ok(fl.excitationNm<fl.components[0].centre);
  assert.equal(theoreticalFluorescence({functionalGroups:[{id:'alcohol'}],structure:{aromaticRings:0}}).points,null);
});

test('Powder pattern from a CIF reproduces NaCl reflections',()=>{
  assert.deepEqual(parseSymop('-x+1/2,y,z').map(r=>[r.r,r.t]),[[[-1,0,0],.5],[[0,1,0],0],[[0,0,1],0]]);
  const s=structureFromCif(nacl);assert.equal(s.atoms.length,8);
  const p=powderPattern(s,{max:60}),strong=p.reflections.find(r=>r.intensity===100);
  assert.ok(Math.abs(strong.twoTheta-31.70)<.03);assert.deepEqual([...strong.hkl].map(Math.abs).sort(),[0,0,2]);
  assert.ok(p.reflections.some(r=>Math.abs(r.twoTheta-45.45)<.03&&r.intensity>40));
  assert.match(Object.values(patternLabels(p.reflections,2)).join(' '),/\(/);
});

test('Calculated patterns are stored as unreviewed, linked XRD evidence',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'st-xrd-')),db=openBank(dir,path.join(root,'catalog','identities.json'));
  try{const c=db.prepare('SELECT * FROM compounds LIMIT 1').get(),saved=await saveCalculatedPattern(db,dir,c,{cif:Buffer.from(nacl),source:'upload',matchKind:'user'});
    const e=compound(db,c.id).external.find(x=>x.technique==='xrd');assert.equal(e.id,saved.id);assert.equal(e.metadata.calculated,true);assert.equal(e.metadata.eligibleForMatching,false);}
  finally{db.close()}
  assert.equal(hillSpaced('C9H8O4'),'C9 H8 O4');assert.equal(hillSpaced('ClNa'),'Cl Na');
  assert.ok(nameMatches({chemname:'2-(acetyloxy)benzoic acid',commonname:'Aspirin'},['aspirin']));assert.ok(!nameMatches({chemname:'Caffeic acid'},['aspirin']));
});

test('MassBank records parse with identity, licence and peaks; bundle links by exact InChIKey',async()=>{
  const r=parseMassBank('ACCESSION: MSBNK-TEST-1\nRECORD_TITLE: TEST; EI-B; MS\nLICENSE: CC BY\nCH$NAME: Test\nCH$FORMULA: C2H6O\nCH$LINK: INCHIKEY LFQSCWFLJHTTHZ-UHFFFAOYSA-N\nAC$INSTRUMENT_TYPE: EI-B\nAC$MASS_SPECTROMETRY: MS_TYPE MS\nPK$PEAK: m/z int. rel.int.\n  31 100 999\n  45 50 500\n//\n');
  assert.equal(r.ionization,'EI');assert.equal(r.inchikey,'LFQSCWFLJHTTHZ-UHFFFAOYSA-N');assert.deepEqual(r.peaks,[[31,999],[45,500]]);
  if(!existsSync(path.join(root,'sources','massbank','massbank-subset.json.gz')))return;
  const dir=await mkdtemp(path.join(os.tmpdir(),'st-mb-')),db=openBank(dir,path.join(root,'catalog','identities.json'));
  try{const res=await importMassBankBundle(db,dir,root);assert.ok(res.records>10000);assert.ok(res.linked>1000);const row=db.prepare("SELECT * FROM external_evidence_extra WHERE source_id='massbank' AND compound_id IS NOT NULL LIMIT 1").get();assert.ok(row);assert.ok(JSON.parse(row.metadata).license);assert.equal(await importMassBankBundle(db,dir,root),null);}
  finally{db.close()}
});
