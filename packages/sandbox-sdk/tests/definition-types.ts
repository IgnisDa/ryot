import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";
import { defineWorkflow, type WorkflowReplayEnvelope } from "@ryot/sandbox-sdk/workflow";

import { defineManifest, defineScript } from "../src/driver.js";
import type { Equal, Expect } from "./type-assertions.js";

const scriptManifest = defineManifest({
	kind: "script",
	capabilities: ["getCachedValue"],
	name: "Typed script",
	slug: "typed-script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
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
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});
const operation = defineOperation({
	manifest: operationManifest,
	input: Schema.Struct({ value: Schema.Number }),
	output: Schema.String,
	run: (input) => Effect.succeed(String(input.value)),
});

const workflowManifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Typed workflow",
	slug: "typed-workflow",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});
const workflow = defineWorkflow({
	manifest: workflowManifest,
	input: Schema.Struct({ value: Schema.Number }),
	output: Schema.String,
	run: (input, replay) =>
		replay.activity(
			"format",
			{
				scriptSlug: "format-value",
				input: Schema.Struct({ value: Schema.Number }),
				output: Schema.String,
			},
			input,
		),
});

const scriptInputType: Expect<Equal<Parameters<typeof script.run>[0], { readonly key: string }>> =
	true;
const operationOutputType: Expect<Equal<Effect.Success<ReturnType<typeof operation.run>>, string>> =
	true;
const workflowOutputType: Expect<
	Equal<Effect.Success<ReturnType<typeof workflow.run>>, WorkflowReplayEnvelope>
> = true;
void scriptInputType;
void operationOutputType;
void workflowOutputType;

defineWorkflow({
	manifest: workflowManifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: (_input, replay) =>
		replay.activity(
			"invalid",
			{
				scriptSlug: "typed-activity",
				input: Schema.Struct({ value: Schema.Number }),
				output: Schema.String,
			},
			// @ts-expect-error activity inputs are inferred from the direct script reference.
			{ value: "wrong" },
		),
});
