const MARKER = /\n\n\[WeekToDo:([\w-]+)\]$/;
export const markerId = (remote) => remote.notes?.match(MARKER)?.[1];
export const fields = ["title", "notes", "status", "due"];
export function localFields(task) {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(task.listId);
  return { title: task.text || "", notes: task.desc || "", status: task.checked ? "completed" : "needsAction",
    due: date && task.googleUndatedListId !== task.listId ? `${date[1]}-${date[2]}-${date[3]}T00:00:00.000Z` : null };
}
export function remoteFields(task) {
  return { title: task.title || "", notes: (task.notes || "").replace(MARKER, ""), status: task.status || "needsAction",
    due: task.due ? `${task.due.slice(0, 10)}T00:00:00.000Z` : null };
}
export function wireTask(value, id) { return { ...value, notes: `${value.notes}\n\n[WeekToDo:${id}]` }; }
export function equal(a, b) { return fields.every((key) => a?.[key] === b?.[key]); }
export function reconcile(base, local, remote) {
  return Object.fromEntries(fields.map((key) => [key, !base || local[key] !== base[key] ? local[key] : remote[key]]));
}
export function applyFields(task, value, fallbackList) {
  const oldDue = task ? localFields(task).due : null;
  const listId = value.due ? value.due.slice(0, 10).replaceAll("-", "") : (task && !oldDue ? task.listId : fallbackList);
  return { subTaskList: [], color: "none", priority: 0,
    tags: [], time: null, alarm: false, repeatingEvent: null, ...task,
    googleUndatedListId: value.due ? null : listId,
    text: value.title, desc: value.notes, checked: value.status === "completed", listId };
}
