import { Schema as PluginKitSchema } from "@ryot-app/plugin-kit/effect";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { value } from "../shared/value";

export const manifest = defineManifest({ name: "Zeta", slug: "zeta", kind: "script" });

export default defineScript({
	manifest,
	input: Schema.Struct({}),
	output: PluginKitSchema.String,
	run: () => Effect.succeed(value),
});
