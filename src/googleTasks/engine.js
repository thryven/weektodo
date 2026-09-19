import { applyFields, equal, localFields, markerId, reconcile, remoteFields, wireTask } from "./model";

export class GoogleSyncEngine {
  constructor({ repository, transport, onApplied = () => {}, today = () => {
    const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  } }) { Object.assign(this, { repository, transport, onApplied, today }); }
  async synchronize(listId) {
    const remotes = await this.transport.tasks(listId);
    const snapshot = await this.repository.snapshot(listId);
    const locals = new Map(snapshot.tasks.map((task) => [task._sync.id, task]));
    const remoteById = new Map(remotes.map((task) => [task.id, task]));
    const handled = new Set();
    const ids = new Set([...locals.keys(), ...Object.keys(snapshot.mappings), ...Object.keys(snapshot.queue)]);
    const commit = async (id, expected, next, mapping) => {
      this.onApplied(await this.repository.commit({ listId, id, expected, next, mapping, operationId: snapshot.queue[id]?.operationId }));
    };
    for (const id of ids) {
      const local = locals.get(id); const map = snapshot.mappings[id];
      // The visible note marker recovers a POST whose response was lost before the
      // local mapping committed. Never blindly repeat an ambiguous insert.
      let remote = map ? remoteById.get(map.googleId) : remotes.find((task) => !task.deleted && markerId(task) === id);
      if (remote) handled.add(remote.id);
      if (remote?.assignmentInfo) continue;
      if (!local) {
        if (remote && !remote.deleted) {
          try { await this.transport.write({ listId, taskId: remote.id, action: "delete", etag: remote.etag }); }
          catch (error) { if (![404, 410].includes(error.status)) throw error; }
        }
        await commit(id, undefined, undefined, null); continue;
      }
      const localValue = localFields(local);
      if (map && (!remote || remote.deleted)) {
        if (equal(localValue, map.base)) { await commit(id, local, undefined, null); continue; }
        // Preserve an unsynced local edit by recreating a remotely deleted task.
        remote = null;
      }
      const remoteValue = remote && remoteFields(remote);
      const value = remote ? reconcile(map?.base, localValue, remoteValue) : localValue;
      let saved = remote;
      if (!remote || !equal(value, remoteValue)) saved = await this.transport.write({ listId,
        taskId: remote?.id, action: remote ? "update" : "create", task: wireTask(value, id), etag: remote?.etag });
      await commit(id, local, applyFields(local, value, this.today()), { googleId: saved.id, base: value, updated: saved.updated, etag: saved.etag });
    }
    for (const remote of remotes) {
      if (remote.deleted || remote.assignmentInfo || handled.has(remote.id)) continue;
      const id = crypto.randomUUID(); const value = remoteFields(remote);
      await commit(id, undefined, applyFields(null, value, this.today()), { googleId: remote.id, base: value, updated: remote.updated, etag: remote.etag });
    }
  }
}
