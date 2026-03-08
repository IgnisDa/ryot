import { Effect as RuntimeEffect, Schema } from "@ryot/sandbox-sdk/effect";

import type { ExecutionMetadata, SandboxWorkflowReference, WorkflowManifest } from "./core";
import { sandboxHostCapabilitySchema } from "./core";
import { SANDBOX_SCRIPT_DEFINITION } from "./driver";
import {
	type JsonValue,
	jsonValueSchema,
	sandboxHostErrorSchema,
	type SandboxHostError,
} from "./wire";

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
export const workflowHostRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("host"),
	args: strictStruct({
		capability: sandboxHostCapabilitySchema,
		args: Schema.Array(jsonValueSchema),
	}),
});
export const workflowNestedChildRequestSchema = strictStruct({
	...durableCallFields,
	kind: Schema.Literal("workflow-child"),
	args: strictStruct({
		input: jsonValueSchema,
		workflowSlug: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	}),
});
export const workflowDurableCallRequestSchema = Schema.Union([
	workflowActivityRequestSchema,
	workflowSleepRequestSchema,
	workflowChildRequestSchema,
	workflowHostRequestSchema,
	workflowNestedChildRequestSchema,
]);
export type WorkflowDurableCallRequest = Schema.Schema.Type<
	typeof workflowDurableCallRequestSchema
>;

export const workflowReplayJournalEntrySchema = strictStruct({
	value: jsonValueSchema,
	request: workflowDurableCallRequestSchema,
});
export type WorkflowReplayJournalEntry = Schema.Schema.Type<
	typeof workflowReplayJournalEntrySchema
>;

export const workflowReplayEnvelopeSchema = Schema.Union([
	strictStruct({
		state: Schema.Literal("pending"),
		journalLength: Schema.optional(durableCallFields.index),
		requests: Schema.Array(workflowDurableCallRequestSchema),
	}),
	strictStruct({
		output: jsonValueSchema,
		state: Schema.Literal("completed"),
		journalLength: Schema.optional(durableCallFields.index),
		requests: Schema.Array(workflowDurableCallRequestSchema),
	}),
	strictStruct({
		error: Schema.String,
		state: Schema.Literal("failed"),
		journalLength: Schema.optional(durableCallFields.index),
		requests: Schema.Array(workflowDurableCallRequestSchema),
	}),
]);
export type WorkflowReplayEnvelope = Schema.Schema.Type<typeof workflowReplayEnvelopeSchema>;

export type WorkflowSandboxHost = {
	readonly durableCalls: () => RuntimeEffect.Effect<
		ReadonlyArray<JsonValue | WorkflowReplayJournalEntry>,
		SandboxHostError
	>;
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
> = SandboxWorkflowReference<Input, Output>;

export const workflowDurableResultSchema = Schema.Union([
	strictStruct({ value: jsonValueSchema, state: Schema.Literal("success") }),
	strictStruct({ error: sandboxHostErrorSchema, state: Schema.Literal("failure") }),
]);
export type WorkflowDurableResult = Schema.Schema.Type<typeof workflowDurableResultSchema>;

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

const stableJson = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "undefined";
};

const makeWorkflowReplay = (
	journal: ReadonlyArray<JsonValue | WorkflowReplayJournalEntry>,
	requests: WorkflowDurableCallRequest[],
): WorkflowReplay => {
	const resolve = <Output extends Schema.ConstraintDecoder<unknown>>(
		request: WorkflowDurableCallRequest,
		output: Output,
	): RuntimeEffect.Effect<Output["Type"], unknown> => {
		const recorded = journal[request.index];
		if (recorded === undefined) {
			return RuntimeEffect.fail(pending as unknown);
		}
		const entry = Schema.decodeUnknownResult(workflowReplayJournalEntrySchema)(recorded);
		if (entry._tag === "Failure") {
			return Schema.decodeUnknownEffect(output)(recorded).pipe(
				RuntimeEffect.mapError((error) => error),
			);
		}
		if (stableJson(entry.success.request) !== stableJson(request)) {
			return RuntimeEffect.fail(
				new Error(`Sandbox workflow journal identity mismatch at index ${request.index}`),
			);
		}
		return Schema.decodeUnknownEffect(output)(entry.success.value).pipe(
			RuntimeEffect.mapError((error) => error),
		);
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
			RuntimeEffect.flatMap((journal) => {
				const replayIdentity = { journalLength: journal.length };
				return definition.run(input, makeWorkflowReplay(journal, requests), execution).pipe(
					RuntimeEffect.flatMap((value) => Schema.decodeUnknownEffect(definition.output)(value)),
					RuntimeEffect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
					RuntimeEffect.map((output) => ({
						output,
						requests,
						...replayIdentity,
						state: "completed" as const,
					})),
					RuntimeEffect.catch((error) =>
						RuntimeEffect.succeed(
							error === pending
								? { requests, ...replayIdentity, state: "pending" as const }
								: {
										requests,
										error: String(error),
										...replayIdentity,
										state: "failed" as const,
									},
						),
					),
				);
			}),
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
