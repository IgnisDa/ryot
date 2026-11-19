import { DbError } from "@ryot-app/contract/errors";
import type { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Cause, Context, Effect, Layer } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePersistenceError } from "#modules/automations/lifecycle/planning";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";

import { automationAttemptIdentity } from "./attempt-repository";
import { AutomationRunJob, type AutomationRunPayload } from "./run-job";
import { AutomationRunRepository } from "./run-repository";

const AUTOMATION_IMMEDIATE_TIMEOUT_SLACK_MS = 5_000;
export const AUTOMATION_IMMEDIATE_TIMEOUT_MS =
	SANDBOX_LIMITS.execution.timeoutMs + AUTOMATION_IMMEDIATE_TIMEOUT_SLACK_MS;
export const AUTOMATION_IMMEDIATE_CONCURRENCY = 8;

type AutomationDispatchState = "fresh" | "closed" | "claimed";

type AutomationDispatch = { readonly state: AutomationDispatchState };

const dispatchStateOf = (
	row: undefined | { readonly status: string; readonly attemptCount: number },
): AutomationDispatchState => {
	if (!row || (row.attemptCount === 0 && row.status !== "queued")) {
		return "closed";
	}
	return row.attemptCount > 0 ? "claimed" : "fresh";
};

const runUnavailable = () => new DbError({ message: "Automation run is unavailable" });

const rootTransactionRequired = () =>
	new DbError({ message: "Automation admission requires a root transaction" });

export class AutomationExecutionOperations extends Context.Service<
	AutomationExecutionOperations,
	{
		submit: (payload: AutomationRunPayload) => Effect.Effect<void, DbError>;
		dispatchStates: (
			runIds: ReadonlyArray<AutomationRunId>,
		) => Effect.Effect<ReadonlyMap<AutomationRunId, AutomationDispatch>, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/execution/AutomationExecutionOperations") {}

export const AutomationExecutionOperationsLive = Layer.effect(
	AutomationExecutionOperations,
	Effect.gen(function* () {
		const runs = yield* AutomationRunRepository;
		const jobs = yield* JobQueue;
		const session = yield* DatabaseSession;
		const admission = yield* AccountAdmission.make;
		return AutomationExecutionOperations.of({
			dispatchStates: (runIds) =>
				runs.listDispatchStates(runIds).pipe(
					Effect.map((rows) => {
						const rowsById = new Map(
							rows.map((row): [string, (typeof rows)[number]] => [row.id, row]),
						);
						return new Map(
							runIds.map((runId): [AutomationRunId, AutomationDispatch] => {
								const row = rowsById.get(runId);
								return [runId, { state: dispatchStateOf(row) }];
							}),
						);
					}),
				),
			submit: (payload) =>
				session
					.transaction(
						Effect.gen(function* () {
							const run = yield* runs.findById(payload.runId);
							if (!run) {
								return yield* runUnavailable();
							}
							if (run.executionUserId !== null) {
								yield* admission.admitAccount(yield* admission.currentAccount(run.executionUserId));
							}
							return yield* jobs.enqueue(AutomationRunJob, payload, {
								key: automationAttemptIdentity(payload.runId, payload.attemptNumber).executionId,
								...(run.executionUserId === null ? {} : { userId: run.executionUserId }),
							});
						}),
					)
					.pipe(
						Effect.asVoid,
						Effect.catchTags({
							SchemaError: Effect.die,
							DatabaseSessionStateError: rootTransactionRequired,
						}),
					),
		});
	}),
);

export const LifecycleExecutionLive = Layer.effect(
	LifecycleExecution,
	Effect.gen(function* () {
		const operations = yield* AutomationExecutionOperations;
		const session = yield* DatabaseSession;
		const submitFresh = (payload: AutomationRunPayload) =>
			operations.submit(payload).pipe(
				Effect.catchCauseIf(
					(cause) => !Cause.hasInterruptsOnly(cause),
					(cause) => Effect.logWarning("automation run submission failed", cause),
				),
			);
		return LifecycleExecution.of({
			dispatch: Effect.fn("LifecycleExecution.dispatch")(function* (plans) {
				yield* session.requireRoot.pipe(
					Effect.mapError(
						() => new LifecyclePersistenceError({ code: "postcommit-requires-root" }),
					),
				);
				const payloads = plans.flatMap((plan) =>
					plan.runs.flatMap((run) =>
						run.triggerId === plan.triggerId && run.status !== "skipped"
							? [{ runId: run.id, attemptNumber: 1 }]
							: [],
					),
				);
				if (payloads.length === 0) {
					return;
				}
				const states = yield* operations.dispatchStates(payloads.map(({ runId }) => runId)).pipe(
					Effect.catchCauseIf(
						(cause) => !Cause.hasInterruptsOnly(cause),
						(cause) =>
							Effect.logWarning("automation dispatch state read failed", cause).pipe(
								Effect.as(new Map<AutomationRunId, AutomationDispatch>()),
							),
					),
				);
				yield* Effect.forEach(
					payloads.filter((payload) => states.get(payload.runId)?.state === "fresh"),
					submitFresh,
					{ discard: true, concurrency: AUTOMATION_IMMEDIATE_CONCURRENCY },
				);
			}),
		});
	}),
);
