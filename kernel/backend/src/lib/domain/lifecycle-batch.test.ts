import {
	AutomationPopulationContext,
	AutomationRelationshipChangePayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";

import { lifecycleBatchTriggers } from "./lifecycle-batch";
import { rootLifecycleCommand } from "./lifecycle-command";

const command = rootLifecycleCommand({
	source: "api",
	lane: "interactive",
	itemIdentity: "population",
	occurredAt: "2026-09-15T00:00:00.000Z",
	executionId: AutomationExecutionId.make("execution-1"),
	initiator: { kind: "user", id: UserId.make("user-1") },
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
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

const creditChange = (index: number, withPopulation = false) => ({
	scopeUserId: UserId.make("user-1"),
	payload: Schema.decodeSync(AutomationRelationshipChangePayload)({
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
});

describe("lifecycle batch triggers", () => {
	it("splits a write into replay-stable chunks that fit the sandbox input budget", () => {
		const changes = Array.from({ length: 200 }, (_, index) => creditChange(index));
		const input = { command, identity: ["credits"], resource: "relationship" } as const;
		const triggers = lifecycleBatchTriggers(input, 200, changes);
		const items = triggers.flatMap(({ payload }): ReadonlyArray<unknown> =>
			payload?.operation === "batch" ? payload.items : [],
		);
		expect(triggers.length).toBeGreaterThan(1);
		expect(items).toEqual(changes.map(({ payload }) => payload));
		for (const { payload } of triggers) {
			expect(JSON.stringify(payload).length).toBeLessThanOrEqual(
				SANDBOX_LIMITS.execution.contextBytes / 2,
			);
		}
		expect(lifecycleBatchTriggers(input, 200, changes).map(({ id }) => id)).toEqual(
			triggers.map(({ id }) => id),
		);
		expect(lifecycleBatchTriggers(input, 3, changes).length).toBeGreaterThan(triggers.length);
	});

	it("keeps a single-item batch the size of its item trigger when the write carries population", () => {
		const change = creditChange(0, true);
		const [trigger] = lifecycleBatchTriggers(
			{ identity: ["seasons"], resource: "relationship", command: { ...command, population } },
			200,
			[change],
		);
		expect(
			JSON.stringify(trigger?.payload).length - JSON.stringify(change.payload).length,
		).toBeLessThan(100);
	});
});
