export const units = {ftir:'cm-1',h1:'ppm',c13:'ppm',uv:'nm',xrd:'2theta-deg',fluorescence:'nm',raman:'cm-1',ms:'m/z'};
const numeric=c=>/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(c);
function table(buffer){
  const text=buffer.toString('utf8').replace(/^\uFEFF/,'');
  if(text.includes('\u0000'))throw Error('Binary file: export numerical CSV/TXT.');
  const lines=text.split(/\r?\n/).filter(l=>l.trim()&&!/^\s*[#;]/.test(l));
  if(!lines.length)throw Error('Empty numerical file.');
  const delimiter=lines[0].includes(',')?',':lines[0].includes('\t')?'\t':lines[0].includes(';')?';':null;
  const split=line=>delimiter?line.split(delimiter).map(s=>s.trim().replace(/^"|"$/g,'')):line.trim().split(/\s+/);
  const first=split(lines[0]),header=!first.every(numeric),rows=lines.slice(header?1:0).map(split);
  return {headers:header?first:first.map((_,i)=>i?'Trace '+i:'x'),rows,header};
}
export function inspectSpectrum(buffer){const t=table(buffer),valid=t.rows.filter(r=>r.length===t.headers.length&&r.every(numeric));if(valid.length<3)throw Error('At least three numerical rows required.');if(valid.length>200000)throw Error('Maximum 200,000 points.');let low=Infinity,high=-Infinity;for(const r of valid){low=Math.min(low,Number(r[0]));high=Math.max(high,Number(r[0]))}return {headers:t.headers,rows:valid.length,xRange:[low,high],traces:t.headers.slice(1).map((name,i)=>({name,column:i+1,yMode:/transmittance|%t/i.test(name)?'transmittance-percent':/absorbance/i.test(name)?'absorbance':'intensity',normalized:/normaliz/i.test(name)}))};}
export function parseSpectrum(buffer, technique, metadata={}) {
  if(!units[technique]) throw Error('Unsupported technique');
  const text=buffer.toString('utf8').replace(/^\uFEFF/,'');
  if(text.includes('\u0000') || !/^[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]*$/.test(text)) throw Error('Binary instrument file archived; export a two-column CSV/TXT for comparison.');
  if(/##/.test(text)) throw Error('JCAMP-DX archived, not parsed in this version. Export uncompressed two-column CSV/TXT.');
  const points=[]; let ignored=0;const t=table(buffer),column=Number(metadata.yColumn||1);
  if(!Number.isInteger(column)||column<1||column>=t.headers.length)throw Error('Select an existing intensity column.');
  if(t.headers.length>2&&!metadata.yColumn)throw Error('Multiple traces: choose the intensity column explicitly.');
  for(const cols of t.rows) {
    if(cols.length!==t.headers.length || !cols.every(numeric)) {ignored++;continue;}
    const x=Number(cols[0]),y=Number(cols[column]); if(!Number.isFinite(x)||!Number.isFinite(y)) throw Error('Non-finite numerical value.');
    points.push([x,y]);
  }
  if(points.length<3) throw Error('At least 3 two-column data points required. Columns: x, intensity.');
  if(points.length>200000) throw Error('Maximum 200,000 points; original archived. Export a reduced trace.');
  if(ignored>5) throw Error('Too many unrecognized rows; file archived without interpretation. Use a plain two-column CSV/TXT.');
  if(metadata.xUnit!==units[technique]) throw Error(`Expected x units ${units[technique]}; no automatic conversion is performed.`);
  if(!['continuous','peaks'].includes(metadata.format)) throw Error('Specify continuous trace or peak list.');
  if(['ftir','uv'].includes(technique)&&metadata.format!=='continuous') throw Error('FTIR/UV requires a continuous trace in this version.');
  const range = {ftir:[100,10000],h1:[-20,40],c13:[-50,350],uv:[100,1500],xrd:[0,180],fluorescence:[100,2000],raman:[0,10000],ms:[1,5000]}[technique];
  if(points.some(([x])=>x<range[0]||x>range[1])) throw Error(`x values outside supported ${technique} range (${range.join(' to ')} ${units[technique]}). Check units.`);
  const sorted=points.sort((a,b)=>a[0]-b[0]);
  if(sorted.some((p,i)=>i&&p[0]===sorted[i-1][0])) throw Error('Duplicate x values; export unique x coordinates.');
  if(sorted.at(-1)[0]===sorted[0][0] || metadata.format==='continuous' && sorted.every(p=>p[1]===sorted[0][1])) throw Error('Spectrum has no variation.');
  if(!['absorbance','transmittance-percent','intensity'].includes(metadata.yMode)) throw Error('Specify the intensity convention.');
  if(metadata.yMode==='transmittance-percent'&&(technique!=='ftir'||points.some(p=>p[1]<=0||p[1]>100))) throw Error('FTIR transmittance must be in (0,100] percent.');
  if(metadata.yMode==='intensity'&&points.some(p=>p[1]<0)&&metadata.format==='peaks') throw Error('Peak intensities must be nonnegative.');
  return {points:sorted,ignoredRows:ignored,range:[sorted[0][0],sorted.at(-1)[0]],selectedColumn:column,selectedHeader:t.headers[column],columnHeaders:t.headers,algorithm:'explicit-column-csv-v2'};
}
function values(spectrum, grid) {
  const p=spectrum.parsed.points; const m=spectrum.metadata;
  const val=y=>m.yMode==='transmittance-percent'?-Math.log10(y/100):y;
  if(m.format==='peaks') {
    const width=spectrum.technique==='h1'?.025:.3;
    return grid.map(x=>p.reduce((sum,[px,py])=>sum+Math.max(0,py)*Math.exp(-.5*((x-px)/width)**2),0));
  }
  let i=0;
  return grid.map(x=>{while(i<p.length-2&&p[i+1][0]<x)i++;const [ax,ay]=p[i], [bx,by]=p[i+1];return val(ay)+(val(by)-val(ay))*(x-ax)/(bx-ax)});
}
export function compareSpectra(a,b) {
  if(a.technique!==b.technique || a.metadata.format!==b.metadata.format || a.metadata.xUnit!==b.metadata.xUnit) return {eligible:false,reason:'Different technique, units or data format'};
  // Conditions gate rather than silently mixing solvent/phase/IR mode.
  const fields=a.technique==='ftir'?['phase','measurement',...((a.metadata.phase==='solution'||a.metadata.solvent||b.metadata.solvent)?['solvent']:[])]:a.technique==='xrd'?['phase','radiation','polymorph']:a.technique==='fluorescence'?['solvent','excitation']:a.technique==='ms'?['ionization']:['solvent'];
  for(const f of fields) if(!a.metadata[f]||!b.metadata[f]||/^(unknown|not known)$/i.test(a.metadata[f])||a.metadata[f].trim().toLowerCase()!==b.metadata[f].trim().toLowerCase()) return {eligible:false,reason:`Missing or different ${f}`};
  const [al,ah]=a.parsed.range,[bl,bh]=b.parsed.range;
  const lo=Math.max(al,bl),hi=Math.min(ah,bh),coverage=(hi-lo)/Math.max(ah-al,bh-bl);
  if(hi<=lo||coverage<.7) return {eligible:false,reason:'Less than 70% shared x-range'};
  const n= a.technique==='h1'||a.technique==='c13'?4096:1024;
  const grid=Array.from({length:n},(_,i)=>lo+i*(hi-lo)/(n-1));
  const norm=arr=>{const min=Math.min(...arr);return arr.map(x=>x-min)};
  const av=norm(values(a,grid)), bv=norm(values(b,grid));
  let dot=0,aa=0,bb=0;for(let i=0;i<n;i++){dot+=av[i]*bv[i];aa+=av[i]**2;bb+=bv[i]**2;}
  if(!aa||!bb)return {eligible:false,reason:'Flat shared range'};
  return {eligible:true,similarity:Math.max(0,Math.min(1,dot/Math.sqrt(aa*bb))),coverage,range:[lo,hi],method:'Resampled, minimum-offset cosine similarity v1',warning:'Not a probability or proof of identity. No peak assignment, calibration, shift alignment or mixture deconvolution.'};
}
