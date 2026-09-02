import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron/simple";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const plugins = [vue()];

  if (mode === "web") {
    plugins.push(
      VitePWA({
        injectRegister: null,
        manifest: false,
        registerType: "prompt",
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff,woff2,json,ogg}"],
          maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
          navigateFallback: "index.html",
          navigateFallbackDenylist: [
            /^\/v1(?:\/|$)/,
            /^\/health(?:\/|$)/,
            /^\/\.well-known\/weektodo-sync(?:\/|$)/,
          ],
          skipWaiting: false,
        },
      })
    );
  }

  if (mode === "electron") {
    plugins.push(
      electron({
      main: {
        entry: "electron/main.js",
        vite: {
          build: {
            outDir: "dist-electron",
            rolldownOptions: {
              output: { entryFileNames: "main.js" },
            },
          },
        },
      },
      preload: {
        input: "electron/preload.js",
        vite: {
          build: {
            outDir: "dist-electron",
            emptyOutDir: false,
            rolldownOptions: {
              output: { entryFileNames: "preload.js" },
            },
          },
        },
      },
      })
    );
  }

  return {
    base: "./",
    plugins,
    server: mode === "web" ? {
      proxy: {
        "/v1": { target: "http://127.0.0.1:3000" },
        "/health": { target: "http://127.0.0.1:3000" },
        "/.well-known/weektodo-sync": { target: "http://127.0.0.1:3000" },
      },
    } : undefined,
    resolve: {
      // Preserve the extensionless Vue imports accepted by the previous CLI setup.
      extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json", ".vue"],
    },
    build: {
      outDir: "dist",
      target: "es2020",
      rolldownOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("@sentry")) return "observability";
            if (id.includes("bootstrap") || id.includes("@popperjs")) return "ui";
            if (id.includes("moment") || id.includes("date-fns") || id.includes("rrule")) return "dates";
            if (id.includes("markdown-it") || id.includes("linkify")) return "rich-text";
            if (id.includes("vue") || id.includes("vuex")) return "vue";
          },
        },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.js", "server/**/*.test.js", "api/**/*.test.js"],
    },
  };
});
