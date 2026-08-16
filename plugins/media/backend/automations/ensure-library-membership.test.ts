import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import {
	automationContext,
	entityRecord,
	eventAutomationContext,
	execution,
	hostSuccess,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./ensure-library-membership.sandbox";

const libraryRows = {
	data: {
		library: {
			type: "rows" as const,
			items: [{ entityId: "library-1" }],
			pageInfo: { limit: 1, hasMore: false, nextCursor: null },
		},
	},
};

const context = (entitySchemaSlug: string): AutomationInput =>
	automationContext({
		userId: "user-1",
		entitySchemaSlug,
		category: "change",
		externalId: "dune",
		entityId: "entity-1",
		operation: "complete",
		providerId: "provider-1",
		resource: "provider-entity-import",
	});

const membership = (sourceEntityId: string) => [
	{
		deletes: [],
		creates: [
			{
				properties: {},
				sourceEntityId,
				targetEntityId: "library-1",
				relationshipSchemaSlug: "in-library",
			},
		],
	},
];

it.each(["book", "show", "anime", "manga", "video-game", "music", "person", "company"])(
	"adds %s to the user's library",
	(entitySchemaSlug) => {
		const changes: unknown[] = [];
		let queryCalls = 0;
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => {
				queryCalls += 1;
				return hostSuccess(libraryRows);
			},
			changeUserRelationships: (batches) => {
				changes.push(batches);
				return hostSuccess([{ created: 1, deleted: 0 }]);
			},
		});

		return Effect.runPromise(
			definition.run(context(entitySchemaSlug), host, execution).pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(queryCalls).toBe(1);
					expect(changes).toEqual([
						[
							{
								deletes: [],
								creates: [
									{
										properties: {},
										sourceEntityId: "entity-1",
										targetEntityId: "library-1",
										relationshipSchemaSlug: "in-library",
									},
								],
							},
						],
					]);
				}),
			),
		);
	},
);

it("is idempotent when the same import hook runs repeatedly", () => {
	const changes: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => hostSuccess(libraryRows),
		changeUserRelationships: (batches) => {
			changes.push(batches);
			return hostSuccess([{ deleted: 0, created: changes.length === 1 ? 1 : 0 }]);
		},
	});

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(context("book"), host, execution)).toBeNull();
			expect(yield* definition.run(context("book"), host, execution)).toBeNull();
			expect(changes[0]).toEqual(changes[1]);
		}),
	);
});

it("ignores irrelevant entity and event inputs", () => {
	let calls = 0;
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => {
			calls += 1;
			return hostSuccess(libraryRows);
		},
		changeUserRelationships: () => {
			calls += 1;
			return hostSuccess([]);
		},
	});
	const eventInput = eventAutomationContext({ entitySchemaSlug: "workout" });
	const libraryInput = eventAutomationContext({ entitySchemaSlug: "library" });
	const untargetedCollectionInput = eventAutomationContext({
		entitySchemaSlug: "collection",
		eventSchemaSlug: "add-entity-to-collection",
		properties: { entityId: "entity-9", entitySchemaSlug: "workout" },
	});
	const irrelevantInput = context("workout");

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(eventInput, host, execution)).toBeNull();
			expect(yield* definition.run(libraryInput, host, execution)).toBeNull();
			expect(yield* definition.run(untargetedCollectionInput, host, execution)).toBeNull();
			expect(yield* definition.run(irrelevantInput, host, execution)).toBeNull();
			expect(calls).toBe(0);
		}),
	);
});

it("adds the event subject and the collection membership target to the library", () => {
	const changes: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => hostSuccess(libraryRows),
		changeUserRelationships: (batches) => {
			changes.push(batches);
			return hostSuccess([{ created: 1, deleted: 0 }]);
		},
	});

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(
				yield* definition.run(
					eventAutomationContext({ entitySchemaSlug: "movie", eventSchemaSlug: "progress" }),
					host,
					execution,
				),
			).toBeNull();
			expect(
				yield* definition.run(
					eventAutomationContext({
						entitySchemaSlug: "collection",
						eventSchemaSlug: "add-entity-to-collection",
						properties: { entityId: "entity-2", entitySchemaSlug: "book" },
					}),
					host,
					execution,
				),
			).toBeNull();
			expect(changes).toEqual([membership("entity-1"), membership("entity-2")]);
		}),
	);
});

it("uses trusted user scope for direct creation and skips global population", async () => {
	const changes: unknown[] = [];
	let reads = 0;
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => {
			reads += 1;
			return hostSuccess(libraryRows);
		},
		changeUserRelationships: (batches) => {
			changes.push(batches);
			return hostSuccess([{ created: 1, deleted: 0 }]);
		},
	});
	const payload = {
		category: "change",
		resource: "entity",
		operation: "create",
		after: entityRecord({ entitySchemaSlug: "movie" }),
	};
	await Effect.runPromise(
		definition.run(automationContext(payload, { executionUserId: null }), host, execution),
	);
	expect(reads).toBe(0);
	expect(changes).toEqual([]);
	await Effect.runPromise(definition.run(automationContext(payload), host, execution));
	expect(reads).toBe(1);
	expect(changes).toEqual([
		[
			{
				deletes: [],
				creates: [
					{
						properties: {},
						sourceEntityId: "entity-1",
						targetEntityId: "library-1",
						relationshipSchemaSlug: "in-library",
					},
				],
			},
		],
	]);
});

it("rejects provider completion for a different execution user before host calls", async () => {
	let calls = 0;
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => {
			calls += 1;
			return hostSuccess(libraryRows);
		},
		changeUserRelationships: () => {
			calls += 1;
			return hostSuccess([]);
		},
	});
	const input = automationContext(context("movie").automation.payload, {
		executionUserId: "other-user",
	});
	await expect(Effect.runPromise(definition.run(input, host, execution))).rejects.toThrow(
		"Provider import user does not match execution user",
	);
	expect(calls).toBe(0);
});
