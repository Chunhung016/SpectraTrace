// Small JCAMP-DX reader for NIST WebBook downloads: (X++(Y..Y)) with AFFN or ASDF
// (SQZ/DIF/DUP) compression, and (XY..XY) peak tables / point lists.
const SQZ={'@':0,A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,I:9,a:-1,b:-2,c:-3,d:-4,e:-5,f:-6,g:-7,h:-8,i:-9};
const DIF={'%':0,J:1,K:2,L:3,M:4,N:5,O:6,P:7,Q:8,R:9,j:-1,k:-2,l:-3,m:-4,n:-5,o:-6,p:-7,q:-8,r:-9};
const DUP={S:1,T:2,U:3,V:4,W:5,X:6,Y:7,Z:8,s:9};
const label=s=>s.replace(/[\s\-/\\_]/g,'').toUpperCase();

function isAffn(line){const parts=line.trim().split(/[\s,;]+/).filter(Boolean);return parts.length>0&&parts.every(p=>/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(p))}
function affnNumbers(line){return (line.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)||[]).map(Number)}
function tokens(line){
  const out=[];let cur=null;const push=()=>{if(cur&&cur.s!==''&&cur.s!=='-')out.push(cur);cur=null};
  for(const ch of line){
    if(ch in SQZ){push();cur={t:'abs',s:(SQZ[ch]<0?'-':'')+Math.abs(SQZ[ch])}}
    else if(ch in DIF){push();cur={t:'dif',s:(DIF[ch]<0?'-':'')+Math.abs(DIF[ch])}}
    else if(ch in DUP){push();cur={t:'dup',s:String(DUP[ch])}}
    else if(ch==='+'||ch==='-'){push();cur={t:'abs',s:ch==='-'?'-':''}}
    else if(/[0-9.]/.test(ch)){if(!cur)cur={t:'abs',s:''};cur.s+=ch}
    else push();
  }
  push();return out;
}
export function decodeLine(line){
  if(isAffn(line))return {values:affnNumbers(line),endsDif:false};
  const values=[];let last=null,lastDif=0,lastType=null;
  for(const tk of tokens(line)){
    if(tk.t==='abs'){last=Number(tk.s);values.push(last);lastType='abs'}
    else if(tk.t==='dif'){if(last===null)throw Error('DIF value without a preceding ordinate');lastDif=Number(tk.s);last+=lastDif;values.push(last);lastType='dif'}
    else{const n=Number(tk.s);if(last===null)throw Error('DUP without a value');for(let k=1;k<n;k++){if(lastType==='dif')last+=lastDif;values.push(last)}}
  }
  return {values,endsDif:lastType==='dif'};
}

function xyData(lines,info){
  const xf=Number(info.XFACTOR)||1,yf=Number(info.YFACTOR)||1,ys=[],lineX=[];let prevDif=false;
  for(const raw of lines){
    const line=raw.replace(/\$\$.*$/,'').trim();if(!line)continue;
    const {values,endsDif}=decodeLine(line);if(!values.length)continue;
    let y=values.slice(1);
    if(prevDif&&ys.length&&y.length){if(Math.abs(y[0]-ys.at(-1))>1e-9*Math.max(1,Math.abs(y[0])))throw Error('DIF checkpoint mismatch');y=y.slice(1)}
    lineX.push([values[0]*xf,ys.length]);ys.push(...y);prevDif=endsDif;
  }
  const n=Number(info.NPOINTS)||ys.length;
  if(ys.length!==n)throw Error('Decoded '+ys.length+' points; header says '+n);
  const first=Number(info.FIRSTX),last=Number(info.LASTX);
  let x;
  if(Number.isFinite(first)&&Number.isFinite(last)&&n>1)x=k=>first+(last-first)*k/(n-1);
  else if(lineX.length>1){const [x0,i0]=lineX[0],[x1,i1]=lineX.at(-1),dx=(x1-x0)/(i1-i0||1);x=k=>x0+dx*(k-i0)}
  else throw Error('Cannot determine x spacing');
  return ys.map((y,k)=>[x(k),y*yf]);
}
function pairs(lines,info){
  const xf=Number(info.XFACTOR)||1,yf=Number(info.YFACTOR)||1,nums=[];
  for(const raw of lines)nums.push(...affnNumbers(raw.replace(/\$\$.*$/,'')));
  if(nums.length%2)throw Error('Odd number of values in an (XY..XY) table');
  const out=[];for(let i=0;i<nums.length;i+=2)out.push([nums[i]*xf,nums[i+1]*yf]);return out;
}

export function parseJcamp(text){
  const lines=String(text).split(/\r?\n/),blocks=[];let block=null,i=0;
  while(i<lines.length){
    const m=lines[i].match(/^\s*##([^=]*)=(.*)$/);i++;if(!m)continue;
    const key=label(m[1]);let value=m[2];
    if(key==='TITLE'){block={info:{},points:null,dataKind:null};blocks.push(block)}
    if(!block){block={info:{},points:null,dataKind:null};blocks.push(block)}
    if(key==='END'){block=null;continue}
    if(['XYDATA','PEAKTABLE','XYPOINTS'].includes(key)){
      const body=[];while(i<lines.length&&!/^\s*##/.test(lines[i]))body.push(lines[i++]);
      const form=value.replace(/\s/g,'');
      block.points=/^\(X\+\+\(Y\.\.Y\)\)$/i.test(form)?xyData(body,block.info):pairs(body,block.info);
      block.dataKind=key==='XYDATA'&&/\+\+/.test(form)?'continuous':key==='PEAKTABLE'?'peaks':'points';continue;
    }
    while(i<lines.length&&!/^\s*##/.test(lines[i]))value+='\n'+lines[i++];
    block.info[key]=value.replace(/\$\$.*$/gm,'').trim();
  }
  return blocks.filter(b=>b.points?.length);
}

// Normalize a parsed NIST block into SpectraTrace units.
export function normalizeNistBlock(b){
  const type=String(b.info.DATATYPE||'').toUpperCase(),xu=String(b.info.XUNITS||'').toUpperCase(),yu=String(b.info.YUNITS||'').toUpperCase();
  let technique,points=b.points.filter(p=>p.every(Number.isFinite)),xUnit,yMode,note='';
  if(/INFRARED/.test(type)){
    technique='ftir';xUnit='cm-1';
    if(/MICROMETER|MICRON/.test(xu)){points=points.filter(p=>p[0]>0).map(([x,y])=>[1e4/x,y]);note='Converted from micrometres to cm⁻¹ (10⁴/λ). '}
    else if(!/1\/CM|CM-1|CM\^-1/.test(xu))throw Error('Unsupported IR x units '+xu);
    yMode=/ABSORBANCE/.test(yu)?'absorbance':/TRANSMITTANCE/.test(yu)?(points.some(p=>p[1]>1.5)?'transmittance-percent':'transmittance-fraction'):null;
    if(!yMode)throw Error('Unsupported IR y units '+yu);
  }else if(/MASS/.test(type)){
    technique='ms';xUnit='m/z';yMode='relative-abundance';
  }else if(/UV|VIS/.test(type)){
    technique='uv';
    if(/NANOMET(?:ER|RE)|\bNM\b/.test(xu))xUnit='nm';
    else if(/1\s*\/\s*CM|CM\s*(?:\^?\s*-1)|WAVENUMBER/.test(xu)){points=points.filter(p=>p[0]>0).map(([x,y])=>[1e7/x,y]);xUnit='nm';note='Converted from cm⁻¹ to nm (10⁷/ν̃). '}
    else if(/ANGSTROM|Å/.test(xu)){points=points.filter(p=>p[0]>0).map(([x,y])=>[x/10,y]);xUnit='nm';note='Converted from Å to nm (λ/10). '}
    else throw Error('Unsupported UV x units '+xu);
    yMode=/LOG/.test(yu)&&/EPSILON|MOLAR/.test(yu)?'log-epsilon':/EPSILON|MOLAR/.test(yu)?'epsilon':/ABSORBANCE/.test(yu)?'absorbance':'intensity';
  }else throw Error('Unsupported JCAMP data type '+type);
  points.sort((a,c)=>a[0]-c[0]);
  const unique=[];for(const p of points)if(!unique.length||p[0]!==unique.at(-1)[0])unique.push(p);
  if(unique.length<(technique==='ms'?1:3))throw Error('Too few points');
  return {technique,xUnit,yMode,format:technique==='ms'?'peaks':'continuous',points:unique,range:[unique[0][0],unique.at(-1)[0]],note,header:b.info};
}
