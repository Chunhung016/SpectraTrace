/* Spectral exports preserve representation: position lists never gain invented intensities. */
(function(){
  const units={ftir:'cm-1',c13:'ppm',h1:'ppm',uv:'nm',xrd:'2theta-deg',fluorescence:'nm',raman:'cm-1'};
  // Reflectance and optical constants are distinct physical observables, not absorbance.
  const incompatibleFtirType=value=>/reflectance|optical[- ]constants|refractive[- ]index|extinction[- ]coefficient/i.test(value||'');
  function canSwitchFtir(data){return !!data&&data.technique==='ftir'&&data.kind!=='positions'&&!incompatibleFtirType(data.measurementType)&&!incompatibleFtirType(data.yUnit);}
  function canAssignPeaks(data){return !!data&&['ftir','h1','c13','uv'].includes(data.technique)&&(data.technique!=='ftir'||(!incompatibleFtirType(data.measurementType)&&!incompatibleFtirType(data.yUnit)));}
  function sourcePriority(option){
    if(option.simulation)return 10;
    const record=option.record||option.summary||{},meta=record.metadata||{};
    if(incompatibleFtirType(meta.measurementType)||incompatibleFtirType(meta.yMode))return 8;
    if(option.status==='reviewed')return 0;
    return record.parsed?1:/^continuous/.test(record.representation||'')?2:4;
  }
  function spectrumData(record,technique){
    if(record.status==='quarantined')return null;
    const meta=record.metadata||{};
    if(record.parsed?.points?.length)return {kind:meta.format==='peaks'?'peaks':'curve',points:record.parsed.points,xUnit:meta.xUnit||units[technique],yUnit:meta.yMode||'intensity',technique,measurementType:meta.measurementType||(/reflectance|DRIFT/i.test(meta.measurement||'')?'reflectance':''),normalized:meta.normalized==='true',conditions:meta.conditions||{},simulation:record.simulation,nmrModel:record.nmrModel,frequency:meta.frequency,solvent:meta.solvent,isSimulated:['simulated','theoretical'].includes(record.status)}; 
    if(['assigned-shifts','peak-positions'].includes(record.representation)&&Array.isArray(record.data)){
      const values=record.data.filter(p=>Number.isFinite(p.shift)).map(p=>({x:p.shift,atom:p.atom||'',multiplicity:p.multiplicity||'',coupling:p.couplingText||''}));
      return values.length?{kind:'positions',values,xUnit:'ppm',technique}:null;
    }
    if(record.representation==='reported-bands'&&Array.isArray(record.data)){
      const values=record.data.filter(Number.isFinite).map(x=>({x}));
      return values.length?{kind:'positions',values,xUnit:'cm-1',technique}:null;
    }
    return null;
  }
  const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  function detectPeaks(data){
    if(data.simulation&&['h1','c13'].includes(data.technique)){const groups=new Map();for(const c of data.simulation.components){if(!groups.has(c.centre))groups.set(c.centre,{x:c.centre,y:0,labels:[],origin:'illustrative centre'});const p=groups.get(c.centre);p.y+=c.weight;p.labels.push(c.label)}return [...groups.values()].sort((a,b)=>a.x-b.x)}
    if(data.kind==='positions')return data.values.map(p=>({x:p.x,y:1,origin:'reported position'}));
    if(data.kind==='peaks')return data.points.map(([x,y])=>({x,y,origin:'supplied peak'}));
    const points=data.points;if(points.length<3)return [];const inverted=data.technique==='ftir'&&/transmittance/i.test(data.yUnit),values=points.map(p=>inverted?-p[1]:p[1]);let lo=Infinity,hi=-Infinity;for(const y of values){lo=Math.min(lo,y);hi=Math.max(hi,y)}if(hi===lo)return [];
    const threshold=(hi-lo)*.03,span=Math.max(3,Math.min(200,Math.round(points.length/20))),found=[];
    for(let i=1;i<points.length-1;i++){if(values[i]<=values[i-1]||values[i]<values[i+1])continue;let left=values[i],right=values[i];for(let k=Math.max(0,i-span);k<i;k++)left=Math.min(left,values[k]);for(let k=i+1;k<=Math.min(points.length-1,i+span);k++)right=Math.min(right,values[k]);if(values[i]-Math.max(left,right)>=threshold)found.push({x:points[i][0],y:points[i][1],height:values[i]-lo,origin:'detected local extremum'})}
    const distance={ftir:8,uv:3,h1:.001,c13:.005,xrd:.12,fluorescence:3,raman:8}[data.technique],selected=[];for(const p of found.sort((a,b)=>b.height-a.height)){if(!selected.some(q=>Math.abs(p.x-q.x)<distance))selected.push(p)}return selected.sort((a,b)=>a.x-b.x);
  }
  function displayData(data,mode){
    if(['h1','c13'].includes(data.technique)&&mode==='sticks'){const peaks=detectPeaks(data);let max=1;for(const p of peaks)max=Math.max(max,p.y);return {...data,kind:'peaks',points:peaks.map(p=>[p.x,data.isSimulated?p.y/max:p.y]),yUnit:data.kind==='positions'?'Position marker (not intensity)':data.isSimulated?'Illustrative relative intensity':data.yUnit};}
    if(!canSwitchFtir(data))return data;
    const trans=/transmittance/i.test(data.yUnit),abs=/^absorbance$/i.test(data.yUnit);
    if(mode==='transmittance'){
      if(trans)return data;
      if(data.isSimulated)return {...data,points:data.points.map(([x,y])=>[x,100*(1-y)]),yUnit:'Illustrative transmittance (%)'};
      if(abs)return {...data,points:data.points.map(([x,y])=>[x,100*Math.pow(10,-y)]),yUnit:'Transmittance (%)'};
      let low=Infinity,high=-Infinity;for(const [,y]of data.points){low=Math.min(low,y);high=Math.max(high,y)}return {...data,points:data.points.map(([x,y])=>[x,1-(y-low)/(high-low||1)]),yUnit:'Relative downward display'};
    }
    if(trans&&data.points.every(p=>p[1]>0))return {...data,points:data.points.map(([x,y])=>[x,-Math.log10(y/100)]),yUnit:data.normalized?'Derived relative absorbance (normalized %T)':'Absorbance'};
    return data;
  }
  function assignPeaks(peaks,technique,profile,data){
    if(!canAssignPeaks(data))return new Map();
    const labels=new Map();for(const p of peaks){let matches=[];
      if(technique==='ftir'){const regions=profile?.ftir?.regions||[{label:'C=O / C=C',broadRegionCm1:[1600,1900]},{label:'O-H / N-H',broadRegionCm1:[3000,3700]},{label:'C-H',broadRegionCm1:[2800,3350]},{label:'Triple bond',broadRegionCm1:[2000,2300]}];matches=regions.filter(r=>p.x>=r.broadRegionCm1[0]&&p.x<=r.broadRegionCm1[1]).map(r=>r.label)}
      else if(['h1','c13'].includes(technique)){if(data.isSimulated)matches=p.labels||[];else matches=[...new Set((profile?.[technique]?.atomEnvironments||[]).filter(a=>a.broadShiftPpm&&p.x>=a.broadShiftPpm[0]&&p.x<=a.broadShiftPpm[1]).map(a=>a.environment))]}
      else if(data.isSimulated)matches=data.simulation.components.filter(c=>Math.abs(p.x-c.centre)<=c.sigma).map(c=>c.label);
      labels.set(p.x,matches.map(s=>s+'?').join(' / '));
    }return labels;
  }
  function csv(data,provenance={}){
    const comment=Object.entries(provenance).map(([k,v])=>'# '+k+': '+String(v&&typeof v==='object'?JSON.stringify(v):v??'').replace(/[\r\n]/g,' '));
    if(data.nmrLines)return [...comment,[data.xUnit,data.yUnit,'origin','signal','multiplicity','J_Hz'].map(cell).join(','),...[...data.nmrLines,...data.referenceLines||[]].map(p=>[p.x,p.y,p.origin,p.signalId,p.multiplicity,p.jHz.join(';')].map(cell).join(','))].join('\r\n')+'\r\n';
    if(data.kind==='positions')return [...comment,[data.xUnit,'atom','multiplicity','coupling'].map(cell).join(','),...data.values.map(p=>[p.x,p.atom,p.multiplicity,p.coupling].map(cell).join(','))].join('\r\n')+'\r\n';
    return [...comment,[data.xUnit,data.yUnit].map(cell).join(','),...data.points.map(p=>p.map(cell).join(','))].join('\r\n')+'\r\n';
  }
  function chart(data){
    const original=data.kind==='positions'?data.values.map(p=>[p.x,0]):data.points;
    const all=[...original,...(data.referenceLines||[]).map(l=>[l.x,l.y])];
    const values=data.viewRange?all.filter(p=>p[0]>=data.viewRange[0]&&p[0]<=data.viewRange[1]):all;
    const pathValues=data.viewRange?original.filter(p=>p[0]>=data.viewRange[0]&&p[0]<=data.viewRange[1]):original;
    if(!values.length)return null;
    let lo=Infinity,hi=-Infinity,ylo=Infinity,yhi=-Infinity;
    for(const [x,y]of values){lo=Math.min(lo,x);hi=Math.max(hi,x);ylo=Math.min(ylo,y);yhi=Math.max(yhi,y)}
    if(data.viewRange){lo=data.viewRange[0];hi=data.viewRange[1]}
    if(data.kind==='peaks')ylo=Math.min(0,ylo);
    if(data.simulation&&!data.viewRange){lo=data.nmrModel?.range?.[0]??data.simulation.grid.start;hi=data.nmrModel?.range?.[1]??data.simulation.grid.end}
    if(/transmittance.*\(%\)/i.test(data.yUnit)&&ylo>=0&&yhi<=100){ylo=0;yhi=100}
    if(lo===hi){lo-=1;hi+=1}if(ylo===yhi){ylo-=.5;yhi+=.5}
    const xpad=(hi-lo)*.018;lo-=xpad;hi+=xpad;
    const gap=yhi-ylo;ylo-=gap*.14;yhi+=gap*.18;
    const reverse=['ftir','h1','c13'].includes(data.technique),xp=x=>68+(reverse?hi-x:x-lo)/(hi-lo)*664,yp=y=>300-(y-ylo)/(yhi-ylo)*235;
    // Preserve local extrema when reducing a trace for the display; CSV keeps every point.
    const selected=[];const size=Math.max(1,Math.ceil(pathValues.length/900));for(let i=0;i<pathValues.length;i+=size){const bin=pathValues.slice(i,i+size);if(data.kind==='peaks'||data.kind==='positions'){selected.push(...bin);continue}const candidates=[0,bin.length-1,bin.reduce((best,p,k)=>p[1]<bin[best][1]?k:best,0),bin.reduce((best,p,k)=>p[1]>bin[best][1]?k:best,0)];for(const k of [...new Set(candidates)].sort((a,b)=>a-b))selected.push(bin[k])}
    let path=data.kind==='positions'?selected.map(([x])=>`M${xp(x).toFixed(2)} 220v35`).join(' '):data.kind==='peaks'?selected.map(([x,y])=>`M${xp(x).toFixed(2)} ${yp(0).toFixed(2)}V${yp(y).toFixed(2)}`).join(' '):selected.map(([x,y],i)=>`${i?'L':'M'}${xp(x).toFixed(2)} ${yp(y).toFixed(2)}`).join(' ');
    return {path,lo,hi,ylo,yhi,reverse,xPosition:xp,yPosition:yp,positionOnly:data.kind==='positions',ticks:Array.from({length:6},(_,i)=>({x:68+i*664/5,value:reverse?hi-i*(hi-lo)/5:lo+i*(hi-lo)/5})),yTicks:Array.from({length:5},(_,i)=>({y:300-i*235/4,value:ylo+i*(yhi-ylo)/4}))};
  }
  function instrumentTexture(data,enabled){
    if(!enabled||!data.isSimulated||data.kind!=='curve'||!['ftir','uv'].includes(data.technique))return data;
    const seed=20261005,noise=i=>{let s=((i+1)^seed)>>>0;s=Math.imul(s^(s>>>16),0x45d9f3b);s=Math.imul(s^(s>>>16),0x45d9f3b);return ((s^(s>>>16))>>>0)/4294967295-.5};
    // Same fixed-seed instrument effects for all structures. Not compound-specific evidence.
    const points=data.points.map(([x,y],i)=>{const fraction=i/Math.max(1,data.points.length-1),ripple=.007*Math.sin(fraction*43)+.005*Math.sin(fraction*187),spike=i%487===91?.035:i%487===92?-.012:0;return [x,Math.max(.003,Math.min(.95,y*.91+.012*noise(i)+ripple+.014*fraction+spike))]});
    return {...data,points,texture:{kind:'fixed-seed educational instrument effects',seed,baselineRipple:true,isolatedSpikes:true,eligibleForMatching:false},yUnit:data.yUnit};
  }
  function exportProvenance(record,data={}){
    const meta=record.metadata||{};
    return {source:record.source_url||'',sourceLabel:meta.sourceLabel||record.source_title||'',measurementType:meta.measurementType||data.measurementType||'',conditions:meta.conditions||data.conditions||{},phase:meta.phase||'',instrument:meta.instrument||'',resolution:meta.resolution||'',license:meta.license||record.source_license||'',citation:meta.citation||meta.reference||'',identityLinkage:meta.identityLinkage||'',eligibleForMatching:meta.eligibleForMatching??null};
  }
  window.focusSpectraData={spectrumData,csv,chart,detectPeaks,displayData,assignPeaks,canSwitchFtir,canAssignPeaks,sourcePriority,exportProvenance,instrumentTexture};
})();
