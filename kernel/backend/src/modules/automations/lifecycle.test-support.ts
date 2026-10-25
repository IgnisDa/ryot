import {
	AutomationRun,
	AutomationTrigger,
	type AutomationWarning,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	ImportRunId,
	IntegrationId,
	type PluginId,
	SandboxScriptId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Layer } from "effect";

import { lifecycleBatchTriggers } from "#modules/automations/lifecycle/batch";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	LifecyclePersistenceError,
	type LifecyclePlan,
	type LifecyclePlanner,
	type LifecyclePlanningResult,
	LifecycleWork,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import type { DatabaseSession } from "#platform/db/session";

export const noLifecycleWorkLayer = Layer.succeed(LifecycleWork, {
	dispatch: () => Effect.void,
	admit: () => Effect.succeed([]),
});

export const noHooksFixture = (): Extract<LifecyclePlanningResult, { _tag: "NoHooks" }> => ({
	runs: [],
	policies: [],
	trigger: null,
	_tag: "NoHooks",
	wasCreated: false,
	backgroundJobIds: [],
});

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
					yield* lifecycleBatchTriggers(input, maxItems, relevant),
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
	execution: Omit<LifecycleExecution["Service"], "dispatch" | "executeBatchPolicy">,
	session?: DatabaseSession["Service"],
): LifecycleExecution["Service"] =>
	LifecycleExecution.of({
		...execution,
		executeBatchPolicy: () => Effect.die("Unexpected batch policy"),
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
	backgroundJobIds: [],
	trigger: triggerFixture(id),
});

export const queuedRunFixture = (id: string) =>
	AutomationRun.make({
		stage: "after",
		pluginId: null,
		attemptCount: 0,
		startedAt: null,
		status: "queued",
		finishedAt: null,
		skipReason: null,
		delivery: "async",
		hookName: "Fixture",
		nextAttemptAt: null,
		executionUserId: null,
		scriptSlug: "fixture",
		pluginRevisionId: null,
		id: AutomationRunId.make(id),
		pluginConfigRevisionId: null,
		scriptContentHash: "fixture-hash",
		queuedAt: "2026-09-15T00:00:00.000Z",
		hookSlug: AutomationHookSlug.make("fixture"),
		retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
		artifactsExpireAt: "2026-09-22T00:00:00.000Z",
		triggerId: AutomationTriggerId.make("trigger-test"),
		sandboxScriptId: SandboxScriptId.make("fixture-script"),
	});

export const triggerFixture = (id = "trigger-test", signalSchemaPluginId: null | PluginId = null) =>
	AutomationTrigger.make({
		scopeUserId: null,
		blockedReason: null,
		payloadPrunedAt: null,
		id: AutomationTriggerId.make(id),
		createdAt: "2026-09-15T00:00:00.000Z",
		occurredAt: "2026-09-15T00:00:00.000Z",
		kind: { operation: "emit", category: "signal", resource: "signal" },
		payload: {
			operation: "emit",
			category: "signal",
			resource: "signal",
			signalSchemaPluginId,
			actorUserId: UserId.make("owner"),
			properties: { nested: { a: 1, b: 2 } },
			signalSchemaSlug: SignalSchemaSlug.make("fixture.signal"),
		},
		causation: {
			depth: 0,
			source: "api",
			parentRunId: null,
			lane: "interactive",
			parentTriggerId: null,
			importRunId: ImportRunId.make("import"),
			integrationId: IntegrationId.make("integration"),
			executionId: AutomationExecutionId.make("command"),
			initiator: { kind: "user", id: UserId.make("owner") },
			rootExecutionId: AutomationExecutionId.make("command"),
			providerExecutionId: AutomationExecutionId.make("provider"),
		},
	});
