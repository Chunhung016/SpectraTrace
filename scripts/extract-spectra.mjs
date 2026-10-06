import {mkdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sources=path.join(root,'data','source-downloads');
async function run(args){return new Promise((resolve,reject)=>{const p=spawn('tar',args,{windowsHide:true});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',n=>n===0?resolve(out):reject(Error(err)))})}
async function extract(archive,name){const target=path.join(sources,'extracted',name);await mkdir(target,{recursive:true});const listing=(await run(['-tf',archive])).trim().split(/\r?\n/);for(const entry of listing){const normalized=entry.replace(/\\/g,'/');if(normalized.startsWith('/')||normalized.split('/').includes('..')||/^[A-Za-z]:/.test(normalized))throw Error('Unsafe archive path: '+entry);const resolved=path.resolve(target,entry);if(resolved!==target&&!resolved.startsWith(target+path.sep))throw Error('Archive escapes target')}
 const verbose=await run(['-tvf',archive]);if(verbose.split(/\r?\n/).some(l=>/^[lh]/.test(l)))throw Error('Archive contains links; review before extraction');await run(['-xf',archive,'-C',target]);console.log(name,listing.length,'archive entries extracted');return target;}
for(const [file,name]of [['uv-advisor-supplement.zip','uv-advisor'],['npmrd-assignments.zip','npmrd-assignments'],['npmrd-peaks.zip','npmrd-peaks'],['npmrd-metadata-00001-50000.zip','npmrd-metadata'],['chemotion-ir.tar','chemotion-ir']]){
 const archive=path.join(sources,file);if(!await stat(archive).catch(()=>null))continue;const target=await extract(archive,name);
 if(name==='chemotion-ir')await extract(path.join(target,'10.22000-OGoEQGlsZGElrgst','data','dataset','JCAMP-DX Files','IR_data.tar.xz'),'chemotion-jdx');
}
