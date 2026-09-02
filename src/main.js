import { createApp } from "vue";
import App from "./App.vue";
import { store } from "./store/store";
import * as Sentry from "@sentry/vue";

import { createI18n } from "vue-i18n";
import { languages } from "./assets/languages/languages.js";
const messages = Object.assign(languages);
const i18n = createI18n({
  locale: "en",
  fallbackLocale: "en",
  messages,
});

import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";

import "bootstrap-icons/font/bootstrap-icons.css";

import "./assets/style/main.scss";
import "./assets/style/uiComponents.scss";
import { createSyncRuntime } from "./sync/syncRuntime";
import { createInitialSnapshot } from "./sync/initialSnapshot";
import { syncAccountClient } from "./sync/syncAccountSession";
import { recoverPendingLocalWrites } from "./repositories/localDocumentSyncRepository";

recoverPendingLocalWrites();

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    new Sentry.BrowserTracing({
      // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
      tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
    })
    // Sentry.replayIntegration({
    //   maskAllText: true,
    //   blockAllMedia: true,
    // }),
  ],
  // Performance Monitoring
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // Session Replay
  replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
  replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
  // beforeSend(event) {
  //   if (!store.getters.config.reportErrors) {
  //     return null;
  //   }
  //   return event;
  // },
});

const app = createApp(App);

app.use(store);
app.use(i18n);
app.mount("#app");

// Sync remains inert until both the rollout flag and an authenticated, encrypted session exist.
let syncRuntime;
async function startSyncSession(session) {
  syncRuntime?.stop();
  try{syncRuntime=createSyncRuntime(import.meta.env,{accessToken:()=>syncAccountClient.accessToken(),
    accountKey:()=>syncAccountClient.accountKey(),workspaceId:session.accountId,deviceId:session.deviceId});}
  catch(error){syncRuntime=null;window.dispatchEvent(new CustomEvent("weektodo:sync-state",{detail:{status:"error",error:error.message}}));return;}
  if(!syncRuntime)return;
  syncRuntime.subscribe((state)=>window.dispatchEvent(new CustomEvent("weektodo:sync-state",{detail:state})));
  await createInitialSnapshot();syncRuntime.start();
}
window.addEventListener("weektodo:sync-session",(event)=>startSyncSession(event.detail));
window.addEventListener("weektodo:sync-now",()=>syncRuntime?.syncNow());
window.addEventListener("weektodo:sync-logout",()=>{syncRuntime?.stop();syncRuntime=null;
  window.dispatchEvent(new CustomEvent("weektodo:sync-state",{detail:{status:"offline",error:null}}));});
