import dbRepository from "../repositories/dbRepository";
import storageRepository from "../repositories/storageRepository";
import { enqueueSyncOperations, getSyncMetadata, setSyncMetadata } from "../repositories/syncOutboxRepository";
import { getDeviceId } from "./deviceIdentity";
import { createSyncOperation, ensureSyncMetadata } from "./syncModel";
import { prepareSharedSettings } from "./syncSettings";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function databaseRecords() {
  const db = await requestResult(dbRepository.open());
  const [todoLists, todoListKeys, repeatingEvents, repeatingEventKeys] = await Promise.all([
    requestResult(dbRepository.getAll(db, "todo_lists")),
    requestResult(dbRepository.getAllKeys(db, "todo_lists")),
    requestResult(dbRepository.getAll(db, "repeating_events")),
    requestResult(dbRepository.getAllKeys(db, "repeating_events")),
  ]);
  todoLists.forEach((list) => list.forEach((task) => ensureSyncMetadata(task)));
  repeatingEvents.forEach((event) => ensureSyncMetadata(event));
  const transaction = db.transaction(["todo_lists", "repeating_events"], "readwrite");
  todoLists.forEach((list, index) => transaction.objectStore("todo_lists").put(list, todoListKeys[index]));
  repeatingEvents.forEach((event, index) => transaction.objectStore("repeating_events").put(event, repeatingEventKeys[index]));
  await transactionDone(transaction);
  db.close();
  return { tasks: todoLists.flat(), repeatingEvents };
}

export async function createInitialSnapshot() {
  if (await getSyncMetadata("initialSnapshotCreated")) return [];
  const deviceId = getDeviceId();
  const records = await databaseRecords();
  const lists = storageRepository.get("customTodoListIds") || [];
  const config = storageRepository.get("config") || {};
  const settingsMetadata = storageRepository.get("syncSharedSettingsMetadata");
  const settings = prepareSharedSettings(config, null, settingsMetadata);

  const operations = buildInitialSnapshotOperations({ ...records, lists, settings, deviceId });
  storageRepository.set("customTodoListIds", lists);
  storageRepository.set("syncSharedSettingsMetadata", settings._sync);
  await enqueueSyncOperations(operations);
  await setSyncMetadata("initialSnapshotCreated", { createdAt: new Date().toISOString(), entityCount: operations.length });
  return operations;
}

export function buildInitialSnapshotOperations({ tasks, repeatingEvents, lists, settings, deviceId }) {
  const entities = [
    ...tasks.map((payload) => ({ type: "task", payload: ensureSyncMetadata(payload) })),
    ...repeatingEvents.map((payload) => ({ type: "repeating_event", payload: ensureSyncMetadata(payload) })),
    ...lists.map((payload) => ({ type: "custom_list", payload: ensureSyncMetadata(payload) })),
    { type: "settings", payload: settings },
  ];
  return entities.map(({ type, payload }) =>
    createSyncOperation(type, payload, "upsert", undefined, deviceId));
}
