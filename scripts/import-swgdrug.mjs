// npm run import:swgdrug -- path/to/SWGDRUG_IR_Library_JCAMP.zip [more files or folders]
//   --link="SWGDRUG title=Catalog name"   force a link when names differ (repeatable)
// Imports the user-downloaded SWGDRUG Infrared Library (JCAMP-DX). Run while the server is stopped.
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openBank} from '../lib/bank.mjs';
import {importSwgdrug,nameKey} from '../lib/swgdrug.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=path.resolve(process.env.SPECTRATRACE_DATA_DIR||path.join(root,'data'));
const args=process.argv.slice(2),files=args.filter(a=>!a.startsWith('--'));
const overrides=new Map(args.filter(a=>a.startsWith('--link=')).map(a=>a.slice(7).split('=')).filter(p=>p.length===2).map(([from,to])=>[nameKey(from),to.trim()]));
if(!files.length){console.error('Usage: npm run import:swgdrug -- <SWGDRUG JCAMP zip, .jdx file or folder> [--link="Title=Catalog name"]\nDownload the JCAMP version from https://www.swgdrug.org/ir.htm first.');process.exit(1)}
const db=openBank(dir,path.join(root,'catalog','identities.json'));
try{
  const report=await importSwgdrug(db,dir,files.map(f=>path.resolve(f)),{overrides,log:m=>console.log(m)});
  const out=path.join(root,'swgdrug-import-report.json');await writeFile(out,JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2));
  for(const r of report.imported.filter(r=>r.compoundId))console.log('  linked: '+r.title+' → '+r.compound);
  const cocaine=report.imported.filter(r=>/cocaine/i.test(r.title));if(cocaine.length&&!cocaine.some(r=>r.compoundId))console.log('Cocaine spectra found but not linked; see '+out+' and use --link if appropriate.');
  console.log('Report: '+out);
}catch(e){console.error('SWGDRUG import failed: '+e.message);process.exitCode=1}
finally{db.close()}
