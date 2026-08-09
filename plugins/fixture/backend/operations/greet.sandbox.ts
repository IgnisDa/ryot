import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

export const manifest = defineManifest({
	capabilities: [],
	kind: "operation",
	slug: "operation.greet",
	name: "Fixture greeting",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineOperation({
	manifest,
	output: Schema.Struct({ greeting: Schema.String }),
	run: (input) => Effect.succeed({ greeting: `Hello, ${input.name}` }),
	input: Schema.Struct({ name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))) }),
});
