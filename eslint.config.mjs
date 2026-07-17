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
      // Allow disabling obsidianmd/prefer-create-el for SVG createElementNS
      // (createSvg is 1.13+ only; we still support 1.12.x for SVG graphs).
      "eslint-comments/no-restricted-disable": ["error",
        "no-console",
        "no-restricted-globals",
        "@typescript-eslint/no-restricted-imports",
        "no-alert",
        "@typescript-eslint/no-deprecated",
        "@typescript-eslint/no-explicit-any",
        "@microsoft/sdl/no-document-write",
        "no-eval",
        "@microsoft/sdl/no-inner-html",
        "obsidianmd/no-nodejs-modules",
      ],
    },
  },
]);
