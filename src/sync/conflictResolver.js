import { SYNC_FIELD, createSyncOperation } from "./syncModel";

const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const plainObject=(value)=>value!==null&&typeof value==="object"&&!Array.isArray(value);

export function mergeFields(base={},local={},remote={},path="") {
  const merged={};const conflicts=[];const keys=new Set([...Object.keys(base||{}),...Object.keys(local||{}),...Object.keys(remote||{})]);
  keys.delete(SYNC_FIELD);
  for(const key of keys){const field=path?`${path}.${key}`:key;const before=base?.[key];const ours=local?.[key];const theirs=remote?.[key];
    if(equal(ours,theirs))merged[key]=structuredClone(ours);
    else if(equal(ours,before))merged[key]=structuredClone(theirs);
    else if(equal(theirs,before))merged[key]=structuredClone(ours);
    else if(plainObject(before)&&plainObject(ours)&&plainObject(theirs)){const nested=mergeFields(before,ours,theirs,field);
      merged[key]=nested.merged;conflicts.push(...nested.conflicts);}
    else{merged[key]=structuredClone(theirs);conflicts.push(field);}
  }
  return {merged,conflicts};
}

function labelConflictCopy(payload) {
  const copy=structuredClone(payload);const field=["text","title","name"].find((key)=>typeof copy[key]==="string");
  if(field)copy[field]=`${copy[field]} (conflict copy)`;return copy;
}

export function resolveConflict(operation,conflict,{deviceId,now=()=>new Date().toISOString(),id=()=>crypto.randomUUID()}={}) {
  const timestamp=now();const remote=conflict.serverPayload;const base=operation.basePayload||{};const local=operation.payload;
  const remoteDeleted=conflict.serverAction==="delete"||Boolean(remote?.[SYNC_FIELD]?.deletedAt);
  const history=[{id:id(),entityType:operation.entityType,entityId:operation.entityId,serverRevision:operation.baseRevision,
    source:"base",payload:structuredClone(base),createdAt:timestamp},{id:id(),entityType:operation.entityType,entityId:operation.entityId,
    serverRevision:conflict.serverRevision,source:"remote",payload:structuredClone(remote),createdAt:timestamp}];

  if(operation.action==="delete"){
    const retry={...operation,operationId:id(),baseRevision:conflict.serverRevision,basePayload:structuredClone(remote),createdAt:timestamp,attempts:0};
    return {operations:[retry],history,conflictCopy:null,conflictFields:[]};
  }
  if(remoteDeleted){
    const copy=labelConflictCopy(local);copy[SYNC_FIELD]={...copy[SYNC_FIELD],id:id(),createdAt:timestamp,updatedAt:timestamp,
      serverRevision:0,localRevision:1,deletedAt:null,conflictOf:operation.entityId};
    return {operations:[createSyncOperation(operation.entityType,copy,"upsert",id,deviceId,null)],history,
      conflictCopy:copy,conflictFields:["$deleted"]};
  }

  const result=mergeFields(base,local,remote);const merged={...result.merged,[SYNC_FIELD]:{...local[SYNC_FIELD],
    serverRevision:conflict.serverRevision,localRevision:Math.max(local[SYNC_FIELD]?.localRevision||0,remote[SYNC_FIELD]?.localRevision||0)+1,
    updatedAt:timestamp,deletedAt:null}};
  const operations=[createSyncOperation(operation.entityType,merged,"upsert",id,deviceId,remote)];let conflictCopy=null;
  if(result.conflicts.length){conflictCopy=labelConflictCopy(local);conflictCopy[SYNC_FIELD]={...conflictCopy[SYNC_FIELD],id:id(),createdAt:timestamp,
    updatedAt:timestamp,serverRevision:0,localRevision:1,deletedAt:null,conflictOf:operation.entityId};
    operations.push(createSyncOperation(operation.entityType,conflictCopy,"upsert",id,deviceId,null));}
  history.push({id:id(),entityType:operation.entityType,entityId:operation.entityId,serverRevision:conflict.serverRevision,
    source:"merged",payload:structuredClone(merged),createdAt:timestamp});
  return {operations,history,conflictCopy,conflictFields:result.conflicts};
}
