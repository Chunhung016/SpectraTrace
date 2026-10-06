// Educational interval rules; not a trained classifier or an identification probability.
export const interpretationVersion='ftir-screen-v1';
export const interpretationSources=[{title:'Michigan State University — infrared spectroscopy',url:'https://www2.chemistry.msu.edu/faculty/reusch/virttxtjml/spectrpy/infrared/irspec1.htm'},{title:'Thermo Fisher — identify an unknown sample with ATR',url:'https://knowledge1.thermofisher.com/Molecular_Spectroscopy/Molecular_Spectroscopy_Software/OMNIC_Family/OMNIC_Paradigm_Software/OMNIC_Paradigm_Operator_Manuals/Latest_OMNIC_Paradigm_User_Guide/Identify_an_Unknown_Sample_with_ATR'}];
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]||0};
export function interpretFtir(spectrum){
  if(!spectrum?.parsed?.points?.length)throw Error(spectrum?.parse_error||'No numerical FTIR trace.');
  const meta=spectrum.metadata||{};
  if(!['absorbance','transmittance-percent'].includes(meta.yMode))throw Error('Functional-group screening requires absorbance or % transmittance, not reflectance or an unspecified intensity.');
  const raw=spectrum.parsed.points,points=raw.filter(([x])=>x>=400&&x<=4000).map(([x,y])=>[x,meta.yMode==='transmittance-percent'?-Math.log10(y/100):y]);
  if(points.length<30||points.at(-1)[0]-points[0][0]<600)throw Error('Too little mid-IR coverage for functional-group screening.');
  const dx=median(points.slice(1).map((p,i)=>p[0]-points[i][0])),half=Math.max(1,Math.min(25,Math.round(3/dx))),smooth=points.map((p,i)=>[p[0],median(points.slice(Math.max(0,i-half),Math.min(points.length,i+half+1)).map(q=>q[1]))]);
  const ys=smooth.map(p=>p[1]),min=Math.min(...ys),max=Math.max(...ys),span=max-min,noise=median(points.map((p,i)=>Math.abs(p[1]-smooth[i][1])))*1.4826,threshold=Math.max(span*.025,noise*6,.002),found=[];
  for(let i=1;i<smooth.length-1;i++){
    if(ys[i]<=ys[i-1]||ys[i]<ys[i+1])continue;
    const reach=Math.max(3,Math.round(65/dx)),left=Math.min(...ys.slice(Math.max(0,i-reach),i)),right=Math.min(...ys.slice(i+1,Math.min(ys.length,i+reach+1))),prom=ys[i]-Math.max(left,right);
    if(prom<threshold)continue;
    let l=i,r=i;const mid=ys[i]-prom/2;while(l>0&&ys[l]>mid)l--;while(r<ys.length-1&&ys[r]>mid)r++;
    found.push({x:smooth[i][0],absorbance:ys[i],prominence:prom,width:smooth[r][0]-smooth[l][0],fingerprint:smooth[i][0]<1500,artifact:false});
  }
  const peaks=[];for(const p of found.sort((a,b)=>b.prominence-a.prominence))if(!peaks.some(q=>Math.abs(q.x-p.x)<12))peaks.push(p);peaks.sort((a,b)=>a.x-b.x);
  for(const p of peaks)p.artifact=(p.x>=2250&&p.x<=2420)||(p.x>=3700&&p.x<=4000)||p.width<Math.max(dx*3,2);
  const inBand=(lo,hi)=>peaks.filter(p=>p.x>=lo&&p.x<=hi&&!p.artifact),features=[];
  const add=(id,label,lo,hi,groups,note,weight=1)=>{const bands=inBand(lo,hi);if(bands.length)features.push({id,label,range:[lo,hi],peaks:bands.map(p=>p.x),groups,note,weight})};
  add('carbonyl','C=O possible',1650,1800,['carbonyl'],'Carbonyl class remains ambiguous; water bending, conjugation and amides need manual review.',2);
  add('xh','O–H / N–H possible',3200,3670,['alcohol','phenol','acid','nh'],'Water, hydrogen bonding and exchange can contribute.',1);
  add('nitrile','C≡N / C≡C possible',2100,2250,['nitrile','alkyne'],'Weak alkyne bands may be absent; inspect the original trace.',2);
  const rings=inBand(1490,1620),oop=inBand(650,900);if(rings.length>=2&&oop.length)features.push({id:'aromatic',label:'Aromatic ring possible',range:[650,1620],peaks:[...rings,...oop].map(p=>p.x),groups:['aromatic'],note:'Multiple ring-region and out-of-plane bands are consistent with, not proof of, an aromatic ring.',weight:1});
  add('co','C–O / C–N region',1000,1300,['ether','ester','alcohol','phenol','amide','amine'],'Overlapping fingerprint bands; not used as a hard identity filter.',.5);
  const ch=inBand(2800,3000);if(ch.length)features.push({id:'ch',label:'Aliphatic C–H possible',range:[2800,3000],peaks:ch.map(p=>p.x),groups:[],note:'Common to many organic compounds.',weight:0});
  const warnings=['Tentative interval-based screening, not confirmed functional-group assignments.','Fingerprint peaks are detected, but no exact fingerprint identification is claimed without compatible measured references.','A compound absent from the catalog, mixture, polymer or inorganic material may have no suitable candidate.'];
  if(meta.normalized==='true'||/normaliz/i.test(spectrum.parsed.selectedHeader||''))warnings.push('The chosen column is normalized. Absorbance conversion is a display/feature transform, not a quantitative absorbance measurement.');
  if(noise>span*.04)warnings.push('High noise relative to signal: peak detection may miss or misassign bands.');
  if(!meta.phase||meta.phase==='unknown'||!meta.measurement||meta.measurement==='unknown')warnings.push('Unknown physical state or measurement mode limits experimental comparison.');
  if(meta.sampleType==='mixture')warnings.push('Mixture selected: a single-compound structure is not a complete sample identification.');
  if(points[0][0]>650||points.at(-1)[0]<3600)warnings.push('Incomplete mid-IR coverage; absence of unmeasured bands is not scored.');
  return {version:interpretationVersion,features,peaks,rawPointCount:raw.length,screenRange:[points[0][0],points.at(-1)[0]],stepCm1:dx,noiseEstimate:noise,fingerprint:{range:[Math.max(400,points[0][0]),Math.min(1500,points.at(-1)[0])],peaks:peaks.filter(p=>p.fingerprint&&!p.artifact).map(p=>p.x)},conditions:meta,warnings,sources:interpretationSources,eligibleForMatching:false};
}
export function screenCatalog(analysis,entries){
  const clues=analysis.features.filter(f=>f.weight>=1&&f.groups.length);
  if(!clues.length)return [];
  const ranked=entries.map(c=>{const profile=typeof c.profile==='string'?JSON.parse(c.profile):c.profile,ids=new Set(profile.functionalGroups.filter(g=>(g.siteCount??g.count??0)>0).map(g=>g.id)),supported=[],unexplained=[];let score=0;
    for(const f of clues){if(f.groups.some(id=>ids.has(id))){score+=f.weight;supported.push(f.label)}else unexplained.push(f.label)}
    const carbonyl=ids.has('carbonyl')||['acid','ester','amide','aldehyde','ketone'].some(id=>ids.has(id))||/(?:[cC](?:\d|%\d{2})*(?:\(=O\)|=O)|O=[cC])/.test(c.smiles||'');
    if(carbonyl&&!analysis.features.some(f=>f.id==='carbonyl')&&analysis.screenRange[0]<=1650&&analysis.screenRange[1]>=1800){score-=.5;unexplained.push('Expected C=O not clearly detected; check manually')}
    return {compound:{id:c.id,name:c.name,formula:c.formula,smiles:c.smiles},supported,unexplained,ruleScore:score,kind:'structure-screen',eligibleForMatching:false};
  }).filter(c=>c.ruleScore>0);
  ranked.sort((a,b)=>b.ruleScore-a.ruleScore||a.unexplained.length-b.unexplained.length||a.compound.name.localeCompare(b.compound.name));return ranked;
}
