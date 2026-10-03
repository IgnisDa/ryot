import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./ensure-fitness-library-membership.sandbox";

const timestamp = "2026-07-20T10:00:00.000Z";

const automationInput = (payload: unknown) =>
	Schema.decodeUnknownSync(automationInputSchema)({
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
	});

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

it.each([
	["entity creation", entityCreate("exercise")],
	["provider import", providerImport("exercise")],
])("adds the exercise to the fitness library on %s", (_label, input) => {
	const { host, changes } = recordingHost();
	return Effect.runPromise(
		definition.run(input, host).pipe(
			Effect.map((result) => {
				expect(result).toBeNull();
				expect(changes).toEqual([
					[
						{
							deletes: [],
							creates: [
								{
									properties: {},
									targetEntityId: "library-1",
									sourceEntityId: "exercise-1",
									relationshipSchemaSlug: "in-fitness-library",
								},
							],
						},
					],
				]);
			}),
		),
	);
});

it("ignores entities that are not exercises", () => {
	const { host, changes } = recordingHost();
	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(entityCreate("workout"), host)).toBeNull();
			expect(yield* definition.run(providerImport("workout"), host)).toBeNull();
			expect(changes).toEqual([]);
		}),
	);
});
