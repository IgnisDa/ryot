import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

import { defineManifest, defineScript } from "../src/driver.js";
import type { Equal, Expect } from "./type-assertions.js";

const scriptManifest = defineManifest({
	kind: "script",
	capabilities: ["getCachedValue"],
	name: "Typed script",
	slug: "typed-script",
	requiredAppConfigKeys: [],
});
const script = defineScript({
	manifest: scriptManifest,
	input: Schema.Struct({ key: Schema.String }),
	output: Schema.NullOr(Schema.Number),
	run: (input, host) =>
		host
			.getCachedValue(input.key)
			.pipe(Effect.map((value) => (typeof value === "number" ? value : null))),
});

const operationManifest = defineManifest({
	kind: "operation",
	capabilities: [],
	name: "Typed operation",
	slug: "typed-operation",
	requiredAppConfigKeys: [],
});
const operation = defineOperation({
	manifest: operationManifest,
	input: Schema.Struct({ value: Schema.Number }),
	output: Schema.String,
	run: (input) => Effect.succeed(String(input.value)),
});

const scriptInputType: Expect<Equal<Parameters<typeof script.run>[0], { readonly key: string }>> =
	true;
const operationOutputType: Expect<
	Equal<Effect.Effect.Success<ReturnType<typeof operation.run>>, string>
> = true;
void scriptInputType;
void operationOutputType;
