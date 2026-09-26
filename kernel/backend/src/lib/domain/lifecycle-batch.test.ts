import {
	AutomationPopulationContext,
	AutomationRelationshipChangePayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";

import type { LifecyclePlan } from "./lifecycle";
import { lifecycleBatchTriggers } from "./lifecycle-batch";
import { lifecycleTrigger, rootLifecycleCommand } from "./lifecycle-command";

const command = rootLifecycleCommand({
	source: "api",
	itemIdentity: "population",
	occurredAt: "2026-09-15T00:00:00.000Z",
	executionId: AutomationExecutionId.make("execution-1"),
	initiator: { kind: "user", id: UserId.make("user-1") },
});

const population = Schema.decodeSync(AutomationPopulationContext)({
	rootPreviouslyPopulated: true,
	scopeEntity: { id: "show-1", name: "Show", entitySchemaSlug: "show" },
	parentEntity: {
		name: "Show",
		entitySchemaSlug: "show",
		properties: { images: "x".repeat(40_000) },
	},
});

const creditPlan = (index: number, withPopulation = false): LifecyclePlan => ({
	runs: [],
	policies: [],
	wasCreated: true,
	trigger: lifecycleTrigger(
		{ ...command, itemIdentity: `credit-${index}` },
		UserId.make("user-1"),
		Schema.decodeSync(AutomationRelationshipChangePayload)({
			category: "change",
			operation: "create",
			resource: "relationship",
			after: {
				targetEntityId: "movie-1",
				id: `relationship-${index}`,
				sourceEntityId: `person-${index}`,
				createdAt: "2026-09-15T00:00:00.000Z",
				updatedAt: "2026-09-15T00:00:00.000Z",
				relationshipSchemaSlug: "person-to-movie",
				properties: { biography: "x".repeat(1_000) },
			},
			...(withPopulation ? { population } : {}),
		}),
	),
});

describe("lifecycle batch triggers", () => {
	it("splits a write into replay-stable chunks that fit the sandbox input budget", () => {
		const plans = Array.from({ length: 200 }, (_, index) => creditPlan(index));
		const input = { plans, command, identity: ["credits"], resource: "relationship" } as const;
		const triggers = lifecycleBatchTriggers(input, 200);
		const items = triggers.flatMap(({ payload }): ReadonlyArray<unknown> =>
			payload?.operation === "batch" ? payload.items : [],
		);
		expect(triggers.length).toBeGreaterThan(1);
		expect(items).toEqual(plans.map(({ trigger }) => trigger.payload));
		for (const { payload } of triggers) {
			expect(JSON.stringify(payload).length).toBeLessThanOrEqual(
				SANDBOX_LIMITS.execution.contextBytes / 2,
			);
		}
		expect(lifecycleBatchTriggers(input, 200).map(({ id }) => id)).toEqual(
			triggers.map(({ id }) => id),
		);
		expect(lifecycleBatchTriggers(input, 3).length).toBeGreaterThan(triggers.length);
	});

	it("keeps a single-item batch the size of its item trigger when the write carries population", () => {
		const plan = creditPlan(0, true);
		const [trigger] = lifecycleBatchTriggers(
			{
				plans: [plan],
				identity: ["seasons"],
				resource: "relationship",
				command: { ...command, population },
			},
			200,
		);
		expect(
			JSON.stringify(trigger?.payload).length - JSON.stringify(plan.trigger.payload).length,
		).toBeLessThan(100);
	});
});
