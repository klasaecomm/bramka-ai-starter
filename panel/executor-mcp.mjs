// Natywne API Executora: jedna organizacja, wspólne połączenia (owner=org), jeden adres MCP.
// Panel loguje się kontem administratora Executora; tokenów dostawców nigdy nie zwraca.
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const segment=value=>encodeURIComponent(value);
export function createExecutorMcp({base,publicUrl,panelOrigin,email,password,organization='firma',clientName='Bramka AI',fetchImpl=fetch}){
 const CALLBACK=panelOrigin+'/oauth/mcp/callback',CLIENT=panelOrigin+'/oauth/mcp-client.json';
 // Dokument klienta (CIMD) dostawca pobiera z internetu, więc działa tylko z publicznym HTTPS.
 const publicPanel=/^https:\/\//.test(panelOrigin)&&!/^https:\/\/(localhost|127\.|\[::1\])/.test(panelOrigin);
 let token,until=0,loginPromise;
 async function request(path,{method='GET',body,timeout=60000,argumentsToken}={}){
  if(!email||!password)throw fail('Brak dostępu panelu do Executora (ADMIN_EMAIL / ADMIN_HASLO w .env).',503);
  if(!token||Date.now()>until){
   if(!loginPromise)loginPromise=(async()=>{
   const r=await fetchImpl(base+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:publicUrl},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(15000)});
   const d=await r.json().catch(()=>null);if(!r.ok||!d?.token)throw fail('Logowanie do Executora: HTTP '+r.status+(d?.code?' ('+d.code+')':''));token=d.token;until=Date.now()+300000;
   })().finally(()=>{loginPromise=null;});
   await loginPromise;
  }
  const r=await fetchImpl(base+'/api'+path,{method,headers:{Authorization:'Bearer '+(argumentsToken||token),'Content-Type':'application/json',Origin:publicUrl},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const d=await r.json().catch(()=>null);if(r.status===401){token=null;throw fail('Sesja Executora wygasła. Odśwież panel.',401);}
  if(!r.ok)throw fail('Executor: '+(d?.message||d?.error?.message||'HTTP '+r.status),r.status<500?r.status:502);return d;
 }
 const connectionPath=c=>'/connections/'+[c.owner,c.integration,c.name].map(segment).join('/');
 async function state(){
  const [integrations,connections,tools]=await Promise.all([request('/integrations'),request('/connections?owner=org'),request('/tools?owner=org')]);
  const endpoint=publicUrl+'/mcp';
  return {publiczny:publicUrl,wspolny:{id:organization,adres:endpoint},polaczenia:integrations.filter(i=>i.kind==='mcp').map(i=>{
   const cc=connections.filter(c=>c.integration===i.slug);const tt=tools.filter(t=>t.integration===i.slug);const health=cc.find(c=>c.lastHealth)?.lastHealth;
   // Resend full_access includes email sending; its scopes are alternatives, not cumulative.
   const missing=cc.some(c=>(c.missingOAuthScopes||[]).some(scope=>!(i.slug==='resend'&&scope==='emails:send'&&String(c.oauthScope||'').split(/\s+/).includes('full_access'))));
   return {polaczone:cc.length>0,brakUprawnien:missing,id:i.slug,slug:i.slug,nazwa:i.name,url:i.displayUrl||'',aktywne:true,osiagalne:!health||health.status==='healthy'||health.status==='ok',auth:i.authMethods.some(a=>a.kind==='oauth')?'oauth':cc.length&&cc[0].template!=='none'?'bearer':'none',oauthPanel:i.authMethods.some(a=>a.kind==='oauth'),narzedzi:tt.length,serwer:{id:organization,adres:endpoint},ostatnio:health?.checkedAt||null,status:health?.status||(!cc.length?'unconnected':'unknown')};
  })};
 }
 async function add(d){
  const slug=String(d.nazwa||'').trim();if(!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug))throw fail('Nazwa: małe litery, cyfry i myślniki.',400);
  let url;try{url=new URL(String(d.url||''))}catch{throw fail('Podaj pełny adres serwera MCP (https://…).',400)}
  if(url.protocol!=='https:')throw fail('Podaj adres HTTPS.',400);
  const template=d.auth==='bearer'||d.auth==='naglowek'?'company-key':'none';
  const auth=template==='none'?{kind:'none'}:{kind:'apikey',name:d.auth==='naglowek'?String(d.naglowek):'Authorization',in:'header',prefix:d.auth==='naglowek'?'':'Bearer '};
  await request('/mcp/servers',{method:'POST',body:{name:slug,slug,endpoint:url.href,remoteTransport:d.transport==='SSE'?'sse':'streamable-http',...(template==='none'?{auth}:{authenticationTemplate:[{slug:template,kind:'apikey',placements:[{carrier:'header',name:auth.name,prefix:auth.prefix}]}]})}});
  await request('/connections',{method:'POST',body:{owner:'org',integration:slug,name:'main',template,value:template==='none'?'':String(d.token||'')}});
  return {ok:true};
 }
 async function refresh(id){
  const cc=(await request('/connections?owner=org')).filter(c=>c.integration===id);if(!cc.length)throw fail('Najpierw połącz konto.',409);
  for(const c of cc)await request(connectionPath(c)+'/refresh',{method:'POST'});return {ok:true};
 }
 async function remove(id){await request('/integrations/'+segment(id),{method:'DELETE'});return {ok:true};}
 async function users(){
  const d=await request('/auth/admin/list-users');return d.users.map(u=>({email:u.email,nazwa:u.name||u.email,id:u.id,admin:u.role==='admin'}));
 }
 async function mint(d){
  // Native Better Auth checks whether the caller may mint for this account.
  const members=await users();const u=members.find(u=>u.email===d.email);if(!u)throw fail('Nie znaleziono konta.',400);
  let argumentsToken;
  if(u.email!==email){const impersonation=await request('/auth/admin/impersonate-user',{method:'POST',body:{userId:u.id}});argumentsToken=impersonation.session?.token;if(!argumentsToken)throw fail('Nie udało się utworzyć dostępu dla tego konta.');}
  let key;
  try{key=await request('/auth/api-key/create',{method:'POST',argumentsToken,body:{name:String(d.nazwa||'MCP').slice(0,60),expiresIn:Math.min(365,Math.max(1,Number(d.dni)||90))*86400}});}
  finally{if(argumentsToken)await request('/auth/admin/stop-impersonating',{method:'POST',argumentsToken,body:{}}).catch(()=>{});}
  return {token:key.key,wygasa:key.expiresAt};
 }
 async function start(id,clientId){
  const i=await request('/integrations/'+segment(id));const auth=i.authMethods.find(a=>a.kind==='oauth');if(!auth)throw fail('To połączenie nie używa OAuth.',400);
  if(clientId!==undefined&&(id!=='meta-ads'||!/^\d{5,30}$/.test(String(clientId))))throw fail('Podaj poprawne App ID aplikacji Meta.',400);
  let slug=clientId?'bramka-meta-ads-'+clientId:'bramka-'+id;const clients=await request('/oauth/clients');
  if(!clients.some(c=>c.slug===slug&&c.owner==='org')){
   const o=await request('/oauth/probe',{method:'POST',body:{url:auth.oauth?.discoveryUrl||i.displayUrl}});if(!o.authorizationUrl||!o.tokenUrl)throw fail('Brakuje adresów logowania dostawcy.',409);
   if(id==='meta-ads'){
    if(!clientId)throw fail('Meta wymaga App ID istniejącej aplikacji z Facebook Login for Business oraz zarejestrowanego adresu powrotu.',409);
    await request('/oauth/clients',{method:'POST',body:{owner:'org',slug,authorizationUrl:o.authorizationUrl,tokenUrl:o.tokenUrl,grant:'authorization_code',clientId:String(clientId),clientSecret:'',resource:o.resource||null,originIntegration:id}});
   }else if(!o.clientIdMetadataDocumentSupported||(!publicPanel&&o.registrationEndpoint)){
    if(!o.registrationEndpoint)throw fail('Dostawca wymaga skonfigurowanej aplikacji OAuth.',409);
    const registered=await request('/oauth/clients/register-dynamic',{method:'POST',body:{owner:'org',slug,issuer:o.issuer||null,registrationEndpoint:o.registrationEndpoint,authorizationUrl:o.authorizationUrl,tokenUrl:o.tokenUrl,resource:o.resource||null,scopes:auth.oauth?.scopes||[],tokenEndpointAuthMethodsSupported:o.tokenEndpointAuthMethodsSupported||[],clientName,redirectUri:CALLBACK,originIntegration:id}});
    if(typeof registered?.client!=='string'||!registered.client)throw fail('Executor nie zwrócił zarejestrowanego klienta OAuth.');
    slug=registered.client;
   }else if(!publicPanel){
    throw fail('Ten dostawca wymaga publicznego adresu HTTPS panelu (docs/vps.md).',409);
   }else{
    await request('/oauth/clients',{method:'POST',body:{owner:'org',slug,authorizationUrl:o.authorizationUrl,tokenUrl:o.tokenUrl,grant:'authorization_code',clientId:CLIENT,clientSecret:'',resource:o.resource||null,originIntegration:id}});
   }
  }
  const r=await request('/oauth/start',{method:'POST',body:{client:slug,clientOwner:'org',owner:'org',name:'main',integration:id,template:auth.template,redirectUri:CALLBACK}});
  if(r.status!=='redirect'||!r.authorizationUrl)throw fail('Executor nie zwrócił adresu logowania.');return {url:r.authorizationUrl};
 }
 // Executor sends an org envelope to providers, but complete/cancel require
 // the original random session state (the upstream callback makes the same conversion).
 function callbackState(raw){
  let d;try{d=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'))}catch{return raw}
  if(!d||typeof d.state!=='string'||typeof d.orgSlug!=='string'||!d.orgSlug.trim())return raw;
  if(d.orgSlug.trim()!==organization)throw fail('Sesja OAuth należy do innej organizacji.',400);
  return d.state;
 }
 async function callback(params){
  if(!params.get('state')||(!params.get('code')&&!params.get('error')))return {status:400,kind:'expired'};
  let state;try{state=callbackState(params.get('state'))}catch{return {status:400,kind:'error'}}
  if(params.get('error')){await request('/oauth/cancel',{method:'POST',body:{state}}).catch(()=>{});return {status:400,kind:'error'};}
  try{const c=await request('/oauth/complete',{method:'POST',body:{state,code:params.get('code')}});const connection=c.connection||c;await refresh(connection.integration);return {status:200,kind:'success'};}catch(x){return {status:400,kind:x.status===404||/code has expired/i.test(x.message)?'expired':'error'};}
 }
 async function health(){const r=await fetchImpl(base+'/api/health',{signal:AbortSignal.timeout(5000)});return r.ok;}
 return {request,state,add,refresh,remove,users,mint,start,callback,health,clientMetadata:{client_id:CLIENT,client_name:clientName,client_uri:panelOrigin,redirect_uris:[CALLBACK],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'}};
}
