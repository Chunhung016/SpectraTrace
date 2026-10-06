// Maintainer script: node scripts/build-massbank-bundle.mjs path/to/MassBank-data
// Writes sources/massbank/massbank-subset.json.gz:
//  - every EI mass spectrum in MassBank (searchable by name/InChIKey), and
//  - for catalog compounds, up to two LC-MS/MS spectra per ion mode (collision energy nearest 30).
// No-derivatives (ND) licences are excluded; each row keeps its own licence and authors.
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMassBank,bundleRow,MASSBANK_VERSION} from '../lib/massbank.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=process.argv[2];
if(!source){console.log('Usage: node scripts/build-massbank-bundle.mjs path/to/MassBank-data');process.exit(1)}
const catalog=new Set(JSON.parse(await readFile(path.join(root,'catalog','identities.json'),'utf8')).entries.map(e=>e.inchikey));
const ei=[],tandem=new Map();let scanned=0;
async function* walk(d){for(const e of await readdir(d,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const p=path.join(d,e.name);if(e.isDirectory())yield* walk(p);else if(e.name.endsWith('.txt'))yield p}}
const ceValue=s=>{const m=String(s||'').match(/(\d+(?:\.\d+)?)/);return m?Number(m[1]):null};
for await(const file of walk(source)){
  const r=parseMassBank(await readFile(file,'utf8'));scanned++;
  if(!r.accession||!r.peaks.length||!r.inchikey||/ND/.test(r.license||''))continue;
  if(r.ionization==='EI'&&(r.ac.MS_TYPE||'MS')==='MS'){ei.push(bundleRow(r));continue}
  if(!catalog.has(r.inchikey)||!/MS2/.test(r.ac.MS_TYPE||''))continue;
  const key=r.inchikey+'|'+(r.ac.ION_MODE||''),list=tandem.get(key)||[];list.push(r);tandem.set(key,list);
}
const picked=[];
for(const list of tandem.values()){
  list.sort((a,b)=>{const pa=/\[M[+-]H\][+-]/.test(a.ms.PRECURSOR_TYPE||'')?0:1,pb=/\[M[+-]H\][+-]/.test(b.ms.PRECURSOR_TYPE||'')?0:1;const ca=ceValue(a.ac.COLLISION_ENERGY),cb=ceValue(b.ac.COLLISION_ENERGY);return pa-pb||Math.abs((ca??60)-30)-Math.abs((cb??60)-30)||a.accession.localeCompare(b.accession)});
  picked.push(...list.slice(0,2).map(bundleRow));
}
const rows=[...ei,...picked].sort((a,b)=>a.accession.localeCompare(b.accession));
const json=JSON.stringify({version:MASSBANK_VERSION,source:'https://github.com/MassBank/MassBank-data',builtAt:new Date().toISOString(),selection:'All EI-MS records; up to two MS2 records per catalog compound and ion mode (precursor [M±H], collision energy nearest 30). ND licences excluded.',licenseNote:'Each record keeps its MassBank licence (CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, dl-de/by-2-0). ShareAlike/NonCommercial terms apply to those records.',records:rows});
const gz=gzipSync(json,{level:9});await mkdir(path.join(root,'sources','massbank'),{recursive:true});
await writeFile(path.join(root,'sources','massbank','massbank-subset.json.gz'),gz);
console.log(`Scanned ${scanned} records; bundled ${ei.length} EI-MS + ${picked.length} catalog MS/MS (${new Set(picked.map(r=>r.inchikey)).size} compounds); ${(gz.length/1e6).toFixed(1)} MB; sha256 ${createHash('sha256').update(gz).digest('hex')}`);
