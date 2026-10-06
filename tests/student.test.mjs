import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {inspectSpectrum,parseSpectrum,compareSpectra} from '../lib/spectra.mjs';
import {interpretFtir,screenCatalog} from '../lib/interpret.mjs';
import {extractFigures} from '../lib/microscopy.mjs';
const meta={xUnit:'cm-1',yMode:'transmittance-percent',format:'continuous',yColumn:'1',phase:'solid',measurement:'ATR',solvent:'none'};
test('Multi-column instrument CSV requires explicit trace selection and preserves selected values',()=>{
 const raw=Buffer.from('Wavenumber_cm-1,Original_Transmittance_percent,Normalized_Transmittance_percent\n4000,91.2,98\n3000,86.1,92\n1000,52.8,30\n500,75.3,70\n');const info=inspectSpectrum(raw);assert.equal(info.traces.length,2);assert.equal(info.traces[1].normalized,true);
 assert.throws(()=>parseSpectrum(raw,'ftir',{...meta,yColumn:undefined}),/choose/i);const a=parseSpectrum(raw,'ftir',meta),b=parseSpectrum(raw,'ftir',{...meta,yColumn:'2'});assert.equal(a.points[0][1],75.3);assert.equal(b.points[0][1],70);assert.equal(a.selectedHeader,'Original_Transmittance_percent');assert.throws(()=>parseSpectrum(raw,'ftir',{...meta,yColumn:'99'}),/column/);
});
test('FTIR screening is tentative, skips CO2-region peaks and ranks only structural hypotheses',()=>{
 const points=Array.from({length:3601},(_,i)=>{const x=400+i,a=.02+Math.exp(-.5*((x-1720)/18)**2)*.7+Math.exp(-.5*((x-2350)/4)**2)*.9;return [x,100*10**-a]});const a=interpretFtir({metadata:meta,parsed:{points}});assert.ok(a.features.some(f=>f.id==='carbonyl'));assert.ok(a.peaks.find(p=>Math.abs(p.x-2350)<5)?.artifact);assert.equal(a.eligibleForMatching,false);
 const candidates=screenCatalog(a,[{id:1,name:'TEST carbonyl',profile:{functionalGroups:[{id:'carbonyl',siteCount:1}]}},{id:2,name:'TEST no carbonyl',profile:{functionalGroups:[{id:'aromatic',siteCount:6}]}}]);assert.equal(candidates[0].compound.id,1);assert.equal(candidates.length,1);assert.equal(candidates[0].eligibleForMatching,false);
 assert.throws(()=>interpretFtir({metadata:{...meta,yMode:'intensity'},parsed:{points}}),/absorbance/);
 assert.equal(compareSpectra({technique:'ftir',metadata:{...meta,phase:'unknown'},parsed:{points,range:[400,4000]}},{technique:'ftir',metadata:meta,parsed:{points,range:[400,4000]}}).eligible,false);
});
test('Plot padding, zoom, reversible measured preservation and T-only reproducible texture',()=>{
 const window={};vm.runInNewContext(readFileSync(new URL('../dist/focus-data.js',import.meta.url),'utf8'),{window});const f=window.focusSpectraData,d={kind:'curve',technique:'ftir',points:[[400,0],[500,1],[1000,.1]],yUnit:'absorbance'};const g=f.chart(d);assert.ok(g.yPosition(0)<290);assert.ok(g.yPosition(1)>65);assert.ok(g.lo<400&&g.hi>1000);assert.equal(f.instrumentTexture(d,true),d);
 const t={...d,isSimulated:true};const before=JSON.stringify(t),n=f.instrumentTexture(t,true);assert.notDeepEqual(n.points,t.points);assert.equal(JSON.stringify(t),before);assert.deepEqual(n,f.instrumentTexture(t,true));assert.equal(n.texture.eligibleForMatching,false);const z=f.chart({...d,viewRange:[400,550]});assert.ok(z.hi<600);assert.equal(f.chart({...d,viewRange:[600,700]}),null);const xrd={...d,technique:'xrd',xUnit:'2theta-deg'};assert.equal(f.chart(xrd).reverse,false);assert.equal(f.canAssignPeaks(xrd),false);
});
test('Microscopy extraction requires CC BY, excludes retractions and preserves sample captions',()=>{
 const article={pmcid:'PMC123',title:'TEST ONLY aspirin crystals',authors:'Test',year:'2026'},fig='<fig id="F1"><label>Figure 1</label><caption><p>SEM of a TEST formulation, not pure crystals.</p></caption><graphic><?image-cloudpmc-urn urn:cdn:blobs/abc/123/hash/test.jpg?></graphic></fig>',xml='<permissions><license>Creative Commons Attribution (CC-BY)</license></permissions>'+fig;
 const records=extractFigures(xml,article);assert.equal(records.length,1);assert.equal(records[0].exactIdentityVerified,false);assert.match(records[0].caption,/formulation/);assert.match(records[0].imageUrl,/cdn.ncbi.nlm.nih.gov/);assert.equal(extractFigures(fig,article).length,0);assert.equal(extractFigures(xml,{...article,title:'RETRACTED TEST'}).length,0);assert.equal(extractFigures(xml.replace('(CC-BY)','(CC-BY-NC)'),article).length,0);
 assert.equal(extractFigures(xml,{...article,queryName:'aspirin'}).length,0);
 const pct=xml.replace('a TEST formulation, not pure crystals','raw PCT and a TEST formulation').replace('<?image-cloudpmc-urn urn:cdn:blobs/abc/123/hash/test.jpg?>','<?cloudpmc-path blobs/abc/123/hash/test.jpg?><?cloudpmc-bucket cdn?>');assert.equal(extractFigures(pct,{...article,queryName:'acetaminophen'}).length,1);
});
