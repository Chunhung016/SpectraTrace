import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNistPage,collectionSpecies,decodeNistJcamp,nistUrl,htmlText,duplicateCanonical,linkNistIdentity} from '../lib/nist.mjs';

const entity={'@type':'MolecularEntity',name:'TEST ONLY Benzoic acid',inChIKey:'WPYMKLBDIGXBTP-UHFFFAOYSA-N',inChI:'InChI=1S/C7H6O2/c8-7(9)6-4-2-1-3-5-6/h1-5H,(H,8,9)',molecularFormula:'C7H6O2'};
const page=(owner='Public domain')=>`<title>TEST fixture</title><script type="application/ld+json">${JSON.stringify(entity)}</script><p>CAS Registry Number: 65-85-0</p><table><tr><th>Owner</th><td>${owner}</td></tr><tr><th>State</th><td>solid</td></tr><tr><th>Instrument</th><td>TEST fixture, not experimental</td></tr></table><a href="/cgi/cbook.cgi?JCAMP=C65850&amp;Index=5&amp;Type=IR">spectrum</a><a href="/chemistry/silmarils-solids-hrf-drf/docs/test.pdf">Detailed documentation</a>`;
const block=(owner='Public domain',unit='Reflectance',label='Hemispherical (Total) reflectance')=>`##TITLE=TEST ONLY — NOT RESEARCH DATA
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##OWNER=${owner}
##CAS REGISTRY NO=65-85-0
##XUNITS=1/cm
##YUNITS=${unit}
##YLABEL=${label}
##XFACTOR=1
##YFACTOR=1
##FIRSTX=400
##LASTX=440
##FIRSTY=0.1
##NPOINTS=5
##XYDATA=(X++(Y..Y))
400 0.1 0.2 0.3 0.2 0.1
##END=
`;

test('NIST page extraction requires explicit individual ownership and structured identity',()=>{
 const p=parseNistPage(page(),'https://webbook.nist.gov/cgi/cbook.cgi?ID=C65850&Type=IR-SPEC&Index=5');assert.equal(p.publicDomain,true);assert.equal(p.inchikey,entity.inChIKey);assert.equal(p.cas,'65-85-0');assert.equal(p.conditions.State,'solid');assert.equal(p.downloadUrl,'https://webbook.nist.gov/cgi/cbook.cgi?JCAMP=C65850&Index=5&Type=IR');assert.equal(p.documentation.length,1);
 assert.equal(parseNistPage(page('COBLENTZ SOC.'),'https://webbook.nist.gov/').publicDomain,false);
 assert.equal(parseNistPage(page('Not public domain'),'https://webbook.nist.gov/').publicDomain,false);
 assert.throws(()=>nistUrl('https://evil.example/download'),/Only advertised/);assert.throws(()=>nistUrl('/cdn-cgi/challenge'),/Only advertised/);
 assert.equal(htmlText('solid &amp; liquid &plusmn; 0.4 &times; 2'),'solid & liquid ± 0.4 × 2');
 const index='<a href="/cgi/cbook.cgi?Contrib=IARPA-IR-S&amp;ID=C65850&amp;Mask=80">Benzoic acid</a><a href="/cgi/cbook.cgi?Contrib=IARPA-IR-S&amp;ID=C65850&amp;Mask=80">duplicate</a><a href="/cgi/cbook.cgi?ID=C50782&amp;Mask=80">Unlicensed collection</a>';
 assert.equal(collectionSpecies(index,'https://webbook.nist.gov/').length,1);
});

test('NIST decoding checks ownership/CAS for every block and preserves physical values',()=>{
 const spectra=decodeNistJcamp(Buffer.from(block()+block('Public domain','Reflectance','Diffuse-only reflectance')),'65-85-0');assert.equal(spectra.length,2);assert.equal(spectra[0].measurementType,'reflectance');assert.equal(spectra[1].yUnit,'Diffuse-only reflectance');assert.deepEqual(spectra[0].parsed.points,[[400,.1],[410,.2],[420,.3],[430,.2],[440,.1]]);
 assert.throws(()=>decodeNistJcamp(Buffer.from(block()+block('Copyright NIST')),'65-85-0'),/explicitly public domain/);
 assert.throws(()=>decodeNistJcamp(Buffer.from(block()),'50-78-2'),/CAS/);
 assert.throws(()=>decodeNistJcamp(Buffer.from('<html>Error page</html>'),'65-85-0'),/Not a JCAMP/);
 assert.throws(()=>decodeNistJcamp(Buffer.from(block('Public domain','Unknown','Unknown')),'65-85-0'),/Unrecognized physical/);
 assert.throws(()=>decodeNistJcamp(Buffer.from(block('Public domain','Absorption coefficient','Absorption coefficient (cm-1)')),'65-85-0'),/Unrecognized physical/);
 assert.throws(()=>decodeNistJcamp(Buffer.from(block().replace('##NPOINTS=5','##NPOINTS=6')),'65-85-0'),/NPOINTS/);
});

test('Exact structure identity and stable duplicate canonical survive reruns',()=>{
 const p=parseNistPage(page(),'https://webbook.nist.gov/'),compound={id:1,inchikey:entity.inChIKey},catalog=new Map([[entity.inChIKey,compound]]);
 assert.strictEqual(linkNistIdentity(p,catalog,entity.inChIKey),compound);assert.equal(linkNistIdentity(p,catalog,'OTHERKEY-UHFFFAOYSA-N'),null);
 assert.equal(linkNistIdentity({...p,inchi:null},catalog,entity.inChIKey),null);
 assert.equal(duplicateCanonical(['b','a']),'a');assert.equal(duplicateCanonical(['a','b','a']),'a');assert.equal(duplicateCanonical([]),null);
});
