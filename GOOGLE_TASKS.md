# Google Tasks integration

WeekToDo's existing IndexedDB task lists remain the working database. Google sync is optional and only available in Electron. No task data is migrated to another database. Version 8 adds two stores, `google_sync_state` and `google_sync_queue`; existing stores and the separate account-sync outbox remain intact. No new dependencies are required.

## Google Cloud setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Tasks API** in APIs & Services → Library.
3. Configure Google Auth Platform branding and audience (OAuth consent screen). For personal testing, add your Google account as a test user. Public distribution may require Google's verification. Testing-mode authorizations may expire and require sign-in again.
4. Create an OAuth client with application type **Desktop app**, then download its JSON. Do not use a Web application client, a service account, or an API key.
5. The only requested scope is `https://www.googleapis.com/auth/tasks`, needed for read/write/delete. No email, profile, Drive or Calendar scopes are requested.

The app uses the system browser, a random-port `127.0.0.1` loopback listener, authorization code + S256 PKCE, and a random validated state. Desktop loopback clients do not require a fixed port or hosted redirect page. See [Google's installed-app OAuth guidance](https://developers.google.com/identity/protocols/oauth2/native-app).

## Configure and run

Development: copy `.env.google-tasks.example` to `.env.google-tasks`, fill in `client_id` and `client_secret` from the downloaded Desktop client, and run `pnpm electron:google`. These are runtime main-process variables; never use `VITE_` prefixes. The client identifier and Desktop client secret identify a public installed app and cannot be treated as confidential server credentials. User refresh/access tokens are separate and are never embedded in a build.

Packaged app: place the downloaded JSON at `google-oauth.json` in Electron's `app.getPath("userData")` directory, retaining the top-level `installed` object. On Windows this is normally `%APPDATA%\WeekToDo\google-oauth.json` (the actual folder follows Electron's app name). Alternatively launch with `GOOGLE_TASKS_CLIENT_ID` and `GOOGLE_TASKS_CLIENT_SECRET` in the process environment. Environment values override JSON. Credentials/config JSON are not packaged or committed.

Open Settings → Google Tasks → **Sign in with Google**, grant access, refresh/select a Google task list, then press **Sync Now**. Automatic sync defaults to on and runs at startup, after local writes (600ms debounce), when connectivity returns, on focus, and approximately every minute while open. Turning it off retains the queue and permits manual sync. Disconnect preserves local tasks and mappings, removes locally stored Google tokens and attempts remote revocation. If disconnected offline, access can also be revoked from your Google account.

## Mapping and conflicts

- All local calendar/custom-list tasks sync into the selected Google list. Their existing `_sync.id` maps to a Google ID, scoped by Google list. Selecting a different list also uploads local tasks there; it does not move/delete tasks in the former list. Re-selecting a previous list reuses its mappings. Disconnect clears list selection so switching Google accounts requires explicitly choosing a list again.
- `text` ↔ title, `desc` ↔ notes, `checked` ↔ completion, calendar list `YYYYMMDD` ↔ date-only due date. Remote date edits move tasks to that day's list. Undated imported tasks appear on today's list but remain undated in Google until moved to another day.
- A three-way field merge compares local and remote fields with their last acknowledged base. Independent edits merge. If both sides changed the same field, local wins. ETag preconditions prevent overwriting a change made after the remote read; a later sync fetches and reconciles it again.
- Local deletion wins against a remote edit. Remote deletion removes an unchanged local task. A remote deletion conflicting with unsynced local field edits recreates the edited task. No interactive conflict resolution screen is provided.
- Task writes and Google's coalescing queue commit in the same IndexedDB transaction. The sync engine also scans the primary store for changes from the existing account-sync provider. Mapping updates, remote task writes and queue acknowledgement commit together. A compare-and-swap prevents a response from overwriting a newer local edit or acknowledging its queued operation.
- Created/updated Google notes contain a trailing `[WeekToDo:local-id]` marker. It is hidden in WeekToDo but visible in Google. This recovers a successfully inserted task after a lost HTTP response or crash before mapping persistence. Leave the marker intact. Google does not provide an insert idempotency key; removing the marker during that failure window can cause a duplicate on retry.
- Errors leave changes queued. Requests time out after 30 seconds. Automatic retries use capped exponential backoff with jitter; manual sync retries immediately. Expired/revoked credentials require reconnecting. API permission and quota failures are shown in Settings.

## Security and boundaries

`electron/googleTasks.js` owns OAuth, encrypted credentials and Google requests. Tokens are encrypted using Electron `safeStorage` before persistence, never sent through preload or saved in renderer/localStorage. The app refuses Linux's `basic_text` fallback or an unavailable OS keychain. See [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

Preload exposes only status, sign-in, disconnect, list, task-read and validated task-write methods. Main-process handlers verify the sender and main frame. Renderer Node integration remains disabled; context isolation and sandboxing remain enabled. The renderer service/controller, storage adapter and framework-independent reconciliation engine are separate from Vue components, allowing a future client to supply another auth/transport implementation.

## Limitations and verification

- This is polling sync while the desktop app runs, not push or background sync after quitting. Full paginated Google lists include completed, hidden and deleted tasks. Large lists may use more quota.
- Colors, alarms, local times, tags, priorities and recurrence definitions remain local. Google parent/subtask hierarchy is flattened on import; local subtasks remain local. Assigned tasks from Docs/Chat are excluded to avoid deleting their originating objects. Google due dates do not carry a usable time-of-day; see [Google Tasks resource fields](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks).
- Task limits are validated (1,024-character title, 8,192-character notes including the marker). An invalid task pauses that run and retains its queue entry; shorten it and retry.
- Clear-data and backup import clear Google mappings/settings/queue. Select a list again deliberately; imports are not treated as mass remote deletions. Existing backups do not include Google tokens or mappings.
- Tests cover creates, updates, completions, deletions, field conflicts, offline failures, lost-create-response recovery, durable queue persistence, in-flight edits, IPC sender validation and insecure-storage refusal. Run `pnpm test`, `pnpm lint`, and `pnpm electron:build`.
- A real Google account and configured Desktop OAuth client are needed for live acceptance: sign in, select a disposable list, create/edit/complete/delete on each device, edit offline and restart, reconnect, change the same and different fields on both sides, disconnect/reconnect, and verify automatic sync off versus Sync Now. Automated tests use fake transport/storage; they do not certify a live authorization grant.

## Changed areas

- `electron/googleTasks.js`, `electron/main.js`, `electron/preload.js`: OAuth/API service and narrow IPC.
- `src/googleTasks/{model,repository,engine,service}.js`: mapping, reconciliation, durable storage and scheduling.
- `src/googleTasks/*.test.js`: targeted sync/security/storage tests.
- `src/repositories/dbRepository.js`: additive schema and atomic Google queue capture.
- `src/main.js`, `src/views/{configModal,googleTasksPanel}.vue`, `src/views/configList.js`: lifecycle and Settings UI.
- `.env.google-tasks.example`, `.gitignore`, `package.json`, this guide: configuration and usage.
