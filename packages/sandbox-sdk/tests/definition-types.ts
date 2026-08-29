import { defineAutomation, defineAutomationPolicy } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { defineWorkflow, type WorkflowReplayEnvelope } from "@ryot-app/sandbox-sdk/workflow";

import { defineManifest, defineScript } from "../src/driver.js";
import type { SandboxHostError } from "../src/wire.js";
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
		host.getCachedValue(input.key).pipe(
			Effect.filterOrFail(
				(value): value is number => typeof value === "number",
				() => ({ _tag: "InvalidCachedValue" as const }),
			),
		),
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
const failingOperation = defineOperation({
	output: Schema.String,
	manifest: operationManifest,
	input: Schema.Struct({ value: Schema.Number }),
	run: (input) =>
		input.value < 0
			? Effect.fail({ _tag: "InvalidOperationInput" as const })
			: Effect.succeed(String(input.value)),
});

const automationManifest = defineManifest({
	capabilities: [],
	kind: "automation",
	name: "Typed automation",
	slug: "typed-automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	automationType: "automation",
	inputProjection: { event: { properties: [], compareProperties: [] } },
});
const automation = defineAutomation({
	manifest: automationManifest,
	run: () => Effect.fail({ _tag: "AutomationFailure" as const }),
});
const policy = defineAutomationPolicy({
	run: () => Effect.fail({ _tag: "PolicyFailure" as const }),
	manifest: defineManifest({
		...automationManifest,
		automationType: "policy",
		inputProjection: { event: { properties: [] } },
	}),
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
const scriptFailureType: Expect<
	Equal<
		Effect.Error<ReturnType<typeof script.run>>,
		SandboxHostError | { _tag: "InvalidCachedValue" }
	>
> = true;
const operationOutputType: Expect<Equal<Effect.Success<ReturnType<typeof operation.run>>, string>> =
	true;
const operationFailureType: Expect<Equal<Effect.Error<ReturnType<typeof operation.run>>, never>> =
	true;
const failingOperationFailureType: Expect<
	Equal<Effect.Error<ReturnType<typeof failingOperation.run>>, { _tag: "InvalidOperationInput" }>
> = true;
const automationFailureType: Expect<
	Equal<Effect.Error<ReturnType<typeof automation.run>>, { _tag: "AutomationFailure" }>
> = true;
const policyFailureType: Expect<
	Equal<Effect.Error<ReturnType<typeof policy.run>>, { _tag: "PolicyFailure" }>
> = true;
const workflowOutputType: Expect<
	Equal<Effect.Success<ReturnType<typeof workflow.run>>, WorkflowReplayEnvelope>
> = true;
const workflowFailureType: Expect<
	Equal<Effect.Error<ReturnType<typeof workflow.run>>, SandboxHostError>
> = true;
void scriptInputType;
void scriptFailureType;
void operationOutputType;
void operationFailureType;
void failingOperationFailureType;
void automationFailureType;
void policyFailureType;
void workflowOutputType;
void workflowFailureType;

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
