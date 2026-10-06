import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import initRDKit from '@rdkit/rdkit';
import {openBank} from '../lib/bank.mjs';
import {NIST_ORIGIN,nistCollections,nistUrl,collectionSpecies,parseNistPage,decodeNistJcamp,duplicateCanonical,linkNistIdentity} from '../lib/nist.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=process.env.SPECTRATRACE_DATA_DIR||path.join(root,'data'),downloads=path.join(dir,'source-downloads','nist-public-domain');
await mkdir(downloads,{recursive:true});
const db=openBank(dir,path.join(root,'catalog','identities.json')),hash=x=>createHash('sha256').update(x).digest('hex');
const rdkit=await initRDKit();
const catalog=new Map(db.prepare('SELECT * FROM compounds').all().map(c=>[c.inchikey,c]));
const names=new Set([...catalog.values()].map(c=>nameKey(c.name)));
// Candidate-discovery aliases only; the page InChIKey must still match exactly.
const aliases=new Map([['4-Acetamidophenol','RZVAJINKPMORJF-UHFFFAOYSA-N'],['beta-Estradiol','VOXZDWNPVJITMN-ZBRFXRBCSA-N']].filter(([,key])=>catalog.has(key)).map(([name,key])=>[nameKey(name),key]));
const args=process.argv.slice(2),only=args.find(a=>a.startsWith('--compound='))?.slice(11)?.toLowerCase(),reportPath=path.join(root,'nist-import-report.json');
const report={startedAt:new Date().toISOString(),scope:'Explicitly public-domain PNNL files for exact-linked starter catalog identities only; no whole-WebBook mirror.',policy:{eligibleForMatching:false,rights:'Individual page and every JCAMP block must say Public domain. WebBook compilation copyright is not waived.',robotsUrl:NIST_ORIGIN+'/robots.txt',aiTraining:false},collections:[],imported:[],skipped:[],errors:[]};
let nextRequest=0,crawlDelay=5000;
function nameKey(s){return String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'')}
async function fetchBytes(url){url=nistUrl(url);const delay=Math.max(0,nextRequest-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));nextRequest=Date.now()+crawlDelay;const r=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:'error',headers:{'User-Agent':'SpectraTrace-local-research-reference-import/1.0'}});if(!r.ok){const e=Error('HTTP '+r.status+' '+url);e.stop=r.status===429||r.status===503;throw e}const b=Buffer.from(await r.arrayBuffer());if(b.length>10000000)throw Error('Source exceeds 10 MB limit');return {bytes:b,url,retrievedAt:new Date().toISOString(),sha256:hash(b),contentType:r.headers.get('content-type')}}
async function saveReport(){report.finishedAt=new Date().toISOString();report.counts={files:new Set(report.imported.map(r=>r.sha256)).size,spectralRecords:report.imported.length,linkedIdentities:new Set(report.imported.map(r=>r.compoundId)).size,skipped:report.skipped.length,errors:report.errors.length};await writeFile(reportPath,JSON.stringify(report,null,2))}
async function page(url){const key=hash(nistUrl(url)).slice(0,24),cache=path.join(downloads,key+'.page.json');try{const p=JSON.parse(await readFile(cache,'utf8'));if(p.sourceUrl!==nistUrl(url))throw Error('Cache URL mismatch');return p}catch(e){if(e.code!=='ENOENT')throw e}const r=await fetchBytes(url),p={...parseNistPage(r.bytes.toString('utf8'),url),retrievedAt:r.retrievedAt,pageSha256:r.sha256};await writeFile(cache,JSON.stringify(p,null,2),{flag:'wx'});return p}
// A refresh must never undo an explicit quarantine decision or its metadata.
const put=db.prepare("INSERT INTO external_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,parsed=excluded.parsed WHERE external_evidence.status!='quarantined'");
try{
 const robots=await fetchBytes(NIST_ORIGIN+'/robots.txt'),robotText=robots.bytes.toString('utf8');
 if(!/^User-agent:\s*\*/im.test(robotText)||/^Disallow:\s*(?:\/|\/cgi\/?|\/cgi\/cbook\.cgi)\s*$/im.test(robotText))throw Error('Robots policy does not allow this import');
 crawlDelay=Math.max(5000,Number(robotText.match(/^Crawl-delay:\s*(\d+(?:\.\d+)?)/im)?.[1]||5)*1000);report.policy.crawlDelayMs=crawlDelay;report.policy.robotsSha256=robots.sha256;
 for(const source of nistCollections){
  const indexCache=path.join(downloads,source.id+'.index.json');let index;
  try{index=JSON.parse(await readFile(indexCache,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;const fetched=await fetchBytes(source.url);index={url:source.url,retrievedAt:fetched.retrievedAt,sha256:fetched.sha256,species:collectionSpecies(fetched.bytes.toString('utf8'),source.url)};await writeFile(indexCache,JSON.stringify(index,null,2),{flag:'wx'})}
  const candidates=index.species.filter(s=>(names.has(nameKey(s.label))||aliases.has(nameKey(s.label)))&&(!only||nameKey(s.label).includes(nameKey(only))));
  report.collections.push({sourceId:source.id,indexUrl:source.url,discoveredSpecies:index.species.length,candidateSpecies:candidates.length,discovery:'Normalized exact catalog names plus two explicit discovery aliases; spectra only linked by exact InChIKey. Name-discovery may miss other synonyms.'});
  db.prepare('INSERT OR IGNORE INTO external_sources VALUES(?,?,?,?,?)').run(source.id,source.title,source.url,'Public domain individual PNNL files; NIST WebBook compilation copyright retained',JSON.stringify({citation:source.citation,notes:'Public-domain ownership checked per page and original JCAMP block. Conditions/physical quantities preserved. Imported and unreviewed, excluded from matching. Not all IR records are absorbance or transmittance.',archives:[index]}));
  console.log(source.id+': '+candidates.length+' catalog-name candidates of '+index.species.length+' source species');
  for(const candidate of candidates){
   try{
    const listing=await page(candidate.url),c=linkNistIdentity(listing,catalog,rdkit.get_inchikey_for_inchi(listing.inchi||''));
    if(!c){report.skipped.push({name:candidate.label,url:candidate.url,reason:'No exact catalog InChIKey match',inchikey:listing.inchikey});continue}
    const pages=listing.downloadUrl?[listing.sourceUrl]:listing.spectra.map(s=>s.url);
    if(!pages.length){report.skipped.push({name:c.name,url:candidate.url,reason:'No advertised IR spectrum pages'});continue}
    const seenFiles=new Set();
    for(const url of pages){
     const p=url===listing.sourceUrl?listing:await page(url);
     if(!p.publicDomain||!p.downloadUrl){report.skipped.push({name:c.name,url,reason:!p.publicDomain?'Owner is not explicitly Public domain':'No advertised JCAMP download'});continue}
     if(!linkNistIdentity(p,catalog,rdkit.get_inchikey_for_inchi(p.inchi||''))||p.inchikey!==c.inchikey){report.skipped.push({name:c.name,url,reason:'Spectrum page identity mismatch'});continue}
     if(seenFiles.has(p.downloadUrl))continue;seenFiles.add(p.downloadUrl);
     const filename=hash(p.downloadUrl).slice(0,24)+'.jdx',file=path.join(downloads,filename),provenanceFile=file+'.provenance.json';let original,provenance;
     if(await stat(provenanceFile).catch(()=>null)){original=await readFile(file);provenance=JSON.parse(await readFile(provenanceFile,'utf8'));if(hash(original)!==provenance.sha256||provenance.url!==p.downloadUrl)throw Error('Cached original checksum/URL mismatch')}
     else{const r=await fetchBytes(p.downloadUrl);original=r.bytes;decodeNistJcamp(original,p.cas);provenance={...r,bytes:r.bytes.length,owner:p.owner,rightsBasis:'Individual page and JCAMP OWNER explicitly Public domain',spectrumPage:p.sourceUrl,pageSha256:p.pageSha256};await writeFile(file,original,{flag:'wx'});await writeFile(provenanceFile,JSON.stringify(provenance,null,2),{flag:'wx'})}
     const decoded=decodeNistJcamp(original,p.cas);
     db.exec('BEGIN IMMEDIATE');try{
      for(const record of decoded){const sourceRecord=p.downloadUrl+'#block='+record.blockIndex+'&spectrum='+record.spectrumIndex,id=hash(source.id+'|'+sourceRecord).slice(0,32),traceHash=hash(JSON.stringify([c.inchikey,record.yUnit,record.parsed.points])),peers=db.prepare("SELECT id,metadata,status FROM external_evidence WHERE source_id=? AND json_extract(metadata,'$.traceHash')=?").all(source.id,traceHash),canonical=duplicateCanonical([id,...peers.map(e=>e.id)]),duplicateOf=id===canonical?null:canonical;
       if(db.prepare('SELECT status FROM external_evidence WHERE id=?').get(id)?.status==='quarantined'){report.skipped.push({name:c.name,url,reason:'Existing record is quarantined; no overwrite',id});continue}
       const metadata={sourceLabel:'NIST · PNNL · '+record.yUnit,owner:p.owner,license:'Public domain (individual spectrum)',compilationRights:'NIST SRD 69 compilation copyrighted; this is a selective individual-data import, not a database mirror',cas:p.cas,sourceName:p.name,identityLinkage:'Exact full InChIKey; page InChI independently hashed with RDKit; original JCAMP CAS matches page',sourceUrl:p.sourceUrl,downloadUrl:p.downloadUrl,citation:source.citation,nistCitation:'NIST Chemistry WebBook, SRD 69, https://doi.org/10.18434/T4D303',documentation:p.documentation,conditions:p.conditions,phase:p.conditions.State||record.header.STATE,instrument:p.conditions.Instrument||record.header['SPECTROMETER/DATASYSTEM'],resolution:p.conditions['Spectral resolution']||p.conditions['Instrument resolution']||p.conditions.Resolution,date:p.conditions.Date||record.header.DATE,xUnit:'cm-1',yMode:record.yUnit,originalYUnit:record.originalYUnit,measurementType:record.measurementType,format:'continuous',processing:'JCAMP decoded with jcampconverter 9.0.0; source point values and physical quantities retained; no normalization, resampling, absorbance conversion or synthetic peaks',header:record.header,converterLogs:record.converterLogs,retrievedAt:provenance.retrievedAt,pageRetrievedAt:p.retrievedAt,pageSha256:p.pageSha256,blockIndex:record.blockIndex,spectrumIndex:record.spectrumIndex,eligibleForMatching:false,review:'Imported public-domain reference; not independently reviewed, excluded from unknown-compound matching',traceHash,duplicateOf};
       put.run(id,source.id,sourceRecord,c.id,c.name,c.inchikey,c.smiles,'ftir','continuous','imported',p.sourceUrl,path.relative(dir,file),filename,provenance.sha256,JSON.stringify(metadata),JSON.stringify(record.parsed),null);
       for(const peer of peers){if(peer.id===id||peer.status==='quarantined')continue;const prior=JSON.parse(peer.metadata);prior.duplicateOf=peer.id===canonical?null:canonical;db.prepare('UPDATE external_evidence SET metadata=? WHERE id=?').run(JSON.stringify(prior),peer.id)}
       report.imported.push({id,sourceId:source.id,compoundId:c.id,name:c.name,inchikey:c.inchikey,measurementType:record.measurementType,yUnit:record.yUnit,points:record.parsed.points.length,range:record.parsed.range,url:p.sourceUrl,downloadUrl:p.downloadUrl,sha256:provenance.sha256,duplicateOf});
      }db.exec('COMMIT');
     }catch(e){db.exec('ROLLBACK');throw e}
     console.log('Imported '+c.name+': '+decoded.length+' measured reference traces ('+decoded.map(r=>r.yUnit).join(', ')+')');await saveReport();
    }
   }catch(e){report.errors.push({name:candidate.label,url:candidate.url,error:e.message});console.log('Not imported '+candidate.label+': '+e.message);if(e.stop)throw e}
  }
 }
}catch(e){report.errors.push({error:e.message});process.exitCode=1}
finally{await saveReport();db.close();console.log(JSON.stringify(report.counts,null,2));console.log('Report: '+reportPath)}
