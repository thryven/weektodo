export function registerServiceWorker({ onUpdateAvailable, onError } = {}) {
  if (!import.meta.env.PROD || window.weekToDoDesktop || !("serviceWorker" in navigator)) return;

  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (worker.state !== "installed" || !navigator.serviceWorker.controller) return;
          onUpdateAvailable?.(() => worker.postMessage({ type: "SKIP_WAITING" }));
        });
      });
    } catch (error) {
      onError?.(error);
    }
  });
}
