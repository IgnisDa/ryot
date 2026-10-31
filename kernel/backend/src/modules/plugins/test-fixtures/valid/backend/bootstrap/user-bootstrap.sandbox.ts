import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
	kind: "script",
	name: "Fixture User Bootstrap",
	slug: "fixture.user-bootstrap",
});

export default defineScript({
	manifest,
	output: Schema.Null,
	input: Schema.Unknown,
	run: () => Effect.succeed(null),
});
