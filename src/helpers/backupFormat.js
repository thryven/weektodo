export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !("config" in data)) {
    throw new Error("Invalid WeekToDo backup");
  }

  const config = typeof data.config === "string" ? JSON.parse(data.config) : data.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Invalid WeekToDo configuration");
  }

  return {
    ...data,
    config: JSON.stringify({ ...config, importing: true }),
    customTodoListIds:
      typeof data.customTodoListIds === "string"
        ? data.customTodoListIds
        : JSON.stringify(data.customTodoListIds ?? []),
    todoLists: data.todoLists ?? {},
    repeating_events: data.repeating_events ?? {},
    repeating_events_by_date: data.repeating_events_by_date ?? {},
  };
}

export function serializeBackup(data) {
  return JSON.stringify(data);
}
