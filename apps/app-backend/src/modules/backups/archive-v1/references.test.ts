import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	backupV1EventReferenceRules,
	collectV1EmbeddedEntityIds,
	rewriteV1EventReferences,
} from "./references";

it("collects otherwise unreferenced global entity IDs from V1 embedded rules", () => {
	expect(
		collectV1EmbeddedEntityIds([
			{
				entitySchemaSlug: "workout-template",
				properties: {
					exercises: [{ exerciseId: "global-exercise" }, { exerciseId: "global-exercise" }],
				},
			},
		]),
	).toEqual(["global-exercise"]);
});

const timestamp = "2026-08-23T12:00:00.000Z";

it.effect("rewrites known collection history IDs and preserves deleted opaque members", () =>
	Effect.gen(function* () {
		const base = {
			id: "event-id",
			createdAt: timestamp,
			updatedAt: timestamp,
			occurredAt: timestamp,
			sessionEntityId: null,
			entityId: "collection-source",
			eventSchemaSlug: "collection:add-entity-to-collection",
		};
		const entityIds = new Map([["collection-source", "collection-target"]]);
		const relationshipIds = new Map([["relationship-source", "relationship-target"]]);

		expect(
			yield* rewriteV1EventReferences(
				{
					...base,
					properties: { entityId: "member-source", relationshipId: "relationship-source" },
				},
				new Map([...entityIds, ["member-source", "member-target"]]),
				relationshipIds,
				backupV1EventReferenceRules,
			),
		).toMatchObject({
			entityId: "collection-target",
			properties: { entityId: "member-target", relationshipId: "relationship-target" },
		});
		expect(
			yield* rewriteV1EventReferences(
				{
					...base,
					eventSchemaSlug: "collection:remove-entity-from-collection",
					properties: { entityId: "deleted-member", relationshipId: "deleted-relationship" },
				},
				entityIds,
				relationshipIds,
				backupV1EventReferenceRules,
			),
		).toMatchObject({
			entityId: "collection-target",
			properties: { entityId: "deleted-member", relationshipId: "deleted-relationship" },
		});
	}),
);

it.effect("continues rejecting unresolved event foreign keys", () =>
	rewriteV1EventReferences(
		{
			id: "event-id",
			properties: {},
			entityId: "missing",
			createdAt: timestamp,
			updatedAt: timestamp,
			occurredAt: timestamp,
			sessionEntityId: null,
			eventSchemaSlug: "review",
		},
		new Map(),
		new Map(),
	).pipe(
		Effect.flip,
		Effect.tap((error) =>
			Effect.sync(() => expect(error.reason).toBe("missing_reference_mapping")),
		),
	),
);
