import test from 'node:test';
import assert from 'node:assert/strict';
import {describeFetchError} from '../lib/net.mjs';
import {parseJcamp,normalizeNistBlock} from '../lib/jcamp.mjs';
import {lookupNist} from '../lib/nist-webbook.mjs';
import {simulationRecord} from '../lib/simulation.mjs';

test('Network failures name the real cause instead of "fetch failed"',()=>{
  const e=new TypeError('fetch failed');e.cause=Object.assign(Error('unable to verify the first certificate'),{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'});
  assert.match(describeFetchError(e,'crystallography.net (COD)'),/UNABLE_TO_VERIFY_LEAF_SIGNATURE.*certificate/);
  const d=new TypeError('fetch failed');d.cause=Object.assign(Error('getaddrinfo ENOTFOUND x'),{code:'ENOTFOUND'});assert.match(describeFetchError(d,'x'),/DNS/);
});

test('NIST UV "Wavelength (nm)" is accepted and scanned-image-only IR is skipped quietly',async()=>{
  const uv=normalizeNistBlock(parseJcamp('##TITLE=Aspirin\n##DATA TYPE=UV/VIS SPECTRUM\n##XUNITS=Wavelength (nm)\n##YUNITS=Logarithm epsilon\n##NPOINTS=3\n##XYPOINTS=(XY..XY)\n211.87,3.972\n212.88,3.948\n213.90,3.924\n##END=')[0]);
  assert.equal(uv.xUnit,'nm');assert.equal(uv.yMode,'log-epsilon');
  const key='BSYNRYMUTXBXSQ-UHFFFAOYSA-N',scan='##TITLE=2-(acetyloxy)benzoic acid\n##JCAMP-DX=4.24\n##DATA TYPE=INFRARED SPECTRUM\n##$NIST IMAGE=cob2250\n##DATA PROCESSING=(NO SPECTRUM, ONLY SCANNED IMAGE IS AVAILABLE)\n##NPOINTS=0\n##END=\n';
  const pages={'/robots.txt':'User-agent: *\nDisallow: /cdn-cgi/\n',['/cgi/cbook.cgi?InChI='+key+'&Units=SI']:'<script type="application/ld+json">{"@type":"MolecularEntity","name":"Aspirin","inChIKey":"'+key+'"}</script>CAS Registry Number: 50-78-2 <a href="/cgi/cbook.cgi?ID=C50782&amp;Units=SI&amp;Mask=80#IR-Spec">IR Spectrum</a>','/cgi/cbook.cgi?ID=C50782&Units=SI&Mask=80':'<a href="/cgi/cbook.cgi?JCAMP=C50782&amp;Index=0&amp;Type=IR">Download</a>','/cgi/cbook.cgi?JCAMP=C50782&Index=0&Type=IR':scan};
  const r=await lookupNist({id:1,name:'aspirin',inchikey:key},{get:async url=>{const u=new URL(url),b=pages[u.pathname+u.search];return b==null?null:Buffer.from(b)}});
  assert.equal(r.errors.length,0);assert.equal(r.skipped.length,1);assert.match(r.skipped[0].imageUrl,/Scan=cob2250/);
});

test('Theory spectra are labelled Absorbance / Intensity, never "illustrative"',()=>{
  const old={version:'illustrative-envelope-v2-nmr1',limitations:['Rule-based illustrative envelopes only.'],spectra:{uv:{grid:{start:200,end:202,step:1,xUnit:'nm'},yUnit:'relative illustrative envelope',components:[{label:'Illustrative aromatic motif window'}],y:[0,1,0]}}};
  const r=simulationRecord(old,'uv');assert.match(r.metadata.yMode,/^absorbance$/i);assert.doesNotMatch(JSON.stringify([r.metadata,r.limitations,r.simulation.components]),/illustrat/i);
});
