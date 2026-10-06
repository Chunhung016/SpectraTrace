/* Educational envelopes, NOT quantum-calculated or validated spectral predictions. */
import {modelLines} from '../dist/nmr-core.mjs';
export const SIMULATION_VERSION='illustrative-envelope-v2-nmr1';
export const simulationGrids={ftir:{start:400,end:4000,step:1,xUnit:'cm-1'},c13:{start:-20,end:260,step:.1,xUnit:'ppm'},h1:{start:-2,end:16,step:.01,xUnit:'ppm'},uv:{start:140,end:800,step:1,xUnit:'nm'}};
export const simulationLimitations=[
  'Rule-based illustrative envelopes only. Not experimental data, quantum calculations or validated theoretical predictions.',
  'Fine grid spacing is sampling density, not scientific resolution or prediction accuracy.',
  'Envelope centres and relative weights are display assumptions, not assigned peaks, intensities, oscillator strengths or chemical shifts.',
  'No fingerprint modes, NMR symmetry, multiplicity, coupling, solvent, conformers, protonation or concentration model is calculated.',
  'UV wavelength windows are illustrative motif bins, not predicted transitions, colour or lambda-max.',
  'Unmodelled atoms/environments are omitted, not proved absent. Similar envelopes may occur for different compounds.',
  'Never eligible for experimental-reference matching. Measured records and original files are unchanged.'
];
function component(label,range,weight=1){return {label,range,centre:(range[0]+range[1])/2,sigma:(range[1]-range[0])/4,weight,assumption:'illustrative broad envelope; centre and weight are not a spectral assignment'}}
function envelope(technique,components,omitted=[]){
  const grid=simulationGrids[technique],size=Math.round((grid.end-grid.start)/grid.step)+1,y=new Array(size).fill(0);
  // Every structure with the same features uses the same deterministic rules: no random noise or hashed peak jitter.
  for(const c of components){const first=Math.max(0,Math.ceil((c.centre-5*c.sigma-grid.start)/grid.step)),last=Math.min(size-1,Math.floor((c.centre+5*c.sigma-grid.start)/grid.step));for(let i=first;i<=last;i++){const z=(grid.start+i*grid.step-c.centre)/c.sigma;y[i]+=c.weight*Math.exp(-.5*z*z)}}
  let max=0;for(const value of y)max=Math.max(max,value);if(max)y.forEach((v,i)=>y[i]=Number((v/max).toFixed(6)));
  return {technique,kind:'rule-simulation',status:'illustrative-only',eligibleForMatching:false,grid,normalization:'independently normalized maximum = 1; not quantitative intensity',yUnit:'relative illustrative envelope',components,omitted,y};
}
export function buildSimulation(profile,nmrModel=null){
  if(!profile||profile.status==='unresolved-structure')throw Error('A resolved structural guide is required.');
  const ftir=profile.ftir.regions.map(r=>component(r.label,r.broadRegionCm1));
  const groups=new Map(profile.functionalGroups.map(g=>[g.id,g.siteCount]));
  const uv=[];
  if(profile.structure.carbonAtoms)uv.push(component('Generic far-UV backbone envelope',[140,200]));
  if(groups.has('aromatic'))uv.push(component('Illustrative aromatic motif window',[190,290]));
  if(groups.has('diene'))uv.push(component('Illustrative diene motif window',[200,300]));
  if(groups.has('enone'))uv.push(component('Illustrative conjugated carbonyl window',[230,360]));
  if(groups.has('carbonyl'))uv.push(component('Illustrative carbonyl motif window',[240,360],.25));
  const nmr=(key)=>{const map=new Map(),omitted=[];for(const atom of profile[key].atomEnvironments){if(!atom.broadShiftPpm){omitted.push({atomIndex:atom.atomIndex,environment:atom.environment,count:atom.count||1});continue}const id=atom.environment+'|'+atom.broadShiftPpm.join(',');if(!map.has(id))map.set(id,component(atom.environment,atom.broadShiftPpm,0));map.get(id).weight+=key==='h1'?atom.count:1;}return envelope(key,[...map.values()],omitted)};
  const spectra={ftir:envelope('ftir',ftir),c13:nmr('c13'),h1:nmr('h1'),uv:envelope('uv',uv)};
  if(nmrModel)for(const t of ['h1','c13']){
    const model={...nmrModel[t],version:nmrModel.version,limitations:nmrModel.limitations,omitted:nmrModel.omitted,eligibleForMatching:false};
    const components=model.signals.map(s=>({...component(s.label,[s.shift-.04,s.shift+.04],s.area),centre:s.shift,sigma:t==='h1'?.008:.08,assumption:'T shift centre; analytical multiplet lines are stored in nmrModel'}));
    spectra[t]={...envelope(t,components,nmrModel.omitted),nmrModel:model};
  }
  const limitations=nmrModel?[...simulationLimitations.filter(x=>!x.startsWith('No fingerprint modes')),'FTIR fingerprint modes, conformers, protonation and concentration effects are not calculated.',...nmrModel.limitations]:simulationLimitations;
  return {version:SIMULATION_VERSION,kind:'rule-simulation',status:'illustrative-only',eligibleForMatching:false,inputSha256:profile.inputSha256,sourceGuideVersion:profile.version,limitations,spectra};
}
export function simulationRecord(dataset,technique,identity={}){const s=dataset.spectra[technique];if(!s)throw Error('Unsupported technique');const model=s.nmrModel,points=model?modelLines(model,model.defaultFrequency).map(l=>[l.x,l.y]).sort((a,b)=>a[0]-b[0]):s.y.map((y,i)=>[Number((s.grid.start+i*s.grid.step).toFixed(6)),y]);return {name:identity.name,inchikey:identity.inchikey,representation:'rule-simulation',status:'theoretical',eligibleForMatching:false,version:dataset.version,nmrModel:model,metadata:{xUnit:s.grid.xUnit,format:model?'peaks':'continuous',yMode:model?'Illustrative relative intensity':s.yUnit,frequency:model?String(model.defaultFrequency):'',solvent:model?'none':'',notes:dataset.limitations.join(' '),license:'Identity source terms remain applicable; independently authored educational illustration rules.'},parsed:{points,range:[s.grid.start,s.grid.end]},simulation:s,limitations:dataset.limitations};}
