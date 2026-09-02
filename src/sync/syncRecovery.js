import { enqueueSyncOperations } from "../repositories/syncOutboxRepository";
import { getDeviceId } from "./deviceIdentity";
import { createSyncOperation } from "./syncModel";

export function createRevisionRestoreOperation(entry,history,{deviceId=getDeviceId(),now=()=>new Date().toISOString(),
  id=()=>crypto.randomUUID()}={}) {
  if(!entry?.payload)throw new Error("REVISION_PAYLOAD_UNAVAILABLE");
  const candidates=history.filter((item)=>item.entityType===entry.entityType&&item.entityId===entry.entityId&&item.payload);
  const latest=candidates.reduce((current,item)=>(item.serverRevision||0)>(current?.serverRevision||0)?item:current,null);
  if(!latest)throw new Error("REVISION_BASE_UNAVAILABLE");
  const payload=structuredClone(entry.payload);payload._sync={...(payload._sync||{}),id:entry.entityId,
    serverRevision:latest.serverRevision||0,localRevision:Math.max(payload._sync?.localRevision||0,latest.payload._sync?.localRevision||0)+1,
    updatedAt:now(),deletedAt:null};
  return createSyncOperation(entry.entityType,payload,"upsert",id,deviceId,latest.payload);
}

export async function restoreSyncRevision(entry,history,options) {
  const operation=createRevisionRestoreOperation(entry,history,options);await enqueueSyncOperations([operation]);return operation;
}
