import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "script",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Fixture User Bootstrap",
	slug: "fixture.user-bootstrap",
});

export default defineScript({
	manifest,
	output: Schema.Null,
	input: Schema.Unknown,
	run: () => Effect.succeed(null),
});
