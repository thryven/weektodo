import { SyncAccountClient } from "./syncAccountClient";

export const syncAccountClient = new SyncAccountClient({ baseUrl: import.meta.env.VITE_SYNC_URL });
