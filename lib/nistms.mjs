// Reader for user-supplied NIST MS Search libraries (USER.DBU + optional USRSTRUC.DB).
// The binary layout was decoded from the supplied libraries and every record is
// validated before use: exact peak count, intensities that end at the comment field
// and a 0–999 relative-abundance scale. Records that fail validation are skipped
// and reported, never guessed.
export const NISTMS_VERSION='nist-ms-search-user-library-v1';

function cstring(buf,start){const end=buf.indexOf(0,start);if(end<0)throw Error('Unterminated text field');return {text:buf.toString('latin1',start,end),next:end+1};}

// Masses: first byte is the first m/z; positive bytes are m/z steps; a byte >= 0x80
// stands for a run of (0x100 - byte + runOffset) consecutive masses (step 1).
function decodeMasses(buf,start,count,runOffset){
  const masses=[];let i=start,m=null;
  while(masses.length<count&&i<buf.length){
    const b=buf[i++];
    if(m===null){m=b;masses.push(m);continue;}
    if(b>=0x80){for(let k=0;k<0x100-b+runOffset;k++)masses.push(++m);}
    else{m+=b;masses.push(m);}
  }
  return masses.length===count?{masses,next:i}:null;
}
// Intensities on a 0–999 scale: bytes 0–250 are literal; a lead byte 0xFB–0xFF
// plus one byte encodes 5 * next + (0xFF - lead), covering 250–999.
function decodeIntensities(buf,start,count){
  const values=[];let i=start;
  while(values.length<count&&i<buf.length){
    const b=buf[i++];
    if(b>=0xfb){if(i>=buf.length)return null;values.push(5*buf[i++]+(0xff-b));}
    else values.push(b);
  }
  return values.length===count?{values,next:i}:null;
}
const printable=b=>b===0||(b>=0x20&&b<0x7f);

export function parseNameField(raw){
  // "Name $$ $:28INCHIKEY $$ $:24CAS $$ $:29RI $$ synonym ..."
  const parts=raw.split(' $$ ').map(s=>s.trim()).filter(Boolean),out={name:parts[0]||raw,synonyms:[],inchikey:null,cas:null,retentionIndex:null};
  for(const p of parts.slice(1)){
    const tag=p.match(/^\$:(\d\d)(.*)$/);
    if(!tag){out.synonyms.push(p);continue;}
    const [,code,value]=tag;
    if(code==='28'&&/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(value))out.inchikey=value;
    else if(code==='24'&&/^\d{2,7}-\d\d-\d$/.test(value))out.cas=value;
    else if(code==='29')out.retentionIndex=value.replace(/^[a-z]=/,'');
  }
  // Recurrent-unknown entries: "F-10260;{...}-Eucalyptol?" carry a tentative name after the lab code.
  const tentative=out.name.match(/^[A-Z]-\d+;\{[^}]*\}-(.+)$/);
  out.tentativeName=tentative?tentative[1].trim():null;
  out.identityStatus=out.inchikey?'inchikey':tentative?'tentative-name':/^[A-Z]-\d+;\{/.test(out.name)?'unidentified':/\?\s*$/.test(out.name)?'tentative-name':'named';
  return out;
}

export function parseUserDbu(buf){
  const records=[],skipped=[];let i=0x200,index=0;
  while(i<buf.length-6){
    const at=buf.indexOf(Buffer.from([0xfa,0xfa]),i);if(at<0)break;
    const length=buf.readUInt32LE(at+2);
    if(length<0x20||at+length>buf.length){i=at+2;continue;}
    const rec=buf.subarray(at,at+length);i=at+length;index++;
    try{records.push(parseRecord(rec,index))}catch(e){skipped.push({record:index,reason:e.message})}
  }
  return {records,skipped};
}

function parseRecord(rec,index){
  const name=cstring(rec,0x1c);let pos=name.next,structurePointer=null;
  // Optional '@offset' pointer into USRSTRUC.DB, then the formula (may be empty).
  let field=cstring(rec,pos);
  if(/^@\d+$/.test(field.text)){structurePointer=Number(field.text.slice(1));pos=field.next;field=cstring(rec,pos);}
  const formula=field.text;pos=field.next;
  const count=rec.readUInt16LE(pos);pos+=2;
  if(!count||count>2000)throw Error('Implausible peak count');
  for(const runOffset of [1,0]){
    const m=decodeMasses(rec,pos,count,runOffset);if(!m)continue;
    const it=decodeIntensities(rec,m.next,count);if(!it)continue;
    if(it.next<rec.length&&!printable(rec[it.next]))continue;
    const max=Math.max(...it.values);
    if(max<1||max>999||m.masses.some((x,k)=>k&&x<=m.masses[k-1])||m.masses.at(-1)>2000)continue;
    const comment=it.next<rec.length?cstring(rec,it.next).text:'';
    return {record:index,...parseNameField(name.text),rawName:name.text,formula:/^[A-Z][A-Za-z0-9()+-]*$/.test(formula)?formula:null,structurePointer,comment,peaks:m.masses.map((x,k)=>[x,it.values[k]]),basePeak:m.masses[it.values.indexOf(max)]};
  }
  throw Error('Peak block did not validate');
}

// USRSTRUC.DB is a concatenation of MDL molfiles; the record's '@offset' points at one.
export function molfileAt(structures,offset){
  if(!structures||offset==null)return null;
  for(const start of [offset,offset-1]){
    if(start<0||start>=structures.length)continue;
    const end=structures.indexOf('M  END',start);if(end<0||end-start>200000)continue;
    const block=structures.toString('latin1',start,end+6);
    if(/V2000|V3000/.test(block.split(/\r?\n/).slice(0,6).join('\n')))return block.replace(/\r\n/g,'\n');
  }
  return null;
}

export function parseLibrary(files){
  const user=files.get('USER.DBU');if(!user)throw Error('USER.DBU not found; this is not a NIST MS Search user library');
  const {records,skipped}=parseUserDbu(user),structures=files.get('USRSTRUC.DB')||null;
  for(const r of records)r.molfile=molfileAt(structures,r.structurePointer);
  return {records,skipped,version:NISTMS_VERSION};
}
