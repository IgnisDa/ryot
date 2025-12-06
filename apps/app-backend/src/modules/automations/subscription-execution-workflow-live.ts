import { Activity } from "@effect/workflow";
import { DbError } from "@ryot/contract/errors";
import type { SubscriptionExecutionPayload } from "@ryot/contract/modules/automations/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

import { AutomationsRepository } from "./repository";
import { SubscriptionExecutionWorkflow } from "./subscription-execution-workflow";

const PreparedSubscription = Schema.Union(
	Schema.Struct({ kind: Schema.Literal("skipped") }),
	Schema.Struct({
		scriptId: SandboxScriptId,
		kind: Schema.Literal("ready"),
		capabilityCeiling: Schema.Array(Schema.String),
		metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	}),
);

const prepare = (payload: SubscriptionExecutionPayload) =>
	Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const runInTransaction = yield* TransactionRunner;
		const prepared = yield* runInTransaction(
			repository.prepareSubscriptionRun({
				runId: payload.runId,
				ruleId: payload.ruleId,
				automation: payload.automation,
				correlationId: payload.correlationId,
				executionUserId: payload.executionUserId,
			}),
		);
		if (prepared.kind !== "created" && prepared.kind !== "resumable") {
			return { kind: "skipped" as const };
		}
		return {
			kind: "ready" as const,
			metadata: prepared.metadata,
			capabilityCeiling: prepared.capabilityCeiling,
			scriptId: SandboxScriptId.make(prepared.scriptId),
		};
	});

const markRunning = (runId: string) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* AutomationsRepository;
		return yield* runWithDb(repository.markRunRunning(runId));
	});

const complete = (
	runId: string,
	result: {
		value: unknown;
		error: string | null;
		logs: ReadonlyArray<string>;
		timing?: { totalMs: number; executionMs: number } | undefined;
		scriptAudit?: { hash: string; updatedAt: string } | undefined;
	},
) =>
	Effect.gen(function* () {
		const repository = yield* AutomationsRepository;
		const runWithDb = yield* DbRunner;
		yield* runWithDb(repository.completeSubscriptionRun({ runId, ...result }));
	});

export const runSubscriptionExecutionWorkflow = Effect.fn("runSubscriptionExecutionWorkflow")(
	function* (payload: SubscriptionExecutionPayload) {
		const prepared = yield* Activity.make({
			error: DbError,
			execute: prepare(payload),
			success: PreparedSubscription,
			name: "prepare-subscription-run",
		});
		if (prepared.kind === "skipped") {
			return { status: "skipped" as const };
		}

		const canRun = yield* Activity.make({
			error: DbError,
			success: Schema.Boolean,
			execute: markRunning(payload.runId),
			name: "mark-subscription-run-running",
		});
		if (!canRun) {
			return { status: "skipped" as const };
		}

		const result = yield* RunSandboxWorkflow.execute({
			driverName: "subscription",
			scriptId: prepared.scriptId,
			executionKind: "subscription",
			userId: payload.executionUserId,
			executionId: `${payload.executionId}-sandbox`,
			capabilityCeiling: prepared.capabilityCeiling,
			context: { automation: payload.automation, rule: { metadata: prepared.metadata } },
			automationRun: {
				runId: payload.runId,
				correlationId: payload.correlationId,
				occurrenceAt: payload.automation.committedAt,
				automationDepth: payload.automation.automationDepth,
			},
		});

		yield* Activity.make({
			error: DbError,
			success: Schema.Void,
			name: "complete-subscription-run",
			execute: complete(payload.runId, result),
		});
		return { status: result.error === null ? ("succeeded" as const) : ("failed" as const) };
	},
);

const SubscriptionExecutionWorkflowLive = SubscriptionExecutionWorkflow.toLayer((payload) =>
	runSubscriptionExecutionWorkflow(payload),
);

export const SubscriptionExecutionWorkflowDefinitionsLive = Layer.mergeAll(
	SubscriptionExecutionWorkflowLive,
);
