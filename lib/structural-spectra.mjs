// Read saved T data first; generate missing T data from resolved local rules only.
// This never stores a reference, changes an upload, or calls an external service.
import initRDKit from '@rdkit/rdkit';
import {buildNmrModel} from './nmr.mjs';
import {buildSimulation,SIMULATION_VERSION} from './simulation.mjs';

export function createStructuralSpectrumReader(db,{loadRdkit=initRDKit}={}){
  let rdkit;
  return async compound=>{
    const stored=db.prepare('SELECT payload FROM compound_simulations WHERE compound_id=?').get(compound.id);
    const row=compound.logic?null:db.prepare('SELECT profile FROM compound_logic WHERE compound_id=?').get(compound.id);
    const profile=compound.logic||(row?JSON.parse(row.profile):null);
    if(stored){const dataset=JSON.parse(stored.payload);if(dataset.version===SIMULATION_VERSION&&(!profile||profile.inputSha256===dataset.inputSha256))return dataset}
    if(!profile||profile.status==='unresolved-structure')throw Object.assign(Error('Build the structural guide first (npm run build:logic)'),{status:404});
    rdkit??=loadRdkit().catch(e=>{rdkit=null;throw e});
    return buildSimulation(profile,buildNmrModel(await rdkit,compound.smiles));
  };
}
