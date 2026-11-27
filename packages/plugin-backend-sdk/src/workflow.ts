import { boundaryReasonOfError } from "@ryot-app/contract/modules/scripts/boundary-reason";
import type { SANDBOX_FAILURE_KINDS } from "@ryot-app/contract/modules/scripts/wire";
import { Effect as RuntimeEffect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { ExecutionMetadata, WorkflowManifest } from "./core/script-manifest";
import { SANDBOX_SCRIPT_DEFINITION } from "./driver";
import { jsonValueSchema, type SandboxHostError } from "./wire";
import {
	type WorkflowDurableCallRequest,
	type WorkflowReplayEnvelope,
	workflowReplayEnvelopeSchema,
	type WorkflowReplayHost,
	type WorkflowReplayJournal,
} from "./workflow/protocol";
import type { WorkflowReference, WorkflowScriptReference } from "./workflow/references";

const pending = Symbol("workflow-durable-call-pending");

export type WorkflowDefinition<
	Manifest extends WorkflowManifest,
	Input extends Schema.Codec<unknown, unknown>,
> = {
	readonly input: Input;
	readonly manifest: Manifest;
	readonly output: typeof workflowReplayEnvelopeSchema;
	readonly definitionType: typeof SANDBOX_SCRIPT_DEFINITION;
	readonly run: (
		input: Input["Type"],
		host: WorkflowReplayHost,
		execution: ExecutionMetadata,
	) => RuntimeEffect.Effect<WorkflowReplayEnvelope, SandboxHostError>;
};

export type WorkflowStep = {
	readonly child: <
		Input extends Schema.Constraint,
		Output extends Schema.ConstraintDecoder<unknown>,
	>(
		name: string,
		reference: WorkflowReference<Input, Output>,
		input: Input["Type"],
	) => RuntimeEffect.Effect<Output["Type"], WorkflowStepFailure>;
	readonly activity: <
		Input extends Schema.Constraint,
		Output extends Schema.ConstraintDecoder<unknown>,
	>(
		name: string,
		reference: WorkflowScriptReference<Input, Output>,
		input: Input["Type"],
	) => RuntimeEffect.Effect<Output["Type"], WorkflowStepFailure>;
};

type WorkflowStepFailure =
	typeof pending | SandboxHostError | Schema.SchemaError | WorkflowJournalMismatchError;

type WorkflowExecution<
	Manifest extends WorkflowManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
	Failure,
	Checkpoint extends Schema.ConstraintDecoder<unknown>,
> = {
	readonly input: Input;
	readonly output: Output;
	readonly manifest: Manifest;
	readonly checkpoint?: Checkpoint;
	readonly run: (
		input: Input["Type"],
		step: WorkflowStep & {
			readonly save: (checkpoint: Checkpoint["Type"]) => RuntimeEffect.Effect<never, unknown>;
		},
		checkpoint: null | Checkpoint["Type"],
		execution: ExecutionMetadata,
	) => RuntimeEffect.Effect<Output["Type"], Failure>;
};

class WorkflowJournalMismatchError extends Schema.TaggedError<
	WorkflowJournalMismatchError,
	{ readonly brand: unique symbol }
>()("WorkflowJournalMismatchError", { message: Schema.String }) {}

// A host call that may already have reached an external system reports `external-uncertain` so the
// kernel refuses to auto-retry it unless the hook declared run-ID idempotency.
const workflowFailureKind = (error: unknown): (typeof SANDBOX_FAILURE_KINDS)[number] => {
	if (typeof error !== "object" || error === null || !("data" in error)) {
		return "script-failure";
	}
	const data: unknown = error.data;
	return typeof data === "object" &&
		data !== null &&
		"code" in data &&
		data.code === "external-uncertain"
		? "external-uncertain"
		: "script-failure";
};

const boundaryData = (error: unknown) => {
	const data = boundaryReasonOfError(error);
	return data ? { data } : {};
};

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
	return JSON.stringify(value);
};

const makeWorkflowStep = (
	journal: WorkflowReplayJournal,
	requests: WorkflowDurableCallRequest[],
): WorkflowStep => {
	const resolve = <Output extends Schema.ConstraintDecoder<unknown>>(
		request: WorkflowDurableCallRequest,
		output: Output,
	): RuntimeEffect.Effect<Output["Type"], WorkflowStepFailure> => {
		return RuntimeEffect.gen(function* () {
			if (request.index >= journal.length) {
				return yield* RuntimeEffect.fail(pending);
			}
			return yield* journal
				.read(request.index)
				.pipe(
					RuntimeEffect.flatMap(
						(entry): RuntimeEffect.Effect<Output["Type"], WorkflowStepFailure> =>
							stableJson(entry.request) !== stableJson(request)
								? RuntimeEffect.fail(
										new WorkflowJournalMismatchError({
											message: `Sandbox workflow journal identity mismatch at index ${request.index}`,
										}),
									)
								: Schema.decodeEffect(output)(entry.value),
					),
				);
		});
	};
	const register = <Output extends Schema.ConstraintDecoder<unknown>>(
		request: WorkflowDurableCallRequest,
		output: Output,
	) => {
		requests.push(request);
		return resolve(request, output);
	};

	return {
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
	};
};

export const defineWorkflow = <
	const Manifest extends WorkflowManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
	Failure,
	Checkpoint extends Schema.ConstraintDecoder<unknown> = typeof Schema.Never,
>(
	definition: WorkflowExecution<Manifest, Input, Output, Failure, Checkpoint>,
): WorkflowDefinition<Manifest, Input> => ({
	...definition,
	output: workflowReplayEnvelopeSchema,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
	run: (input, host, execution) => {
		const requests: WorkflowDurableCallRequest[] = [];
		const saved = Symbol("checkpoint");
		let nextCheckpoint: unknown;
		return host.replayJournal().pipe(
			RuntimeEffect.flatMap((journal) => {
				const replayIdentity = { journalLength: journal.length };
				const checkpoint: RuntimeEffect.Effect<null | Checkpoint["Type"], Schema.SchemaError> =
					definition.checkpoint && host.checkpoint !== undefined
						? Schema.decodeEffect(definition.checkpoint)(host.checkpoint)
						: RuntimeEffect.succeed(null);
				return checkpoint.pipe(
					RuntimeEffect.flatMap((state) =>
						definition.run(
							input,
							{
								...makeWorkflowStep(journal, requests),
								save: (value) => {
									nextCheckpoint = value;
									return RuntimeEffect.fail(saved);
								},
							},
							state,
							execution,
						),
					),
					RuntimeEffect.flatMap((value) => Schema.decodeUnknownEffect(definition.output)(value)),
					RuntimeEffect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
					RuntimeEffect.map((output) => ({
						output,
						requests,
						...replayIdentity,
						state: "completed" as const,
					})),
					RuntimeEffect.catch(
						(error): RuntimeEffect.Effect<WorkflowReplayEnvelope, SandboxHostError> =>
							error === saved && definition.checkpoint
								? Schema.decodeUnknownEffect(definition.checkpoint)(nextCheckpoint).pipe(
										RuntimeEffect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)),
										RuntimeEffect.mapBoth({
											onFailure: (failure) => ({ message: String(failure) }),
											onSuccess: (value) => ({
												requests,
												checkpoint: value,
												...replayIdentity,
												state: "checkpoint" as const,
											}),
										}),
									)
								: RuntimeEffect.succeed(
										error === pending
											? { requests, ...replayIdentity, state: "pending" as const }
											: {
													requests,
													...replayIdentity,
													state: "failed" as const,
													...boundaryData(error),
													kind: workflowFailureKind(error),
													error:
														!(error instanceof Error) &&
														typeof error === "object" &&
														error !== null &&
														"message" in error &&
														typeof error.message === "string"
															? error.message
															: String(error),
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
export type { WorkflowReference, WorkflowScriptReference } from "./workflow/references";
export {
	selectExecutable,
	defineScriptReference,
	defineWorkflowReference,
	defineExecutableAlternatives,
} from "./workflow/references";
