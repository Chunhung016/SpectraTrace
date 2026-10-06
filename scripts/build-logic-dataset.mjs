import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import initRDKit from '@rdkit/rdkit';
import {openBank} from '../lib/bank.mjs';
import {LOGIC_VERSION,createLogicEngine,exportLogicDataset} from '../lib/logic.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),db=openBank(path.join(root,'data'),path.join(root,'catalog','identities.json'));
const rdkit=await initRDKit(),engine=createLogicEngine(rdkit),built=new Date().toISOString();let valid=0,unresolved=0;
db.exec('BEGIN IMMEDIATE');try{const save=db.prepare('INSERT INTO compound_logic VALUES(?,?,?,?) ON CONFLICT(compound_id) DO UPDATE SET method=excluded.method,profile=excluded.profile,built_at=excluded.built_at');for(const c of db.prepare('SELECT id,smiles FROM compounds ORDER BY id').all()){const p=engine.profile(c.smiles);if(p.status==='unresolved-structure')unresolved++;else valid++;save.run(c.id,LOGIC_VERSION,JSON.stringify(p),built)}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}finally{engine.close()}
const dataset=exportLogicDataset(db);writeFileSync(path.join(root,'logic-dataset-1500.json'),JSON.stringify(dataset,null,2));db.close();console.log(JSON.stringify({valid,unresolved,uniqueIdentities:dataset.uniqueIdentityCount,collectionEntries:dataset.membershipCount,kind:'rule-derived educational guides; NOT experimental spectra',file:'logic-dataset-1500.json'}));
