import {createHash} from 'node:crypto';
export const LOGIC_VERSION='structural-guide-v1';
export const logicSources=[
 {id:'msu-ir',title:'William Reusch, Michigan State University: infrared spectrometry',url:'https://www2.chemistry.msu.edu/faculty/reusch/virttxtjml/spectrpy/infrared/irspec1.htm'},
 {id:'msu-nmr',title:'William Reusch, Michigan State University: NMR spectroscopy',url:'https://www2.chemistry.msu.edu/faculty/reusch/virttxtjml/spectrpy/nmr/nmr1.htm'},
 {id:'msu-uv',title:'William Reusch, Michigan State University: UV-visible spectroscopy',url:'https://www2.chemistry.msu.edu/faculty/reusch/virttxtjml/spectrpy/uv-vis/uvspec.htm'}
];
// Independently authored broad chemical heuristics, not copied spectral records.
export const groupRules=[
 ['acid','Carboxylic acid','[CX3](=[OX1])[OX2H1]'],
 ['carboxylate','Carboxylate','[CX3](=[OX1])[O-]'],
 ['ester','Ester / lactone','[CX3](=[OX1])[OX2][#6]'],
 ['amide','Amide / lactam','[CX3](=[OX1])[NX3]'],
 ['aldehyde','Aldehyde','[CX3H1](=[OX1])[#6]'],
 ['ketone','Ketone','[CX3](=[OX1])([#6])[#6]'],
 ['carbonyl','Carbonyl bond','[C]=[O]'],
 ['alcohol','Alcohol','[OX2H1][CX4;!$(C=O)]'],
 ['phenol','Phenol','[OX2H1][c]'],
 ['ether','Ether (excluding acyl oxygen)','[OX2]([#6;!$(C=O)])[#6;!$(C=O)]'],
 ['amine','Neutral amine (excluding amide)','[NX3;+0;!$(N[C,S,P]=[O,S,N]);!$(N=*)]'],
 ['nh','Neutral N–H site','[N,n;H1,H2;+0]'],
 ['thiol','Thiol','[SX2H1]'],
 ['nitrile','Nitrile','[CX2]#[NX1]'],
 ['alkene','Nonaromatic C=C','[CX3]=[CX3]'],
 ['alkyne','C≡C','[CX2]#[CX2]'],
 ['aromatic','Aromatic atoms','[a]'],
 ['nitro','Nitro','[N+](=[O])[O-]'],
 ['sulfone','Sulfone-like S(=O)₂','[S](=[O])(=[O])'],
 ['halogen','Halogen substituent','[F,Cl,Br,I]'],
 ['diene','Conjugated nonaromatic diene','[CX3]=[CX3]-[CX3]=[CX3]'],
 ['enone','Conjugated carbonyl fragment','[O]=[CX3]-[CX3]=[CX3]']
];
export function createLogicEngine(rdkit){
 const queries=groupRules.map(([id,label,smarts])=>{const query=rdkit.get_qmol(smarts);if(!query)throw Error('Invalid structural rule '+id);return {id,label,smarts,query}});
 function profile(smiles){const mol=rdkit.get_mol(smiles);if(!mol||!mol.is_valid()){mol?.delete();return {version:LOGIC_VERSION,kind:'rule-derived',status:'unresolved-structure',eligibleForMatching:false,error:'Source SMILES could not be parsed; no features invented'}}
 try{
  const molecular=JSON.parse(mol.get_json()),raw=molecular.molecules[0],defaults=molecular.defaults.atom,bondDefaults=molecular.defaults.bond,rep=raw.extensions.find(e=>e.name==='rdkitRepresentation')||{},aromatic=new Set(rep.aromaticAtoms||[]);
  const atoms=raw.atoms.map((a,index)=>({...defaults,...a,index,aromatic:aromatic.has(index)}));const bonds=raw.bonds.map(b=>({...bondDefaults,...b}));const adjacency=atoms.map(()=>[]);for(const b of bonds){const [a,c]=b.atoms;adjacency[a].push({atom:atoms[c],order:b.bo});adjacency[c].push({atom:atoms[a],order:b.bo});}
  const functionalGroups=queries.map(r=>{const decoded=JSON.parse(mol.get_substruct_matches(r.query,JSON.stringify({maxMatches:10000})));if(decoded.error)throw Error(decoded.error);const matches=Array.isArray(decoded)?decoded:[];const sets=new Map(matches.map(m=>[[...m.atoms].sort((a,b)=>a-b).join(','),m.atoms]));return {id:r.id,label:r.label,smarts:r.smarts,siteCount:sets.size,atomSets:[...sets.values()]}}).filter(r=>r.siteCount);
  const has=id=>functionalGroups.some(g=>g.id===id),ftir=[];const band=(id,label,range,note)=>ftir.push({ruleId:id,label,broadRegionCm1:range,note,sourceId:'msu-ir',kind:'rule-derived',intensity:null,exactPeak:null});
  if(has('carbonyl'))band('carbonyl-region','C=O-containing structure',[1600,1900],'Broad screening region only. Functional class, conjugation, strain, phase and hydrogen bonding shift actual bands.');
  if(has('acid'))band('acid-oh','Acid O–H',[2500,3600],'Association and solvent affect width/position; no measured band shape assigned.');
  if(has('alcohol')||has('phenol'))band('hydroxyl','Alcohol / phenol O–H',[3000,3700],'Hydrogen-bonding-dependent; distinct from acid hydroxyl.');
  if(has('nh'))band('neutral-nh','Neutral N–H',[3100,3600],'Only structures actually bearing neutral N–H trigger this rule. No multiplicity or intensity inferred.');
  if(has('carboxylate'))band('carboxylate-region','Carboxylate coupled C–O modes',[1300,1700],'Do not interpret as a neutral carboxylic-acid C=O/O–H pair.');
  if(has('nitrile')||has('alkyne'))band('triple-bonds','Triple-bond region',[2000,2300],'Presence of a triple bond does not guarantee a strong observable IR absorption.');
  if(has('alkene')||has('aromatic'))band('unsaturation','C=C / aromatic skeletal region',[1450,1700],'Overlapping modes; cannot resolve ring substitution or identify a compound.');
  if(atoms.some(a=>a.z===6&&a.impHs>0))band('carbon-hydrogen','C–H stretch region',[2800,3350],'Broad envelope spanning multiple hybridizations, not a list of exact peaks.');
  const carbon=[],hydrogen=[];let exchangeable=0,explicitH=0,unsupportedHydrogens=0;
  for(const a of atoms){if(a.z===1){explicitH++;continue;}const adjacent=adjacency[a.index],h=a.impHs+adjacent.filter(n=>n.atom.z===1&&[0,1].includes(n.atom.isotope)).length;const carbonyl=adjacent.some(n=>n.atom.z===8&&n.order===2),triple=adjacent.some(n=>n.order===3),double=adjacent.some(n=>n.order===2),hetero=adjacent.some(n=>[7,8,9,15,16,17,35,53].includes(n.atom.z));
   if(a.z===6){let region,label;if(a.chg||a.nRad){label='Charged / radical carbon: outside simple rules';region=null;}else if(carbonyl){label='Carbonyl carbon';region=[150,230];}else if(aromatic.has(a.index)){label='Aromatic carbon';region=[90,170];}else if(triple){label='Triple-bond carbon';region=[50,140];}else if(double){label='Other unsaturated carbon';region=[90,180];}else if(hetero){label='Saturated carbon bonded to heteroatom';region=[10,110];}else{label='Other saturated carbon';region=[0,80];}carbon.push({atomIndex:a.index,environment:label,broadShiftPpm:region,kind:'rule-derived'});
    if(h){let protonLabel,protonRegion;if(a.chg||a.nRad){protonLabel='H at charged/radical site: outside simple rules';protonRegion=null;}else if(carbonyl){protonLabel='Aldehydic carbon-bound H';protonRegion=[8,11];}else if(aromatic.has(a.index)){protonLabel='Aromatic carbon-bound H';protonRegion=[5,10];}else if(triple){protonLabel='Triple-bond carbon-bound H';protonRegion=[1,4];}else if(double){protonLabel='Other unsaturated carbon-bound H';protonRegion=[3,9];}else{protonLabel=hetero?'Saturated C–H adjacent to heteroatom':'Other saturated carbon-bound H';protonRegion=[0,6];}hydrogen.push({atomIndex:a.index,count:h,environment:protonLabel,broadShiftPpm:protonRegion,kind:'rule-derived'});}
   }else if(h&&[7,8,16].includes(a.z)){exchangeable+=h;hydrogen.push({atomIndex:a.index,count:h,environment:'Exchange-sensitive heteroatom-bound H',broadShiftPpm:null,kind:'rule-derived'});}else if(h){unsupportedHydrogens+=h;hydrogen.push({atomIndex:a.index,count:h,environment:'Other H environment: unsupported',broadShiftPpm:null,kind:'rule-derived'});}
  }
  const descriptors=JSON.parse(mol.get_descriptors());const warnings=['Not measured spectra, a trained prediction model, or a validated identification library.','Ranges are deliberately broad educational heuristics, not confidence intervals or exact peak assignments.','Atom indices are zero-based in the supplied source SMILES parse, not a publication atom-numbering scheme.','Tautomer, protonation, stereochemistry, conformers, solvent, temperature and mixtures can change actual spectra.','Atom/H counts are not numbers of resonances; symmetry, exchange, overlap and diastereotopic protons are not resolved.','No intensities, splitting, coupling constants, full fingerprint curves, UV λmax or calibrated probabilities are generated.'];if(atoms.some(a=>a.chg))warnings.push('Charged structure: simple shift regions may be inappropriate.');if(atoms.some(a=>a.isotope))warnings.push('Isotope-labelled structure: hydrogen/isotope counts need expert checking; do not assume standard ¹H response.');
  return {version:LOGIC_VERSION,kind:'rule-derived',status:'educational-only',eligibleForMatching:false,inputSha256:createHash('sha256').update(smiles).digest('hex'),canonicalSmiles:mol.get_smiles(),structure:{heavyAtoms:descriptors.NumHeavyAtoms,carbonAtoms:carbon.length,carbonBoundHydrogens:hydrogen.filter(h=>atoms[h.atomIndex].z===6).reduce((n,h)=>n+h.count,0),exchangeSensitiveHydrogens:exchangeable,otherHydrogens:unsupportedHydrogens,explicitHydrogenAtoms:explicitH,aromaticRings:descriptors.NumAromaticRings,totalRings:descriptors.NumRings,formalCharge:atoms.reduce((n,a)=>n+a.chg,0),exactMass:descriptors.exactmw,unspecifiedStereoCenters:descriptors.NumUnspecifiedAtomStereoCenters},functionalGroups,ftir:{kind:'rule-derived',regions:ftir,fullSpectrum:null},h1:{kind:'rule-derived',atomEnvironments:hydrogen,resonanceCount:null,splitting:null,sourceId:'msu-nmr'},c13:{kind:'rule-derived',atomEnvironments:carbon,resonanceCount:null,sourceId:'msu-nmr'},uv:{kind:'rule-derived',features:[has('aromatic')?'Aromatic π system detected':null,has('diene')?'Conjugated diene fragment detected':null,has('enone')?'Conjugated carbonyl fragment detected':null,has('carbonyl')?'Carbonyl chromophore detected':null].filter(Boolean),interpretation:'Structural chromophore hints only; not a UV absorption or colour prediction. Absence of these motifs does not establish UV transparency.',lambdaMaxNm:null,absorbance:null,sourceId:'msu-uv'},warnings};
 }finally{mol.delete()}}
 return {profile,close:()=>queries.forEach(q=>q.query.delete())};
}
export function exportLogicDataset(db){const evidence=new Map();for(const e of db.prepare('SELECT e.id,e.compound_id,e.source_id,e.source_record,e.technique,e.representation,e.status,e.source_url,e.sha256,s.license datasetLicense,json_extract(e.metadata,\'$.license\') recordLicense FROM external_evidence e JOIN external_sources s ON s.id=e.source_id WHERE e.compound_id IS NOT NULL ORDER BY e.compound_id,e.technique').all()){if(!evidence.has(e.compound_id))evidence.set(e.compound_id,[]);evidence.get(e.compound_id).push(e)}const entries=db.prepare('SELECT c.*,l.profile,l.built_at FROM compounds c JOIN compound_logic l ON l.compound_id=c.id ORDER BY c.id').all().map(c=>({id:c.id,name:c.name,inchikey:c.inchikey,formula:c.formula,smiles:c.smiles,logic:JSON.parse(c.profile),builtAt:c.built_at,externalEvidence:evidence.get(c.id)||[]}));const memberships=db.prepare('SELECT m.collection_id,m.compound_id,m.provenance FROM memberships m JOIN compound_logic l ON l.compound_id=m.compound_id ORDER BY m.collection_id,m.compound_id').all().map(m=>({...m,provenance:JSON.parse(m.provenance)}));return {schemaVersion:1,method:LOGIC_VERSION,exportedAt:new Date().toISOString(),uniqueIdentityCount:entries.length,membershipCount:memberships.length,description:'Structure-derived educational guides with source-linked experimental evidence kept separate. No missing spectra are fabricated. No spectra are eligible for matching solely from these rules.',sources:logicSources,experimentalSources:db.prepare('SELECT id,title,url,license FROM external_sources ORDER BY id').all(),dataLicensing:'Identity and external-evidence source licenses are retained per record. This export does not replace those terms. Rules are independently authored screening heuristics; linked teaching pages explain scientific principles, not imported spectra.',entries,memberships};}
