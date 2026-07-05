import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import { value } from "../shared/value";

export const manifest = defineManifest({
	name: "Zeta",
	slug: "zeta",
	kind: "script",
	capabilities: [],
	requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
	output: Schema.String,
	input: Schema.Struct({}),
	run: () => Effect.succeed(value),
});

export default defineScript({ manifest, drivers: { main } });
