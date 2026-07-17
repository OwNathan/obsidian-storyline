import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["*.mjs", "main.js", "node_modules/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // Preserve brand names with their canonical casing in UI strings.
      "obsidianmd/ui/sentence-case": ["error", {
        brands: ["StoryLine", "Scrivener", "Obsidian"],
      }],
      // StoryLine still targets Obsidian 1.12.x (see manifest.json →
      // minAppVersion), where getSettingDefinitions() doesn't exist. The
      // declarative settings API is 1.13.0+ only, so the imperative display()
      // path in settings.ts is intentional until we drop 1.12.x support.
      //
      // The plugin's recommended config forbids inline-disabling ANY
      // obsidianmd/* rule (via eslint-comments/no-restricted-disable with
      // the "obsidianmd/*" wildcard), so the suppression must live here.
      // Re-enable this rule (and remove this entry) once minAppVersion is
      // bumped to 1.13.0 and settings.ts migrates to getSettingDefinitions().
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
]);
