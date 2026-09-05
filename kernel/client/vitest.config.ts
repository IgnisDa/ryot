import { defineClientConfig } from "@ryot-app/testing/vitest.client";

export default defineClientConfig({ maxWorkers: 2, setupFiles: ["./vitest.setup.ts"] });
