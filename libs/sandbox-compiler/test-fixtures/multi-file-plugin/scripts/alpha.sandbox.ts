import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/core";
import * as z from "@ryot/sandbox-sdk/zod";

import { value } from "../shared/value";

export const manifest = defineManifest({
	name: "Alpha",
	slug: "alpha",
	kind: "script",
	capabilities: [],
	requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
	output: z.string(),
	input: z.object({}),
	run: () => Promise.resolve(value),
});

export default defineScript({ manifest, drivers: { main } });
