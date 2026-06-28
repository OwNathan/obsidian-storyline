import esbuild from "esbuild";
import process from "process";
import { existsSync, mkdirSync } from "fs";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  loader: {
    ".md": "text",
  },
  plugins: [
    {
      name: "copy-static-files",
      setup(build) {
        build.onEnd(async () => {
          const staticFiles = ["styles.css"];
          for (const file of staticFiles) {
            try {
              const fs = await import("fs/promises");
              const source = await fs.readFile(file, "utf8");
              await fs.writeFile(file, source);
            } catch (e) {
              console.warn(`[esbuild] Failed to copy ${file}:`, e);
            }
          }
        });
      },
    },
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
