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

const membership = (sourceEntityId: string) => [
	{
		deletes: [],
		creates: [
			{
				properties: {},
				sourceEntityId,
				targetEntityId: "library-1",
				relationshipSchemaSlug: "in-media-library",
			},
		],
	},
];

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
	const eventInput = eventAutomationContext({ entitySchemaSlug: "workout" });
	const mediaLibraryInput = eventAutomationContext({ entitySchemaSlug: "media-library" });
	const untargetedCollectionInput = eventAutomationContext({
		entitySchemaSlug: "collection",
		eventSchemaSlug: "add-entity-to-collection",
		properties: { entityId: "entity-9", entitySchemaSlug: "workout" },
	});
	const irrelevantInput = context("workout");

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(eventInput, host)).toBeNull();
			expect(yield* definition.run(mediaLibraryInput, host)).toBeNull();
			expect(yield* definition.run(untargetedCollectionInput, host)).toBeNull();
			expect(yield* definition.run(irrelevantInput, host)).toBeNull();
			expect(calls).toBe(0);
		}),
	);
});

it("adds the event subject and the collection membership target to the media library", () => {
	const changes: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => hostSuccess(mediaLibraryRows),
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
				),
			).toBeNull();
			expect(changes).toEqual([membership("entity-1"), membership("entity-2")]);
		}),
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
