import { expect, it } from "@effect/vitest";
import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import definition, { manifest } from "./ensure-fitness-library-membership.sandbox";

const timestamp = "2026-07-20T10:00:00.000Z";

const automationInput = (payload: unknown) =>
	Schema.decodeUnknownEffect(automationInputSchema)({
		automation: {
			payload,
			runId: "run-1",
			occurredAt: timestamp,
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.ensure-fitness-library-membership",
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				lane: "interactive",
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
		},
	}).pipe(Effect.orDie);

const entityCreate = (entitySchemaSlug: string) =>
	automationInput({
		category: "change",
		resource: "entity",
		operation: "create",
		after: {
			properties: {},
			id: "exercise-1",
			externalId: null,
			providerId: null,
			entitySchemaSlug,
			populatedAt: null,
			name: "Bench Press",
			createdAt: timestamp,
			updatedAt: timestamp,
			entitySchemaPluginId: "fitness-owner",
		},
	});

const providerImport = (entitySchemaSlug: string) =>
	automationInput({
		userId: "user-1",
		entitySchemaSlug,
		category: "change",
		operation: "complete",
		entityId: "exercise-1",
		providerId: "provider-1",
		externalId: "bench-press",
		resource: "provider-entity-import",
		entitySchemaPluginId: "fitness-owner",
	});

const recordingHost = () => {
	const changes: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		changeUserRelationships: (batches) => {
			changes.push(batches);
			return Effect.succeed([{ created: 1, deleted: 0 }]);
		},
		executeRyotql: () =>
			Effect.succeed({
				data: {
					fitnessLibrary: {
						type: "rows" as const,
						items: [{ entityId: "library-1" }],
						pageInfo: { limit: 1, hasMore: false, nextCursor: null },
					},
				},
			}),
	});
	return { host, changes };
};

it.effect.each([
	{ label: "entity creation", input: entityCreate("exercise") },
	{ label: "provider import", input: providerImport("exercise") },
])("adds the exercise to the fitness library on $label", ({ input }) =>
	Effect.gen(function* () {
		const { host, changes } = recordingHost();
		expect(yield* definition.run(yield* input, host)).toBeNull();
		expect(changes).toEqual([
			[
				{
					deletes: [],
					creates: [
						{
							properties: {},
							propertiesMode: "merge",
							targetEntityId: "library-1",
							sourceEntityId: "exercise-1",
							relationshipSchemaSlug: "in-fitness-library",
						},
					],
				},
			],
		]);
	}),
);

it.effect("ignores entities that are not exercises", () =>
	Effect.gen(function* () {
		const { host, changes } = recordingHost();
		expect(yield* definition.run(yield* entityCreate("workout"), host)).toBeNull();
		expect(yield* definition.run(yield* providerImport("workout"), host)).toBeNull();
		expect(changes).toEqual([]);
	}),
);
