import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import { value } from "../shared/value";

const typedValue: JsonValue = value;

export const manifest = defineManifest({ name: "Alpha", slug: "alpha", kind: "script" });

export default defineScript({
	manifest,
	output: Schema.String,
	input: Schema.Struct({}),
	run: () => Effect.succeed(typedValue),
});
