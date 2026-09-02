# Build Toolchain Migration

## Completed state

- The web renderer, Electron main process, and preload script build with Vite 8.
- Electron packaging uses electron-builder 26 and Electron 44.
- Renderer access to desktop features goes through a narrow context-bridge API.
- Electron context isolation and sandboxing are enabled; renderer Node integration is disabled.
- Vue CLI, webpack, Babel CLI plugins, and the legacy Electron CLI plugin have been removed.
- The repository uses pnpm with a committed lockfile.
- Tests, lint, web/main/preload builds, and an unpacked Windows package have been verified.
- Web builds generate a Workbox service worker from the final hashed Vite assets; stale caches are cleaned up and updates use the existing in-app prompt.
- Service workers are excluded from Electron builds and runtime registration.
- Sass modules use `@use`; builds no longer emit Sass import deprecations.
- Browser dependencies are split into framework, date, UI, rich-text, and observability chunks, with the application chunk below 400 KB minified.
- `electron:smoke` validates the packaged archive contents and confirms web-only/runtime dependencies are excluded.
- Automated tests cover task ordering, recurrence generation, configuration migration, and current/legacy backup compatibility.

The Vue CLI/Webpack 4 migration is complete. Remaining dependency deprecation notices belong to application-library upgrades rather than the build-toolchain migration.

Internet synchronization is tracked separately in `SYNC_ARCHITECTURE.md`; its local storage foundation is implemented without enabling network access.
