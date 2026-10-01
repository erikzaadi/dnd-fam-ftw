import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "curly": ["error", "all"],
      "brace-style": ["error", "1tbs"],
      "indent": ["error", 2],
      "no-console": "off",
    },
  },
  {
    // Realm internals: account workflows may compose realms (realms/composition), and
    // only realms/ itself sees its private rules. Everyone else uses realms/access.
    files: ["src/**/*.ts"],
    ignores: ["src/realms/**", "src/services/accountService.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "realms/(composition|rules)(\\.js)?$",
          message: "Use realms/access.ts. realms/composition is for services/accountService.ts only; realms/rules is private to realms/.",
        }],
      }],
    },
  },
  {
    files: ["src/services/accountService.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "realms/rules(\\.js)?$",
          message: "realms/rules is private to realms/. Use realms/composition or realms/access.",
        }],
      }],
    },
  }
);
