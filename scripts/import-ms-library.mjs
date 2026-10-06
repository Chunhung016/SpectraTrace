// Usage: npm run import:ms [-- path/to/library.zip|folder ...]
// Default: every .zip in sources/ms-libraries. Re-running updates records in place.
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {openBank} from '../lib/bank.mjs';
import {importMsLibraries} from '../lib/mslib-import.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=process.env.SPECTRATRACE_DATA_DIR||path.join(root,'data');
const paths=process.argv.slice(2);if(!paths.length)paths.push(path.join(root,'sources','ms-libraries'));
const db=openBank(dir,path.join(root,'catalog','identities.json'));
let rdkit=null;try{rdkit=await (await import('@rdkit/rdkit')).default()}catch{console.log('RDKit unavailable: library molfiles will not be converted to drawable structures.')}
try{
  const report=await importMsLibraries(db,dir,paths,{rdkit,log:console.log});
  await writeFile(path.join(root,'ms-library-import-report.json'),JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2));
  if(!report.libraries.length){console.log('No NIST MS Search library (USER.DBU) found in: '+paths.join(', '));process.exitCode=1}
}finally{db.close()}
