export function compactOutbox(operations) {
  const ordered = [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = new Map();
  for (const operation of ordered){const key=`${operation.entityType}:${operation.entityId}`;const previous=latest.get(key);
    latest.set(key,previous?{...operation,baseRevision:previous.baseRevision,
      basePayload:previous.basePayload??operation.basePayload}:operation);}
  const operationsToSend = [...latest.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const selectedIds = new Set(operationsToSend.map((operation) => operation.operationId));
  return {
    operations: operationsToSend,
    supersededOperationIds: ordered
      .filter((operation) => !selectedIds.has(operation.operationId))
      .map((operation) => operation.operationId),
  };
}

export function readyOperations(operations, now = Date.now()) {
  return operations.filter((operation) => !operation.nextAttemptAt || Date.parse(operation.nextAttemptAt) <= now);
}
