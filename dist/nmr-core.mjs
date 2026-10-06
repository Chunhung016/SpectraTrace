// First-order educational line arithmetic; never a structure-identification model.
export const NMR_VERSION='first-order-teaching-v1';
export const nmrSources={
 shifts:'https://www.sigmaaldrich.com/US/en/technical-documents/technical-article/analytical-chemistry/nuclear-magnetic-resonance/1h-nmr-and-13c-nmr-chemical-shifts-of-impurities-chart',
 coupling:'https://www.sigmaaldrich.com/US/en/technical-documents/technical-article/analytical-chemistry/nuclear-magnetic-resonance/nmr-deuterated-solvent-properties-reference',
 principles:'https://www2.chemistry.msu.edu/faculty/reusch/virttxtjml/spectrpy/nmr/nmr1.htm'
};
const signal=(shift,spinCount=0,jHz=0)=>({shift,couplings:spinCount?[{count:spinCount,spin:1,jHz}]:[]});
// Average residual-solvent shifts from the impurity table; approximate J values
// from the solvent-properties chart. Referencing, temperature and composition matter.
export const solvents=[
 {id:'none',label:'None / unknown',h1:[],c13:[]},
 {id:'cdcl3',label:'CDCl₃',aliases:['chloroform-d','chloroform-d1'],h1:[signal(7.26)],c13:[signal(77.16,1,32)],water:1.56},
 {id:'dmso',label:'DMSO-d₆',aliases:['dmso-d6','(cd3)2so'],h1:[signal(2.50,2,1.7)],c13:[signal(39.52,3,21)],water:3.33},
 {id:'cd3od',label:'CD₃OD',aliases:['methanol-d4','meod','meod-d4'],h1:[signal(3.31,2,1.7)],c13:[signal(49.00,3,21.4)],water:4.87},
 {id:'acetone',label:'Acetone-d₆',aliases:['acetone-d6','(cd3)2co'],h1:[signal(2.05,2,2.2)],c13:[signal(29.84,3,20),signal(206.26)],water:2.84},
 {id:'cd3cn',label:'CD₃CN',aliases:['acetonitrile-d3'],h1:[signal(1.94,2,2.5)],c13:[signal(1.32,3,21),signal(118.26)],water:2.13},
 {id:'c6d6',label:'C₆D₆',aliases:['benzene-d6'],h1:[signal(7.16)],c13:[signal(128.06,1,24)],water:.40},
 {id:'d2o',label:'D₂O',aliases:['deuteriumoxide','water-d2'],h1:[signal(4.79)],c13:[]},
 {id:'cd2cl2',label:'CD₂Cl₂',aliases:['dichloromethane-d2','dcm-d2'],h1:[signal(5.32,1,1)],c13:[signal(53.8,2,27)]}
];
const normalize=v=>String(v||'').toLowerCase().replace(/[₀-₉]/g,x=>String('₀₁₂₃₄₅₆₇₈₉'.indexOf(x))).replace(/[\s_]/g,'');
export function solventId(value){const v=normalize(value);return solvents.find(s=>[s.id,s.label,...s.aliases||[]].some(x=>normalize(x)===v))?.id||'none'}
export function splitSignal(s,frequency){
 if(!(Number(frequency)>0))throw Error('Enter the observed nucleus frequency in MHz.');
 let lines=[{offset:0,weight:1}];
 for(const c of s.couplings||[]){if(!(c.jHz>0)||!(c.count>0))continue;const spin=c.spin??.5,states=Math.round(2*spin)+1;
  for(let k=0;k<c.count;k++){const next=new Map();for(const l of lines)for(let m=0;m<states;m++){const offset=l.offset+(m-spin)*c.jHz,key=Math.round(offset*1e8);const prior=next.get(key);if(prior)prior.weight+=l.weight;else next.set(key,{offset:key/1e8,weight:l.weight})}lines=[...next.values()];if(lines.length>512)return [{x:s.shift,y:s.area||1,unresolved:true}];}
 }
 const total=lines.reduce((n,l)=>n+l.weight,0);return lines.sort((a,b)=>a.offset-b.offset).map(l=>({x:s.shift+l.offset/Number(frequency),y:l.weight/total*(s.area||1)}));
}
export function multiplicity(s){
 if(s.exchangeable)return 'br s';const cs=s.couplings||[];if(!cs.length)return 's';
 const names={1:'s',2:'d',3:'t',4:'q',5:'quint',6:'sext',7:'sept'};
 return cs.map(c=>names[Math.round(2*(c.spin??.5)*c.count+1)]||'m').join('');
}
export function modelLines(model,frequency,split=true,exchange=true){
 const signals=(model?.signals||[]).filter(s=>exchange||!s.exchangeable);
 const lines=signals.flatMap(s=>splitSignal(split?s:{...s,couplings:[]},frequency).map(l=>({...l,signalId:s.id,label:s.label,origin:'T compound',multiplicity:split?multiplicity(s):(s.exchangeable?'br s':'s (splitting off)'),jHz:(s.couplings||[]).map(c=>c.jHz),atoms:s.atoms,area:s.area,exchangeable:!!s.exchangeable})));
 let max=0;for(const l of lines)max=Math.max(max,l.y);return lines.map(l=>({...l,y:max?l.y/max:0}));
}
export function referenceSignals(technique,settings={}){
 const solvent=solvents.find(s=>s.id===settings.solvent)||solvents[0],out=[];
 if(settings.solventPeaks!==false)for(const [i,s]of (solvent[technique]||[]).entries())out.push({...s,id:'solvent-'+i,label:solvent.label+(solvent.id==='d2o'?' · HOD':''),origin:'solvent reference',area:.18});
 if(settings.water&&technique==='h1'&&Number.isFinite(solvent.water))out.push({id:'water',shift:solvent.water,couplings:[],area:.12,label:'H₂O / HOD (variable)',origin:'water reference'});
 if(settings.reference)out.push({id:'zero-reference',shift:0,couplings:[],area:.12,label:solvent.id==='d2o'?'DSS / TSP (reference convention)':'TMS (reference convention)',origin:'zero reference'});
 return out.map(s=>({...s,multiplicity:multiplicity(s),source:s.origin==='zero reference'?nmrSources.principles:nmrSources.shifts,couplingSource:nmrSources.coupling}));
}
export function view(data,settings){
 const model=data.nmrModel,frequency=Number(settings.frequency)||0,refs=referenceSignals(data.technique,settings);
 const base=model?modelLines(model,frequency,settings.coupling!==false,settings.exchange!==false):null;
 const referenceLines=model?refs.flatMap(s=>splitSignal(s,frequency).map(l=>({...l,label:s.label,origin:s.origin,signalId:s.id,multiplicity:s.multiplicity,jHz:s.couplings.map(c=>c.jHz)}))):[];
 return {...data,...(base?{kind:'peaks',points:base.map(l=>[l.x,l.y]),nmrLines:base,yUnit:'Illustrative relative intensity'}:{}),referenceSignals:refs,referenceLines,
  nmrSettings:{...settings,frequency,strongCouplingWarning:!!model?.signals.some(s=>s.couplings.some(c=>(c.partners||[]).some(id=>{const partner=model.signals.find(p=>p.id===id);return partner&&Math.abs(partner.shift-s.shift)*frequency<10*c.jHz}))),carbonMode:data.technique==='c13'?'¹³C{¹H} · proton-decoupled':'¹H · first-order T / observed lines',referenceMode:model?'T reference peaks · assumed height':'Guides only · no peaks added to the measurement',solventSources:nmrSources,solventNote:'Approximate reference positions; water shifts, referencing, temperature and composition vary. Solvent selection does not recalculate compound shifts.'}};
}
export function lineSpacing(a,b,frequency){if(!(Number(frequency)>0)||!Number.isFinite(a)||!Number.isFinite(b))return null;return Math.abs(a-b)*Number(frequency)}
export function csvView(original,shown){return shown.nmrSettings&&!original.isSimulated?{...original,nmrSettings:shown.nmrSettings,referenceSignals:shown.referenceSignals}:shown}
