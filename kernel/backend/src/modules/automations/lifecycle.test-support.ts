import {
	AutomationRun,
	AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import {
	LifecyclePersistenceError,
	type LifecyclePlan,
	type LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleBatchTriggers } from "#lib/domain/lifecycle-batch";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import type { DatabaseSession } from "#lib/infrastructure/db/session";

export const withLifecycleBatchPlanning = (
	planner: Pick<LifecyclePlanner["Service"], "plan">,
	maxItems = 200,
	hasCandidates = true,
): LifecyclePlanner["Service"] => {
	const changes: Array<{
		scopeUserId: AutomationTrigger["scopeUserId"];
		executionId: AutomationTrigger["causation"]["executionId"];
		payload: Parameters<typeof lifecycleBatchTriggers>[2][number]["payload"];
	}> = [];
	const sealed = new Map<string, ReadonlyArray<ReturnType<typeof toLifecycleDispatchPlan>>>();
	return {
		prepareBatch: (input) =>
			Effect.succeed({
				hasCandidates,
				id: stableStringify([input.command.itemIdentity, ...input.identity]),
			}),
		plan: (input) =>
			planner.plan(input).pipe(
				Effect.tap((result) => {
					const payload = input.trigger.payload;
					if (
						result.trigger !== null &&
						payload?.category === "change" &&
						payload.operation !== "batch" &&
						payload.resource !== "provider-entity-import"
					) {
						changes.push({
							payload,
							scopeUserId: input.trigger.scopeUserId,
							executionId: input.trigger.causation.executionId,
						});
					}
					return Effect.void;
				}),
			),
		planBatch: (input) =>
			Effect.gen(function* () {
				const identity = stableStringify([
					input.command.causation.executionId,
					input.command.itemIdentity,
					input.resource,
					input.identity,
				]);
				const previous = sealed.get(identity);
				if (previous) {
					return previous;
				}
				const relevant = changes
					.splice(0)
					.filter(({ executionId }) => executionId === input.command.causation.executionId);
				const planned = yield* Effect.forEach(
					lifecycleBatchTriggers(input, maxItems, relevant),
					(trigger) =>
						planner
							.plan({ trigger })
							.pipe(
								Effect.map((result) =>
									result.trigger === null ? [] : [toLifecycleDispatchPlan(result)],
								),
							),
				);
				const dispatch = planned.flat();
				sealed.set(identity, dispatch);
				return dispatch;
			}),
	};
};

export const withLifecycleDispatch = (
	execution: Omit<LifecycleExecution["Service"], "dispatch">,
	session?: DatabaseSession["Service"],
): LifecycleExecution["Service"] =>
	LifecycleExecution.of({
		...execution,
		dispatch: (plans) =>
			Effect.forEach(plans, (plan) =>
				execution
					.after({ runs: plan.runs, triggerId: plan.triggerId })
					.pipe(
						Effect.map((warnings): ReadonlyArray<AutomationWarning> => [
							...(plan.blockedReason?.hasRequiredHooks
								? [{ ...plan.blockedReason, triggerId: plan.triggerId }]
								: []),
							...warnings,
						]),
					),
			).pipe(
				Effect.map((groups) => groups.flat()),
				Effect.andThen((warnings) =>
					session === undefined
						? Effect.succeed(warnings)
						: session.requireRoot.pipe(
								Effect.mapError(
									() => new LifecyclePersistenceError({ code: "postcommit-requires-root" }),
								),
								Effect.as(warnings),
							),
				),
			),
	});

export const planFixture = (id: string): LifecyclePlan => ({
	runs: [],
	policies: [],
	wasCreated: true,
	trigger: triggerFixture(id),
});

export const queuedRunFixture = (id: string) =>
	Schema.decodeSync(AutomationRun)({
		id,
		stage: "after",
		pluginId: null,
		attemptCount: 0,
		startedAt: null,
		status: "queued",
		finishedAt: null,
		skipReason: null,
		delivery: "async",
		hookSlug: "fixture",
		hookName: "Fixture",
		nextAttemptAt: null,
		executionUserId: null,
		scriptSlug: "fixture",
		pluginRevisionId: null,
		triggerId: "trigger-test",
		pluginConfigRevisionId: null,
		sandboxScriptId: "fixture-script",
		scriptContentHash: "fixture-hash",
		queuedAt: "2026-09-15T00:00:00.000Z",
		retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
		artifactsExpireAt: "2026-09-22T00:00:00.000Z",
	});

export const triggerFixture = (id = "trigger-test", signalSchemaPluginId: PluginId | null = null) =>
	Schema.decodeSync(AutomationTrigger)({
		id,
		scopeUserId: null,
		blockedReason: null,
		payloadPrunedAt: null,
		createdAt: "2026-09-15T00:00:00.000Z",
		occurredAt: "2026-09-15T00:00:00.000Z",
		kind: { operation: "emit", category: "signal", resource: "signal" },
		payload: {
			operation: "emit",
			category: "signal",
			resource: "signal",
			actorUserId: "owner",
			signalSchemaPluginId,
			signalSchemaSlug: "fixture.signal",
			properties: { nested: { a: 1, b: 2 } },
		},
		causation: {
			depth: 0,
			source: "api",
			parentRunId: null,
			lane: "interactive",
			parentTriggerId: null,
			importRunId: "import",
			executionId: "command",
			rootExecutionId: "command",
			integrationId: "integration",
			providerExecutionId: "provider",
			initiator: { id: "owner", kind: "user" },
		},
	});
