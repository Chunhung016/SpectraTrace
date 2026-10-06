// Turn Node's generic "fetch failed" into the underlying network/TLS reason with a fix hint.
const HINTS={
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:'the site\'s certificate chain is incomplete for Node.js. SpectraTrace already adds the Windows certificate store; open the site once in Edge or Chrome and retry, or download the file in your browser and add it by hand',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'Node.js does not trust the certificate issuer. an antivirus or company HTTPS proxy usually causes this; update Node.js to 24.5+ so SpectraTrace can use the Windows certificate store',
  SELF_SIGNED_CERT_IN_CHAIN:'an antivirus or company proxy is intercepting HTTPS; update Node.js to 24.5+ so SpectraTrace can use the Windows certificate store',
  CERT_HAS_EXPIRED:'the site certificate has expired or the computer clock is wrong',
  ENOTFOUND:'the name could not be resolved (DNS / offline)',
  EAI_AGAIN:'DNS lookup timed out (offline or DNS problem)',
  ECONNREFUSED:'the connection was refused (firewall or proxy)',
  ECONNRESET:'the connection was reset (firewall, proxy or VPN)',
  ETIMEDOUT:'the connection timed out (firewall, proxy or slow network)',
  UND_ERR_CONNECT_TIMEOUT:'the connection timed out (firewall, proxy or slow network)',
  ERR_SSL_WRONG_VERSION_NUMBER:'a proxy answered instead of the site'
};
export function describeFetchError(e,site){
  if(e?.name==='TimeoutError'||e?.name==='AbortError')return site+' did not answer within the time limit';
  let c=e;const codes=[];for(let i=0;c&&i<5;i++){if(c.code)codes.push(c.code);c=c.cause}
  const code=codes.find(x=>HINTS[x])||codes.at(-1)||'',detail=e?.cause?.message&&e.cause.message!==e.message?e.cause.message:'';
  return 'Could not connect to '+site+(code?' ('+code+')':'')+(HINTS[code]?': '+HINTS[code]:detail?': '+detail:'');
}
export async function fetchWithReason(fetchImpl,url,options,site){
  try{return await fetchImpl(url,options)}catch(e){const err=Error(describeFetchError(e,site));err.cause=e;err.network=true;throw err}
}

// Trust the operating-system certificate store as well as Node's bundled roots, like a browser does.
// Fixes downloads that work in Edge/Chrome but fail in Node with certificate errors (Windows, proxies, antivirus).
export async function useSystemCertificates(){
  try{
    const tls=await import('node:tls');
    if(typeof tls.getCACertificates!=='function'||typeof tls.setDefaultCACertificates!=='function')return 'unavailable (Node '+process.versions.node+'; needs 24.5+)';
    const merged=[...new Set([...tls.getCACertificates('default'),...tls.getCACertificates('system')])];
    tls.setDefaultCACertificates(merged);return 'system certificate store added';
  }catch(e){return 'unavailable: '+e.message}
}
