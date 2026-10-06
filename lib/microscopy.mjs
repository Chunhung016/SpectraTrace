// Article figures are contextual literature evidence, never a morphology prediction.
const cache=new Map(),pending=new Map();
export const MICROSCOPY_VERSION='caption-bound-v2';
const plain=x=>String(x||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{Accept:'application/xml,application/json'}});if(!r.ok)throw Error('Literature service returned '+r.status);const t=await r.text();if(t.length>12000000)throw Error('Article exceeds processing limit');return t};
export function extractFigures(xml,article){
  const permission=xml.match(/<permissions>[\s\S]*?<\/permissions>/)?.[0]||'',licensed=/creativecommons\.org\/licenses\/by\/|Creative Commons Attribution \(CC-BY\)|CC BY 4\.0/i.test(permission)&&!/CC-BY-NC|CC-BY-ND|licenses\/by-nc|licenses\/by-nd/i.test(permission);
  if(!licensed||/retract/i.test(article.title))return [];
  const licenseUrl=(permission.match(/(?:href|xlink:href)="(https?:\/\/creativecommons\.org\/licenses\/by\/[^" ]*)"/)?.[1]||permission.match(/(?:href|xlink:href)="(https?:\/\/pubs\.acs\.org\/[^" ]*ccby[^" ]*)"/)?.[1]||'https://creativecommons.org/licenses/').replace(/^http:/,'https:');
  return [...xml.matchAll(/<fig\b[\s\S]*?<\/fig>/g)].flatMap(m=>{
    const fig=m[0],caption=plain(fig.match(/<caption>[\s\S]*?<\/caption>/)?.[0]);
    if(!/\bSEM\b|\bTEM\b|scanning electron|transmission electron/i.test(caption)||/reproduced|reprinted|copyright|permission from/i.test(caption))return [];
    if(article.queryName){const terms=[article.queryName,...(/acetaminophen|paracetamol/i.test(article.queryName)?['paracetamol','acetaminophen','PCT','PMOL']:[])],direct=terms.some(t=>caption.toLowerCase().includes(t.toLowerCase()));if(!direct)return [];if(/platelet|thrombus|erythrocyte|leukocyte|tumou?r|kidney|renal tissue|cell morphology|hepatocyte/i.test(caption))return []}
    const urn=fig.match(/<\?image-cloudpmc-urn urn:cdn:(blobs\/[^?]+)\?>/)?.[1]||(/<\?cloudpmc-bucket cdn\?>/.test(fig)?fig.match(/<\?cloudpmc-path (blobs\/[^?]+)\?>/)?.[1]:null),id=fig.match(/<fig\b[^>]*\bid="([\w.-]+)"/)?.[1];
    if(!urn||!id||!/^blobs\/[\w/.-]+$/.test(urn))return [];
    return [{...article,figure:plain(fig.match(/<label>[\s\S]*?<\/label>/)?.[0]),caption:caption.slice(0,1500),technique:/\bTEM\b|transmission electron/i.test(caption)?'TEM':'SEM',imageUrl:'https://cdn.ncbi.nlm.nih.gov/pmc/'+urn,figureUrl:'https://pmc.ncbi.nlm.nih.gov/articles/'+article.pmcid+'/figure/'+id+'/',license:'CC BY',licenseUrl,status:'literature-context',exactIdentityVerified:false}];
  });
}
export async function microscopy(name){
  const safe=String(name).replace(/[^\p{L}\p{N} ()-]/gu,' ').trim().slice(0,100);if(safe.length<3)return {figures:[],reason:'Compound name too short for reliable literature discovery.'};
  const key=safe.toLowerCase();if(cache.has(key))return cache.get(key);if(pending.has(key))return pending.get(key);
  const work=(async()=>{
    const terms=/acetaminophen|paracetamol/i.test(safe)?'("acetaminophen" OR "paracetamol")':'"'+safe+'"';
    const query='TITLE_ABS:'+terms+' AND ("scanning electron" OR "transmission electron") AND (crystal OR particle OR powder OR formulation) AND OPEN_ACCESS:Y';
    const search=JSON.parse(await get('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=12&query='+encodeURIComponent(query))),papers=(search.resultList?.result||[]).filter(r=>r.pmcid&&r.isRetracted!=='Y'&&!/retract/i.test(r.title));
    const seeds=/^aspirin$/i.test(safe)?['PMC7587144']:/acetaminophen|paracetamol/i.test(safe)?['PMC8076289','PMC10124118']:[];
    for(const id of seeds)if(!papers.some(r=>r.pmcid===id)){const record=JSON.parse(await get('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&query=PMCID:'+id));const r=record.resultList?.result?.[0];if(r?.pmcid&&!/retract/i.test(r.title))papers.unshift(r)}
    const figures=[],errors=[];
    for(const r of papers.slice(0,12)){try{const article={queryName:safe,pmcid:r.pmcid,title:r.title,authors:r.authorString,year:r.pubYear,doi:r.doi||'',articleUrl:'https://pmc.ncbi.nlm.nih.gov/articles/'+r.pmcid+'/'};figures.push(...extractFigures(await get('https://www.ebi.ac.uk/europepmc/webservices/rest/'+r.pmcid+'/fullTextXML'),article))}catch(e){errors.push(r.pmcid+': '+e.message)}}
    const result={version:MICROSCOPY_VERSION,figures,articlesScanned:Math.min(12,papers.length),totalLiteratureHits:Number(search.hitCount)||0,errors,queryName:safe,retrievedAt:new Date().toISOString(),reason:figures.length?null:'No eligible CC BY SEM/TEM figure found in the first 12 open-access papers.',warning:'Article-associated figures may depict formulations, co-crystals, carriers or treated samples. Check each caption and paper. They do not show your uploaded sample or prove its identity.'};cache.set(key,result);return result;
  })();pending.set(key,work);try{return await work}finally{pending.delete(key)}
}
