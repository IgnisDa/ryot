import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { defineWorkflow, type WorkflowReplayEnvelope } from "@ryot-app/sandbox-sdk/workflow";

import { defineManifest, defineScript } from "../src/driver.js";
import type { Equal, Expect } from "./type-assertions.js";

const scriptManifest = defineManifest({
	kind: "script",
	name: "Typed script",
	slug: "typed-script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getCachedValue"],
});
const script = defineScript({
	manifest: scriptManifest,
	output: Schema.NullOr(Schema.Number),
	input: Schema.Struct({ key: Schema.String }),
	run: (input, host) =>
		host
			.getCachedValue(input.key)
			.pipe(Effect.map((value) => (typeof value === "number" ? value : null))),
});

const operationManifest = defineManifest({
	capabilities: [],
	kind: "operation",
	name: "Typed operation",
	slug: "typed-operation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});
const operation = defineOperation({
	output: Schema.String,
	manifest: operationManifest,
	input: Schema.Struct({ value: Schema.Number }),
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
	output: Schema.String,
	manifest: workflowManifest,
	input: Schema.Struct({ value: Schema.Number }),
	run: (input, replay) =>
		replay.activity(
			"format",
			{
				output: Schema.String,
				scriptSlug: "format-value",
				input: Schema.Struct({ value: Schema.Number }),
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
	output: Schema.String,
	input: Schema.Struct({}),
	manifest: workflowManifest,
	run: (_input, replay) =>
		replay.activity(
			"invalid",
			{
				output: Schema.String,
				scriptSlug: "typed-activity",
				input: Schema.Struct({ value: Schema.Number }),
			},
			// @ts-expect-error activity inputs are inferred from the direct script reference.
			{ value: "wrong" },
		),
});
