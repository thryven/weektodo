# Internet Sync Architecture

## Delivery status

Phases 1 and 2 are implemented. Internet sync remains disabled by default, and normal builds make no sync network requests. Enabling the experimental runtime requires an endpoint, workspace, and an injected secure access-token provider; tokens cannot be embedded through Vite environment variables.

## Phase 1 storage contract

IndexedDB schema version 5 adds:

- `sync_outbox`, keyed by `operationId`, with a `createdAt` index.
- `sync_metadata`, reserved for cursors, account state, protocol versions, and initial-snapshot state.

Writes to IndexedDB-backed primary records and their outbox operations share one transaction. Local-storage-backed settings and custom-list metadata retain their existing storage format for compatibility and enqueue operations immediately after the local write.

Each syncable entity carries an internal `_sync` object:

```json
{
  "id": "globally-unique-id",
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp",
  "serverRevision": 0,
  "localRevision": 1,
  "deletedAt": null
}
```

Existing tasks, custom lists, and repeating events receive this metadata when loaded. The migration is idempotent and does not change their user-visible data. Derived repeating-event-by-date records are not synchronized because they can be regenerated from recurrence definitions.

Outbox operations contain:

- A unique operation ID
- Entity type and stable entity ID
- Originating device ID
- `upsert` or `delete` action
- Base server revision and local revision
- A complete entity payload
- Creation time and retry-attempt count

Deleted entities are preserved in the outbox as tombstones, preventing an offline device from recreating deleted data later.

## Settings boundary

Shared settings include planner presentation and behavior such as language, theme, visible panels, columns, task movement, ordering, and recurrence-related preferences.

The following remain local to each device:

- Installed application version and first-run state
- Update checking
- Start-on-login and background behavior
- Tray icon preference
- Import-in-progress state
- Notification permission, startup notification, and sound
- Error-reporting preference

Credentials, tokens, and encryption keys will never be placed in the shared settings document.

## Compatibility guarantees

- Existing IndexedDB records remain readable after the schema upgrade.
- Existing backup files remain importable.
- Sync metadata is included naturally in new backups but ignored by older application logic.
- The app remains fully local-first; repository calls do not wait for a server.
- Repeated writes use stable IDs and increasing local revisions.
- Retried future uploads can be deduplicated by operation ID.

## Phase 2 protocol contract

The client protocol is versioned as `/v1/sync` and supports:

- Pulling ordered changes after a persisted numeric cursor, in pages of at most 500 records.
- Pushing complete entity operations in idempotent batches of at most 500 records.
- Explicit accepted-operation IDs and structured stale-revision conflicts.
- A pull/push/pull cycle so concurrent changes cannot be skipped around a push.
- Server-assigned authoritative revisions and workspace isolation.
- Operation compaction by entity before upload.
- Exponential retry scheduling capped at five minutes, with attempt count and last error retained locally.
- Removal of acknowledged and superseded operations.
- An idempotent initial snapshot covering tasks, recurrence definitions, custom lists, and shared settings.
- Persisted cursor, conflict, protocol, workspace, and device state in `sync_metadata`.

An in-memory reference server exercises idempotent replay, workspace isolation, stale-revision conflicts, cursor advancement, interruption, retry, and acknowledgement behavior without external infrastructure.

## Phase 3 scope

The next phase will add:

1. Account registration, login, verification, and session lifecycle.
2. Secure Electron credential storage and browser session handling.
3. Device enrollment, naming, listing, and revocation.
4. Workspace ownership authorization enforced server-side.
5. End-to-end encryption envelopes and recovery-key generation.
6. A deployable API/database service implementing the tested Phase 2 contract.
7. Security tests for cross-account access, revoked sessions, token replay, and malformed encrypted payloads.

The runtime will remain off by default until Phase 3 authentication and encryption are complete.

## Phase 3 implementation status

Implemented foundations:

- AES-256-GCM payload encryption with workspace/entity associated data.
- Random 256-bit account keys, password-wrapped key envelopes, and printable recovery keys.
- Recovery-key-wrapped account-key envelopes; the server never receives plaintext account keys.
- Argon2id password hashing and opaque, hashed-at-rest access/refresh tokens.
- Fifteen-minute access sessions, rotating refresh sessions, replay rejection, and device-wide revocation.
- Cross-account workspace and mismatched-device authorization checks around `/v1/sync`.
- Fastify API routes with request limits and JSON-schema validation.
- PostgreSQL identity and transactional sync adapters plus `server/schema.sql`.
- Electron credentials encrypted through `safeStorage` and exposed only through a narrow preload bridge.
- Encrypted transport tests proving the server sees ciphertext and malformed ciphertext is rejected.

Remaining rollout gates:

- Configure and test the real verification-mail webhook.
- Deploy behind the same-origin TLS reverse proxy represented by `deploy/Caddyfile.example`.
- Complete an external security review and staged operational deployment.

Completed rollout controls:

- The opt-in PostgreSQL integration suite passed against Supabase staging through the IPv4 session pooler with verified TLS on 2026-09-01. It covered idempotent migrations, verified accounts, rotating sessions, devices, encrypted sync writes, pullback, and cleanup.
- Single-use, expiring email verification tokens are hashed at rest; login and enrollment require a verified account.
- Failed delivery can be retried through a rate-limited, account-enumeration-safe resend endpoint.
- Browser refresh sessions use rotating Secure, HttpOnly, SameSite=Strict cookies and never appear in JSON responses.
- Sensitive endpoints have tighter rate limits, while all API endpoints have a global ceiling.
- Security audit events contain event type, outcome, opaque account/device IDs, and keyed IP hashes—never credentials or payloads.
- Numbered PostgreSQL migrations are transactional, ordered, idempotent, and protected by an advisory lock.
- A settings flow creates password/recovery encryption envelopes and refuses account creation until the user confirms the recovery key is saved.
- Authenticated users can list and revoke devices; the sync runtime starts only after an authenticated in-memory encryption session exists.

Until these gates are complete, `VITE_SYNC_ENABLED` must remain unset/false.

## Phase 4 implementation status

The multi-device synchronization layer is implemented behind the same disabled rollout flag:

- A second PC cannot obtain a session through ordinary login. It creates a ten-minute enrollment request instead.
- An existing authenticated device must approve the matching six-digit code.
- Enrollment secrets are random, stored only as hashes, expire, and can be completed only once.
- Approved completion creates a distinct device identity and rotating session, then returns the already encrypted account-key envelopes.
- Background synchronization is single-flight, starts on launch, runs periodically, debounces rapid local writes, and resumes after an online event.
- Local repository writes emit an internal sync-needed event only after the durable outbox write completes.
- Authenticated long-poll notifications wake other devices without making the notification channel authoritative; cursor pull remains the source of truth.
- The enabled UI exposes `syncing`, `synced`, `offline`, `error`, and `conflict` states plus a manual synchronize action.
- Stopping the coordinator removes listeners, timers, and the notification loop.

Phase 4 remains unavailable in normal builds until the Phase 3 rollout gates—especially verified accounts, secure browser cookies, production database migration, rate limiting, recovery UI, and security review—are completed.

## Phase 5 conflicts and recovery

Phase 5 protects user work when multiple offline devices edit the same entity:

- Outbox operations retain a local-only base snapshot. The encrypted transport removes that snapshot before upload, so the server never receives merge inputs in plaintext.
- The client performs a recursive three-way merge. A field changed on only one device is retained automatically; identical edits coalesce; arrays and incompatible values are treated atomically.
- If both devices change the same field differently, the remote value remains canonical and the complete local version becomes a clearly labeled conflict copy with a new entity ID.
- Delete-versus-edit conflicts preserve the edit as a conflict copy. Delete-versus-delete coalesces, while a newer remote edit can be deleted again using its current revision.
- IndexedDB version 6 adds conflict, revision-history, and tombstone stores. Conflict resolution replaces the stale outbox item and writes history/conflict records in one transaction.
- Applied remote changes create immutable history snapshots. The Sync settings panel lists conflict copies and their revision timeline, and can queue an old snapshot for restoration against the newest known server base.
- Encrypted tombstone payloads remain available for 90 days by default. After archival, a minimal server marker remains to reject stale resurrection without retaining the deleted content payload.
- Device cursors are recorded for future compaction and recovery policies. The append-only server change log remains the authoritative revision history.
- Tests cover independent concurrent edits, overlapping field edits, delete-versus-edit recovery, encrypted conflict payloads, tombstone resurrection protection, and an explicitly aborted recovery transaction.

## Production rollout infrastructure

The rollout infrastructure prepares the disabled sync service for a controlled deployment:

- Refresh rotation is atomic. Reuse of an already rotated token is treated as suspected theft and revokes all sessions for that device.
- Explicit logout revokes the device's sessions, clears the refresh cookie, and stops the local coordinator without revoking the device itself.
- Liveness and readiness are separate. Readiness checks database connectivity and confirms that every numbered migration has been applied without exposing database error details.
- The server drains connections on `SIGTERM`/`SIGINT` and has a bounded forced-shutdown fallback.
- Production proxy forwarding is explicitly enabled so per-client rate limits and keyed network hashes use the originating address behind Caddy.
- The maintenance command removes expired enrollment requests and old session/audit records in one transaction with configurable retention periods.
- `docker-compose.sync.yml` provides PostgreSQL, one-shot migrations, the API, health checks, and automatic TLS through Caddy. Internal PostgreSQL traffic explicitly disables TLS; external managed databases can enable verified TLS.
- Internet sync remains disabled by default. Mail-provider validation, a backup/restore drill, external security review, and staged rollout are still required before enabling it for normal users.

Operational commands:

```sh
pnpm server:migrate
pnpm server:maintenance
TEST_DATABASE_URL=postgres://... pnpm test
docker compose --env-file .env.sync -f docker-compose.sync.yml up --build
```

### Vercel and Supabase database connections

The deployed API uses `DATABASE_URL` for Supabase's transaction pooler on port `6543`. Each warm Vercel function keeps a local `pg.Pool` with at most two connections, a 10-second idle timeout, and a 10-second connection timeout. Queries remain unnamed and parameterized, so they do not rely on prepared statements that persist between transactions.

Schema administration is deliberately separate. `pnpm server:migrate` prefers `MIGRATION_DATABASE_URL`, which must be the direct Supabase address on port `5432`. For local compatibility it falls back to `DATABASE_URL` when the migration-specific variable is absent. Migrations must run before deployment and never from the Vercel function or build step.

For a live pooled staging gate, set `TEST_DATABASE_URL` to the transaction-pooler address, `TEST_MIGRATION_DATABASE_URL` to the direct address, and `TEST_REQUIRE_TRANSACTION_POOLER=true`, then run:

```powershell
pnpm test -- server/postgres.integration.test.js
```

Use `.env.sync.example` as the variable template. Keep the real `.env.sync` file and all Vercel environment values out of source control.

## Phase 6 application storage adaptation

The application keeps its local-first repository boundary:

```text
Vue components
      │
Repositories
      │
Local database ── Change outbox
      │
Sync engine
      │
Intranet or internet host
```

- Task and repeating-event repository writes commit the primary IndexedDB record and complete outbox operations in the same transaction.
- Settings and custom-list documents remain synchronously readable from localStorage for compatibility. Their writes synchronously publish a mirror plus write-ahead journal, then atomically commit an IndexedDB document shadow and outbox operation; the journal is removed only after that durable commit.
- If IndexedDB is temporarily unavailable, the local change remains available and its journal survives. Startup immediately restores the mirror and retries the durable document/outbox transaction.
- Rapid writes to one local document are serialized, while the outbox compactor preserves their earliest server merge base.
- Legacy tasks, repeating events, and custom lists that receive sync IDs during loading now persist those IDs together with snapshot operations rather than bypassing the repository synchronization layer.
- Durable commits emit `weektodo:sync-needed` only after transaction completion.
- IndexedDB version 7 adds `sync_local_documents`, the durable mirror used by logical localStorage transactions.
- Backup format version 2 preserves entity sync metadata but remains backward-compatible with earlier backups. Import replaces all primary IndexedDB records atomically and clears stale outbox, cursor, history, conflict, tombstone, and document-shadow state so a fresh snapshot can be generated.
- Clearing application data now clears primary and synchronization stores together. Internal write-ahead journal keys are excluded from exported backups.
