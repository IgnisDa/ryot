import { expect, it } from "@effect/vitest";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import {
	automationContext,
	entityRecord,
	eventAutomationContext,
	hostSuccess,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./ensure-media-library-membership.sandbox";

const mediaLibraryRows = {
	data: {
		mediaLibrary: {
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

const eventBatch = (...events: Parameters<typeof eventAutomationContext>[0][]): AutomationInput => {
	const items = events.map((event) => {
		const payload = eventAutomationContext(event).automation.payload;
		if (
			payload.category !== "change" ||
			payload.resource !== "event" ||
			payload.operation !== "create"
		) {
			throw new Error("Expected event create change");
		}
		return payload;
	});
	return automationContext({ items, resource: "event", category: "change", operation: "batch" });
};

it.each(["book", "show", "anime", "manga", "video-game", "music", "person", "company"])(
	"adds %s to the user's media library",
	(entitySchemaSlug) => {
		const changes: unknown[] = [];
		let queryCalls = 0;
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => {
				queryCalls += 1;
				return hostSuccess(mediaLibraryRows);
			},
			changeUserRelationships: (batches) => {
				changes.push(batches);
				return hostSuccess([{ created: 1, deleted: 0 }]);
			},
		});

		return Effect.runPromise(
			definition.run(context(entitySchemaSlug), host).pipe(
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
										relationshipSchemaSlug: "in-media-library",
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
		executeRyotql: () => hostSuccess(mediaLibraryRows),
		changeUserRelationships: (batches) => {
			changes.push(batches);
			return hostSuccess([{ deleted: 0, created: changes.length === 1 ? 1 : 0 }]);
		},
	});

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(context("book"), host)).toBeNull();
			expect(yield* definition.run(context("book"), host)).toBeNull();
			expect(changes[0]).toEqual(changes[1]);
		}),
	);
});

it("ignores irrelevant entity and event inputs", () => {
	let calls = 0;
	const host = defineSandboxTestHost(manifest, {
		changeUserRelationships: () => {
			calls += 1;
			return hostSuccess([]);
		},
		executeRyotql: () => {
			calls += 1;
			return hostSuccess(mediaLibraryRows);
		},
	});
	const eventInput = eventBatch({ entitySchemaSlug: "workout" });
	const mediaLibraryInput = eventBatch({ entitySchemaSlug: "media-library" });
	const membershipEventInput = eventBatch({
		entitySchemaSlug: "book",
		eventSchemaSlug: "add-to-media-library",
	});
	const untargetedCollectionInput = eventBatch({
		entitySchemaSlug: "collection",
		eventSchemaSlug: "add-entity-to-collection",
		properties: { entityId: "entity-9", entitySchemaSlug: "workout" },
	});
	const irrelevantInput = context("workout");

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(eventInput, host)).toBeNull();
			expect(yield* definition.run(mediaLibraryInput, host)).toBeNull();
			expect(yield* definition.run(membershipEventInput, host)).toBeNull();
			expect(yield* definition.run(untargetedCollectionInput, host)).toBeNull();
			expect(yield* definition.run(irrelevantInput, host)).toBeNull();
			expect(calls).toBe(0);
		}),
	);
});

it("upserts each distinct event or collection target once per written batch", () => {
	const changes: unknown[] = [];
	let reads = 0;
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => {
			reads += 1;
			return hostSuccess(mediaLibraryRows);
		},
		changeUserRelationships: (batches) => {
			changes.push(batches);
			return hostSuccess([{ created: 1, deleted: 0 }]);
		},
	});

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(
				yield* definition.run(
					eventBatch(
						{ entitySchemaSlug: "movie", eventSchemaSlug: "progress" },
						{ entitySchemaSlug: "movie", eventSchemaSlug: "complete" },
						{ entitySchemaSlug: "workout", eventSchemaSlug: "progress" },
						{
							entitySchemaSlug: "collection",
							eventSchemaSlug: "add-entity-to-collection",
							properties: { entityId: "entity-2", entitySchemaSlug: "book" },
						},
					),
					host,
				),
			).toBeNull();
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
								relationshipSchemaSlug: "in-media-library",
							},
							{
								properties: {},
								sourceEntityId: "entity-2",
								targetEntityId: "library-1",
								relationshipSchemaSlug: "in-media-library",
							},
						],
					},
				],
			]);
		}),
	);
});

it("splits a batch of distinct membership targets within the host write limit", () => {
	const sizes: number[] = [];
	let calls = 0;
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => hostSuccess(mediaLibraryRows),
		changeUserRelationships: (batches) => {
			calls += 1;
			sizes.push(...batches.map((batch) => batch.creates.length));
			return hostSuccess(batches.map((batch) => ({ deleted: 0, created: batch.creates.length })));
		},
	});
	return Effect.runPromise(
		definition
			.run(
				eventBatch(
					...Array.from({ length: 101 }, (_, index) => ({
						entitySchemaSlug: "book",
						entityId: `entity-${index}`,
					})),
				),
				host,
			)
			.pipe(
				Effect.map(() => {
					expect(calls).toBe(1);
					expect(sizes).toEqual([100, 1]);
				}),
			),
	);
});

it.live("uses trusted user scope for direct creation", () =>
	Effect.gen(function* () {
		const changes: unknown[] = [];
		let reads = 0;
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => {
				reads += 1;
				return hostSuccess(mediaLibraryRows);
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
		yield* definition.run(automationContext(payload), host);
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
							relationshipSchemaSlug: "in-media-library",
						},
					],
				},
			],
		]);
	}),
);

it.live("rejects provider completion for a different execution user before host calls", () =>
	Effect.gen(function* () {
		let calls = 0;
		const host = defineSandboxTestHost(manifest, {
			changeUserRelationships: () => {
				calls += 1;
				return hostSuccess([]);
			},
			executeRyotql: () => {
				calls += 1;
				return hostSuccess(mediaLibraryRows);
			},
		});
		const input = automationContext(context("movie").automation.payload, {
			executionUserId: "other-user",
		});
		const error = yield* Effect.flip(definition.run(input, host));
		expect(error).toMatchObject({ message: "Provider import user does not match execution user" });
		expect(calls).toBe(0);
	}),
);
