import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import { value } from "../shared/value";

export const manifest = defineManifest({
	name: "Alpha",
	slug: "alpha",
	kind: "script",
	capabilities: [],
	requiredPluginConfigKeys: ["alpha-key"],
	requiredSystemConfigKeys: ["system-key"],
});

export default defineScript({
	manifest,
	output: Schema.String,
	input: Schema.Struct({}),
	run: () => Effect.succeed(value),
});
