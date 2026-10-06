import {mkdir,writeFile,readFile,rename,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'data','source-downloads');await mkdir(dir,{recursive:true});
const jobs=[
 ['uv-advisor-supplement.zip','https://ndownloader.figshare.com/files/31512017','UV-adVISor supplementary data / Figshare','CC BY 4.0'],
 ['chemotion-ir.tar','https://radar4chem.radar-service.eu/radar-backend/archives/OGoEQGlsZGElrgst/versions/1/content','Chemotion IR / RADAR4Chem','CC BY-SA 4.0'],
 ['npmrd-assignments.zip','https://np-mrd.org/system/downloads/current/assignment_tables.zip','NP-MRD','CC BY-NC 4.0'],
 ['npmrd-peaks.zip','https://np-mrd.org/system/downloads/current/peak_lists.zip','NP-MRD','CC BY-NC 4.0'],
 ['npmrd-metadata-00001-50000.zip','https://np-mrd.org/system/downloads/current/npmrd_natural_products_NP0000001_NP0050000_json.zip','NP-MRD','CC BY-NC 4.0'],
 ['irexp-resolved-commercial.jsonl.gz','https://huggingface.co/datasets/ilkhamfy/IRexp/resolve/main/data/irexp_resolved_commercial.jsonl.gz','IRexp','CC BY 4.0 packaging; per-record source license'],
 ['irexp-NOTICE.txt','https://huggingface.co/datasets/ilkhamfy/IRexp/resolve/main/NOTICE','IRexp','Source notice'],
 ['irexp-license-remediation.md','https://huggingface.co/datasets/ilkhamfy/IRexp/resolve/main/LICENCE_REMEDIATION.md','IRexp','Source notice']
];
for(const [filename,url,provider,license] of jobs){
 const output=path.join(dir,filename),meta=output+'.provenance.json';
 try{
  if(await stat(meta).catch(()=>null)){console.log('Cached',filename);continue;}
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('HTTP '+response.status);
  const length=Number(response.headers.get('content-length'));if(length>200000000)throw Error('Source exceeds 200 MB per-file safety limit');
  if(response.headers.get('content-type')?.includes('text/html'))throw Error('HTML response, not a data download');
  const temp=output+'.part';await pipeline(Readable.fromWeb(response.body),createWriteStream(temp,{flags:'w'}));await rename(temp,output);
  const bytes=await readFile(output);const sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(meta,JSON.stringify({filename,url,provider,license,retrievedAt:new Date().toISOString(),bytes:bytes.length,sha256,etag:response.headers.get('etag')},null,2));
  console.log('Downloaded',filename,bytes.length,'bytes',sha256);
 }catch(e){console.log('Not downloaded',filename,e.message);process.exitCode=1;}
}
