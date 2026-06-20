import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import { AutomationContext } from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { AutomationsRepository } from "./repository";
import { executeSubscriptionExecution } from "./subscription-execution-workflow";

/**
 * Lifecycle subscription dispatcher. Call sites must be workflow-body-only:
 * these functions start durable child workflows, so invoking them from a
 * service method, repository, or an Activity `execute` body breaks the
 * one-durable-owner model and can duplicate runs on replay. Services return
 * mutation envelopes; the owning workflow body dispatches from them.
 * See modules/automations/AGENTS.md ("Write-path ownership").
 */

const LifecycleAutomationContext = Schema.Struct({
	...AutomationContext.omit("operation", "ruleId").fields,
	operation: Schema.Literal("create", "update", "delete"),
});

export const LifecycleOccurrence = Schema.Struct({
	userId: Schema.NullOr(UserId),
	correlationId: Schema.String,
	automation: LifecycleAutomationContext,
	target: Schema.Union(
		Schema.Struct({ kind: Schema.Literal("entity"), schemaId: EntitySchemaId }),
		Schema.Struct({ kind: Schema.Literal("event"), schemaId: EventSchemaId }),
		Schema.Struct({ kind: Schema.Literal("relationship"), schemaId: RelationshipSchemaId }),
	),
});

export type LifecycleOccurrence = typeof LifecycleOccurrence.Type;

const dispatchResolvedLifecycleSubscriptions = Effect.fn("dispatchResolvedLifecycleSubscriptions")(
	function* (input: LifecycleOccurrence, rules: ReadonlyArray<{ id: AutomationRuleId }>) {
		const engine = yield* WorkflowEngine;
		for (const rule of rules) {
			const executionId = `lifecycle-subscription-${input.automation.occurrenceId}-${rule.id}`;
			yield* executeSubscriptionExecution(engine, {
				executionId,
				ruleId: rule.id,
				executionUserId: input.userId,
				correlationId: input.correlationId,
				automation: { ...input.automation, ruleId: rule.id },
			});
		}
	},
);

const resolveLifecycleSubscriptions = Effect.fn("resolveLifecycleSubscriptions")(function* (
	input: LifecycleOccurrence,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* AutomationsRepository;
	return yield* runWithDb(
		repository.listLifecycleSubscriptions({
			...input.target,
			userId: input.userId,
			operation: input.automation.operation,
		}),
	);
});

export const dispatchLifecycleSubscriptions = Effect.fn("dispatchLifecycleSubscriptions")(
	function* (input: LifecycleOccurrence) {
		const engine = yield* WorkflowEngine;
		const rules = yield* Activity.make({
			error: DbError,
			success: Schema.Array(Schema.Struct({ id: AutomationRuleId })),
			name: `resolve-lifecycle-subscriptions-${input.automation.occurrenceId}`,
			execute: resolveLifecycleSubscriptions(input),
		});
		yield* dispatchResolvedLifecycleSubscriptions(input, rules).pipe(
			Effect.provideService(WorkflowEngine, engine),
		);
	},
);
