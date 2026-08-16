import js from "@eslint/js";

// Minimal, correctness-focused rules -- catches the things a CI check
// should catch (unused vars, undefined refs, obvious footguns), not a
// style enforcer. No framework here, so no framework-specific plugin.
export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        console: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        crypto: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        ReadableStream: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        location: "readonly",
        navigator: "readonly",
        alert: "readonly",
        prompt: "readonly",
        confirm: "readonly",
        setTimeout: "readonly",
        FormData: "readonly",
        HTMLElement: "readonly",
      },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["node_modules/**", "dist/**", ".wrangler/**", "src/skills.generated.js"],
  },
];