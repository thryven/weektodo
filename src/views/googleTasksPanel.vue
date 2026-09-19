<template>
  <section class="mt-2" aria-labelledby="google-tasks-heading">
    <h6 id="google-tasks-heading">Google Tasks</h6>
    <p class="small">Keep working offline. Sync titles, notes, dates and completion with Google Tasks.</p>
    <p role="status" aria-live="polite">{{ state.connected ? 'Connected' : 'Disconnected' }} · {{ state.status }}</p>
    <p v-if="state.error || error" class="small text-danger" role="alert">{{ error || state.error }}</p>
    <button v-if="!state.connected" class="btn border" :disabled="busy" @click="run(() => service.connect())">Sign in with Google</button>
    <template v-else>
      <label for="google-task-list" class="form-label">Google task list</label>
      <div class="d-flex gap-2 mb-2">
        <select id="google-task-list" class="form-select" :value="state.listId" :disabled="busy || syncing" @change="selectList">
          <option value="">Choose a list</option>
          <option v-if="state.listId && !state.lists.some(list => list.id === state.listId)" :value="state.listId">Selected list (refresh to see name)</option>
          <option v-for="list in state.lists" :key="list.id" :value="list.id">{{ list.title }}</option>
        </select>
        <button class="btn border" :disabled="busy || syncing" @click="run(() => service.refreshLists())">Refresh</button>
      </div>
      <p class="small">All local tasks sync to this list. Selecting another list also copies your local tasks there. Undated tasks from Google appear on today’s list.</p>
      <div class="form-check form-switch mb-3">
        <input id="google-auto-sync" class="form-check-input" type="checkbox" :checked="state.auto" :disabled="busy || syncing" @change="setAuto">
        <label class="form-check-label" for="google-auto-sync">Automatically sync tasks</label>
      </div>
      <p class="small">Last sync: {{ state.lastSync ? new Date(state.lastSync).toLocaleString() : 'Never' }}</p>
      <div class="d-flex gap-2">
        <button class="btn border" :disabled="busy || syncing || !state.listId" @click="run(() => service.sync())">Sync Now</button>
        <button class="btn border" :disabled="busy || syncing" @click="run(() => service.disconnect())">Disconnect</button>
      </div>
    </template>
  </section>
</template>
<script>
import { getGoogleTasksController } from "../googleTasks/service";
export default {
  name: "googleTasksPanel",
  data: () => ({ service: null, state: { lists: [] }, busy: false, error: "" }),
  computed: { syncing() { return this.state.status === "Syncing"; } },
  mounted() {
    this.service = getGoogleTasksController();
    if (this.service) this.unsubscribe = this.service.subscribe((state) => { this.state = state; });
  },
  beforeUnmount() { this.unsubscribe?.(); },
  methods: {
    async run(action) { this.busy = true; this.error = ""; try { await action(); } catch (error) { this.error = error.message; } finally { this.busy = false; } },
    selectList(event) { const listId = event.target.value; return this.run(() => this.service.configure({ listId })); },
    setAuto(event) { const auto = event.target.checked; return this.run(() => this.service.configure({ auto })); },
  },
};
</script>
