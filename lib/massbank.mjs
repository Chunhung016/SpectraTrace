// MassBank record reader (https://github.com/MassBank/MassBank-data, per-record licences).
// Keeps identity, acquisition and licence fields verbatim; peaks are m/z with relative intensity (0–999).
export const MASSBANK_VERSION='massbank-record-v1';

export function parseMassBank(text){
  const lines=String(text).split(/\r?\n/),r={names:[],links:{},ac:{},ms:{},peaks:[],comments:[]};
  for(let i=0;i<lines.length;i++){
    const line=lines[i],m=line.match(/^([A-Z$_]+(?:\$[A-Z_]+)?):\s?(.*)$/);if(!m)continue;const [,tag,value]=m;
    if(tag==='ACCESSION')r.accession=value.trim();
    else if(tag==='RECORD_TITLE')r.title=value.trim();
    else if(tag==='LICENSE')r.license=value.trim();
    else if(tag==='AUTHORS')r.authors=value.trim();
    else if(tag==='COPYRIGHT')r.copyright=value.trim();
    else if(tag==='PUBLICATION')r.publication=value.trim();
    else if(tag==='DATE')r.date=value.trim();
    else if(tag==='CH$NAME')r.names.push(value.trim());
    else if(tag==='CH$FORMULA')r.formula=value.trim();
    else if(tag==='CH$EXACT_MASS')r.exactMass=Number(value);
    else if(tag==='CH$SMILES')r.smiles=value.trim();
    else if(tag==='CH$IUPAC')r.inchi=value.trim();
    else if(tag==='CH$LINK'){const [k,...v]=value.trim().split(/\s+/);r.links[k]=v.join(' ')}
    else if(tag==='AC$INSTRUMENT')r.instrument=value.trim();
    else if(tag==='AC$INSTRUMENT_TYPE')r.instrumentType=value.trim();
    else if(tag==='AC$MASS_SPECTROMETRY'){const [k,...v]=value.trim().split(/\s+/);r.ac[k]=v.join(' ')}
    else if(tag==='MS$FOCUSED_ION'){const [k,...v]=value.trim().split(/\s+/);r.ms[k]=v.join(' ')}
    else if(tag==='COMMENT')r.comments.push(value.trim());
    else if(tag==='PK$PEAK'){
      for(i++;i<lines.length&&/^\s/.test(lines[i]);i++){const [mz,,rel]=lines[i].trim().split(/\s+/).map(Number);if(Number.isFinite(mz)&&Number.isFinite(rel))r.peaks.push([mz,rel])}
      i--;
    }
  }
  r.inchikey=r.links.INCHIKEY||null;
  r.ionization=/EI/.test(r.instrumentType||'')&&!/ESI/.test(r.instrumentType||'')?'EI':/APCI/.test(r.instrumentType||'')?'APCI':/ESI/.test(r.instrumentType||'')?'ESI':/CI/.test(r.instrumentType||'')?'CI':(r.instrumentType||'unknown');
  return r;
}

export function massBankLabel(r){
  const ce=r.ac.COLLISION_ENERGY,type=r.ac.MS_TYPE||'MS',ion=r.ms.PRECURSOR_TYPE||r.ms.ION_TYPE||'';
  return 'MassBank · '+(r.ionization==='EI'?'EI-MS':r.ionization+'-'+type)+(ion?' '+ion:'')+(ce?' · CE '+ce:'')+(r.ac.ION_MODE&&r.ionization!=='EI'?' · '+r.ac.ION_MODE.toLowerCase():'');
}

// Compact bundle row: everything needed to display and attribute the spectrum.
export function bundleRow(r){
  return {accession:r.accession,title:r.title,name:r.names[0]||r.title,synonyms:r.names.slice(1,4),formula:r.formula,smiles:r.smiles,inchikey:r.inchikey,license:r.license,authors:r.authors,copyright:r.copyright||null,publication:r.publication||null,date:r.date,instrument:r.instrument,instrumentType:r.instrumentType,ionization:r.ionization,msType:r.ac.MS_TYPE||'MS',ionMode:r.ac.ION_MODE||'',collisionEnergy:r.ac.COLLISION_ENERGY||'',ionizationEnergy:r.ac.IONIZATION_ENERGY||'',precursorType:r.ms.PRECURSOR_TYPE||r.ms.ION_TYPE||'',precursorMz:r.ms.PRECURSOR_M_Z||'',peaks:r.peaks};
}
