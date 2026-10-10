import type { ViteUserConfig } from "vitest/config";

const shared: ViteUserConfig = { test: { reporters: ["agent"] } };

export default shared;
