export function listEvidence(db,params={}) {
  const q=String(params.q||'').trim().slice(0,100).replace(/[\\%_]/g,c=>'\\'+c);
  const filters=[q,`%${q}%`,`%${q}%`,`%${q}%`,params.source||'',params.source||'',params.technique||'',params.technique||'',params.representation||'',params.representation||'',params.linked==='1'?1:0];
  const where="WHERE (?='' OR e.name LIKE ? ESCAPE '\\' OR e.inchikey LIKE ? ESCAPE '\\' OR e.source_record LIKE ? ESCAPE '\\') AND (?='' OR e.source_id=?) AND (?='' OR e.technique=?) AND (?='' OR e.representation=?) AND (?=0 OR e.compound_id IS NOT NULL)";
  const offset=Math.max(0,Math.min(1000000,Number(params.offset)||0));
  return {rows:db.prepare(`SELECT e.id,e.name,e.inchikey,e.source_id,e.source_record,e.compound_id,e.technique,e.representation,e.status FROM all_external_evidence e ${where} ORDER BY e.name COLLATE NOCASE,e.id LIMIT 30 OFFSET ?`).all(...filters,offset),total:db.prepare(`SELECT count(*) n FROM all_external_evidence e ${where}`).get(...filters).n,offset};
}
export function evidence(db,id){const row=db.prepare('SELECT e.*,s.title source_title,s.license source_license,s.url dataset_url FROM all_external_evidence e JOIN external_sources s ON s.id=e.source_id WHERE e.id=?').get(id);return row?{...row,metadata:JSON.parse(row.metadata),parsed:row.parsed?JSON.parse(row.parsed):null,data:row.data?JSON.parse(row.data):null,related:row.inchikey?db.prepare('SELECT id,source_id,technique,representation,status FROM all_external_evidence WHERE inchikey=? AND id!=? ORDER BY technique,source_id LIMIT 50').all(row.inchikey,id):[]}:null;}
