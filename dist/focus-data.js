/* Spectral exports preserve representation: position lists never gain invented intensities. */
(function(){
  const units={ftir:'cm-1',c13:'ppm',h1:'ppm',uv:'nm',xrd:'2theta-deg',fluorescence:'nm',raman:'cm-1',ms:'m/z'};
  // Reflectance and optical constants are distinct physical observables, not absorbance.
  const incompatibleFtirType=value=>/reflectance|optical[- ]constants|refractive[- ]index|extinction[- ]coefficient/i.test(value||'');
  const isTransmittance=u=>/transmittance/i.test(u||'');
  const isPercent=u=>/percent|%/i.test(u||'');
  function canSwitchFtir(data){return !!data&&data.technique==='ftir'&&data.kind!=='positions'&&!incompatibleFtirType(data.measurementType)&&!incompatibleFtirType(data.yUnit);}
  function canAssignPeaks(data){return !!data&&['ftir','h1','c13','uv'].includes(data.technique)&&(data.technique!=='ftir'||(!incompatibleFtirType(data.measurementType)&&!incompatibleFtirType(data.yUnit)));}
  function sourcePriority(option){
    if(option.simulation)return 10;
    if(option.calculated)return 9;
    const record=option.record||option.summary||{},meta=record.metadata||{};
    if(incompatibleFtirType(meta.measurementType)||incompatibleFtirType(meta.yMode))return 8;
    if(option.status==='reviewed')return 0;
    if(/nist|swgdrug/i.test(record.source_id||''))return 1;
    if(/^EI/.test(meta.ionization||''))return 1.2;
    if(meta.calculated)return 1.6;
    return record.parsed?1.5:/^continuous/.test(record.representation||'')?2:4;
  }
  function spectrumData(record,technique){
    if(record.status==='quarantined')return null;
    const meta=record.metadata||{},isTheory=['simulated','theoretical'].includes(record.status);
    const yUnit=isTheory?(['ftir','uv'].includes(technique)?'Absorbance':technique==='ms'?'relative-abundance':'Intensity (a.u.)'):meta.yMode||'intensity';
    if(record.parsed?.points?.length)return {kind:meta.format==='peaks'||technique==='ms'?'peaks':'curve',points:record.parsed.points,xUnit:meta.xUnit||units[technique],yUnit,technique,measurementType:meta.measurementType||(/reflectance|DRIFT/i.test(meta.measurement||'')?'reflectance':''),normalized:meta.normalized==='true',conditions:meta.conditions||{},simulation:record.simulation,nmrModel:record.nmrModel,frequency:meta.frequency,solvent:meta.solvent,isSimulated:isTheory,isCalculated:!!record.calculated||!!meta.calculated,sourceId:record.source_id||'',peakLabels:record.ionLabels||meta.peakLabels||null,excitation:meta.excitation||''};
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
    if(data.simulation&&['h1','c13'].includes(data.technique)){const groups=new Map();for(const c of data.simulation.components){if(!groups.has(c.centre))groups.set(c.centre,{x:c.centre,y:0,labels:[],origin:'T signal centre'});const p=groups.get(c.centre);p.y+=c.weight;p.labels.push(c.label)}return [...groups.values()].sort((a,b)=>a.x-b.x)}
    if(data.kind==='positions')return data.values.map(p=>({x:p.x,y:1,origin:'reported position'}));
    if(data.technique==='ms'&&data.kind==='peaks'){
      // Label the most abundant ions plus the highest-m/z ion above 2% (candidate M⁺·).
      const pts=data.points.filter(p=>p[1]>0);if(!pts.length)return [];const max=Math.max(...pts.map(p=>p[1]));
      const top=[...pts].sort((a,b)=>b[1]-a[1]).slice(0,10);let k=pts.findLastIndex(p=>p[1]>=.02*max);while(k>0&&pts[k-1][0]===pts[k][0]-1&&pts[k-1][1]>pts[k][1])k--;const high=pts[k];if(high&&!top.includes(high))top.push(high);
      return top.sort((a,b)=>a[0]-b[0]).map(([x,y])=>({x,y,origin:'library / measured ion'}));
    }
    if(data.kind==='peaks')return data.points.map(([x,y])=>({x,y,origin:'supplied peak'}));
    const points=data.points;if(points.length<3)return [];const inverted=data.technique==='ftir'&&isTransmittance(data.yUnit),values=points.map(p=>inverted?-p[1]:p[1]);let lo=Infinity,hi=-Infinity;for(const y of values){lo=Math.min(lo,y);hi=Math.max(hi,y)}if(hi===lo)return [];
    const threshold=(hi-lo)*.03,span=Math.max(3,Math.min(200,Math.round(points.length/20))),found=[];
    for(let i=1;i<points.length-1;i++){if(values[i]<=values[i-1]||values[i]<values[i+1])continue;let left=values[i],right=values[i];for(let k=Math.max(0,i-span);k<i;k++)left=Math.min(left,values[k]);for(let k=i+1;k<=Math.min(points.length-1,i+span);k++)right=Math.min(right,values[k]);if(values[i]-Math.max(left,right)>=threshold)found.push({x:points[i][0],y:points[i][1],height:values[i]-lo,origin:'detected local extremum'})}
    const distance={ftir:8,uv:3,h1:.001,c13:.005,xrd:.12,fluorescence:3,raman:8}[data.technique],selected=[];for(const p of found.sort((a,b)=>b.height-a.height)){if(!selected.some(q=>Math.abs(p.x-q.x)<distance))selected.push(p)}return selected.sort((a,b)=>a.x-b.x);
  }
  function displayData(data,mode){
    if(data.technique==='ms'&&data.kind==='peaks'){let max=0;for(const p of data.points)max=Math.max(max,p[1]);return max>0?{...data,points:data.points.map(([x,y])=>[x,100*y/max]),yUnit:'Relative abundance (%)',normalizedFrom:max}:data}
    if(data.technique==='xrd'&&mode==='ln'&&data.kind==='curve'){const floor=Math.max(1e-6,Math.min(...data.points.map(p=>p[1]).filter(y=>y>0)));return {...data,points:data.points.map(([x,y])=>[x,Math.log(Math.max(y,floor))]),yUnit:'ln(I) (a.u.)'}}
    if(['h1','c13'].includes(data.technique)&&mode==='sticks'){const peaks=detectPeaks(data);let max=1;for(const p of peaks)max=Math.max(max,p.y);return {...data,kind:'peaks',points:peaks.map(p=>[p.x,data.isSimulated?p.y/max:p.y]),yUnit:data.kind==='positions'?'Position marker (not intensity)':data.isSimulated?'Intensity (a.u.)':data.yUnit};}
    if(!canSwitchFtir(data))return data;
    const trans=isTransmittance(data.yUnit),fraction=trans&&!isPercent(data.yUnit),abs=/^absorbance$/i.test(data.yUnit);
    if(mode==='transmittance'){
      if(trans)return data;
      if(data.isSimulated)return {...data,points:data.points.map(([x,y])=>[x,100*Math.pow(10,-y)]),yUnit:'Transmittance (%)'};
      if(abs)return {...data,points:data.points.map(([x,y])=>[x,100*Math.pow(10,-y)]),yUnit:'Transmittance (%)'};
      let low=Infinity,high=-Infinity;for(const [,y]of data.points){low=Math.min(low,y);high=Math.max(high,y)}return {...data,points:data.points.map(([x,y])=>[x,1-(y-low)/(high-low||1)]),yUnit:'Relative downward display'};
    }
    if(trans&&data.points.every(p=>p[1]>0))return {...data,points:data.points.map(([x,y])=>[x,-Math.log10(fraction?y:y/100)]),yUnit:data.normalized?'Derived relative absorbance (normalized %T)':'Absorbance'};
    return data;
  }
  // Continuous Lorentzian display of NMR lines (T model, peak lists, T solvent lines).
  // A display transform only: CSV keeps the line list and measured traces are never reshaped.
  function lineshape(data,{fwhmHz,frequency,range}={}){
    const lines=[...(data.nmrLines||(data.kind==='peaks'?data.points.map(([x,y])=>({x,y})):[])),...(data.referenceLines||[])].filter(l=>Number.isFinite(l.x)&&l.y>0);
    if(!lines.length||!['h1','c13'].includes(data.technique))return data;
    const mhz=Number(frequency)>0?Number(frequency):(data.technique==='c13'?100:400),width=Number(fwhmHz)>0?Number(fwhmHz):(data.technique==='c13'?2:1),half=width/mhz/2;
    const xs=lines.map(l=>l.x),pad=data.technique==='c13'?5:.3;
    const lo=range?.[0]??Math.min(...xs)-pad,hi=range?.[1]??Math.max(...xs)+pad,grid=[];
    for(let i=0;i<=2400;i++)grid.push(lo+(hi-lo)*i/2400);
    for(const l of lines)if(l.x>=lo&&l.x<=hi)for(const k of [-40,-15,-8,-5,-3,-2,-1.4,-1,-.6,-.3,0,.3,.6,1,1.4,2,3,5,8,15,40]){const x=l.x+k*half;if(x>=lo&&x<=hi)grid.push(x)}
    grid.sort((a,b)=>a-b);const points=[];let prev=null;
    for(const x of grid){if(prev!==null&&x-prev<1e-9)continue;prev=x;let y=0;for(const l of lines){const d=x-l.x;y+=l.y*half*half/(d*d+half*half)}points.push([x,y])}
    return {...data,kind:'curve',points,yUnit:'Intensity (a.u.)',lineshape:{fwhmHz:width,frequency:mhz,range:[lo,hi],lines:lines.length,note:'Lorentzian display of listed lines; not a measured trace'}};
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
  // "Nice" 1–2–5 tick values with minor subdivisions, as on printed spectra.
  function niceTicks(lo,hi,target=6){
    if(!(hi>lo))return {major:[],minor:[],step:0,decimals:0};
    const raw=(hi-lo)/target,mag=10**Math.floor(Math.log10(raw)),m=raw/mag,mant=m<1.5?1:m<3?2:m<7?5:10,step=mant*mag,sub=mant===2?4:5,minor=step/sub;
    const decimals=Math.max(0,-Math.floor(Math.log10(step)+1e-9)),major=[],minors=[];
    for(let k=Math.ceil(lo/step-1e-9);k*step<=hi+step*1e-9;k++)major.push(Number((k*step).toFixed(decimals+2)));
    for(let k=Math.ceil(lo/minor-1e-9);k*minor<=hi+minor*1e-9;k++){const v=k*minor;if(Math.abs(v/step-Math.round(v/step))>1e-6)minors.push(v)}
    return {major,minor:minors,step,decimals};
  }
  const BOX={l:82,r:770,t:52,b:298},HEIGHT=372;
  function chart(data,extra=[]){
    const original=data.kind==='positions'?data.values.map(p=>[p.x,0]):data.points;
    const all=[...original,...(data.referenceLines&&!data.lineshape?data.referenceLines.map(l=>[l.x,l.y]):[]),...extra.flatMap(s=>s.points)];
    const inView=p=>!data.viewRange||(p[0]>=data.viewRange[0]&&p[0]<=data.viewRange[1]);
    const values=all.filter(inView),pathValues=original.filter(inView);
    if(!values.length)return null;
    let lo=Infinity,hi=-Infinity,ylo=Infinity,yhi=-Infinity;
    for(const [x,y]of values){lo=Math.min(lo,x);hi=Math.max(hi,x);ylo=Math.min(ylo,y);yhi=Math.max(yhi,y)}
    if(data.kind==='peaks'||data.technique==='ms'||data.lineshape)ylo=Math.min(0,ylo);
    if(/transmittance.*\(%\)/i.test(data.yUnit)&&ylo>=0&&yhi<=100){ylo=0;yhi=100}
    let padX=true;
    if(data.viewRange){lo=data.viewRange[0];hi=data.viewRange[1];padX=false}
    else if(data.lineshape){lo=data.lineshape.range[0];hi=data.lineshape.range[1];padX=false}
    else if(data.simulation){lo=data.nmrModel?.range?.[0]??data.simulation.grid.start;hi=data.nmrModel?.range?.[1]??data.simulation.grid.end}
    if(data.technique==='ms'&&!data.viewRange){lo=Math.max(0,Math.floor((lo-8)/10)*10);hi=Math.ceil((hi+8)/10)*10;padX=false}
    if(lo===hi){lo-=1;hi+=1}if(ylo===yhi){ylo-=.5;yhi+=.5}
    if(padX){const xpad=(hi-lo)*.018;lo-=xpad;hi+=xpad}
    const gap=yhi-ylo,floorLike=data.kind==='peaks'||data.technique==='ms'||!!data.lineshape;ylo-=gap*(floorLike?.015:.08);yhi+=gap*(data.technique==='ms'?.22:.14);
    const {l,r,t,b}=BOX,reverse=['ftir','h1','c13'].includes(data.technique),xp=x=>l+(reverse?hi-x:x-lo)/(hi-lo)*(r-l),yp=y=>b-(y-ylo)/(yhi-ylo)*(b-t);
    // Preserve local extrema when reducing a trace for the display; CSV keeps every point.
    const reduce=list=>{const out=[],size=Math.max(1,Math.ceil(list.length/1400));for(let i=0;i<list.length;i+=size){const bin=list.slice(i,i+size);if(data.kind==='peaks'||data.kind==='positions'){out.push(...bin);continue}const c=[0,bin.length-1,bin.reduce((best,p,k)=>p[1]<bin[best][1]?k:best,0),bin.reduce((best,p,k)=>p[1]>bin[best][1]?k:best,0)];for(const k of [...new Set(c)].sort((a,b)=>a-b))out.push(bin[k])}return out};
    const line=list=>list.map(([x,y],i)=>`${i?'L':'M'}${xp(x).toFixed(2)} ${yp(y).toFixed(2)}`).join(' ');
    const selected=reduce(pathValues);
    const path=data.kind==='positions'?selected.map(([x])=>`M${xp(x).toFixed(2)} ${b-78}v35`).join(' '):data.kind==='peaks'?selected.map(([x,y])=>`M${xp(x).toFixed(2)} ${yp(0).toFixed(2)}V${yp(y).toFixed(2)}`).join(' '):line(selected);
    const xt=niceTicks(Math.min(lo,hi),Math.max(lo,hi),data.technique==='ms'?8:6),yt=niceTicks(ylo,yhi,5);
    return {path,lo,hi,ylo,yhi,reverse,box:BOX,height:HEIGHT,xPosition:xp,yPosition:yp,positionOnly:data.kind==='positions',
      ticks:xt.major.map(value=>({x:xp(value),value})),minorTicks:xt.minor.map(value=>({x:xp(value),value})),xDecimals:xt.decimals,
      yTicks:yt.major.map(value=>({y:yp(value),value})),yMinorTicks:yt.minor.map(value=>({y:yp(value),value})),yDecimals:yt.decimals,
      series:extra.map(s=>({...s,path:line(reduce(s.points.filter(inView)))}))};
  }
  const colors={ftir:'#e8352e',xrd:'#e00000',h1:'#111111',c13:'#111111',uv:'#6b2fa0',raman:'#1d4f91',fluorescence:'#1f7a3a',ms:'#1a1a1a'};
  const palette=['#6b2fa0','#00a6e6','#7cc242','#f2a900','#c00000','#1d4f91'];
  const titles={ftir:'INFRARED SPECTRUM',h1:'¹H NMR SPECTRUM',c13:'¹³C NMR SPECTRUM',uv:'UV/VISIBLE SPECTRUM',xrd:'X-RAY DIFFRACTION PATTERN',fluorescence:'FLUORESCENCE SPECTRUM',raman:'RAMAN SPECTRUM',ms:'MASS SPECTRUM'};
  const xLabels=d=>d.xUnit==='2theta-deg'?'2θ (°)':d.xUnit==='m/z'?'m/z':d.xUnit==='cm-1'?(d.technique==='raman'?'Raman shift (cm⁻¹)':'Wavenumber (cm⁻¹)'):d.xUnit==='nm'?'Wavelength (nm)':'δ (ppm)';
  function yLabel(d){
    if(d.kind==='positions')return '';
    const u=String(d.yUnit||'');
    if(d.technique==='ftir'&&isTransmittance(u))return isPercent(u)?'TRANSMITTANCE (%)':'TRANSMITTANCE';
    if(/^absorbance$/i.test(u))return d.technique==='ftir'?'ABSORBANCE':'Absorbance';
    return {'log-epsilon':'log ε','epsilon':'ε (L mol⁻¹ cm⁻¹)',intensity:'Intensity (a.u.)','relative-abundance':'Relative abundance'}[u]||u;
  }
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,d)=>String(Number(v.toFixed(Math.min(6,d))));
  let clipCount=0;
  // Classic printed-spectrum style: closed frame, inward major/minor ticks on all sides,
  // technique colour, optional NIST-style title and source credit.
  function svg(data,opts={}){
    const g=chart(data,opts.series||[]);if(!g)return '';
    const {l,r,t,b}=g.box,H=g.height,color=opts.color||(data.isSimulated?'#555':colors[data.technique])||'#222',font='Arial, Helvetica, sans-serif',clip='plot-clip-'+(++clipCount);
    const compact=!!opts.compact,hideY=compact||(opts.hideYValues??(['h1','c13'].includes(data.technique)||g.positionOnly));
    const tick=(ticks,len,axis)=>ticks.map(k=>axis==='x'?`M${k.x.toFixed(2)} ${b}v${-len}M${k.x.toFixed(2)} ${t}v${len}`:`M${l} ${k.y.toFixed(2)}h${len}M${r} ${k.y.toFixed(2)}h${-len}`).join('');
    const inX=k=>k.x>=l-.5&&k.x<=r+.5,inY=k=>k.y>=t-.5&&k.y<=b+.5;
    const xt=g.ticks.filter(inX),yt=g.yTicks.filter(k=>inY(k)&&!(data.technique==='ms'&&k.value>100));
    let out=`<svg class="${opts.className||'floating-plot'}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 ${H}" role="img" aria-label="${esc(opts.ariaLabel||titles[data.technique]||'Spectrum')}"><rect width="800" height="${H}" fill="white"/><defs><clipPath id="${clip}"><rect x="${l}" y="${t-60}" width="${r-l}" height="${b-t+60}"/></clipPath></defs>`;
    if(opts.title)out+=`<g font-family="${font}" fill="#111" text-anchor="middle" font-size="12.5" letter-spacing=".4">${[].concat(opts.title).map((line,i)=>`<text x="${(l+r)/2}" y="${18+i*16}">${esc(line)}</text>`).join('')}</g>`;
    out+=`<g clip-path="url(#${clip})">`;
    for(const s of g.series)out+=`<path d="${s.path}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round"/>`;
    out+=`<path d="${g.path}" fill="none" stroke="${color}" stroke-width="${(compact?2.6:1)*(data.kind==='peaks'?(data.technique==='ms'?1.6:1.3):1.25)}" stroke-linejoin="round"/></g>`;
    out+=`<path d="${tick(xt,7,'x')+tick(g.minorTicks.filter(inX),3.5,'x')+tick(yt,7,'y')+tick(g.yMinorTicks.filter(inY),3.5,'y')}" stroke="#111" stroke-width="1" fill="none"/><rect x="${l}" y="${t}" width="${r-l}" height="${b-t}" fill="none" stroke="#111" stroke-width="1.1"/>`;
    out+=compact?`<g font-family="${font}" fill="#333" font-size="30">${xt.filter((k,i)=>i%2===0).map(k=>`<text x="${k.x.toFixed(2)}" y="${b+36}" text-anchor="middle">${fmt(k.value,g.xDecimals)}</text>`).join('')}</g>`:`<g font-family="${font}" fill="#111" font-size="13">${xt.map(k=>`<text x="${k.x.toFixed(2)}" y="${b+19}" text-anchor="middle">${fmt(k.value,g.xDecimals)}</text>`).join('')}${hideY?'':yt.map(k=>`<text x="${l-7}" y="${(k.y+4.5).toFixed(2)}" text-anchor="end">${fmt(k.value,g.yDecimals)}</text>`).join('')}<text x="${(l+r)/2}" y="${b+44}" text-anchor="middle" font-size="14">${esc(xLabels(data))}</text>${g.positionOnly?'':`<text x="20" y="${(t+b)/2}" transform="rotate(-90 20 ${(t+b)/2})" text-anchor="middle" font-size="13.5">${esc(opts.yLabel||yLabel(data))}</text>`}</g>`;
    if(compact)return out+'</svg>';
    if(opts.corner)out+=`<text x="${r-10}" y="${t+20}" text-anchor="end" font-family="${font}" font-size="13" letter-spacing="1" fill="#111">${esc(opts.corner)}</text>`;
    // Series labels sit beside each curve's extreme, coloured like the curve (overlay view).
    const downward=data.technique==='ftir'&&isTransmittance(data.yUnit);
    const placed=[];
    for(const s of g.series.concat(opts.seriesMain?[{...opts.seriesMain,points:data.points,color}]:[])){const pts=s.points.filter(p=>!data.viewRange||(p[0]>=data.viewRange[0]&&p[0]<=data.viewRange[1]));if(!pts.length)continue;const peak=pts.reduce((a,p)=>downward?(p[1]<a[1]?p:a):(p[1]>a[1]?p:a));const width=7.2*String(s.label).length,x=Math.min(r-6-width,g.xPosition(peak[0])+10);let y=Math.max(t+12,Math.min(b-6,g.yPosition(peak[1])+(downward?14:-4)));
      // Nudge labels that would overlap an earlier one, keeping them beside their own curve.
      while(placed.some(q=>Math.abs(q.y-y)<14&&x<q.x+q.w&&q.x<x+width)&&y>t+14)y-=14;placed.push({x,y,w:width});out+=`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${font}" font-size="12.5" font-weight="700" fill="${s.color}">${esc(s.label)}</text>`}
    // Peak markers: a quiet dot to click; selected peaks get a vertical label as on XRD/IR plates.
    // Label the tallest peaks first; skip a label (not the marker) when it would collide.
    const labelled=[],order=new Map([...(opts.markers||[])].map(m=>{const near=(data.points||[]).reduce((best,q)=>Math.abs(q[0]-m.x)<Math.abs(best[0]-m.x)?q:best,(data.points||[[m.x,0]])[0]);return [m,near?near[1]:0]}).sort((a,c)=>downward?a[1]-c[1]:c[1]-a[1]).map(([m],k)=>[m,k]));
    const roomFor=x=>{if(labelled.some(v=>Math.abs(v-x)<12.5))return false;labelled.push(x);return true};
    for(const m of [...(opts.markers||[])].sort((a,c)=>order.get(a)-order.get(c))){
      if(data.viewRange&&(m.x<data.viewRange[0]||m.x>data.viewRange[1]))continue;
      const x=g.xPosition(m.x);if(x<l-1||x>r+1)continue;
      const near=g.positionOnly?null:(data.points||[]).reduce((best,q)=>Math.abs(q[0]-m.x)<Math.abs(best[0]-m.x)?q:best,data.points[0]);
      const y=g.positionOnly?b-78:Math.max(t,Math.min(b,g.yPosition(near?near[1]:0))),down=downward&&!g.positionOnly,text=m.label||'';
      out+=`<g data-peak="${m.x}" role="button" tabindex="0" aria-label="${esc(m.ariaLabel||('Peak at '+m.x))}" style="cursor:pointer"><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="8" fill="transparent"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${m.on?3:2.4}" fill="${m.on?color:'#9aa3a0'}" fill-opacity="${m.on?.9:.65}"/><title>${esc(m.title||text)}</title>`;
      if(m.on&&text&&roomFor(x)){const label=text.length>34?text.slice(0,32)+'…':text;
        // Downward (transmittance) bands: label hangs from the top of the frame with a leader to the band tip.
        if(down){const top=t+5,len=label.length*5.6+4;out+=`<path d="M${x.toFixed(2)} ${(top+len).toFixed(2)}V${(y-6).toFixed(2)}" stroke="#999" stroke-width=".7" stroke-dasharray="2 2"/><text transform="translate(${(x+3.8).toFixed(2)} ${top}) rotate(-90)" text-anchor="end" font-family="${font}" font-size="10.5" fill="#222">${esc(label)}</text>`}
        else out+=`<path d="M${x.toFixed(2)} ${(y-6).toFixed(2)}V${(y-13).toFixed(2)}" stroke="#444" stroke-width=".8"/><text transform="translate(${(x+3.8).toFixed(2)} ${(y-16).toFixed(2)}) rotate(-90)" text-anchor="start" font-family="${font}" font-size="10.5" fill="#222">${esc(label)}</text>`}
      out+='</g>';
    }
    if(opts.credit)out+=`<text x="10" y="${H-8}" font-family="${font}" font-size="11.5" fill="#333">${esc(opts.credit)}</text>`;
    if(opts.note)out+=`<text x="790" y="${H-8}" text-anchor="end" font-family="${font}" font-size="10.5" fill="#666">${esc(opts.note)}</text>`;
    return out+'</svg>';
  }
  // Molecular-ion isotope cluster from a formula (nominal m/z bins). Fragments are not predicted.
  const ISO={H:[[1.007825,.999885],[2.014102,.000115]],D:[[2.014102,1]],C:[[12,.9893],[13.003355,.0107]],N:[[14.003074,.99636],[15.000109,.00364]],O:[[15.994915,.99757],[16.999132,.00038],[17.99916,.00205]],F:[[18.998403,1]],Na:[[22.98977,1]],Si:[[27.976927,.92223],[28.976495,.04685],[29.97377,.03092]],P:[[30.973762,1]],S:[[31.972071,.9499],[32.971459,.0075],[33.967867,.0425],[35.967081,.0001]],Cl:[[34.968853,.7576],[36.965903,.2424]],K:[[38.963707,.932581],[39.963998,.000117],[40.961826,.067302]],Br:[[78.918338,.5069],[80.916291,.4931]],I:[[126.904473,1]],B:[[10.012937,.199],[11.009305,.801]],Se:[[73.922476,.0089],[75.919214,.0937],[76.919914,.0763],[77.91731,.2377],[79.916522,.4961],[81.9167,.0873]],Li:[[6.015122,.0759],[7.016004,.9241]],As:[[74.921596,1]],Sn:[[115.901741,.0034],[116.902952,.0768],[117.901603,.2422],[118.903308,.0859],[119.902195,.3258],[121.90344,.0463],[123.905274,.0579]],Pt:[[193.962664,.3286],[194.964774,.3378],[195.964935,.2521],[197.967876,.0736]],Fe:[[53.939611,.05845],[55.934937,.91754],[56.935394,.02119],[57.933276,.00282]],Zn:[[63.929142,.4917],[65.926033,.2773],[66.927127,.0404],[67.924844,.1845]],Ca:[[39.962591,.96941],[43.955482,.02086]],Mg:[[23.985042,.7899],[24.985837,.1],[25.982593,.1101]],Gd:[[157.924104,.2484],[159.927054,.2186],[155.92212,.2047],[156.923957,.1565]]};
  function parseFormula(f){
    const s=String(f||'').trim().replace(/[+-]\d*$/,'');if(!s||/[.·•]/.test(s))return null;
    let i=0;const parse=()=>{const counts={};while(i<s.length&&s[i]!==')'){let part;if(s[i]==='('){i++;part=parse();if(s[i++]!==')')throw Error('bracket')}else{const m=s.slice(i).match(/^([A-Z][a-z]?)/);if(!m)throw Error('symbol');i+=m[1].length;part={[m[1]]:1}}const n=s.slice(i).match(/^\d+/);const k=n?Number(n[0]):1;if(n)i+=n[0].length;for(const [e,c]of Object.entries(part))counts[e]=(counts[e]||0)+c*k}return counts};
    try{const c=parse();return i===s.length?c:null}catch{return null}
  }
  function isotopePattern(formula){
    const counts=parseFormula(formula);if(!counts||!Object.keys(counts).length)return null;
    let dist=new Map([[0,{p:1,m:0}]]),mono=0;
    for(const [el,n]of Object.entries(counts)){
      const iso=ISO[el];if(!iso)return null;mono+=n*iso.reduce((a,b)=>b[1]>a[1]?b:a)[0];
      if(n>500)return null;
      for(let k=0;k<n;k++){const next=new Map();for(const [nom,v]of dist)for(const [mass,ab]of iso){const key=nom+Math.round(mass),p=v.p*ab;if(p<1e-12)continue;const cur=next.get(key)||{p:0,m:0};cur.m=(cur.m*cur.p+(v.m+mass)*p)/(cur.p+p);cur.p+=p;next.set(key,cur)}dist=next}
    }
    const rows=[...dist].sort((a,b)=>a[0]-b[0]),max=Math.max(...rows.map(r=>r[1].p));
    const points=rows.filter(r=>r[1].p/max>=.001).map(r=>[r[0],100*r[1].p/max]);
    return {points,monoisotopic:mono-0.000549,nominal:Math.round(mono),exact:rows.filter(r=>r[1].p/max>=.001).map(r=>({nominal:r[0],mass:r[1].m-0.000549,relative:100*r[1].p/max}))};
  }
  const AVG={H:1.008,C:12.011,N:14.007,O:15.999,F:18.998,Na:22.99,Mg:24.305,Si:28.085,P:30.974,S:32.06,Cl:35.45,K:39.098,Ca:40.078,Fe:55.845,Cu:63.546,Zn:65.38,Br:79.904,I:126.904,B:10.81,Li:6.94,Se:78.971,As:74.922,Sn:118.71,Pt:195.084,Gd:157.25,D:2.014};
  // Formula facts used on the compound page: average molar mass and rings + double bonds (DBE).
  function formulaFacts(formula){const c=parseFormula(formula);if(!c)return null;let mw=0;for(const [e,n]of Object.entries(c)){if(!AVG[e])return null;mw+=AVG[e]*n}const hal=(c.F||0)+(c.Cl||0)+(c.Br||0)+(c.I||0),dbe=(c.C||0)+(c.Si||0)-((c.H||0)+(c.D||0)+hal+(c.Na||0)+(c.K||0)+(c.Li||0))/2+((c.N||0)+(c.P||0)+(c.B||0))/2+1;return {counts:c,mw,dbe:Number.isInteger(dbe*2)?dbe:null}}
  function instrumentTexture(data,enabled){
    if(!enabled||!data.isSimulated||data.kind!=='curve'||!['ftir','uv'].includes(data.technique))return data;
    const seed=20261005,noise=i=>{let s=((i+1)^seed)>>>0;s=Math.imul(s^(s>>>16),0x45d9f3b);s=Math.imul(s^(s>>>16),0x45d9f3b);return ((s^(s>>>16))>>>0)/4294967295-.5};
    // Same fixed-seed instrument effects for all structures. Not compound-specific evidence.
    const points=data.points.map(([x,y],i)=>{const fraction=i/Math.max(1,data.points.length-1),ripple=.007*Math.sin(fraction*43)+.005*Math.sin(fraction*187),spike=i%487===91?.035:i%487===92?-.012:0;return [x,Math.max(.003,Math.min(.95,y*.91+.012*noise(i)+ripple+.014*fraction+spike))]});
    return {...data,points,texture:{kind:'fixed-seed educational instrument effects',seed,baselineRipple:true,isolatedSpikes:true,eligibleForMatching:false},yUnit:data.yUnit};
  }
  function exportProvenance(record,data={}){
    const meta=record.metadata||{};
    return {source:record.source_url||meta.sourceUrl||'',sourceLabel:meta.sourceLabel||record.source_title||'',measurementType:meta.measurementType||data.measurementType||'',conditions:meta.conditions||data.conditions||{},phase:meta.phase||'',instrument:meta.instrument||'',resolution:meta.resolution||'',license:meta.license||record.source_license||'',citation:meta.citation||meta.reference||'',identityLinkage:meta.identityLinkage||'',eligibleForMatching:meta.eligibleForMatching??null};
  }
  window.focusSpectraData={formulaFacts,spectrumData,csv,chart,svg,niceTicks,lineshape,isotopePattern,parseFormula,detectPeaks,displayData,assignPeaks,canSwitchFtir,canAssignPeaks,sourcePriority,exportProvenance,instrumentTexture,colors,palette,titles};
})();
