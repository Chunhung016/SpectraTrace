import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readZip,libraryFolders} from '../lib/zip.mjs';
import {parseLibrary,parseNameField} from '../lib/nistms.mjs';
import {parseJcamp,decodeLine,normalizeNistBlock} from '../lib/jcamp.mjs';
import {lookupNist,saveNistLookup,parseSpecies} from '../lib/nist-webbook.mjs';
import {openBank,compound} from '../lib/bank.mjs';
import {importMsLibraries} from '../lib/mslib-import.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const focus=()=>{const window={};vm.runInNewContext(readFileSync(new URL('../dist/focus-data.js',import.meta.url),'utf8'),{window});return window.focusSpectraData};

test('NIST MS Search libraries decode with validated peaks on the 0–999 scale',()=>{
  const zip=path.join(root,'sources','ms-libraries','EssOil.zip');if(!existsSync(zip))return;
  const [[,files]]=libraryFolders(readZip(readFileSync(zip))),lib=parseLibrary(files);
  assert.ok(lib.records.length>1000);assert.ok(lib.records.every(r=>Math.max(...r.peaks.map(p=>p[1]))<=999&&r.peaks.every((p,i)=>!i||p[0]>r.peaks[i-1][0])));
  const dha=lib.records.find(r=>/^Dihydroxyacetone/.test(r.rawName));assert.equal(dha.basePeak,31);
  const n=parseNameField('Schkuhrianol, 2TMS $$ $:2463543-07-7 $$ $:28VBEKBKFLJTUDLU-UHFFFAOYSA-N $$ $:29p=3598 $$ Schkuhrianol, diTMS ether');
  assert.equal(n.inchikey,'VBEKBKFLJTUDLU-UHFFFAOYSA-N');assert.equal(n.cas,'63543-07-7');assert.equal(n.identityStatus,'inchikey');
  assert.equal(parseNameField('F-10260;{D1-1025-D5-1036-H5-1035}-Eucalyptol? $$ $:291036.20').tentativeName,'Eucalyptol?');
});

test('Library import stays unlinked unless the InChIKey is exact',async()=>{
  const zip=path.join(root,'sources','ms-libraries','PedUrine.zip');if(!existsSync(zip))return;
  const dir=await mkdtemp(path.join(os.tmpdir(),'st-ms-')),db=openBank(dir,path.join(root,'catalog','identities.json'));
  try{const r=await importMsLibraries(db,dir,[zip]);assert.equal(r.libraries[0].imported,223);const row=db.prepare("SELECT * FROM all_external_evidence WHERE technique='ms' LIMIT 1").get();assert.equal(row.compound_id,null);assert.equal(JSON.parse(row.metadata).eligibleForMatching,false);
    await importMsLibraries(db,dir,[zip]);assert.equal(db.prepare('SELECT count(*) n FROM external_evidence_extra').get().n,223);}
  finally{db.close()}
});

test('JCAMP-DX decoding: AFFN, SQZ, DIF/DUP with checkpoints, peak tables and NIST units',()=>{
  assert.deepEqual(decodeLine('1000A B C C C C D E F').values,[1000,1,2,3,3,3,3,4,5,6]);
  assert.deepEqual(decodeLine('100@AJJJ%U JJ').values,[100,0,1,2,3,4,4,4,4,5,6]);
  const ir=parseJcamp('##TITLE=x\n##JCAMP-DX=4.24\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=MICROMETERS\n##YUNITS=TRANSMITTANCE\n##YFACTOR=0.01\n##FIRSTX=2.5\n##LASTX=3.0\n##NPOINTS=6\n##XYDATA=(X++(Y..Y))\n2.5A0JJ\n2.8A2JJJ\n##END=')[0];
  assert.equal(ir.points.length,6);const n=normalizeNistBlock(ir);assert.equal(n.xUnit,'cm-1');assert.equal(n.yMode,'transmittance-fraction');assert.ok(Math.abs(n.points.at(-1)[0]-4000)<1e-6);
  const ms=normalizeNistBlock(parseJcamp('##TITLE=m\n##DATA TYPE=MASS SPECTRUM\n##XUNITS=M/Z\n##YUNITS=RELATIVE ABUNDANCE\n##PEAK TABLE=(XY..XY)\n43,9999 58,1200\n71,3000\n##END=')[0]);
  assert.equal(ms.technique,'ms');assert.deepEqual(ms.points,[[43,9999],[58,1200],[71,3000]]);
  assert.throws(()=>parseJcamp('##TITLE=x\n##FIRSTX=1\n##LASTX=3\n##NPOINTS=3\n##XYDATA=(X++(Y..Y))\n1A0JJ\n2B0J\n##END='),/checkpoint/);
});

test('NIST WebBook lookup requires an exact InChIKey and stores originals as unreviewed evidence',async()=>{
  const key='UHOVQNZJYSORNB-UHFFFAOYSA-N',jdx='##TITLE=Benzene\n##JCAMP-DX=4.24\n##DATA TYPE=MASS SPECTRUM\n##OWNER=NIST Mass Spectrometry Data Center\n##CAS REGISTRY NO=71-43-2\n##XUNITS=M/Z\n##YUNITS=RELATIVE ABUNDANCE\n##PEAK TABLE=(XY..XY)\n51,1800 52,1900 77,1400 78,9999 79,680\n##END=';
  const pages={'/robots.txt':'User-agent: *\nDisallow: /cdn-cgi/\nCrawl-delay: 0\n',
    ['/cgi/cbook.cgi?InChI='+key+'&Units=SI']:'<html><h1>Benzene</h1><script type="application/ld+json">{"@type":"MolecularEntity","name":"Benzene","inChIKey":"'+key+'"}</script>CAS Registry Number: 71-43-2 <a href="/cgi/cbook.cgi?ID=C71432&amp;Units=SI&amp;Mask=200#Mass-Spec">Mass spectrum (electron ionization)</a></html>',
    '/cgi/cbook.cgi?ID=C71432&Units=SI&Mask=200':'<a href="/cgi/cbook.cgi?JCAMP=C71432&amp;Index=0&amp;Type=Mass">Download spectrum in JCAMP-DX format</a>',
    '/cgi/cbook.cgi?JCAMP=C71432&Index=0&Type=Mass':jdx};
  const get=async url=>{const u=new URL(url),body=pages[u.pathname+u.search];return body==null?null:Buffer.from(body)};
  const c={id:1,name:'benzene',inchikey:key,smiles:'c1ccccc1'};
  assert.equal((await lookupNist({...c,inchikey:'XXXXXXXXXXXXXX-UHFFFAOYSA-N'},{get})).status,'not-found');
  const r=await lookupNist(c,{get});assert.equal(r.status,'imported');assert.equal(r.spectra.length,1);assert.equal(r.spectra[0].technique,'ms');
  assert.equal(parseSpecies(pages['/cgi/cbook.cgi?InChI='+key+'&Units=SI'],'https://webbook.nist.gov/').id,'C71432');
  const dir=await mkdtemp(path.join(os.tmpdir(),'st-nist-')),db=openBank(dir,path.join(root,'catalog','identities.json'));
  try{const benzoic=db.prepare("SELECT * FROM compounds LIMIT 1").get(),saved=await saveNistLookup(db,dir,benzoic,r);assert.equal(saved.saved.length,1);const ev=compound(db,benzoic.id).external.find(e=>e.technique==='ms');assert.ok(ev);assert.equal(ev.metadata.eligibleForMatching,false);assert.match(ev.metadata.license,/NIST/);}
  finally{db.close()}
});

test('Printed-spectrum renderer, NMR lineshape and calculated isotope clusters',()=>{
  const f=focus();
  assert.equal(JSON.stringify(f.niceTicks(3,5,5).major),'[3,3.5,4,4.5,5]');
  const iso=f.isotopePattern('C10H18O');assert.equal(iso.points[0][0],154);assert.ok(Math.abs(iso.points[1][1]-11.06)<.2);
  const cl=f.isotopePattern('C6H4Cl2');assert.ok(Math.abs(cl.points.find(p=>p[0]===148)[1]-64)<1.5);assert.equal(f.isotopePattern('C9H8O4.HCl'),null);
  const lines={technique:'h1',kind:'peaks',points:[[1.2,1],[3.6,.5]],nmrLines:[{x:1.2,y:1},{x:3.6,y:.5}],xUnit:'ppm',yUnit:'Illustrative relative intensity'},ls=f.lineshape(lines,{fwhmHz:1,frequency:400});
  assert.equal(ls.kind,'curve');assert.ok(Math.abs(Math.max(...ls.points.map(p=>p[1]))-1)<.01);assert.equal(ls.nmrLines.length,2);
  const svg=f.svg({technique:'ftir',kind:'curve',xUnit:'cm-1',yUnit:'transmittance-fraction',points:[[500,.9],[1700,.2],[3000,.8]]},{title:['TEST','INFRARED SPECTRUM'],markers:[{x:1700,on:true,label:'1700'}]});
  assert.match(svg,/INFRARED SPECTRUM/);assert.match(svg,/TRANSMITTANCE/);assert.match(svg,/data-peak="1700"/);assert.match(svg,/#e8352e/);
  const ms=f.displayData({technique:'ms',kind:'peaks',points:[[31,999],[42,237]],yUnit:'relative-abundance'});assert.equal(ms.points[0][1],100);assert.equal(ms.yUnit,'Relative abundance (%)');
});
