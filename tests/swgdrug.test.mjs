import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32} from 'node:zlib';
import {openBank,compound} from '../lib/bank.mjs';
import {nameKey,formulaCounts,linkSwgdrug,swgdrugCatalogIndex,importSwgdrug} from '../lib/swgdrug.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));

// Minimal stored (uncompressed) ZIP writer for fixtures.
function zip(entries){
  const locals=[],centrals=[];let offset=0;
  for(const [name,data]of entries){
    const n=Buffer.from(name),crc=crc32(data),l=Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    locals.push(l,n,data);centrals.push(c,n);offset+=30+n.length+data.length;
  }
  const dir=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,dir,end]);
}
function jdx(title,molform,{xunits='1/CM',yunits='ABSORBANCE',type='INFRARED SPECTRUM'}={}){
  const rows=[];for(let x=4000;x>=650;x-=50){const y=[x,x-25].map(v=>(0.02+0.8*Math.exp(-(((v-1710)/15)**2))+0.5*Math.exp(-(((v-1270)/20)**2))).toFixed(4));rows.push(x+' '+y.join(' '))}
  return Buffer.from(['##TITLE='+title,'##JCAMP-DX=4.24','##DATA TYPE='+type,'##ORIGIN=DEA Special Testing and Research Laboratory','##OWNER=SWGDRUG',molform?'##MOLFORM='+molform:'','##SAMPLING PROCEDURE=ATR, diamond, 3-bounce','##RESOLUTION=4','##XUNITS='+xunits,'##YUNITS='+yunits,'##FIRSTX=4000','##LASTX=625','##XFACTOR=1','##YFACTOR=1','##NPOINTS='+rows.length*2,'##XYDATA=(X++(Y..Y))',...rows,'##END='].filter(Boolean).join('\r\n'));
}

test('SWGDRUG names normalise salts, rotation prefixes and "base"; formulas sum dot parts',()=>{
  assert.equal(nameKey('Cocaine HCl'),'cocaine hydrochloride');
  assert.equal(nameKey('(-)-Cocaine hydrochloride'),'cocaine hydrochloride');
  assert.equal(nameKey('Cocaine base'),'cocaine');
  assert.equal(nameKey('Cocaine'),'cocaine');
  assert.deepEqual(formulaCounts('C17H21NO4.HCl'),formulaCounts('C17H22ClNO4'));
  assert.deepEqual(formulaCounts('C 17 H 21 N O 4'),{C:17,H:21,N:1,O:4});
  const index=swgdrugCatalogIndex([{id:1,inchikey:'A',name:'Cocaine',formula:'C17H21NO4'},{id:2,inchikey:'B',name:'(-)-Cocaine hydrochloride',formula:'C17H22ClNO4'}]);
  assert.equal(linkSwgdrug({TITLE:'Cocaine HCl',MOLFORM:'C17H21NO4.HCl'},index).compound.id,2);
  assert.equal(linkSwgdrug({TITLE:'Cocaine base'},index).compound.id,1);
  assert.equal(linkSwgdrug({TITLE:'Cocaine',MOLFORM:'C17H22ClNO4'},index).compound,null,'formula disagreement blocks the link');
  assert.equal(linkSwgdrug({TITLE:'Coke sample 7'},index,new Map([[nameKey('Coke sample 7'),'Cocaine']])).compound.id,1,'manual override');
});

test('SWGDRUG JCAMP import links cocaine forms, keeps unlinked records searchable and is idempotent',async()=>{
  const tmp=await mkdtemp(path.join(tmpdir(),'swgdrug-')),dir=path.join(tmp,'data');
  try{
    const inner=zip([['more/Benzoylecgonine.jdx',jdx('Unobtainium-42','C9H8O4')]]);
    const archive=path.join(tmp,'SWGDRUG_IR_JCAMP.zip');
    await writeFile(archive,zip([['Cocaine HCl.jdx',jdx('Cocaine HCl','C17H21NO4.HCl')],['Cocaine base.jdx',jdx('Cocaine base','C 17 H 21 N O 4')],['Mislabelled.jdx',jdx('Cocaine','C9H8O4')],['NotIR.jdx',jdx('Some UV','',{type:'UV/VIS SPECTRUM',xunits:'NANOMETERS'})],['readme.txt',Buffer.from('ignored')],['nested.zip',inner]]));
    const db=openBank(dir,path.join(root,'catalog','identities.json'));
    try{
      const report=await importSwgdrug(db,dir,[archive]);
      assert.equal(report.counts.spectra,4);assert.equal(report.counts.skipped,1);assert.equal(report.counts.linked,2);
      const hcl=db.prepare("SELECT id FROM compounds WHERE inchikey='PIQVDUKEQYOJNR-VZXSFKIWSA-N'").get().id,base=db.prepare("SELECT id FROM compounds WHERE inchikey='ZPUCINDJVBIVPJ-LJISPDSOSA-N'").get().id;
      const hclExternal=compound(db,hcl).external.filter(e=>e.source_id==='swgdrug-ir');
      assert.equal(hclExternal.length,1);assert.equal(hclExternal[0].technique,'ftir');assert.equal(hclExternal[0].metadata.measurement,'ATR');assert.equal(hclExternal[0].metadata.eligibleForMatching,false);assert.match(hclExternal[0].metadata.identityLinkage,/formula agrees/);
      assert.equal(compound(db,base).external.filter(e=>e.source_id==='swgdrug-ir').length,1);
      const unlinked=db.prepare("SELECT name,metadata FROM external_evidence WHERE source_id='swgdrug-ir' AND compound_id IS NULL ORDER BY name").all();
      assert.deepEqual(unlinked.map(r=>r.name),['Cocaine','Unobtainium-42']);
      assert.match(JSON.parse(unlinked[0].metadata).identityLinkage,/differs from catalog/);
      const parsed=JSON.parse(db.prepare("SELECT parsed FROM external_evidence WHERE source_id='swgdrug-ir' AND compound_id=?").get(hcl).parsed);
      assert.ok(parsed.points.length>100&&parsed.range[0]<700&&parsed.range[1]>3900);
      assert.ok((await readdir(path.join(dir,'source-downloads','swgdrug-ir'))).some(f=>f.endsWith('.zip')),'original archive retained');
      // Quarantine survives a re-import; re-import does not duplicate.
      db.prepare("UPDATE external_evidence SET status='quarantined' WHERE source_id='swgdrug-ir' AND compound_id=?").run(base);
      await importSwgdrug(db,dir,[archive]);
      assert.equal(db.prepare("SELECT count(*) n FROM external_evidence WHERE source_id='swgdrug-ir'").get().n,4);
      assert.equal(db.prepare("SELECT status FROM external_evidence WHERE source_id='swgdrug-ir' AND compound_id=?").get(base).status,'quarantined');
    }finally{db.close()}
  }finally{await rm(tmp,{recursive:true,force:true})}
});
