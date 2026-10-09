import { defineConfig, type Plugin } from "vite";
import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function skinIndex(): Plugin {
  const dir = join(process.cwd(), "public/assets/skins");
  return {
    name: "skin-index",
    buildStart() {
      const skins = readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, "manifest.json")))
        .map(entry => entry.name);
      writeFileSync(join(dir, "index.json"), JSON.stringify(skins));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [skinIndex()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2021",
  },
});
