import {NMR_VERSION,multiplicity} from '../dist/nmr-core.mjs';
export const nmrLimitations=[
 'T: first-order teaching rules, not measured shifts, fitted coupling constants or a validated NMR prediction.',
 'Structure-refined atom classes are not proof of chemical or magnetic equivalence. CH₂ protons are treated together; diastereotopic, geminal and second-order effects are not resolved.',
 'Shift centres and compound J values are authored assumptions. Changing solvent does not calculate a solvent-induced shift.',
 'Only selected carbon-bound vicinal and aromatic meta H–H paths are illustrated. Long-range, heteronuclear and stereochemistry-dependent couplings are omitted.',
 'Exchange-sensitive sites use optional placeholder broad-singlet positions; exchange, pH, temperature and isotope effects need measured evidence.',
 '¹³C compound lines are proton-decoupled singlets. Heights are qualitative, not quantitative carbon integration. Solvent C–D coupling is retained separately.',
 'T NMR and reference overlays never participate in experimental matching. Original measurements are unchanged.'
];
export function buildNmrModel(rdkit,smiles){
 const mol=rdkit.get_mol(smiles);if(!mol||!mol.is_valid()){mol?.delete();throw Error('Cannot derive NMR teaching rules from invalid SMILES.');}
 try{
  const json=JSON.parse(mol.get_json()),raw=json.molecules[0],rep=raw.extensions.find(x=>x.name==='rdkitRepresentation')||{},ar=new Set(rep.aromaticAtoms||[]);
  const atoms=raw.atoms.map((a,i)=>({...json.defaults.atom,...a,index:i,aromatic:ar.has(i)})),edges=atoms.map(()=>[]);
  for(const b0 of raw.bonds){const b={...json.defaults.bond,...b0},[a,c]=b.atoms;edges[a].push({i:c,order:b.bo});edges[c].push({i:a,order:b.bo})}
  const hs=a=>(a.impHs||0)+edges[a.index].filter(e=>atoms[e.i].z===1&&!(atoms[e.i].isotope>1)).length;
  const carbonyl=i=>atoms[i].z===6&&edges[i].some(e=>e.order===2&&atoms[e.i].z===8);
  // Weisfeiler–Lehman refinement is a local graph heuristic, not NMR equivalence.
  const rank=keys=>{const map=new Map([...new Set(keys)].sort().map((k,i)=>[k,String(i)]));return keys.map(k=>map.get(k))};
  let colors=rank(atoms.map(a=>[a.z,a.chg,a.isotope,a.nRad,hs(a),a.aromatic,edges[a.index].length].join('|')));
  for(let round=0;round<Math.min(atoms.length,20);round++)colors=rank(atoms.map((a,i)=>colors[i]+'|'+edges[i].map(e=>[e.order,colors[e.i]].join(':')).sort().join(',')));
  const protonShift=a=>{
   const ns=edges[a.index].map(e=>atoms[e.i]);if(a.z!==6){const acid=a.z===8&&ns.some(x=>carbonyl(x.index));return {shift:acid?11.5:a.z===8&&ns.some(x=>x.aromatic)?5.5:a.z===8?2.5:3.5,label:acid?'Acid O–H (exchange-sensitive)':a.z===8?'O–H (exchange-sensitive)':'N–H / S–H (exchange-sensitive)',exchangeable:true}}
   if(carbonyl(a.index))return {shift:9.5,label:'Aldehydic H'};
   if(a.aromatic){let shift=7.2;for(const e of edges[a.index]){const n=atoms[e.i];if(n.z!==6)shift+=.25;for(const e2 of edges[n.index])if(e2.i!==a.index){const n2=atoms[e2.i];if(carbonyl(n2.index))shift+=.35;else if(n2.z===8)shift-=.2;else if(n2.z===7)shift+=.1}}
    return {shift:Number(shift.toFixed(2)),label:'Aromatic C–H'};}
   if(edges[a.index].some(e=>e.order===3))return {shift:2.5,label:'Acetylenic H'};
   if(edges[a.index].some(e=>e.order===2))return {shift:5.7,label:'Vinylic H · geometry unresolved'};
   if(ns.some(n=>n.z===8)){const acyl=ns.some(n=>n.z===8&&edges[n.index].some(e=>carbonyl(e.i)));return {shift:acyl?4.1:hs(a)===3?3.35:3.6,label:acyl?'O-acyl C–H':'O-adjacent C–H'}}
   if(ns.some(n=>n.z===7))return {shift:2.7,label:'N-adjacent C–H'};
   if(ns.some(n=>[9,17,35,53].includes(n.z)))return {shift:3.4,label:'Halogen-adjacent C–H'};
   if(ns.some(n=>n.z===16))return {shift:2.5,label:'S-adjacent C–H'};
   if(ns.some(n=>carbonyl(n.index)))return {shift:2.2,label:'Carbonyl-adjacent C–H'};
   if(ns.some(n=>n.aromatic))return {shift:2.3,label:'Benzylic C–H'};
   return {shift:hs(a)===3?.95:hs(a)===2?1.35:1.65,label:'Aliphatic C–H'};
  };
  const carbonShift=a=>{const ns=edges[a.index].map(e=>atoms[e.i]);if(carbonyl(a.index)){if(ns.some(n=>n.z===7))return {shift:165,label:'Amide C=O'};if(ns.filter(n=>n.z===8).length>1)return {shift:ns.some(n=>n.z===8&&hs(n))?173:170,label:'Acid / ester C=O'};return {shift:hs(a)?195:205,label:hs(a)?'Aldehyde C=O':'Ketone C=O'}}
   if(a.aromatic){let shift=ns.some(n=>n.z===8)?155:ns.some(n=>n.z===7)?145:hs(a)?128:138;for(const n of ns.filter(n=>n.aromatic))for(const e of edges[n.index])if(e.i!==a.index){if(carbonyl(e.i))shift+=3;else if(atoms[e.i].z===8)shift-=6;else if(atoms[e.i].z===7)shift+=2;}return {shift,label:'Aromatic carbon'}};
   if(edges[a.index].some(e=>e.order===3))return {shift:ns.some(n=>n.z===7)?118:80,label:'Triple-bond carbon'};
   if(edges[a.index].some(e=>e.order===2))return {shift:hs(a)?125:140,label:'Unsaturated carbon'};
   if(ns.some(n=>n.z===8))return {shift:hs(a)===3?55:65,label:'O-adjacent carbon'};
   if(ns.some(n=>n.z===7))return {shift:45,label:'N-adjacent carbon'};
   if(ns.some(n=>[9,17,35,53].includes(n.z)))return {shift:50,label:'Halogen-adjacent carbon'};
   return {shift:hs(a)===3?20:hs(a)===2?32:hs(a)===1?42:45,label:'Saturated carbon'};
  };
  const hMap=new Map(),cMap=new Map(),omitted=[];
  for(const a of atoms){if(a.z===1)continue;if(a.chg||a.nRad){omitted.push({atom:a.index,reason:'Charged / radical atom outside simple teaching rules'});continue}
   if(a.z===6){const id='C'+colors[a.index];if(!cMap.has(id))cMap.set(id,{id,...carbonShift(a),atoms:[],area:1,couplings:[]});cMap.get(id).atoms.push(a.index)}
   if(hs(a)&&[6,7,8,16].includes(a.z)){const id='H'+colors[a.index];if(!hMap.has(id))hMap.set(id,{id,...protonShift(a),atoms:[],area:0,couplings:[]});const s=hMap.get(id);s.atoms.push(a.index);s.area+=hs(a)}
  }
  for(const s of hMap.values()){
   if(s.exchangeable)continue;const a=atoms[s.atoms[0]],partners=new Map();
   const add=(i,jHz)=>{const b=atoms[i],partner='H'+colors[i];if(b.z!==6||!hs(b)||partner===s.id||!hMap.has(partner))return;const key=partner+'|'+jHz;if(!partners.has(key))partners.set(key,{partner,count:0,spin:.5,jHz,assumption:'T default J, not a fitted or predicted constant'});partners.get(key).count+=hs(b)};
   for(const e of edges[a.index]){const b=atoms[e.i];if(b.z!==6)continue;add(b.index,a.aromatic&&b.aromatic?7.5:e.order===2?12:7);
    if(a.aromatic&&b.aromatic)for(const e2 of edges[b.index])if(e2.i!==a.index&&atoms[e2.i].aromatic)add(e2.i,2);}
   // Equivalent partners with equal J form one first-order n+1 set.
   const js=new Map();for(const c of partners.values()){if(!js.has(c.jHz))js.set(c.jHz,{...c,partners:[],count:0});const j=js.get(c.jHz);j.count+=c.count;j.partners.push(c.partner)}s.couplings=[...js.values()];s.multiplicity=multiplicity(s);
  }
  const notes=[...nmrLimitations];if(atoms.some(a=>a.isotope))notes.push('Isotope-labelled structure: site counts and responses require checking; isotope shifts/couplings are not calculated.');if(atoms.some(a=>[9,15].includes(a.z)))notes.push('F/P present: compound heteronuclear coupling is not calculated.');
  return {version:NMR_VERSION,eligibleForMatching:false,limitations:notes,omitted,h1:{signals:[...hMap.values()],defaultFrequency:400,range:[-1,15],nucleus:'¹H'},c13:{signals:[...cMap.values()],defaultFrequency:100.6,range:[-10,240],nucleus:'¹³C{¹H}'}};
 }finally{mol.delete()}
}
