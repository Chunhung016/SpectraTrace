// T (theory) spectra for techniques the bank has no measured record for.
// Independently authored teaching rules — like the existing FTIR/NMR/UV T envelopes —
// never measured data, never eligible for matching. Every component carries its rule.
export const THEORY_VERSION='teaching-theory-v1';

const MONO={H:1,C:12,N:14,O:16,F:19,Na:23,Si:28,P:31,S:32,Cl:35,K:39,Br:79,I:127,B:11};
const ISO={H:[[1,.999885],[2,.000115]],C:[[12,.9893],[13,.0107]],N:[[14,.99636],[15,.00364]],O:[[16,.99757],[17,.00038],[18,.00205]],F:[[19,1]],Na:[[23,1]],Si:[[28,.92223],[29,.04685],[30,.03092]],P:[[31,1]],S:[[32,.9499],[33,.0075],[34,.0425],[36,.0001]],Cl:[[35,.7576],[37,.2424]],K:[[39,.932581],[41,.067302]],Br:[[79,.5069],[81,.4931]],I:[[127,1]],B:[[10,.199],[11,.801]]};
export function formulaCounts(f){
  const s=String(f||'').trim().replace(/[+-]\d*$/,'');if(!s||/[.·•()]/.test(s))return null;const out={};
  for(const m of s.matchAll(/([A-Z][a-z]?)(\d*)/g)){if(!MONO[m[1]])return null;out[m[1]]=(out[m[1]]||0)+(m[2]?Number(m[2]):1)}
  return s.replace(/([A-Z][a-z]?)(\d*)/g,'')===''?out:null;
}
const nominal=c=>Object.entries(c).reduce((n,[e,k])=>n+MONO[e]*k,0);
const minus=(a,b)=>{const out={...a};for(const [e,k]of Object.entries(b)){out[e]=(out[e]||0)-k;if(out[e]<0)return null;if(!out[e])delete out[e]}return out};
const hill=c=>['C','H',...Object.keys(c).filter(e=>e!=='C'&&e!=='H').sort()].filter(e=>c[e]).map(e=>e+(c[e]>1?c[e]:'')).join('');
function cluster(c){let d=new Map([[0,1]]);for(const [e,n]of Object.entries(c))for(let k=0;k<n;k++){const next=new Map();for(const [m,p]of d)for(const [mass,ab]of ISO[e]){const q=p*ab;if(q<1e-9)continue;next.set(m+mass,(next.get(m+mass)||0)+q)}d=next}return d}
const F=s=>formulaCounts(s);

// EI-MS teaching spectrum: molecular ion + textbook cleavages selected by functional groups.
export function theoreticalMs(formula,profile,smiles=''){
  const M=formulaCounts(formula);if(!M||!M.C)return null;
  const groups=new Map((profile?.functionalGroups||[]).map(g=>[g.id,g.siteCount])),has=id=>groups.has(id),aromatic=has('aromatic'),smi=String(profile?.canonicalSmiles||smiles||'');
  const arH=(profile?.h1?.atomEnvironments||[]).filter(a=>/Aromatic/.test(a.environment)).reduce((n,a)=>n+(a.count||1),0),phenyl=aromatic&&arH>=5;
  const ions=[];const add=(label,rule,f,weight)=>{if(!f)return;const m=nominal(f);if(m<14||m>nominal(M))return;ions.push({label,rule,formula:hill(f),counts:f,weight})};
  const loss=(label,rule,lost,w)=>add(label,rule,minus(M,F(lost)),w);
  add('M⁺·','Molecular ion; stabilised by aromatic/π systems, weak for alcohols, amines and acids',M,aromatic?(has('acid')||has('alcohol')?.35:.85):has('alcohol')||has('amine')||has('acid')?.12:.45);
  if(M.C>1&&M.H>=3&&/C/.test(smi.replace(/Cl/g,'')))loss('[M−CH₃]⁺','α-cleavage / loss of a methyl radical','CH3',.25);
  if(phenyl){add('C₆H₅⁺','Phenyl cation from aromatic rings',F('C6H5'),.35);add('C₄H₃⁺','Phenyl ring fragmentation (77 → 51)',F('C4H3'),.15)}
  if(phenyl&&/(^|[^(=])Cc1ccccc1|c1ccccc1C(?![(=lO])|c1ccc\(C\)cc1/.test(smi)){add('C₇H₇⁺','Benzylic cleavage → tropylium ion',F('C7H7'),.9);add('C₅H₅⁺','Tropylium loses C₂H₂',F('C5H5'),.2)}
  if(phenyl&&/c1ccccc1C\(=O\)|O=C\(c1ccccc1|C\(=O\)c1ccccc1/.test(smi)){add('C₆H₅CO⁺','Benzoyl acylium ion',F('C7H5O'),1);add('C₆H₅⁺','Benzoyl loses CO',F('C6H5'),.55)}
  if(/CC\(=O\)|C\(C\)=O|CC\(C\)=O/.test(smi)||/^CC\(=O\)/.test(smi)){add('CH₃CO⁺','Acetyl acylium ion (m/z 43)',F('C2H3O'),.65)}
  const arylAcetate=aromatic&&/(CC\(=O\)Oc|OC\(C\)=O)/.test(smi);
  if(arylAcetate){loss('[M−CH₂=C=O]⁺·','Aryl acetate loses ketene (42 u)','C2H2O',.7);if(has('acid'))loss('[M−C₂H₂O−H₂O]⁺·','ortho-Hydroxy acid then loses water','C2H4O2',.6)}
  if(has('acid')){loss('[M−OH]⁺','Carboxylic acid loses ·OH','HO',.4);loss('[M−COOH]⁺','Loss of ·COOH','CHO2',.3);add('COOH⁺','Carboxyl cation (m/z 45)',F('CHO2'),.12);if(aromatic&&has('phenol'))loss('[M−H₂O]⁺·','ortho-Effect water loss','H2O',.5)}
  if(has('ester')&&!arylAcetate){if(/C\(=O\)OC(?!C)|COC\(=O\)/.test(smi))loss('[M−OCH₃]⁺','Methyl ester α-cleavage','CH3O',.5);else if(/C\(=O\)OCC|CCOC\(=O\)/.test(smi))loss('[M−OC₂H₅]⁺','Ethyl ester α-cleavage','C2H5O',.5);else loss('[M−OR]⁺','Ester α-cleavage (alkoxy loss, generic)','CH3O',.25)}
  if(has('amide')){add('CONH₂⁺','Primary amide fragment (m/z 44)',F('CH2NO'),.3);if(aromatic)loss('[M−NH₃]⁺·','Amide loses NH₃','H3N',.15)}
  if(has('alcohol')){loss('[M−H₂O]⁺·','Dehydration of alcohols','H2O',.4);add('CH₂OH⁺','α-Cleavage of primary alcohols (m/z 31)',F('CH3O'),.3)}
  if(has('phenol'))loss('[M−CO]⁺·','Phenols lose CO','CO',.3);
  if(has('amine')){add('CH₂=NH₂⁺','Amine α-cleavage (m/z 30)',F('CH4N'),.6);loss('[M−H]⁺','Amines lose α-H','H',.15)}
  if(has('nitro')){loss('[M−NO₂]⁺','Nitro compounds lose ·NO₂','NO2',.5);loss('[M−NO]⁺','Nitro → nitrite rearrangement, loss of NO','NO',.2)}
  if(has('nitrile'))loss('[M−HCN]⁺·','Nitriles lose HCN','CHN',.2);
  if(has('sulfone'))loss('[M−SO₂]⁺·','Sulfones lose SO₂','O2S',.3);
  if(has('ether')&&/COc/.test(smi)){loss('[M−CH₃]⁺','Aryl methyl ether loses ·CH₃','CH3',.3);loss('[M−CH₂O]⁺·','Aryl methyl ether loses CH₂O','CH2O',.2)}
  for(const [x,lost,w]of [['Cl','Cl',.4],['Br','Br',.5],['I','I',.5]])if(M[x])loss('[M−'+x+']⁺','Carbon–halogen cleavage',lost,w);
  const chain=(smi.match(/CCCC/g)||[]).length;
  if(chain){add('C₃H₇⁺','Alkyl chain series (CₙH₂ₙ₊₁⁺)',F('C3H7'),.5);add('C₄H₉⁺','Alkyl chain series',F('C4H9'),.55);add('C₅H₁₁⁺','Alkyl chain series',F('C5H11'),.3);add('C₂H₅⁺','Alkyl chain series',F('C2H5'),.25)}
  const bins=new Map(),labels=new Map();
  for(const ion of ions){const d=cluster(ion.counts);let first=true;for(const [m,p]of [...d].sort((a,b)=>a[0]-b[0])){bins.set(m,(bins.get(m)||0)+ion.weight*p);if(first){labels.set(m,[...(labels.get(m)||[]),ion.label]);first=false}}}
  const max=Math.max(...bins.values());const points=[...bins].filter(([,v])=>v/max>=.004).sort((a,b)=>a[0]-b[0]).map(([m,v])=>[m,Number((999*v/max).toFixed(1))]);
  return {technique:'ms',points,xUnit:'m/z',yMode:'relative-abundance',format:'peaks',ions:ions.map(({counts,...i})=>({...i,mz:nominal(counts)})),ionLabels:Object.fromEntries([...labels].map(([m,l])=>[m,l.join(' / ')])),limitations:['T · textbook EI cleavage rules chosen from functional groups; relative heights are teaching weights, not predicted abundances.','Rearrangements, competing pathways and instrument effects are not modelled; real spectra can differ strongly.']};
}

const gaussGrid=(start,end,step,components)=>{const out=[];for(let x=start;x<=end+1e-9;x+=step){let y=0;for(const c of components){const z=(x-c.centre)/c.sigma;if(Math.abs(z)<6)y+=c.weight*Math.exp(-.5*z*z)}out.push([Number(x.toFixed(3)),y])}const max=Math.max(...out.map(p=>p[1]))||1;return out.map(([x,y])=>[x,Number((y/max).toFixed(5))])};
const RAMAN_ACTIVITY={'carbonyl-region':.45,'acid-oh':.08,hydroxyl:.08,'neutral-nh':.15,'carboxylate-region':.6,'triple-bonds':3,unsaturation:2.2,'carbon-hydrogen':1.3};

// Raman teaching spectrum: the same vibrational regions as FTIR T, re-weighted by
// polarisability-change rules (symmetric, non-polar bonds strong; O–H/N–H weak).
export function theoreticalRaman(profile){
  const regions=profile?.ftir?.regions||[];if(!regions.length)return null;
  const components=regions.map(r=>({label:r.label+' (Raman weighting '+(RAMAN_ACTIVITY[r.ruleId]??.6)+'×)',centre:(r.broadRegionCm1[0]+r.broadRegionCm1[1])/2,sigma:(r.broadRegionCm1[1]-r.broadRegionCm1[0])/4,weight:RAMAN_ACTIVITY[r.ruleId]??.6}));
  const groups=new Set((profile.functionalGroups||[]).map(g=>g.id));
  if(groups.has('aromatic')){components.push({label:'Aromatic ring breathing (strong, sharp in Raman)',centre:1000,sigma:7,weight:2.6},{label:'Aromatic C=C ring stretch',centre:1600,sigma:12,weight:1.6})}
  if((profile.structure?.carbonAtoms||0)>1)components.push({label:'C–C skeletal stretches',centre:1000,sigma:110,weight:.35});
  if(groups.has('thiol'))components.push({label:'S–H / C–S stretches',centre:2570,sigma:15,weight:1.2},{label:'C–S stretch',centre:680,sigma:30,weight:1.3});
  return {technique:'raman',points:gaussGrid(150,3600,2,components),xUnit:'cm-1',yMode:'Intensity (a.u.)',format:'continuous',components:components.map(c=>({...c,range:[c.centre-2*c.sigma,c.centre+2*c.sigma]})),limitations:['T · FTIR rule regions re-weighted by Raman activity rules (polarisability). Not a calculated Raman spectrum; positions are broad screening regions.','Polarisation, laser wavelength, fluorescence background and resonance enhancement are not modelled.']};
}

// Fluorescence teaching spectrum: only when an aromatic/conjugated fluorophore rule applies.
export function theoreticalFluorescence(profile){
  const groups=new Set((profile?.functionalGroups||[]).map(g=>g.id)),rings=profile?.structure?.aromaticRings||0;
  if(!rings&&!groups.has('diene')&&!groups.has('enone'))return {technique:'fluorescence',points:null,reason:'No aromatic or conjugated fluorophore in the structure rules, so no fluorescence emission is expected (T).'};
  let peak=rings?290+42*(Math.min(rings,5)-1):330;const notes=[rings?rings+' aromatic ring(s): emission moves to longer wavelength with more conjugated rings':'Conjugated diene/enone fluorophore'];
  if(groups.has('enone')||groups.has('carbonyl')&&rings){peak+=20;notes.push('Conjugated carbonyl: red shift, often weaker emission')}
  if(groups.has('amine')||groups.has('phenol')||groups.has('ether')&&rings){peak+=18;notes.push('Electron-donor substituent: red shift')}
  const quench=groups.has('nitro')||/Br|I/.test(profile?.canonicalSmiles||'');if(quench)notes.push('Nitro / heavy-atom substituent: fluorescence usually strongly quenched');
  const excitation=Math.round(peak-45),components=[{label:'S₁→S₀ emission (0–0 region)',centre:peak,sigma:14,weight:1},{label:'Vibronic shoulder',centre:peak+22,sigma:18,weight:.6},{label:'Long-wavelength tail',centre:peak+50,sigma:25,weight:.18}];
  return {technique:'fluorescence',points:gaussGrid(Math.max(220,excitation-20),Math.min(800,peak+180),1,components).map(([x,y])=>[x,Number((y*(quench?.15:1)).toFixed(5))]),xUnit:'nm',yMode:'Intensity (a.u.)',format:'continuous',excitationNm:excitation,components:components.map(c=>({...c,range:[c.centre-2*c.sigma,c.centre+2*c.sigma]})),notes,limitations:['T · rule-of-thumb emission band from ring count and substituents, excitation ≈ emission − 45 nm (Stokes shift). Not a calculated spectrum or quantum yield.','Solvent, pH, concentration (inner filter), aggregation and quenchers change real emission strongly.']};
}

export function theoryRecord(kind,result,identity={}){
  return {name:identity.name,inchikey:identity.inchikey,representation:'rule-simulation',status:'theoretical',eligibleForMatching:false,version:THEORY_VERSION,theory:{kind,...result,points:undefined},ionLabels:result.ionLabels||null,metadata:{xUnit:result.xUnit,format:result.format,yMode:result.yMode,excitation:result.excitationNm?String(result.excitationNm):'',notes:result.limitations.join(' '),license:'Independently authored teaching rules.'},parsed:{points:result.points,range:[result.points[0][0],result.points.at(-1)[0]]},limitations:result.limitations};
}
