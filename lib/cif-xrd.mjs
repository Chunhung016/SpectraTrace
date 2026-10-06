// Powder XRD pattern calculated from a crystal structure (CIF): kinematic diffraction
// with Cromer–Mann atomic scattering factors, isotropic Debye–Waller damping and the
// Lorentz-polarisation factor. Theory from a real structure — not a measured pattern;
// preferred orientation, absorption, peak shape and instrument effects are not modelled.
export const XRD_CALC_VERSION='cif-kinematic-v1';
const CM={H:[[0.489918,0.262003,0.196767,0.049879],[20.6593,7.74039,49.5519,2.20159],0.001305],C:[[2.31,1.02,1.5886,0.865],[20.8439,10.2075,0.5687,51.6512],0.2156],N:[[12.2126,3.1322,2.0125,1.1663],[0.0057,9.8933,28.9975,0.5826],-11.529],O:[[3.0485,2.2868,1.5463,0.867],[13.2771,5.7011,0.3239,32.9089],0.2508],F:[[3.5392,2.6412,1.517,1.0243],[10.2825,4.2944,0.2615,26.1476],0.2776],Na:[[4.7626,3.1736,1.2674,1.1128],[3.285,8.8422,0.3136,129.424],0.676],Mg:[[5.4204,2.1735,1.2269,2.3073],[2.8275,79.2611,0.3808,7.1937],0.8584],Si:[[6.2915,3.0353,1.9891,1.541],[2.4386,32.3337,0.6785,81.6937],1.1407],P:[[6.4345,4.1791,1.78,1.4908],[1.9067,27.157,0.526,68.1645],1.1149],S:[[6.9053,5.2034,1.4379,1.5863],[1.4679,22.2151,0.2536,56.172],0.8669],Cl:[[11.4604,7.1964,6.2556,1.6455],[0.0104,1.1662,18.5194,47.7784],-9.5574],K:[[8.2186,7.4398,1.0519,0.8659],[12.7949,0.7748,213.187,41.6841],1.4228],Ca:[[8.6266,7.3873,1.5899,1.0211],[10.4421,0.6599,85.7484,178.437],1.3751],Fe:[[11.7695,7.3573,3.5222,2.3045],[4.7611,0.3072,15.3535,76.8805],1.0369],Cu:[[13.338,7.1676,5.6158,1.6735],[3.5828,0.247,11.3966,64.8126],1.191],Zn:[[14.0743,7.0318,5.1652,2.41],[3.2655,0.2333,10.3163,58.7097],1.3041],Br:[[17.1789,5.2358,5.6377,3.9851],[2.1723,16.5796,0.2609,41.4328],2.9557],I:[[20.1472,18.9949,7.5138,2.2735],[4.347,0.3814,27.766,66.8776],4.0712],Li:[[1.1282,0.7508,0.6175,0.4653],[3.9546,1.0524,85.3905,168.261],0.0377],B:[[2.0545,1.3326,1.0979,0.7068],[23.2185,1.021,60.3498,0.1403],-0.1932]};
const Z={H:1,Li:3,B:5,C:6,N:7,O:8,F:9,Na:11,Mg:12,Al:13,Si:14,P:15,S:16,Cl:17,K:19,Ca:20,Mn:25,Fe:26,Co:27,Ni:28,Cu:29,Zn:30,Ga:31,Ge:32,As:33,Se:34,Br:35,Ag:47,Cd:48,Sn:50,Sb:51,Te:52,I:53,Ba:56,Pt:78,Au:79,Hg:80,Pb:82};
function scattering(el,s2){const t=CM[el];if(t)return t[0].reduce((f,a,i)=>f+a*Math.exp(-t[1][i]*s2),t[2]);const z=Z[el]||6;return z*Math.exp(-10*s2)}

export function tokenizeCif(text){
  const tokens=[],lines=String(text).replace(/\r/g,'').split('\n');
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(line.startsWith(';')){let v=line.slice(1);for(i++;i<lines.length&&!lines[i].startsWith(';');i++)v+='\n'+lines[i];tokens.push({v:v.trim(),q:true});continue}
    const re=/'((?:[^']|'(?=\S))*)'(?=\s|$)|"((?:[^"]|"(?=\S))*)"(?=\s|$)|(#.*$)|(\S+)/g;let m;
    while((m=re.exec(line))){if(m[3])break;tokens.push(m[4]!=null?{v:m[4],q:false}:{v:m[1]??m[2],q:true})}
  }
  return tokens;
}
export function parseCif(text){
  const t=tokenizeCif(text),items={},loops=[];let i=0;
  while(i<t.length){
    const tok=t[i];
    if(!tok.q&&/^data_/i.test(tok.v)){if(Object.keys(items).length)break;i++;continue}
    if(!tok.q&&/^loop_$/i.test(tok.v)){i++;const names=[];while(i<t.length&&!t[i].q&&t[i].v.startsWith('_'))names.push(t[i++].v.toLowerCase());const rows=[];while(i<t.length&&!(!t[i].q&&(/^(loop_|data_)/i.test(t[i].v)||t[i].v.startsWith('_')))){const row=[];for(let k=0;k<names.length&&i<t.length;k++)row.push(t[i++].v);if(row.length===names.length)rows.push(row)}loops.push({names,rows});continue}
    if(!tok.q&&tok.v.startsWith('_')){items[tok.v.toLowerCase()]=t[i+1]?.v;i+=2;continue}
    i++;
  }
  return {items,loops};
}
const num=v=>{if(v==null||v==='?'||v==='.')return NaN;return Number(String(v).replace(/\(\d+\)$/,''))};
function loopWith(loops,name){const l=loops.find(l=>l.names.includes(name));return l?l.rows.map(r=>Object.fromEntries(l.names.map((n,k)=>[n,r[k]]))):[]}
export function parseSymop(op){
  const rows=String(op).toLowerCase().replace(/\s/g,'').split(',');if(rows.length!==3)throw Error('Bad symmetry operator '+op);
  return rows.map(expr=>{const r=[0,0,0];let t=0;for(const m of expr.matchAll(/([+-]?)(\d+(?:\.\d+)?(?:\/\d+)?)?\*?([xyz])?/g)){if(!m[0])continue;const sign=m[1]==='-'?-1:1;let c=m[2]?(m[2].includes('/')?m[2].split('/').reduce((a,b)=>a/b):Number(m[2])):1;if(m[3])r['xyz'.indexOf(m[3])]+=sign*c;else if(m[2])t+=sign*c}return {r,t}});
}
export function structureFromCif(text){
  const {items,loops}=parseCif(text),cell=['a','b','c'].map(k=>num(items['_cell_length_'+k])),angles=['alpha','beta','gamma'].map(k=>num(items['_cell_angle_'+k]));
  if(cell.some(v=>!(v>0))||angles.some(v=>!(v>0)))throw Error('CIF has no complete unit cell');
  const opsRaw=[...loopWith(loops,'_symmetry_equiv_pos_as_xyz').map(r=>r._symmetry_equiv_pos_as_xyz),...loopWith(loops,'_space_group_symop_operation_xyz').map(r=>r._space_group_symop_operation_xyz)];
  const ops=(opsRaw.length?opsRaw:['x,y,z']).map(parseSymop);
  const sites=loopWith(loops,'_atom_site_fract_x').map(r=>{const type=(r._atom_site_type_symbol||r._atom_site_label||'').match(/^[A-Z][a-z]?/)?.[0];const uiso=num(r._atom_site_u_iso_or_equiv),biso=num(r._atom_site_b_iso_or_equiv);return {label:r._atom_site_label,el:type,x:[num(r._atom_site_fract_x),num(r._atom_site_fract_y),num(r._atom_site_fract_z)],occ:Number.isFinite(num(r._atom_site_occupancy))?num(r._atom_site_occupancy):1,B:Number.isFinite(biso)?biso:Number.isFinite(uiso)?8*Math.PI*Math.PI*uiso:3}}).filter(s=>s.el&&s.x.every(Number.isFinite));
  if(!sites.length)throw Error('CIF has no atom positions');
  const atoms=[];
  for(const s of sites)for(const op of ops){const p=op.map(({r,t})=>{let v=r[0]*s.x[0]+r[1]*s.x[1]+r[2]*s.x[2]+t;v-=Math.floor(v);return v>1-1e-6?0:v});if(!atoms.some(a=>a.el===s.el&&p.every((v,k)=>{const d=Math.abs(v-a.p[k]);return Math.min(d,1-d)<2e-3})))atoms.push({el:s.el,p,occ:s.occ,B:s.B})}
  const formula=items._chemical_formula_sum||'',name=items._chemical_name_common||items._chemical_name_systematic||'';
  return {cell,angles,ops:ops.length,sites:sites.length,atoms,formula,name,spaceGroup:items['_symmetry_space_group_name_h-m']||items['_space_group_name_h-m_alt']||'',codId:items._cod_database_code||''};
}
function reciprocalMetric([a,b,c],[al,be,ga]){
  const r=Math.PI/180,ca=Math.cos(al*r),cb=Math.cos(be*r),cg=Math.cos(ga*r);
  const G=[[a*a,a*b*cg,a*c*cb],[a*b*cg,b*b,b*c*ca],[a*c*cb,b*c*ca,c*c]];
  const det=G[0][0]*(G[1][1]*G[2][2]-G[1][2]*G[2][1])-G[0][1]*(G[1][0]*G[2][2]-G[1][2]*G[2][0])+G[0][2]*(G[1][0]*G[2][1]-G[1][1]*G[2][0]);
  const inv=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++){const m=[0,1,2].filter(k=>k!==j),n=[0,1,2].filter(k=>k!==i);inv[i][j]=((i+j)%2?-1:1)*(G[m[0]][n[0]]*G[m[1]][n[1]]-G[m[0]][n[1]]*G[m[1]][n[0]])/det}
  return {Gs:inv,volume:Math.sqrt(det)};
}
export function powderPattern(structure,{wavelength=1.5406,min=3,max=50,step=.02,fwhm=.12}={}){
  const {Gs,volume}=reciprocalMetric(structure.cell,structure.angles),dmin=wavelength/(2*Math.sin(max*Math.PI/360));
  const lim=structure.cell.map(v=>Math.ceil(v/dmin)+1),refl=new Map();
  for(let h=-lim[0];h<=lim[0];h++)for(let k=-lim[1];k<=lim[1];k++)for(let l=-lim[2];l<=lim[2];l++){
    if(!h&&!k&&!l)continue;const q=[h,k,l],inv=q.reduce((s,qi,i)=>s+q.reduce((t,qj,j)=>t+qi*Gs[i][j]*qj,0),0);if(!(inv>0))continue;
    const d=1/Math.sqrt(inv);if(d<dmin)continue;const sinT=wavelength/(2*d);if(sinT>=1)continue;
    const theta=Math.asin(sinT),tt=2*theta*180/Math.PI;if(tt<min)continue;const s2=(sinT/wavelength)**2;
    let re=0,im=0;for(const a of structure.atoms){const f=a.occ*scattering(a.el,s2)*Math.exp(-a.B*s2),ph=2*Math.PI*(h*a.p[0]+k*a.p[1]+l*a.p[2]);re+=f*Math.cos(ph);im+=f*Math.sin(ph)}
    const F2=re*re+im*im;if(F2<1e-6)continue;
    const lp=(1+Math.cos(2*theta)**2)/(Math.sin(theta)**2*Math.cos(theta)),I=F2*lp,key=tt.toFixed(3);
    const cur=refl.get(key)||{twoTheta:tt,d,intensity:0,hkl:[h,k,l],best:0};cur.intensity+=I;
    // Label with the most positive-looking member of the symmetry-equivalent set.
    const score=(h>=0)+(k>=0)+(l>=0)+(h>=k)*.1;if(score>cur.best){cur.best=score;cur.hkl=[h,k,l]}refl.set(key,cur);
  }
  const reflections=[...refl.values()].sort((a,b)=>a.twoTheta-b.twoTheta),top=Math.max(...reflections.map(r=>r.intensity));
  for(const r of reflections){r.intensity=100*r.intensity/top;delete r.best}
  const sigma=fwhm/2.3548,points=[];
  for(let x=min;x<=max+1e-9;x+=step){let y=0;for(const r of reflections){const z=(x-r.twoTheta)/sigma;if(Math.abs(z)<5)y+=r.intensity*Math.exp(-.5*z*z)}points.push([Number(x.toFixed(3)),y])}
  const pmax=Math.max(...points.map(p=>p[1]))||1;
  return {points:points.map(([x,y])=>[x,Number((100*y/pmax).toFixed(4))]),reflections:reflections.filter(r=>r.intensity>=.2).map(r=>({...r,twoTheta:Number(r.twoTheta.toFixed(3)),d:Number(r.d.toFixed(4)),intensity:Number(r.intensity.toFixed(2))})),wavelength,volume,fwhm};
}
const hklText=h=>'('+h.map(v=>v<0?'-'+Math.abs(v):v).join(h.some(v=>Math.abs(v)>9)?',':'')+')';
export function patternLabels(reflections,count=14){
  const out={};for(const r of [...reflections].sort((a,b)=>b.intensity-a.intensity).slice(0,count))out[r.twoTheta]=hklText(r.hkl);return out;
}
