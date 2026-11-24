import {
	AutomationPolicyBatchInput,
	type AutomationPolicyOutput,
	AutomationRun,
	AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	ImportRunId,
	IntegrationId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Layer, Schema } from "effect";

import { lifecycleBatchTriggers } from "#modules/automations/lifecycle/batch";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	LifecyclePersistenceError,
	type LifecyclePlan,
	type LifecyclePlanner,
	type LifecyclePlanningResult,
	LifecycleWork,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import {
	AutomationPolicyExecutionError,
	LifecyclePolicies,
	type LifecyclePolicy,
	type LifecyclePolicyItem,
} from "#modules/automations/lifecycle/policies";
import { scriptCallResult, scriptCallsLayer } from "#modules/scripts/executions/calls.test-support";
import type { DatabaseSession } from "#platform/db/session";

import { LifecyclePoliciesServiceLive } from "./layer";

export const noLifecycleWorkLayer = Layer.succeed(LifecycleWork, {
	derive: () => Effect.succeed([]),
});

export const noHooksFixture = (): Extract<LifecyclePlanningResult, { _tag: "NoHooks" }> => ({
	runs: [],
	trigger: null,
	_tag: "NoHooks",
	wasCreated: false,
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
	const recordPlan = (input: Parameters<LifecyclePlanner["Service"]["plan"]>[0]) =>
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
		);
	return {
		plan: recordPlan,
		lockCatalog: () => Effect.void,
		recordBatchChange: () => Effect.void,
		prepareBatch: (_transaction, input) =>
			Effect.succeed({
				hasCandidates,
				id: stableStringify([input.command.itemIdentity, ...input.identity]),
			}),
		planChange: (input, transaction) =>
			Effect.map(recordPlan({ ...input, transaction }), (result) =>
				result.trigger === null ? [] : [toLifecycleDispatchPlan(result)],
			),
		planChanges: (triggers, transaction) =>
			Effect.forEach(triggers, (trigger) =>
				Effect.map(recordPlan({ trigger, transaction }), (result) =>
					result.trigger === null ? [] : [toLifecycleDispatchPlan(result)],
				),
			),
		planBatch: (transaction, input) =>
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
							.plan({ trigger, transaction })
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
	observer: {
		readonly after: (plan: {
			readonly runs: LifecycleDispatchPlan["runs"];
			readonly triggerId: LifecycleDispatchPlan["triggerId"];
		}) => Effect.Effect<unknown>;
	},
	session?: DatabaseSession["Service"],
): LifecycleExecution["Service"] =>
	LifecycleExecution.of({
		dispatch: (plans) =>
			Effect.gen(function* () {
				if (session !== undefined) {
					yield* session.requireRoot.pipe(
						Effect.mapError(
							() => new LifecyclePersistenceError({ code: "postcommit-requires-root" }),
						),
					);
				}
				yield* Effect.forEach(
					plans,
					(plan) => observer.after({ runs: plan.runs, triggerId: plan.triggerId }),
					{ discard: true },
				);
			}),
	});

export const noPoliciesLayer = Layer.succeed(LifecyclePolicies, {
	match: () => Effect.succeed([]),
	run: () => Effect.die("Unexpected policy"),
});

export const policyFixture = (
	index: number,
	targets: LifecyclePolicy["hook"]["targets"],
	executionUserId: null | UserId = null,
): LifecyclePolicy => ({
	position: index,
	executionUserId,
	pluginId: PluginId.make("policy-plugin"),
	runId: AutomationRunId.make(`policy-${index}`),
	hook: { targets, name: "Policy", stage: "before", scriptSlug: "policy", slug: `policy-${index}` },
	script: { slug: "policy", contentHash: "policy-hash", id: SandboxScriptId.make("policy-script") },
	plugin: {
		revisionId: PluginRevisionId.make("policy-revision"),
		configRevisionId: PluginConfigRevisionId.make("policy-config"),
	},
});

/** Matches policies with `match` and decides each item with `decide`, without a sandbox. */
export const decidingPolicies = <E>(
	match: LifecyclePolicies["Service"]["match"],
	decide: (
		item: LifecyclePolicyItem,
		policy: LifecyclePolicy,
	) => Effect.Effect<AutomationPolicyOutput, E>,
): LifecyclePolicies["Service"] =>
	LifecyclePolicies.of({
		match,
		run: ({ items, policy }) =>
			Effect.forEach(items, (item) =>
				Effect.map(decide(item, policy), (decision) => ({
					decision,
					itemIdentity: item.itemIdentity,
				})),
			).pipe(
				Effect.mapBoth({
					onSuccess: (decided) => ({ items: decided }),
					onFailure: () =>
						new AutomationPolicyExecutionError({
							runId: policy.runId,
							kind: "script-failure",
							code: "policy-execution-failed",
						}),
				}),
			),
	});

/** Real policy matching and preparation, with each policy call decided by `decide`. */
export const decidedPoliciesLayer = (
	decide: (
		item: AutomationPolicyBatchInput["items"][number],
		input: AutomationPolicyBatchInput,
	) => Effect.Effect<AutomationPolicyOutput> = () => Effect.succeed({ action: "allow" }),
) =>
	LifecyclePoliciesServiceLive.pipe(
		Layer.provide(
			scriptCallsLayer((call) =>
				Effect.gen(function* () {
					const input = yield* Schema.decodeUnknownEffect(AutomationPolicyBatchInput)(
						call.input,
					).pipe(Effect.orDie);
					const items = yield* Effect.forEach(input.items, (item) =>
						Effect.map(decide(item, input), (decision) => ({
							decision,
							itemIdentity: item.itemIdentity,
						})),
					);
					return scriptCallResult({ items });
				}),
			),
		),
	);

export const planFixture = (id: string): LifecyclePlan => ({
	runs: [],
	wasCreated: true,
	trigger: triggerFixture(id),
});

export const queuedRunFixture = (id: string) =>
	AutomationRun.make({
		pluginId: null,
		attemptCount: 0,
		startedAt: null,
		status: "queued",
		finishedAt: null,
		skipReason: null,
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
