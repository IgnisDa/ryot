import { expect, it } from "@effect/vitest";
import { EventId } from "@ryot-app/contract/schema/brands";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { PluginId } from "@ryot-app/plugin-kit/schema";

import {
	automationContext,
	entityRecord,
	hostSuccess,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./record-media-library-membership-event.sandbox";

const membership = (
	id: string,
	sourceEntityId: string,
	createdAt = "2026-01-01T00:00:00.000Z",
) => ({
	id,
	createdAt,
	sourceEntityId,
	properties: {},
	updatedAt: createdAt,
	targetEntityId: "library-1",
	relationshipSchemaPluginId: "media-owner",
	relationshipSchemaSlug: "in-media-library",
});

const batchContext = (
	...items: readonly {
		readonly operation?: "create" | "delete";
		readonly relationship: ReturnType<typeof membership>;
	}[]
) =>
	automationContext({
		category: "change",
		operation: "batch",
		resource: "relationship",
		items: items.map(({ relationship, operation = "create" }) => ({
			operation,
			category: "change",
			resource: "relationship",
			[operation === "create" ? "after" : "before"]: relationship,
		})),
	});

const mediaEntityRows = (...entities: readonly [string, string][]) =>
	ryotqlRows(
		"entities",
		entities.map(([id, entitySchemaSlug]) => entityRecord({ id, entitySchemaSlug })),
	);

const addToMediaLibrarySchema = {
	id: "event-schema-1",
	entitySchemaSlug: "book",
	slug: "add-to-media-library",
	name: "Added to media library",
	propertiesSchema: { fields: {} },
	pluginId: PluginId.make("media-owner"),
};

const createHost = (entities: readonly [string, string][]) => {
	const created: unknown[][] = [];
	const calls = { entityReads: 0, schemaReads: 0 };
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => {
			calls.entityReads += 1;
			return hostSuccess(mediaEntityRows(...entities));
		},
		listEventSchemas: () => {
			calls.schemaReads += 1;
			return hostSuccess([addToMediaLibrarySchema]);
		},
		createEvents: (events) => {
			created.push([...events]);
			return hostSuccess({
				count: events.length,
				outcomes: events.map((_, index) => ({
					index,
					status: "written" as const,
					eventId: EventId.make(`created-event-${index}`),
				})),
			});
		},
	});
	return { host, calls, created };
};

it.live("records one add-to-media-library event per membership in a single write", () =>
	Effect.gen(function* () {
		const { host, calls, created } = createHost([
			["entity-1", "book"],
			["entity-2", "book"],
		]);

		yield* definition.run(
			batchContext(
				{ relationship: membership("relationship-1", "entity-1") },
				{ relationship: membership("relationship-2", "entity-2", "2026-01-02T00:00:00.000Z") },
			),
			host,
		);

		expect(created).toEqual([
			[
				{
					properties: {},
					entityId: "entity-1",
					occurredAt: "2026-01-01T00:00:00.000Z",
					eventSchemaSlug: "add-to-media-library",
				},
				{
					properties: {},
					entityId: "entity-2",
					occurredAt: "2026-01-02T00:00:00.000Z",
					eventSchemaSlug: "add-to-media-library",
				},
			],
		]);
		expect(calls).toEqual({ entityReads: 1, schemaReads: 1 });
	}),
);

it.live("skips non-membership relationships, deletions, and non-media entities", () =>
	Effect.gen(function* () {
		const { host, calls, created } = createHost([
			["entity-1", "workout"],
			["entity-2", "book"],
		]);

		yield* definition.run(
			batchContext(
				{
					relationship: {
						...membership("relationship-1", "entity-2"),
						relationshipSchemaSlug: "owns",
					},
				},
				{ operation: "delete", relationship: membership("relationship-2", "entity-2") },
				{ relationship: membership("relationship-3", "entity-1") },
			),
			host,
		);

		expect(created).toEqual([]);
		expect(calls).toEqual({ entityReads: 1, schemaReads: 0 });
	}),
);

it.live("does nothing when the batch has no membership creations", () =>
	Effect.gen(function* () {
		const { host, calls, created } = createHost([]);

		yield* definition.run(
			batchContext({ operation: "delete", relationship: membership("relationship-1", "entity-1") }),
			host,
		);

		expect(created).toEqual([]);
		expect(calls).toEqual({ entityReads: 0, schemaReads: 0 });
	}),
);
