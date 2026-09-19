import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "url";
import path from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "src") + "/",
      "@nrvnaverse/manifest": path.resolve(__dirname, "../../packages/nrvna-manifest/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
