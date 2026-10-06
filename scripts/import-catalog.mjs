// Reproducible identity-only import. Never creates spectral/reference records.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const fetchedAt = new Date().toISOString();
const entries = [];
const sources = [];
async function request(url) {
  for (let n = 0; n < 4; n++) {
    await new Promise(r => setTimeout(r, 300 + n * 1500));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error(`${response.status} ${url}`);
      return response;
    } catch (error) { if (n === 3) throw error; }
  }
}
function add(collection, list) {
  const unique = new Map();
  for (const item of list) {
    if (item.name && /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(item.inchikey) && item.smiles && !unique.has(item.inchikey)) unique.set(item.inchikey, { ...item, collection, fetchedAt });
    if (unique.size === 500) break;
  }
  if (unique.size !== 500) throw Error(`${collection}: expected 500, found ${unique.size}`);
  entries.push(...unique.values());
  console.log(`${collection}: ${unique.size} identities`);
}
console.log('Importing source-identified compounds. No spectra are being imported.');
const npUrl = 'https://www.npatlas.org/static/downloads/NPAtlas_download.tsv';
const tsv = await (await request(npUrl)).text();
const rows = tsv.trim().split(/\r?\n/);
const headers = rows.shift().split('\t');
const np = rows.map(line => Object.fromEntries(line.split('\t').map((v,i) => [headers[i],v])));
add('natural-products', np.map(r => ({ name:r.compound_name, formula:r.compound_molecular_formula, mass:r.compound_molecular_weight, smiles:r.compound_smiles, inchikey:r.compound_inchikey, inchi:r.compound_inchi, provider:'NPAtlas', sourceId:r.npaid, sourceUrl:r.npatlas_url || `https://www.npatlas.org/explore/compounds/${r.npaid}`, license:'CC BY-NC 4.0', doi:r.original_reference_doi, publication:r.original_reference_title, family:`${r.origin_type}: ${r.genus} ${r.origin_species}` })));
sources.push({ provider:'NPAtlas', url:npUrl, version:'2024_09', license:'CC BY-NC 4.0', selection:'First 500 unique InChIKeys in downloadable TSV source order; microbial natural products, not representative of all natural products.' });
let drugs = [], next = 'https://www.ebi.ac.uk/chembl/api/data/molecule.json?max_phase=4&molecule_type=Small%20molecule&limit=1000&offset=0';
while (new Set(drugs.map(r=>r.inchikey)).size < 500 && next) {
  const data = await (await request(next)).json();
  for (const m of data.molecules) {
    const s=m.molecule_structures, p=m.molecule_properties;
    if (!m.pref_name || !s || !p || m.molecule_hierarchy?.parent_chembl_id !== m.molecule_chembl_id) continue;
    drugs.push({name:m.pref_name, formula:p.full_molformula, mass:p.full_mwt, smiles:s.canonical_smiles, inchikey:s.standard_inchi_key, inchi:s.standard_inchi, provider:'ChEMBL',sourceId:m.molecule_chembl_id,sourceUrl:`https://www.ebi.ac.uk/chembl/explore/compound/${m.molecule_chembl_id}`,license:'CC BY-SA 3.0', family:'Small-molecule parent; ChEMBL max_phase = 4 (not a current regulatory approval claim)' });
  }
  next=data.page_meta.next;
  if (next?.startsWith('/')) next='https://www.ebi.ac.uk'+next;
}
add('pharmaceuticals', drugs);
sources.push({provider:'ChEMBL',url:'https://www.ebi.ac.uk/chembl/api/data/molecule.json?max_phase=4&molecule_type=Small%20molecule',license:'CC BY-SA 3.0',selection:'First 500 unique named, structure-bearing small-molecule parent identities in API order with max_phase=4. Includes historical drugs; not a current approval list.'});
let aromatic=[], used = new Set();
for (const [family, smarts, quota] of [['Aromatic amide','c1ccccc1C(=O)[NX3]',167],['Aromatic ester','c1ccccc1C(=O)[OX2][#6]',167],['Aromatic carboxylic acid','c1ccccc1C(=O)[OX2H]',166]]) {
  const url=`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastsubstructure/smarts/${encodeURIComponent(smarts)}/cids/JSON?MaxRecords=800`;
  const search = await (await request(url)).json();
  const ids=search.IdentifierList?.CID || []; let taken=0;
  for(let off=0;off<ids.length && taken<quota;off+=100) {
    const propUrl=`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${ids.slice(off,off+100).join(',')}/property/Title,MolecularFormula,MolecularWeight,SMILES,InChI,InChIKey/JSON`;
    const data=await (await request(propUrl)).json();
    for(const p of data.PropertyTable.Properties) {
      if(used.has(p.InChIKey) || !p.Title || !(p.SMILES || p.ConnectivitySMILES)) continue;
      used.add(p.InChIKey); taken++;
      aromatic.push({name:p.Title, formula:p.MolecularFormula,mass:p.MolecularWeight,smiles:p.SMILES || p.ConnectivitySMILES,inchi:p.InChI,inchikey:p.InChIKey,provider:'PubChem',sourceId:String(p.CID),sourceUrl:`https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,license:'PubChem source-specific usage terms; see record attribution', family,query:smarts});
      if(taken===quota) break;
    }
  }
  if(taken!==quota) throw Error(`Insufficient unique ${family} records: ${taken}`);
  sources.push({provider:'PubChem',url,selection:`${quota} unique identities from the first substructure results for ${smarts}. Overlaps assigned to first family; benzene-carbonyl subset only. API ordering is not a diversity or availability ranking.`});
  console.log(`${family}: ${taken}`);
}
add('aromatic-synthesis', aromatic);
const out=path.join(root,'catalog'); await mkdir(out,{recursive:true});
await writeFile(path.join(out,'identities.json'),JSON.stringify({schemaVersion:1,fetchedAt,sources,entries},null,2));
console.log(`Saved ${entries.length} collection memberships; ${new Set(entries.map(e=>e.inchikey)).size} unique identities. Spectra: 0.`);
