import type { PgClient } from "@effect/sql-pg";
import {
	AutomationTrigger,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect, Option, Schema } from "effect";

import {
	LifecyclePersistenceError,
	type LifecyclePlan,
	type LifecyclePlanner,
} from "#lib/domain/lifecycle";
import { lifecycleBatchTriggers } from "#lib/domain/lifecycle-batch";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";

export const withLifecycleBatchPlanning = (
	planner: Omit<LifecyclePlanner["Service"], "planBatch">,
	maxItems = 200,
): LifecyclePlanner["Service"] => ({
	...planner,
	planBatch: (input) =>
		Effect.forEach(lifecycleBatchTriggers(input, maxItems), (trigger) => planner.plan({ trigger })),
});

export const withLifecycleDispatch = (
	execution: Omit<LifecycleExecution["Service"], "dispatch">,
	client?: PgClient.PgClient,
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
					client === undefined
						? Effect.succeed(warnings)
						: Effect.serviceOption(client.transactionService).pipe(
								Effect.flatMap((active) =>
									Option.isSome(active)
										? new LifecyclePersistenceError({ code: "postcommit-requires-root" })
										: Effect.succeed(warnings),
								),
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
			parentTriggerId: null,
			importRunId: "import",
			executionId: "command",
			rootExecutionId: "command",
			integrationId: "integration",
			providerExecutionId: "provider",
			initiator: { id: "owner", kind: "user" },
		},
	});
