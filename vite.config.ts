import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// https://vite.dev/config/
/**
 * Development only: POST /__dev/save with {"name": "...", "content": "..."} writes the content to dev-out/<name>
 * (plain file names only). Used by scripts in the browser preview to hand rendered SVGs/PNGs back to the disk.
 */
const devSave = () => ({
  name: "plotfolio-dev-save",
  configureServer(server: { middlewares: { use: (path: string, fn: (req: NodeJS.ReadableStream & { method?: string }, res: { statusCode: number; end: (s?: string) => void }) => void) => void } }) {
    server.middlewares.use("/__dev/save", (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        try {
          const { name, content, base64 } = JSON.parse(body) as { name: string; content: string; base64?: boolean };
          if (!/^[\w.-]+$/.test(name)) throw new Error("bad name");
          const dir = new URL("./dev-out/", import.meta.url);
          mkdirSync(dir, { recursive: true });
          writeFileSync(new URL(name, dir), base64 ? Buffer.from(content, "base64") : content);
          res.statusCode = 200;
          res.end("ok");
        } catch (e) {
          res.statusCode = 400;
          res.end(String((e as Error).message));
        }
      });
    });
  },
});

export default defineConfig(() => ({
  plugins: [react(), devSave()],
  // relative asset paths: the built dist/ folder works from any path of a website (and inside the Mac app)
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
