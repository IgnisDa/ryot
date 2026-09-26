import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

export const manifest = defineManifest({
	kind: "operation",
	slug: "operation.greet",
	name: "Fixture greeting",
});

export default defineOperation({
	manifest,
	output: Schema.Struct({ greeting: Schema.String }),
	run: (input) => Effect.succeed({ greeting: `Hello, ${input.name}` }),
	input: Schema.Struct({ name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))) }),
});
