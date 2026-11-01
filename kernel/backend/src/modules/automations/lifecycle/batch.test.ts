import { describe, expect, it } from "@effect/vitest";
import {
	AutomationPopulationContext,
	AutomationRelationshipChangePayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Effect, Schema } from "effect";

import { lifecycleBatchTriggers } from "./batch";
import { rootLifecycleCommand } from "./command";

const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const command = rootLifecycleCommand({
	source: "api",
	lane: "interactive",
	itemIdentity: "population",
	occurredAt: "2026-09-15T00:00:00.000Z",
	executionId: AutomationExecutionId.make("execution-1"),
	initiator: { kind: "user", id: UserId.make("user-1") },
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
});

const population = Schema.decodeEffect(AutomationPopulationContext)({
	rootPreviouslyPopulated: true,
	scopeEntity: { id: "show-1", name: "Show", entitySchemaSlug: "show", entitySchemaPluginId: null },
	parentEntity: {
		name: "Show",
		entitySchemaSlug: "show",
		entitySchemaPluginId: null,
		properties: { images: "x".repeat(40_000) },
	},
});

const creditChange = Effect.fnUntraced(function* (index: number, withPopulation = false) {
	const payload = yield* Schema.decodeEffect(AutomationRelationshipChangePayload)({
		category: "change",
		operation: "create",
		resource: "relationship",
		after: {
			targetEntityId: "record-1",
			id: `relationship-${index}`,
			relationshipSchemaPluginId: null,
			sourceEntityId: `person-${index}`,
			createdAt: "2026-09-15T00:00:00.000Z",
			updatedAt: "2026-09-15T00:00:00.000Z",
			relationshipSchemaSlug: "person-to-record",
			properties: { biography: "x".repeat(1_000) },
		},
		...(withPopulation ? { population: yield* population } : {}),
	});
	return { payload, scopeUserId: UserId.make("user-1") };
});

describe("lifecycle batch triggers", () => {
	it.effect("splits a write into replay-stable chunks that fit the sandbox input budget", () =>
		Effect.gen(function* () {
			const changes = yield* Effect.forEach(
				Array.from({ length: 200 }, (_, index) => index),
				(index) => creditChange(index),
			);
			const input = { command, identity: ["credits"], resource: "relationship" } as const;
			const triggers = yield* lifecycleBatchTriggers(input, 200, changes);
			const items = triggers.flatMap(({ payload }): ReadonlyArray<unknown> =>
				payload?.operation === "batch" ? payload.items : [],
			);
			expect(triggers.length).toBeGreaterThan(1);
			expect(items).toEqual(changes.map(({ payload }) => payload));
			for (const { payload } of triggers) {
				expect((yield* encodeJson(payload)).length).toBeLessThanOrEqual(
					SANDBOX_LIMITS.execution.contextBytes / 2,
				);
			}
			expect((yield* lifecycleBatchTriggers(input, 200, changes)).map(({ id }) => id)).toEqual(
				triggers.map(({ id }) => id),
			);
			expect((yield* lifecycleBatchTriggers(input, 3, changes)).length).toBeGreaterThan(
				triggers.length,
			);
		}),
	);

	it.effect(
		"keeps a single-item batch the size of its item trigger when the write carries population",
		() =>
			Effect.gen(function* () {
				const change = yield* creditChange(0, true);
				const [trigger] = yield* lifecycleBatchTriggers(
					{
						identity: ["parts"],
						resource: "relationship",
						command: { ...command, population: yield* population },
					},
					200,
					[change],
				);
				expect(
					(yield* encodeJson(trigger?.payload)).length - (yield* encodeJson(change.payload)).length,
				).toBeLessThan(100);
			}),
	);
});
