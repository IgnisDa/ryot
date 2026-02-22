import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { EntityId, SignalId, SignalSchemaId, UserId } from "@ryot/contract/schema/brands";
import { type Context, DateTime, Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { AutomationsRepository } from "./repository";
import { AutomationsService, type EmitSignalInput } from "./service";
import { executeSubscriptionExecution } from "./subscription-execution-workflow";

/**
 * Signal subscription dispatcher and combined emit-and-dispatch helper. Call
 * sites must be workflow-body-only or durable-queue-worker-body-only: these
 * functions start durable child workflows, so invoking them from a service
 * method, repository, or an Activity `execute` body breaks the
 * one-durable-owner model and can duplicate runs on replay. Persistence stays
 * in `AutomationsService.emitSignal` (its own transaction); the owning workflow
 * or queue-worker body performs the dispatch.
 * See modules/automations/AGENTS.md ("Write-path ownership").
 */

export const dispatchSignalSubscriptions = Effect.fn("dispatchSignalSubscriptions")(function* (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	signalId: SignalId,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* AutomationsRepository;
	const dispatches = yield* runWithDb(repository.listSignalDispatches(signalId));
	yield* Effect.forEach(
		dispatches,
		(dispatch) => {
			const executionId = `signal-subscription-${dispatch.signalId}-${dispatch.ruleId}`;
			return executeSubscriptionExecution(engine, {
				executionId,
				ruleId: dispatch.ruleId,
				executionUserId: dispatch.userId,
				correlationId: dispatch.correlationId ?? dispatch.signalId,
				automation: {
					operation: "signal",
					ruleId: dispatch.ruleId,
					origin: dispatch.origin,
					occurrenceId: dispatch.signalId,
					automationDepth: dispatch.automationDepth + 1,
					committedAt: DateTime.unsafeMake(dispatch.createdAt),
					source: {
						kind: "signal",
						signal: {
							origin: dispatch.origin,
							properties: dispatch.properties,
							id: SignalId.make(dispatch.signalId),
							createdAt: DateTime.unsafeMake(dispatch.createdAt),
							occurredAt: DateTime.unsafeMake(dispatch.occurredAt),
							actorUserId: dispatch.actorUserId ? UserId.make(dispatch.actorUserId) : null,
							subjectEntityId: dispatch.subjectEntityId
								? EntityId.make(dispatch.subjectEntityId)
								: null,
							schema: {
								name: dispatch.signalSchemaName,
								slug: dispatch.signalSchemaSlug,
								id: SignalSchemaId.make(dispatch.signalSchemaId),
							},
						},
					},
				},
			});
		},
		{ concurrency: "unbounded" },
	);
	return { count: dispatches.length };
});

/**
 * The single call producers make: persist the signal (audience authorization,
 * trusted-principal checks, recipient snapshot, deterministic id and dedup all
 * live in `AutomationsService.emitSignal`) and dispatch its subscriptions.
 *
 * Dispatch is issued unconditionally, including on a duplicate emission. A
 * duplicate returns the existing signal without re-resolving its recipients,
 * but the persisted recipient snapshot still yields the same dispatches, and
 * `dispatchSignalSubscriptions` uses deterministic `signal-subscription-<signalId>-<ruleId>`
 * child execution IDs that the workflow engine dedups. Re-dispatch is therefore
 * idempotent, and it is required for recovery: if a producer crashes after the
 * signal row commits but before dispatch completes, the replay sees a duplicate
 * and must still re-issue the children (otherwise the subscription runs are lost).
 */
export const emitAndDispatchSignal = Effect.fn("emitAndDispatchSignal")(function* (
	engine: Context.Tag.Service<typeof WorkflowEngine>,
	input: EmitSignalInput,
) {
	const automations = yield* AutomationsService;
	const emitted = yield* automations.emitSignal(input);
	yield* dispatchSignalSubscriptions(engine, SignalId.make(emitted.signal.id));
	return emitted;
});
