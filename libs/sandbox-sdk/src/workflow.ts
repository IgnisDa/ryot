import { Effect as RuntimeEffect, Schema } from "@ryot/sandbox-sdk/effect";

import type { ExecutionMetadata, WorkflowManifest } from "./core";
import { SANDBOX_SCRIPT_DEFINITION } from "./driver";
import { type JsonValue, jsonValueSchema, type SandboxHostError } from "./wire";

const strictStruct = <Fields extends Record<string, Schema.Struct.Field>>(fields: Fields) =>
	Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "error" as const } });

const durableCallFields = {
	index: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	name: Schema.String.pipe(Schema.minLength(1)),
};

export const workflowActivityRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("activity"),
	args: strictStruct({
		input: jsonValueSchema,
		scriptSlug: Schema.String.pipe(Schema.minLength(1)),
	}),
});
export const workflowSleepRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("sleep"),
	args: strictStruct({ durationMs: Schema.Number.pipe(Schema.int(), Schema.nonNegative()) }),
});
export const workflowChildRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("child"),
	args: strictStruct({
		input: jsonValueSchema,
		workflowSlug: Schema.String.pipe(Schema.minLength(1)),
	}),
});
export const workflowDurableCallRequestSchema = Schema.Union(
	workflowActivityRequestSchema,
	workflowSleepRequestSchema,
	workflowChildRequestSchema,
);
export type WorkflowDurableCallRequest = Schema.Schema.Type<
	typeof workflowDurableCallRequestSchema
>;

export const workflowReplayEnvelopeSchema = Schema.Union(
	strictStruct({
		requests: Schema.Array(workflowDurableCallRequestSchema),
		state: Schema.Literal("pending"),
	}),
	strictStruct({
		output: jsonValueSchema,
		requests: Schema.Array(workflowDurableCallRequestSchema),
		state: Schema.Literal("completed"),
	}),
	strictStruct({
		error: Schema.String,
		requests: Schema.Array(workflowDurableCallRequestSchema),
		state: Schema.Literal("failed"),
	}),
);
export type WorkflowReplayEnvelope = Schema.Schema.Type<typeof workflowReplayEnvelopeSchema>;

export type WorkflowSandboxHost = {
	readonly durableCalls: () => RuntimeEffect.Effect<ReadonlyArray<JsonValue>, SandboxHostError>;
};

export type WorkflowScriptReference<
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly scriptSlug: string;
};

export type WorkflowReference<
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly workflowSlug: string;
};

export type WorkflowReplay = {
	readonly activity: <
		Input extends Schema.Schema.AnyNoContext,
		Output extends Schema.Schema.AnyNoContext,
	>(
		name: string,
		reference: WorkflowScriptReference<Input, Output>,
		input: Schema.Schema.Type<Input>,
	) => RuntimeEffect.Effect<Schema.Schema.Type<Output>, unknown>;
	readonly sleep: (name: string, durationMs: number) => RuntimeEffect.Effect<null, unknown>;
	readonly child: <
		Input extends Schema.Schema.AnyNoContext,
		Output extends Schema.Schema.AnyNoContext,
	>(
		name: string,
		reference: WorkflowReference<Input, Output>,
		input: Schema.Schema.Type<Input>,
	) => RuntimeEffect.Effect<Schema.Schema.Type<Output>, unknown>;
};

type WorkflowExecution<
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly manifest: WorkflowManifest;
	readonly run: (
		input: Schema.Schema.Type<Input>,
		replay: WorkflowReplay,
		execution: ExecutionMetadata,
	) => RuntimeEffect.Effect<Schema.Schema.Type<Output>, unknown>;
};

export type WorkflowDefinition<
	Manifest extends WorkflowManifest,
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
> = Omit<WorkflowExecution<Input, Output>, "manifest" | "output" | "run"> & {
	readonly output: typeof workflowReplayEnvelopeSchema;
	readonly manifest: Manifest;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
	readonly run: (
		input: Schema.Schema.Type<Input>,
		host: WorkflowSandboxHost,
		execution: ExecutionMetadata,
	) => RuntimeEffect.Effect<WorkflowReplayEnvelope, SandboxHostError>;
};

const pending = Symbol("workflow-durable-call-pending");

const makeWorkflowReplay = (
	journal: ReadonlyArray<JsonValue>,
	requests: WorkflowDurableCallRequest[],
): WorkflowReplay => {
	const resolve = <Output extends Schema.Schema.AnyNoContext>(
		request: WorkflowDurableCallRequest,
		output: Output,
	): RuntimeEffect.Effect<Schema.Schema.Type<Output>, unknown> => {
		requests.push(request);
		const value = journal[request.index];
		return value === undefined
			? RuntimeEffect.fail(pending as unknown)
			: Schema.decodeUnknown(output)(value).pipe(RuntimeEffect.mapError((error) => error));
	};

	return {
		activity: (name, reference, input) =>
			resolve(
				{
					name,
					index: requests.length,
					kind: "activity",
					args: { input: input as JsonValue, scriptSlug: reference.scriptSlug },
				},
				reference.output,
			),
		sleep: (name, durationMs) =>
			resolve({ name, index: requests.length, kind: "sleep", args: { durationMs } }, Schema.Null),
		child: (name, reference, input) =>
			resolve(
				{
					name,
					index: requests.length,
					kind: "child",
					args: { input: input as JsonValue, workflowSlug: reference.workflowSlug },
				},
				reference.output,
			),
	};
};

export const defineWorkflow = <
	const Manifest extends WorkflowManifest,
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
>(
	definition: WorkflowExecution<Input, Output> & { readonly manifest: Manifest },
): WorkflowDefinition<Manifest, Input, Output> => ({
	...definition,
	output: workflowReplayEnvelopeSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	run: (input, host, execution) => {
		const requests: WorkflowDurableCallRequest[] = [];
		return host.durableCalls().pipe(
			RuntimeEffect.flatMap((journal) =>
				definition.run(input, makeWorkflowReplay(journal, requests), execution).pipe(
					RuntimeEffect.flatMap((value) => Schema.decodeUnknown(definition.output)(value)),
					RuntimeEffect.flatMap(Schema.decodeUnknown(jsonValueSchema)),
					RuntimeEffect.map((output) => ({ output, requests, state: "completed" as const })),
					RuntimeEffect.catchAll((error) =>
						RuntimeEffect.succeed(
							error === pending
								? { requests, state: "pending" as const }
								: { error: String(error), requests, state: "failed" as const },
						),
					),
				),
			),
		);
	},
});

export const Effect = {
	as: RuntimeEffect.as,
	gen: RuntimeEffect.gen,
	succeed: RuntimeEffect.succeed,
};
export { Schema };
export { defineManifest } from "./driver";
