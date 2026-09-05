import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import {
	automationContext,
	entityRecord,
	execution,
	hostSuccess,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./record-library-membership-event.sandbox";

const relationshipContext = (overrides: Record<string, unknown> = {}) =>
	automationContext({
		category: "change",
		operation: "create",
		resource: "relationship",
		after: {
			properties: {},
			id: "relationship-1",
			sourceEntityId: "entity-1",
			targetEntityId: "library-1",
			relationshipSchemaSlug: "in-library",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			...overrides,
		},
	});

const mediaEntityRows = (entitySchemaSlug = "book") =>
	ryotqlRows("entities", [entityRecord({ entitySchemaSlug })]);

const addToLibrarySchema = {
	id: "event-schema-1",
	slug: "add-to-library",
	name: "Added to library",
	entitySchemaSlug: "book",
	propertiesSchema: { fields: {} },
};

it("records an add-to-library event for a newly-created media membership", async () => {
	const created: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => hostSuccess(mediaEntityRows()),
		listEventSchemas: () => hostSuccess([addToLibrarySchema]),
		createEvents: (events) => {
			created.push(events);
			return hostSuccess({ count: events.length });
		},
	});

	await Effect.runPromise(definition.run(relationshipContext(), host, execution));

	expect(created).toEqual([
		[
			{
				properties: {},
				entityId: "entity-1",
				eventSchemaSlug: "event-schema-1",
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		],
	]);
});

it("ignores non-media relationships", async () => {
	let calls = 0;
	const host = defineSandboxTestHost(manifest, {
		createEvents: () => {
			calls += 1;
			return hostSuccess({ count: 1 });
		},
		listEventSchemas: () => {
			calls += 1;
			return hostSuccess([addToLibrarySchema]);
		},
		executeRyotql: () => {
			calls += 1;
			return hostSuccess(mediaEntityRows("workout"));
		},
	});

	await Effect.runPromise(
		definition.run(relationshipContext({ relationshipSchemaSlug: "owns" }), host, execution),
	);
	await Effect.runPromise(definition.run(relationshipContext(), host, execution));

	expect(calls).toBe(1);
});
