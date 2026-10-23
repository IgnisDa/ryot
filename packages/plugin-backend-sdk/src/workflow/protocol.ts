import { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import { SANDBOX_FAILURE_KINDS } from "@ryot-app/contract/modules/scripts/wire";
import type { Effect as RuntimeEffect } from "@ryot-app/plugin-backend-sdk/effect";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { sandboxHostCapabilitySchema } from "../core/capabilities";
import {
	jsonValueSchema,
	type SandboxHostError,
	sandboxHostErrorSchema,
	strictStruct,
} from "../wire";

const durableCallFields = {
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	index: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
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
		args: Schema.Array(jsonValueSchema),
		capability: sandboxHostCapabilitySchema,
	}),
});
export const workflowInlineRequestSchema = Schema.Union([
	workflowSleepRequestSchema,
	workflowHostRequestSchema,
]);
export type WorkflowInlineRequest = Schema.Schema.Type<typeof workflowInlineRequestSchema>;
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
		journalLength: durableCallFields.index,
		requests: Schema.Array(workflowDurableCallRequestSchema),
	}),
	strictStruct({
		output: jsonValueSchema,
		state: Schema.Literal("completed"),
		journalLength: durableCallFields.index,
		requests: Schema.Array(workflowDurableCallRequestSchema),
	}),
	strictStruct({
		error: Schema.String,
		state: Schema.Literal("failed"),
		journalLength: durableCallFields.index,
		data: Schema.optionalKey(SandboxBoundaryReason),
		kind: Schema.Literals([...SANDBOX_FAILURE_KINDS]),
		requests: Schema.Array(workflowDurableCallRequestSchema),
	}),
]);
export type WorkflowReplayEnvelope = Schema.Schema.Type<typeof workflowReplayEnvelopeSchema>;

export type WorkflowReplayJournal = {
	readonly length: number;
	readonly read: (
		index: number,
	) => RuntimeEffect.Effect<WorkflowReplayJournalEntry, SandboxHostError>;
};

export type WorkflowReplayHost = {
	readonly replayJournal: () => RuntimeEffect.Effect<WorkflowReplayJournal, SandboxHostError>;
	readonly settleInline: (
		requests: ReadonlyArray<Schema.Schema.Type<typeof workflowSleepRequestSchema>>,
	) => RuntimeEffect.Effect<
		ReadonlyArray<WorkflowReplayJournalEntry["value"]> | null,
		SandboxHostError
	>;
};

export const workflowDurableResultSchema = Schema.Union([
	strictStruct({ value: jsonValueSchema, state: Schema.Literal("success") }),
	strictStruct({ error: sandboxHostErrorSchema, state: Schema.Literal("failure") }),
]);
export type WorkflowDurableResult = Schema.Schema.Type<typeof workflowDurableResultSchema>;
