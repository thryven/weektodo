import eslint from "@eslint/js";
import globals from "globals";
import vue from "eslint-plugin-vue";

export default [
  {
    ignores: ["dist/**", "dist-electron/**", "dist_electron/**", "public/libs/**"],
  },
  eslint.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    files: ["src/**/*.{js,vue}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-console": "warn",
      "no-debugger": "warn",
    },
  },
  {
    files: ["electron/**/*.js", "scripts/**/*.mjs", "server/**/*.mjs", "vite.config.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
];
