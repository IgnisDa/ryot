import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { value } from "../shared/value";

export const manifest = defineManifest({
	name: "Zeta",
	slug: "zeta",
	kind: "script",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineScript({
	manifest,
	output: Schema.String,
	input: Schema.Struct({}),
	run: () => Effect.succeed(value),
});
