// Minimal ZIP reader (stored and deflate entries) for importing supplied library archives.
import {inflateRawSync} from 'node:zlib';

export function readZip(buf){
  let eocd=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw Error('Not a ZIP archive');
  const entries=buf.readUInt16LE(eocd+10);let p=buf.readUInt32LE(eocd+16);const files=new Map();
  for(let n=0;n<entries;n++){
    if(buf.readUInt32LE(p)!==0x02014b50)throw Error('Corrupt ZIP directory');
    const method=buf.readUInt16LE(p+10),size=buf.readUInt32LE(p+20),nameLength=buf.readUInt16LE(p+28),extra=buf.readUInt16LE(p+30),comment=buf.readUInt16LE(p+32),local=buf.readUInt32LE(p+42);
    const name=buf.toString('utf8',p+46,p+46+nameLength);p+=46+nameLength+extra+comment;
    if(name.endsWith('/'))continue;
    const dataStart=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28),raw=buf.subarray(dataStart,dataStart+size);
    if(method!==0&&method!==8)throw Error('Unsupported ZIP compression in '+name);
    const data=method===0?Buffer.from(raw):inflateRawSync(raw);
    if(data.length>200000000)throw Error('ZIP entry too large');
    files.set(name,data);
  }
  return files;
}

// Group archive entries by folder, keyed by upper-case base filename, e.g. "Food" → {USER.DBU,…}.
export function libraryFolders(files){
  const groups=new Map();
  for(const [name,data]of files){
    const parts=name.split('/'),base=parts.pop(),folder=parts.join('/')||'.';
    if(!groups.has(folder))groups.set(folder,new Map());
    groups.get(folder).set(base.toUpperCase()==='USRSTRUC.DB'?'USRSTRUC.DB':base.toUpperCase(),data);
  }
  return [...groups].filter(([,f])=>f.has('USER.DBU'));
}
