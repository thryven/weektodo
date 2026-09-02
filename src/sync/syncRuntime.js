import { getDeviceId } from "./deviceIdentity";
import { HttpSyncTransport } from "./httpSyncTransport";
import { IndexedDbSyncStorage } from "./indexedDbSyncStorage";
import { SyncEngine } from "./syncEngine";
import { EncryptedSyncTransport } from "./encryptedSyncTransport";
import { SyncCoordinator } from "./syncCoordinator";
import { SyncNotificationLoop } from "./syncNotificationLoop";

export function createSyncRuntime(env = import.meta.env, providers = {}) {
  if (env.VITE_SYNC_ENABLED !== "true") return null;
  const workspaceId=providers.workspaceId || env.VITE_SYNC_WORKSPACE_ID;
  const deviceId=providers.deviceId || getDeviceId();
  if (!env.VITE_SYNC_URL || !workspaceId || !providers.accessToken || !providers.accountKey) {
    throw new Error("Sync is enabled but its endpoint, workspace, authentication, or encryption key is missing");
  }
  const httpTransport = new HttpSyncTransport({ baseUrl: env.VITE_SYNC_URL, accessTokenProvider: providers.accessToken });
  const engine = new SyncEngine({
    transport: new EncryptedSyncTransport({ transport: httpTransport, accountKeyProvider: providers.accountKey }),
    storage: new IndexedDbSyncStorage(),
    workspaceId,
    deviceId,
  });
  const notificationLoop=new SyncNotificationLoop({transport:httpTransport,workspaceId,
    onChange:()=>globalThis.dispatchEvent?.(new Event("weektodo:sync-notification"))});
  return new SyncCoordinator({ engine,notificationLoop });
}
