import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import { execution, hostSuccess } from "./automation-test-utils";
import definition, { manifest } from "./media-library-membership-on-import.sandbox";

const libraryRows = {
	data: {
		library: {
			type: "rows" as const,
			items: [{ entityId: "library-1" }],
			pageInfo: { hasMore: false, limit: 1, nextCursor: null },
		},
	},
};

const context = (entitySchemaSlug: string): AutomationInput => ({
	automation: {
		operation: "create",
		origin: { kind: "import" },
		occurrenceId: "import-1-hook-0",
		occurredAt: "2026-01-01T00:00:00.000Z",
		ruleId:
			"binding:media:provider_entity_import:book:automation.media-library-membership-on-import:0",
		source: {
			kind: "entity",
			after: { name: "Dune", id: "entity-1", entitySchemaSlug, properties: { title: "Dune" } },
		},
	},
});

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
			return hostSuccess([{ created: changes.length === 1 ? 1 : 0, deleted: 0 }]);
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

it("ignores non-entity and irrelevant entity inputs", () => {
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
	const eventInput = {
		...context("book"),
		automation: {
			...context("book").automation,
			source: { kind: "event" as const },
		},
	} as AutomationInput;
	const irrelevantInput = context("workout");

	return Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* definition.run(eventInput, host, execution)).toBeNull();
			expect(yield* definition.run(irrelevantInput, host, execution)).toBeNull();
			expect(calls).toBe(0);
		}),
	);
});
