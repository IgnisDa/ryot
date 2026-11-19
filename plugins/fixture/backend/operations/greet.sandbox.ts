import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import { GreetInput, GreetOutput } from "../../shared/greet";

export const manifest = defineManifest({
	kind: "operation",
	slug: "operation.greet",
	name: "Fixture greeting",
});

export default defineOperation({
	manifest,
	input: GreetInput,
	output: GreetOutput,
	run: (input) => Effect.succeed({ greeting: `Hello, ${input.name}` }),
});
