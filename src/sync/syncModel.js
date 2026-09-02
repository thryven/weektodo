const SYNC_FIELD = "_sync";

function defaultId() {
  return crypto.randomUUID();
}

function comparable(entity) {
  const copy = { ...entity };
  delete copy[SYNC_FIELD];
  return JSON.stringify(copy);
}

export function ensureSyncMetadata(entity, { now = () => new Date().toISOString(), id = defaultId } = {}) {
  if (!entity[SYNC_FIELD]) {
    entity[SYNC_FIELD] = {
      id: id(),
      createdAt: now(),
      updatedAt: now(),
      serverRevision: 0,
      localRevision: 0,
      deletedAt: null,
    };
  }
  return entity;
}

export function prepareEntity(entity, previous, options = {}) {
  if (previous?.[SYNC_FIELD] && !entity[SYNC_FIELD]) entity[SYNC_FIELD] = { ...previous[SYNC_FIELD] };
  ensureSyncMetadata(entity, options);

  if (!previous || comparable(entity) !== comparable(previous)) {
    const timestamp = (options.now ?? (() => new Date().toISOString()))();
    entity[SYNC_FIELD].updatedAt = timestamp;
    entity[SYNC_FIELD].localRevision += 1;
    entity[SYNC_FIELD].deletedAt = null;
  }
  return entity;
}

export function prepareTaskList(tasks, previousTasks = [], options = {}) {
  const previousById = new Map(
    previousTasks.filter((task) => task?.[SYNC_FIELD]?.id).map((task) => [task[SYNC_FIELD].id, task])
  );

  const changed = [];
  const upserts = tasks.map((task) => {
    ensureSyncMetadata(task, options);
    const previous = previousById.get(task[SYNC_FIELD].id);
    const previousRevision = task[SYNC_FIELD].localRevision;
    const prepared = prepareEntity(task, previous, options);
    if (!previous || prepared[SYNC_FIELD].localRevision !== previousRevision) changed.push(prepared);
    return prepared;
  });
  const currentIds = new Set(upserts.map((task) => task[SYNC_FIELD].id));
  const deletions = previousTasks
    .filter((task) => task?.[SYNC_FIELD]?.id && !currentIds.has(task[SYNC_FIELD].id))
    .map((task) => ({
      ...task,
      [SYNC_FIELD]: {
        ...task[SYNC_FIELD],
        deletedAt: (options.now ?? (() => new Date().toISOString()))(),
        localRevision: task[SYNC_FIELD].localRevision + 1,
      },
    }));

  return { tasks: upserts, changed, deletions, baseById: previousById };
}

export function createSyncOperation(entityType, entity, action = "upsert", id = defaultId, deviceId = null, basePayload = null) {
  return {
    operationId: id(),
    entityType,
    entityId: entity[SYNC_FIELD].id,
    deviceId,
    action,
    baseRevision: entity[SYNC_FIELD].serverRevision,
    localRevision: entity[SYNC_FIELD].localRevision,
    payload: entity,
    basePayload: basePayload ? structuredClone(basePayload) : null,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

export { SYNC_FIELD };
