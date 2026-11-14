import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({ name: "Main", slug: "main", kind: "script" });

export default defineScript({
	manifest,
	output: Schema.String,
	input: Schema.Struct({}),
	run: () => Effect.succeed("initial"),
});
