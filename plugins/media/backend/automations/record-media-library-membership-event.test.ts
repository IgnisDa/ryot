import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import {
	automationContext,
	entityRecord,
	hostSuccess,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./record-media-library-membership-event.sandbox";

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
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			relationshipSchemaSlug: "in-media-library",
			...overrides,
		},
	});

const mediaEntityRows = (entitySchemaSlug = "book") =>
	ryotqlRows("entities", [entityRecord({ entitySchemaSlug })]);

const addToMediaLibrarySchema = {
	id: "event-schema-1",
	entitySchemaSlug: "book",
	slug: "add-to-media-library",
	name: "Added to media library",
	propertiesSchema: { fields: {} },
};

it.live("records an add-to-media-library event for a newly-created media membership", () =>
	Effect.gen(function* () {
		const created: unknown[] = [];
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => hostSuccess(mediaEntityRows()),
			listEventSchemas: () => hostSuccess([addToMediaLibrarySchema]),
			createEvents: (events) => {
				created.push(events);
				return hostSuccess({ count: events.length });
			},
		});

		yield* definition.run(relationshipContext(), host);

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
	}),
);

it.live("ignores non-media relationships", () =>
	Effect.gen(function* () {
		let calls = 0;
		const host = defineSandboxTestHost(manifest, {
			createEvents: () => {
				calls += 1;
				return hostSuccess({ count: 1 });
			},
			executeRyotql: () => {
				calls += 1;
				return hostSuccess(mediaEntityRows("workout"));
			},
			listEventSchemas: () => {
				calls += 1;
				return hostSuccess([addToMediaLibrarySchema]);
			},
		});

		yield* definition.run(relationshipContext({ relationshipSchemaSlug: "owns" }), host);
		yield* definition.run(relationshipContext(), host);

		expect(calls).toBe(1);
	}),
);
