// Imports NIST MS Search user libraries (zip or folder) as unreviewed EI-MS evidence.
// Identity links are exact InChIKey only; unidentified spectra stay unlinked.
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readZip,libraryFolders} from './zip.mjs';
import {parseLibrary,NISTMS_VERSION} from './nistms.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'library';
const statusText={inchikey:'Structure-linked by InChIKey in the library',named:'Named in the library; no structure identifier',['tentative-name']:'Tentative name (library marks it with ?); unconfirmed',unidentified:'Unidentified recurrent spectrum (lab code only)'};

export async function libraryInputs(paths){
  const out=[];
  for(const p of paths){
    const info=await stat(p).catch(()=>null);if(!info)continue;
    if(info.isDirectory()){
      const names=await readdir(p);
      if(names.some(n=>n.toUpperCase()==='USER.DBU')){const files=new Map();for(const n of names){const f=path.join(p,n);if((await stat(f)).isFile())files.set(n.toUpperCase()==='USRSTRUC.DB'?'USRSTRUC.DB':n.toUpperCase(),await readFile(f))}out.push({file:p,folders:[[path.basename(p),files]],original:null})}
      else for(const n of names.filter(n=>/\.zip$/i.test(n)).sort())out.push(...await libraryInputs([path.join(p,n)]));
    }else if(/\.zip$/i.test(p)){const bytes=await readFile(p);out.push({file:p,folders:libraryFolders(readZip(bytes)),original:bytes});}
  }
  return out;
}

export async function importMsLibraries(db,dir,paths,{rdkit=null,log=()=>{}}={}){
  const inputs=await libraryInputs(paths),report={version:NISTMS_VERSION,libraries:[]};
  const catalog=new Map(db.prepare('SELECT id,inchikey,smiles,name FROM compounds').all().map(c=>[c.inchikey,c]));
  const put=db.prepare("INSERT INTO external_evidence_extra VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET compound_id=excluded.compound_id,name=excluded.name,inchikey=excluded.inchikey,smiles=excluded.smiles,metadata=excluded.metadata,parsed=excluded.parsed WHERE external_evidence_extra.status!='quarantined'");
  const downloads=path.join(dir,'source-downloads','ms-libraries');await mkdir(downloads,{recursive:true});
  for(const input of inputs){
    const archiveHash=input.original?sha(input.original):null,filename=path.basename(input.file),originalName=(archiveHash?archiveHash.slice(0,16)+'-':'')+filename.replace(/[^\w.-]+/g,'_');
    if(input.original){const target=path.join(downloads,originalName);if(!(await stat(target).catch(()=>null)))await writeFile(target,input.original,{flag:'wx'});}
    for(const [folder,files] of input.folders){
      const lib=parseLibrary(files),libName=path.basename(folder==='.'?filename.replace(/\.zip$/i,''):folder),sourceId='mslib-'+slug(libName);
      const userHash=sha(files.get('USER.DBU'));
      db.prepare('INSERT INTO external_sources VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata').run(sourceId,libName+' · EI mass spectral library (NIST MS Search format)','local:'+filename,'User-supplied library; redistribution terms follow the original distributor',JSON.stringify({archives:[{filename,bytes:input.original?.length||files.get('USER.DBU').length,retrievedAt:'Supplied by the user; imported '+new Date().toISOString(),sha256:archiveHash||userHash}],notes:'Decoded from USER.DBU with '+NISTMS_VERSION+'. Peaks are m/z with relative abundance on the library 0–999 scale. Imported and unreviewed; excluded from unknown-compound matching.',archive:filename,archiveSha256:archiveHash,userDbuSha256:userHash,records:lib.records.length,skipped:lib.skipped.length}));
      let linked=0,structures=0;
      db.exec('BEGIN IMMEDIATE');
      try{
        for(const r of lib.records){
          const c=r.inchikey?catalog.get(r.inchikey):null;if(c)linked++;
          let smiles=c?.smiles||null,computedKey=null;
          if(!smiles&&r.molfile&&rdkit){let mol;try{mol=rdkit.get_mol(r.molfile);if(mol?.is_valid()){smiles=mol.get_smiles();computedKey=rdkit.get_inchikey_for_inchi(mol.get_inchi())}}catch{}finally{mol?.delete?.()}}
          if(computedKey&&r.inchikey&&computedKey!==r.inchikey)smiles=null; // Never attach a structure that disagrees with the library key.
          if(smiles)structures++;
          const display=r.tentativeName?r.tentativeName+' · '+r.name.split(';')[0]:r.name;
          const id=sha(sourceId+'|'+userHash+'|'+r.record).slice(0,32),max=Math.max(...r.peaks.map(p=>p[1]));
          const metadata={sourceLabel:libName+' · EI-MS library',xUnit:'m/z',yMode:'relative-abundance',format:'peaks',ionization:'Electron ionization (GC–EI-MS library)',libraryRecord:r.record,libraryName:r.rawName,synonyms:r.synonyms,formula:r.formula,cas:r.cas,retentionIndex:r.retentionIndex,comment:r.comment.slice(0,2000),basePeak:r.basePeak,scale:'0–999 (base peak = '+max+')',identityStatus:r.identityStatus,identityNote:statusText[r.identityStatus],identityLinkage:c?'Exact library InChIKey matches the catalog identity':r.inchikey?'Library InChIKey not in the catalog (derivatives such as TMS are separate identities)':'No structure identifier',structureSource:smiles&&!c?'Library molfile converted with RDKit':c?'Catalog':null,license:'User-supplied NIST MS Search library',eligibleForMatching:false,review:'Imported library spectrum; not independently reviewed'};
          put.run(id,sourceId,filename+'#'+folder+'#'+r.record,c?.id??null,display.slice(0,300),r.inchikey,smiles,'ms','mass-spectrum','imported','',path.join('source-downloads','ms-libraries',originalName),filename,archiveHash||userHash,JSON.stringify(metadata),JSON.stringify({points:r.peaks,range:[r.peaks[0][0],r.peaks.at(-1)[0]]}),null);
        }
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e}
      const summary={sourceId,library:libName,archive:filename,imported:lib.records.length,skipped:lib.skipped.length,catalogLinked:linked,withStructure:structures};
      report.libraries.push(summary);log(libName+': '+lib.records.length+' spectra imported, '+lib.skipped.length+' skipped (failed validation), '+linked+' linked to catalog compounds');
    }
  }
  return report;
}

// First-start convenience: import bundled libraries once per archive checksum.
export async function importBundledLibraries(db,dir,root,log){
  const folder=path.join(root,'sources','ms-libraries'),names=(await readdir(folder).catch(()=>[])).filter(n=>/\.zip$/i.test(n)).sort();
  if(!names.length)return null;
  const hashes=[];for(const n of names)hashes.push(sha(await readFile(path.join(folder,n))));
  const key=sha(hashes.join('|')+NISTMS_VERSION),done=db.prepare("SELECT value FROM settings WHERE key='ms_libraries'").get()?.value;
  if(done&&JSON.parse(done).key===key)return null;
  let rdkit=null;try{rdkit=await (await import('@rdkit/rdkit')).default()}catch{log('RDKit unavailable; library structures are not drawn')}
  const report=await importMsLibraries(db,dir,names.map(n=>path.join(folder,n)),{log,rdkit});
  db.prepare("INSERT INTO settings VALUES('ms_libraries',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({key,importedAt:new Date().toISOString(),libraries:report.libraries}));
  return report;
}

// MassBank subset (sources/massbank/massbank-subset.json.gz), imported once per checksum.
export async function importMassBankBundle(db,dir,root,log=()=>{},file=path.join(root,'sources','massbank','massbank-subset.json.gz')){
  const gz=await readFile(file).catch(()=>null);if(!gz)return null;
  const hash=sha(gz),done=db.prepare("SELECT value FROM settings WHERE key='massbank_bundle'").get()?.value;
  if(done&&JSON.parse(done).sha256===hash)return null;
  const {gunzipSync}=await import('node:zlib'),{massBankLabel}=await import('./massbank.mjs');
  const bundle=JSON.parse(gunzipSync(gz).toString('utf8')),folder=path.join(dir,'source-downloads','massbank'),originalName=hash.slice(0,16)+'-massbank-subset.json.gz';
  await mkdir(folder,{recursive:true});if(!(await stat(path.join(folder,originalName)).catch(()=>null)))await writeFile(path.join(folder,originalName),gz,{flag:'wx'});
  db.prepare('INSERT INTO external_sources VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata').run('massbank','MassBank (EI-MS and catalog LC-MS/MS subset)','https://massbank.eu/MassBank/','Per-record licences: CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, dl-de/by-2-0',JSON.stringify({archives:[{filename:'massbank-subset.json.gz',bytes:gz.length,retrievedAt:bundle.builtAt,sha256:hash}],notes:bundle.selection+' '+bundle.licenseNote,citation:'MassBank consortium, https://github.com/MassBank/MassBank-data'}));
  const catalog=new Map(db.prepare('SELECT id,inchikey FROM compounds').all().map(c=>[c.inchikey,c.id]));
  const put=db.prepare("INSERT INTO external_evidence_extra VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET compound_id=excluded.compound_id,metadata=excluded.metadata,parsed=excluded.parsed WHERE external_evidence_extra.status!='quarantined'");
  let linked=0;db.exec('BEGIN IMMEDIATE');
  try{
    for(const r of bundle.records){
      const peaks=r.peaks.filter(p=>p[1]>0).sort((a,b)=>a[0]-b[0]);if(!peaks.length)continue;
      const cid=catalog.get(r.inchikey)??null;if(cid)linked++;
      const label=massBankLabel({ionization:r.ionization,ac:{MS_TYPE:r.msType,COLLISION_ENERGY:r.collisionEnergy,ION_MODE:r.ionMode},ms:{PRECURSOR_TYPE:r.precursorType}});
      const metadata={sourceLabel:label,sourceUrl:'https://massbank.eu/MassBank/RecordDisplay?id='+encodeURIComponent(r.accession),accession:r.accession,recordTitle:r.title,xUnit:'m/z',yMode:'relative-abundance',format:'peaks',ionization:r.ionization+(r.ionizationEnergy?' '+r.ionizationEnergy:''),msType:r.msType,ionMode:r.ionMode,collisionEnergy:r.collisionEnergy,precursorType:r.precursorType,precursorMz:r.precursorMz,instrument:r.instrument,instrumentType:r.instrumentType,formula:r.formula,synonyms:r.synonyms,license:r.license,authors:r.authors,copyright:r.copyright,citation:r.publication||'MassBank record '+r.accession,date:r.date,identityLinkage:cid?'Exact MassBank InChIKey = catalog identity':'MassBank identity outside the starter catalog',eligibleForMatching:false,review:'Imported MassBank record; not independently reviewed'};
      put.run(sha('massbank|'+r.accession).slice(0,32),'massbank',r.accession,cid,String(r.name).slice(0,300),r.inchikey,r.smiles||null,'ms','mass-spectrum','imported','https://massbank.eu/MassBank/RecordDisplay?id='+encodeURIComponent(r.accession),path.join('source-downloads','massbank',originalName),'massbank-subset.json.gz',hash,JSON.stringify(metadata),JSON.stringify({points:peaks,range:[peaks[0][0],peaks.at(-1)[0]]}),null);
    }
    db.prepare("INSERT INTO settings VALUES('massbank_bundle',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({sha256:hash,records:bundle.records.length,linked,importedAt:new Date().toISOString()}));
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  log('MassBank: '+bundle.records.length+' spectra imported, '+linked+' linked to catalog compounds');
  return {records:bundle.records.length,linked};
}
