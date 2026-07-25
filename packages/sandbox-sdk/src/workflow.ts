import { Effect as RuntimeEffect, Schema } from "@ryot/sandbox-sdk/effect";

import type { ExecutionMetadata, WorkflowManifest } from "./core";
import { SANDBOX_SCRIPT_DEFINITION } from "./driver";
import { type JsonValue, jsonValueSchema, type SandboxHostError } from "./wire";

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const durableCallFields = {
	index: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
};

export const workflowActivityRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("activity"),
	args: strictStruct({
		input: jsonValueSchema,
		scriptSlug: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	}),
});
export const workflowSleepRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("sleep"),
	args: strictStruct({
		durationMs: Schema.Number.pipe(
			Schema.check(Schema.isInt()),
			Schema.check(Schema.isGreaterThanOrEqualTo(0)),
		),
	}),
});
export const workflowChildRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("child"),
	args: strictStruct({
		input: jsonValueSchema,
		workflowSlug: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	}),
});
export const workflowDurableCallRequestSchema = Schema.Union([
	workflowActivityRequestSchema,
	workflowSleepRequestSchema,
	workflowChildRequestSchema,
]);
export type WorkflowDurableCallRequest = Schema.Schema.Type<
	typeof workflowDurableCallRequestSchema
>;

export const workflowReplayEnvelopeSchema = Schema.Union([
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
]);
export type WorkflowReplayEnvelope = Schema.Schema.Type<typeof workflowReplayEnvelopeSchema>;

export type WorkflowSandboxHost = {
	readonly durableCalls: () => RuntimeEffect.Effect<ReadonlyArray<JsonValue>, SandboxHostError>;
};

export type WorkflowScriptReference<
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly scriptSlug: string;
};

export type WorkflowReference<
	Input extends Schema.Constraint,
	Output extends Schema.ConstraintDecoder<unknown>,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly workflowSlug: string;
};

export type WorkflowReplay = {
	readonly activity: <
		Input extends Schema.Constraint,
		Output extends Schema.ConstraintDecoder<unknown>,
	>(
		name: string,
		reference: WorkflowScriptReference<Input, Output>,
		input: Input["Type"],
	) => RuntimeEffect.Effect<Output["Type"], unknown>;
	readonly sleep: (name: string, durationMs: number) => RuntimeEffect.Effect<null, unknown>;
	readonly child: <
		Input extends Schema.Constraint,
		Output extends Schema.ConstraintDecoder<unknown>,
	>(
		name: string,
		reference: WorkflowReference<Input, Output>,
		input: Input["Type"],
	) => RuntimeEffect.Effect<Output["Type"], unknown>;
};

type WorkflowExecution<
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly manifest: WorkflowManifest;
	readonly run: (
		input: Input["Type"],
		replay: WorkflowReplay,
		execution: ExecutionMetadata,
	) => RuntimeEffect.Effect<Output["Type"], unknown>;
};

export type WorkflowDefinition<
	Manifest extends WorkflowManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
> = Omit<WorkflowExecution<Input, Output>, "manifest" | "output" | "run"> & {
	readonly output: typeof workflowReplayEnvelopeSchema;
	readonly manifest: Manifest;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
	readonly run: (
		input: Input["Type"],
		host: WorkflowSandboxHost,
		execution: ExecutionMetadata,
	) => RuntimeEffect.Effect<WorkflowReplayEnvelope, SandboxHostError>;
};

const pending = Symbol("workflow-durable-call-pending");

const makeWorkflowReplay = (
	journal: ReadonlyArray<JsonValue>,
	requests: WorkflowDurableCallRequest[],
): WorkflowReplay => {
	const resolve = <Output extends Schema.ConstraintDecoder<unknown>>(
		request: WorkflowDurableCallRequest,
		output: Output,
	): RuntimeEffect.Effect<Output["Type"], unknown> => {
		const value = journal[request.index];
		return value === undefined
			? RuntimeEffect.fail(pending as unknown)
			: Schema.decodeUnknownEffect(output)(value).pipe(RuntimeEffect.mapError((error) => error));
	};
	const register = <Output extends Schema.ConstraintDecoder<unknown>>(
		request: WorkflowDurableCallRequest,
		output: Output,
	) => {
		requests.push(request);
		return resolve(request, output);
	};

	return {
		activity: (name, reference, input) => {
			const decoded = Schema.decodeUnknownResult(jsonValueSchema)(input);
			if (decoded._tag === "Failure") {
				return RuntimeEffect.fail(decoded.failure);
			}
			return register(
				{
					name,
					kind: "activity",
					index: requests.length,
					args: { input: decoded.success, scriptSlug: reference.scriptSlug },
				},
				reference.output,
			);
		},
		sleep: (name, durationMs) =>
			register({ name, index: requests.length, kind: "sleep", args: { durationMs } }, Schema.Null),
		child: (name, reference, input) => {
			const decoded = Schema.decodeUnknownResult(jsonValueSchema)(input);
			if (decoded._tag === "Failure") {
				return RuntimeEffect.fail(decoded.failure);
			}
			return register(
				{
					name,
					kind: "child",
					index: requests.length,
					args: { input: decoded.success, workflowSlug: reference.workflowSlug },
				},
				reference.output,
			);
		},
	};
};

export const defineWorkflow = <
	const Manifest extends WorkflowManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
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
					RuntimeEffect.flatMap((value) => Schema.decodeUnknownEffect(definition.output)(value)),
					RuntimeEffect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
					RuntimeEffect.map((output) => ({ output, requests, state: "completed" as const })),
					RuntimeEffect.catch((error) =>
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
	all: RuntimeEffect.all,
	gen: RuntimeEffect.gen,
	fail: RuntimeEffect.fail,
	succeed: RuntimeEffect.succeed,
};
export { Schema };
export { defineManifest } from "./driver";
