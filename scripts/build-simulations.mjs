import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import initRDKit from '@rdkit/rdkit';
import {buildNmrModel,nmrLimitations} from '../lib/nmr.mjs';
import {openBank} from '../lib/bank.mjs';
import {buildSimulation,SIMULATION_VERSION,simulationGrids,simulationLimitations} from '../lib/simulation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const db=openBank(path.join(root,'data'));
const rows=db.prepare('SELECT c.id,c.name,c.inchikey,c.smiles,l.profile FROM compounds c JOIN compound_logic l ON l.compound_id=c.id ORDER BY c.id').all(),builtAt=new Date().toISOString(),rdkit=await initRDKit();
const entries=[];db.exec('BEGIN IMMEDIATE');
try{const save=db.prepare('INSERT INTO compound_simulations(compound_id,method,payload,built_at) VALUES(?,?,?,?) ON CONFLICT(compound_id) DO UPDATE SET method=excluded.method,payload=excluded.payload,built_at=excluded.built_at');for(const row of rows){const data=buildSimulation(JSON.parse(row.profile),buildNmrModel(rdkit,row.smiles));save.run(row.id,SIMULATION_VERSION,JSON.stringify(data),builtAt);entries.push({id:row.id,name:row.name,inchikey:row.inchikey,...data});if(entries.length%250===0)console.log('Generated '+entries.length+' / '+rows.length+' structures')}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');db.close();throw e}
const memberships=db.prepare('SELECT collection_id,compound_id,provenance FROM memberships ORDER BY collection_id,compound_id').all().map(m=>({...m,provenance:JSON.parse(m.provenance)}));
const result={version:SIMULATION_VERSION,builtAt,kind:'rule-simulation',eligibleForMatching:false,uniqueIdentityCount:entries.length,membershipCount:memberships.length,techniqueRecords:entries.length*4,grids:simulationGrids,limitations:[...simulationLimitations.filter(x=>!x.startsWith('No fingerprint modes')),...nmrLimitations],entries,memberships};
await writeFile(path.join(root,'theoretical-dataset-1500.json'),JSON.stringify(result));
db.close();console.log(JSON.stringify({uniqueIdentities:entries.length,memberships:memberships.length,techniqueRecords:entries.length*4,file:path.join(root,'theoretical-dataset-1500.json')}));
