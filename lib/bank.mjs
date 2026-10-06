import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
export const collections=[
  {id:'natural-products',name:'Natural products',description:'500 microbial natural products from NPAtlas v2024_09; educational/noncommercial use under CC BY-NC 4.0.'},
  {id:'pharmaceuticals',name:'Pharmaceutical compounds',description:'500 named small-molecule parent identities from ChEMBL with max_phase 4. Not a current regulatory approval list.'},
  {id:'aromatic-synthesis',name:'Aromatic synthesis',description:'167 amides, 167 esters and 166 carboxylic acids from PubChem benzene-carbonyl substructure queries. Identity subsets may overlap other collections.'}
];
export function openBank(directory, catalogPath) {
  mkdirSync(directory,{recursive:true}); mkdirSync(path.join(directory,'uploads'),{recursive:true});
  const db=new DatabaseSync(path.join(directory,'spectratrace.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,target INTEGER NOT NULL DEFAULT 500);
    CREATE TABLE IF NOT EXISTS compounds(id INTEGER PRIMARY KEY,inchikey TEXT NOT NULL UNIQUE,name TEXT NOT NULL,formula TEXT,mass TEXT,smiles TEXT NOT NULL,inchi TEXT);
    CREATE TABLE IF NOT EXISTS memberships(collection_id TEXT NOT NULL REFERENCES collections(id),compound_id INTEGER NOT NULL REFERENCES compounds(id),provenance TEXT NOT NULL,PRIMARY KEY(collection_id,compound_id));
    CREATE TABLE IF NOT EXISTS samples(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('reference','unknown')),label TEXT NOT NULL,compound_id INTEGER REFERENCES compounds(id),status TEXT NOT NULL CHECK(status IN ('pending','approved','unknown')),metadata TEXT NOT NULL,created_at TEXT NOT NULL,review TEXT,reviewed_at TEXT,CHECK((kind='unknown' AND compound_id IS NULL AND status='unknown') OR (kind='reference' AND compound_id IS NOT NULL AND status IN ('pending','approved'))));
    CREATE TABLE IF NOT EXISTS spectra(id TEXT PRIMARY KEY,sample_id TEXT NOT NULL REFERENCES samples(id),technique TEXT NOT NULL CHECK(technique IN ('ftir','h1','c13','uv')),filename TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,parsed TEXT,parse_error TEXT,UNIQUE(sample_id,technique));
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_member_compound ON memberships(compound_id);
    CREATE INDEX IF NOT EXISTS idx_spectra_sample ON spectra(sample_id);
    CREATE INDEX IF NOT EXISTS idx_sample_status ON samples(status,compound_id);
    INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));
    CREATE TABLE IF NOT EXISTS external_sources(id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,license TEXT NOT NULL,metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS external_evidence(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES external_sources(id),source_record TEXT NOT NULL,compound_id INTEGER REFERENCES compounds(id),name TEXT NOT NULL,inchikey TEXT,smiles TEXT,technique TEXT NOT NULL CHECK(technique IN ('ftir','h1','c13','uv')),representation TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('imported','quarantined')),source_url TEXT NOT NULL,original_path TEXT NOT NULL,filename TEXT NOT NULL,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,parsed TEXT,data TEXT);
    CREATE INDEX IF NOT EXISTS idx_external_compound ON external_evidence(compound_id);
    CREATE INDEX IF NOT EXISTS idx_external_identity ON external_evidence(inchikey);
    CREATE INDEX IF NOT EXISTS idx_external_filter ON external_evidence(source_id,technique,representation);
    INSERT OR IGNORE INTO schema_migrations VALUES(2,datetime('now'));
    CREATE TABLE IF NOT EXISTS compound_logic(compound_id INTEGER PRIMARY KEY REFERENCES compounds(id),method TEXT NOT NULL,profile TEXT NOT NULL,built_at TEXT NOT NULL);
    INSERT OR IGNORE INTO schema_migrations VALUES(3,datetime('now'));
    CREATE TABLE IF NOT EXISTS compound_simulations(compound_id INTEGER PRIMARY KEY REFERENCES compounds(id),method TEXT NOT NULL,payload TEXT NOT NULL,built_at TEXT NOT NULL);
    INSERT OR IGNORE INTO schema_migrations VALUES(4,datetime('now'));
  `);
  // Additive storage: original tables and researcher files are never rebuilt.
  db.exec(`CREATE TABLE IF NOT EXISTS auxiliary_spectra(id TEXT PRIMARY KEY,sample_id TEXT NOT NULL REFERENCES samples(id),technique TEXT NOT NULL CHECK(technique IN ('xrd','fluorescence','raman')),filename TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,parsed TEXT,parse_error TEXT,UNIQUE(sample_id,technique));
    CREATE TABLE IF NOT EXISTS student_selections(sample_id TEXT PRIMARY KEY REFERENCES samples(id),compound_id INTEGER REFERENCES compounds(id),selected_at TEXT NOT NULL,note TEXT NOT NULL);
    INSERT OR IGNORE INTO schema_migrations VALUES(5,datetime('now'));
    CREATE TABLE IF NOT EXISTS microscopy_searches(compound_id INTEGER PRIMARY KEY REFERENCES compounds(id),payload TEXT NOT NULL,retrieved_at TEXT NOT NULL);
    INSERT OR IGNORE INTO schema_migrations VALUES(6,datetime('now'));
    CREATE VIEW IF NOT EXISTS all_sample_spectra AS SELECT * FROM spectra UNION ALL SELECT * FROM auxiliary_spectra;`);
  for(const c of collections) db.prepare('INSERT OR IGNORE INTO collections(id,name,description) VALUES(?,?,?)').run(c.id,c.name,c.description);
  if(catalogPath && existsSync(catalogPath)) {
    const seed=JSON.parse(readFileSync(catalogPath,'utf8'));
    // Never overwrite researcher data or already imported provenance on startup.
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const e of seed.entries) {
        db.prepare('INSERT OR IGNORE INTO compounds(inchikey,name,formula,mass,smiles,inchi) VALUES(?,?,?,?,?,?)').run(e.inchikey,e.name,e.formula||null,String(e.mass||''),e.smiles,e.inchi||null);
        const {id}=db.prepare('SELECT id FROM compounds WHERE inchikey=?').get(e.inchikey);
        db.prepare('INSERT OR IGNORE INTO memberships VALUES(?,?,?)').run(e.collection,id,JSON.stringify(e));
      }
      db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('catalog_sources',JSON.stringify({fetchedAt:seed.fetchedAt,sources:seed.sources}));
      db.exec('COMMIT');
    } catch(e){db.exec('ROLLBACK');throw e;}
  }
  db.exec('PRAGMA optimize'); return db;
}
export function logicCounts(db){return {identities:db.prepare('SELECT count(*) n FROM compound_logic').get().n,memberships:db.prepare('SELECT count(*) n FROM memberships m JOIN compound_logic l ON l.compound_id=m.compound_id').get().n,methods:db.prepare('SELECT method,count(*) n FROM compound_logic GROUP BY method').all()};}
export function stats(db) {
  const collectionStats=db.prepare(`SELECT c.*,count(m.compound_id) identities,(SELECT count(DISTINCT s.compound_id) FROM samples s JOIN memberships mm ON mm.compound_id=s.compound_id WHERE mm.collection_id=c.id AND s.status='approved' AND EXISTS(SELECT 1 FROM all_sample_spectra z WHERE z.sample_id=s.id AND z.parsed IS NOT NULL)) covered FROM collections c LEFT JOIN memberships m ON m.collection_id=c.id GROUP BY c.id`).all();
  for(const c of collectionStats)c.techniqueCoverage=db.prepare("SELECT z.technique,count(DISTINCT s.compound_id) n FROM all_sample_spectra z JOIN samples s ON s.id=z.sample_id JOIN memberships m ON m.compound_id=s.compound_id WHERE m.collection_id=? AND s.status='approved' AND z.parsed IS NOT NULL GROUP BY z.technique").all(c.id);
  const external={total:db.prepare('SELECT count(*) n FROM external_evidence').get().n,linkedIdentities:db.prepare('SELECT count(DISTINCT compound_id) n FROM external_evidence').get().n,groups:db.prepare('SELECT source_id,technique,representation,status,count(*) n,sum(compound_id IS NOT NULL) linked FROM external_evidence GROUP BY source_id,technique,representation,status').all(),sources:db.prepare('SELECT * FROM external_sources').all().map(s=>({...s,metadata:JSON.parse(s.metadata)}))};
  const baseStats={external};
  baseStats.logic=logicCounts(db);
  external.uniqueCurves=db.prepare("SELECT source_id,count(DISTINCT json_extract(metadata,'$.traceHash')) n,sum(json_extract(metadata,'$.duplicateOf') IS NOT NULL) duplicates FROM external_evidence WHERE representation LIKE 'continuous%' GROUP BY source_id").all();
  return {...baseStats,collections:collectionStats,uniqueIdentities:db.prepare('SELECT count(*) n FROM compounds').get().n, samples:db.prepare('SELECT kind,status,count(*) n FROM samples GROUP BY kind,status').all(),spectra:db.prepare('SELECT technique,count(*) files,sum(parsed IS NOT NULL) parsed FROM all_sample_spectra GROUP BY technique').all(),sources:JSON.parse(db.prepare("SELECT value FROM settings WHERE key='catalog_sources'").get()?.value||'{}')};
}
export function compound(db,id) {
  const row=db.prepare('SELECT * FROM compounds WHERE id=?').get(id); if(!row) return null;
  const logic=db.prepare('SELECT profile,built_at FROM compound_logic WHERE compound_id=?').get(id);row.logic=logic?{...JSON.parse(logic.profile),builtAt:logic.built_at}:null;
  row.external=db.prepare('SELECT id,source_id,technique,representation,status,name,metadata FROM external_evidence WHERE compound_id=? ORDER BY source_id,technique LIMIT 200').all(id).map(e=>({...e,metadata:JSON.parse(e.metadata)}));
  return {...row,sources:db.prepare('SELECT collection_id,provenance FROM memberships WHERE compound_id=?').all(id).map(r=>({...r,provenance:JSON.parse(r.provenance)})),samples:db.prepare('SELECT id,label,status,metadata,created_at FROM samples WHERE compound_id=? ORDER BY created_at DESC').all(id).map(r=>({...r,metadata:JSON.parse(r.metadata)})),coverage:db.prepare("SELECT technique,count(*) n FROM all_sample_spectra z JOIN samples s ON s.id=z.sample_id WHERE s.compound_id=? AND s.status='approved' AND z.parsed IS NOT NULL GROUP BY technique").all(id)};
}
export function sample(db,id) {
  const row=db.prepare('SELECT * FROM samples WHERE id=?').get(id);if(!row)return null;
  return {...row,selection:db.prepare('SELECT * FROM student_selections WHERE sample_id=?').get(id)||null,metadata:JSON.parse(row.metadata),review:row.review?JSON.parse(row.review):null,spectra:db.prepare('SELECT * FROM spectra WHERE sample_id=? UNION ALL SELECT * FROM auxiliary_spectra WHERE sample_id=?').all(id,id).map(s=>({...s,metadata:JSON.parse(s.metadata),parsed:s.parsed?JSON.parse(s.parsed):null}))};
}
