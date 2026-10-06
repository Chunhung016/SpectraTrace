import {interpretFtir} from './interpret.mjs';

// Navigation gates, not calibrated identity probabilities. A passing result is
// still a provisional reference suggestion, never an assigned sample identity.
export const autoOpenPolicy=Object.freeze({version:'reference-suggestion-v1',minSimilarity:0.985,minGap:0.05,minCoverage:0.9,minDistinctCompounds:2});
export function proposeIdentification(query,results=[]){
  const base={policy:autoOpenPolicy,confirmed:false,autoOpen:false,compoundId:null,status:'needs-review',limitations:'Unvalidated navigation thresholds. Similarity is not identification confidence; compounds outside the reviewed library and close isomers remain possible.'};
  const stop=(reason,details={})=>({...base,...details,reason});
  const ftir=query.spectra.find(z=>z.technique==='ftir'&&z.parsed),m=ftir?.metadata||{};
  if(!results.length)return stop('No compatible reviewed experimental reference. Structure suggestions cannot automatically identify this sample.');
  if(query.selection?.compound_id)return stop('An existing student hypothesis is retained. Review the reference matches before changing it.');
  if(m.sampleType!=='single')return stop('Automatic opening requires an expected single compound; mixtures and unknown sample types need review.');
  if(query.spectra.some(z=>!z.parsed))return stop('One or more uploaded files could not be parsed. Review the original files.');
  if(!ftir||!['absorbance','transmittance-percent'].includes(m.yMode)||m.normalized==='true'||/normaliz/i.test(ftir.parsed.selectedHeader||''))return stop('A non-normalized FTIR absorbance or transmittance trace is required for automatic opening.');
  const p=ftir.parsed.points;
  if(p.length<150||p[0][0]>650||p.at(-1)[0]<3600||p.some((q,i)=>i&&q[0]-p[i-1][0]>25))return stop('FTIR coverage or sampling is too limited for automatic opening.');
  let a;try{a=interpretFtir(ftir)}catch{return stop('FTIR interpretation needs review before automatic opening.');}
  const bands=a.peaks.filter(z=>!z.artifact);
  // Noise is expressed in absorbance by interpretFtir, regardless of upload axes.
  let lo=Infinity,hi=-Infinity;for(const [,y]of p){const v=m.yMode==='transmittance-percent'?-Math.log10(y/100):y;lo=Math.min(lo,v);hi=Math.max(hi,v)}
  if(hi===lo||a.noiseEstimate>(hi-lo)*.04||bands.length<3||bands.filter(z=>z.fingerprint).length<2)return stop('Not enough reliable FTIR bands, or excessive noise, for automatic opening.');
  const best=results[0],bestFtir=best.scores.find(z=>z.technique==='ftir');
  const competitors=results.filter(z=>z.compound.id!==best.compound.id).flatMap(z=>z.scores.filter(s=>s.technique==='ftir').map(s=>s.similarity));
  const distinct=new Set(results.filter(z=>z.scores.some(s=>s.technique==='ftir')).map(z=>z.compound.id)).size;
  const gap=bestFtir&&competitors.length?bestFtir.similarity-Math.max(...competitors):null;
  const details={referenceCompoundCount:distinct,similarity:best.mean,ftirGap:gap};
  if(distinct<autoOpenPolicy.minDistinctCompounds)return stop('Too few distinct compatible reference compounds to establish a separated match.',details);
  const usable=query.spectra.filter(z=>z.parsed);
  if(!bestFtir||best.scores.length!==usable.length)return stop('The leading reference does not cover every uploaded technique.',details);
  if(bestFtir.referenceNormalized)return stop('The leading FTIR reference is normalized. Review the match rather than opening automatically.',details);
  if(best.scores.some(z=>!Number.isFinite(z.similarity)||!Number.isFinite(z.coverage)||z.similarity<autoOpenPolicy.minSimilarity||z.coverage<autoOpenPolicy.minCoverage))return stop('Reference similarity or shared range does not meet the automatic-opening gate.',details);
  if(gap<autoOpenPolicy.minGap)return stop('Several reference compounds have similar FTIR matches. Choose after reviewing the candidates.',details);
  return {...base,...details,autoOpen:true,status:'reference-suggestion',compoundId:best.compound.id,referenceId:best.referenceId,reason:'A separated reviewed-reference match opens as a suggestion, not a confirmed identification.'};
}
