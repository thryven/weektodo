const STORAGE_KEY="weektodo.localNetworkSync";
export const LOCAL_SYNC_MODES=["disabled","host","client"];

export function normalizeLocalSyncSettings(value={}) {
  return {mode:LOCAL_SYNC_MODES.includes(value.mode)?value.mode:"disabled",address:String(value.address||"").trim().replace(/\/$/,""),
    hostName:String(value.hostName||"").trim().slice(0,100)};
}
export function loadLocalSyncSettings(storage=localStorage) {
  try{return normalizeLocalSyncSettings(JSON.parse(storage.getItem(STORAGE_KEY)||"{}"));}catch{return normalizeLocalSyncSettings();}
}
export function saveLocalSyncSettings(settings,storage=localStorage) {
  const normalized=normalizeLocalSyncSettings(settings);storage.setItem(STORAGE_KEY,JSON.stringify(normalized));return normalized;
}
export function validateHostAddress(address) {
  try{const url=new URL(address);if(!["http:","https:"].includes(url.protocol))throw new Error();return url.toString().replace(/\/$/,"");}
  catch{throw new Error("Enter a complete HTTP or HTTPS host address");}
}
export async function probeLocalSyncHost(address,fetchImplementation=fetch) {
  const normalized=validateHostAddress(address);const response=await fetchImplementation(`${normalized}/.well-known/weektodo-sync`,
    {headers:{Accept:"application/json"},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error("Host unavailable");const result=await response.json();
  if(result.service!=="weektodo-sync"||result.protocolVersion!==1)throw new Error("This address is not a compatible WeekToDo host");
  return {...result,address:normalized};
}
export function localSyncStatus({mode,syncStatus,pendingCount=0,conflictCount=0,error,navigatorOnline=true}) {
  if(mode==="disabled")return{code:"disabled",message:"Local network sync is disabled"};
  const normalizedError=String(error||"").toUpperCase();
  if(normalizedError.includes("UNAUTHORIZED")||normalizedError.includes("AUTHENTICATION")||normalizedError.includes("401"))
    return{code:"authentication_failed",message:"Authentication failed"};
  if(conflictCount>0)return{code:"conflicts",message:"Conflicts require attention"};
  if(pendingCount>0)return{code:"pending",message:"Changes waiting to sync",detail:!navigatorOnline||syncStatus==="offline"?
    "Working offline":syncStatus==="error"?"Host unavailable":null};
  if(!navigatorOnline||syncStatus==="offline")return{code:"offline",message:"Working offline"};
  if(syncStatus==="error")return{code:"host_unavailable",message:"Host unavailable"};
  if(syncStatus==="syncing")return{code:"syncing",message:"Synchronizing…"};
  if(syncStatus==="synced")return{code:"synchronized",message:"Synchronized"};
  return{code:"host_unavailable",message:"Host unavailable"};
}
