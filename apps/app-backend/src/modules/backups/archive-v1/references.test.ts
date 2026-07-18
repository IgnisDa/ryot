import { expect, it } from "@effect/vitest";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import {
	collectV1EmbeddedEntityIds,
	rewriteV1EventReferences,
	rewriteV1PropertyReferences,
} from "./references";

const propertiesSchema = {
	fields: {
		ordinary: { type: "string", label: "Ordinary", description: "Ordinary string" },
		groups: {
			type: "array",
			label: "Groups",
			description: "Nested groups",
			items: {
				type: "object",
				label: "Group",
				description: "Nested group",
				properties: {
					members: {
						type: "array",
						label: "Members",
						description: "Nested members",
						items: {
							type: "object",
							label: "Member",
							description: "Nested member",
							properties: {
								entityId: {
									type: "string",
									label: "Entity",
									description: "Entity reference",
									reference: { kind: "entity-id", required: true },
								},
								relationshipId: {
									type: "string",
									label: "Relationship",
									description: "Relationship reference",
									reference: { kind: "relationship-id" },
								},
							},
						},
					},
				},
			},
		},
	},
} satisfies AppSchema;

const nestedProperties = {
	ordinary: "entity-source",
	groups: [
		{
			members: [
				{ entityId: "entity-source", relationshipId: "relationship-source" },
				{ entityId: "entity-other", relationshipId: "deleted-relationship" },
			],
		},
	],
};

it.effect(
	"collects and round trips schema-declared references through nested objects and arrays",
	() =>
		Effect.gen(function* () {
			expect(
				collectV1EmbeddedEntityIds([
					{ propertiesSchema, properties: nestedProperties },
					{ propertiesSchema, properties: nestedProperties },
				]),
			).toEqual(["entity-other", "entity-source"]);
			const rewritten = yield* rewriteV1PropertyReferences(
				nestedProperties,
				propertiesSchema,
				new Map([
					["entity-source", "entity-target"],
					["entity-other", "entity-other-target"],
				]),
				new Map([["relationship-source", "relationship-target"]]),
			);
			expect(rewritten).toEqual({
				ordinary: "entity-source",
				groups: [
					{
						members: [
							{ entityId: "entity-target", relationshipId: "relationship-target" },
							{ entityId: "entity-other-target", relationshipId: "deleted-relationship" },
						],
					},
				],
			});
			expect(
				yield* rewriteV1PropertyReferences(
					rewritten,
					propertiesSchema,
					new Map([
						["entity-target", "entity-source"],
						["entity-other-target", "entity-other"],
					]),
					new Map([["relationship-target", "relationship-source"]]),
				),
			).toEqual(nestedProperties);
		}),
);

it.effect("fails when a required schema-declared reference has no mapping", () =>
	rewriteV1PropertyReferences(
		{ groups: [{ members: [{ entityId: "missing" }] }] },
		propertiesSchema,
		new Map(),
		new Map(),
	).pipe(
		Effect.flip,
		Effect.tap((error) =>
			Effect.sync(() => {
				expect(error.reason).toBe("missing_reference_mapping");
				expect(error.message).toContain("Missing entity reference mapping for 'missing'");
			}),
		),
	),
);

const timestamp = "2026-08-23T12:00:00.000Z";

it.effect("rewrites event foreign keys and schema-declared optional property references", () =>
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
				{
					fields: {
						entityId: {
							type: "string",
							label: "Entity",
							description: "Entity reference",
							reference: { kind: "entity-id" },
						},
						relationshipId: {
							type: "string",
							label: "Relationship",
							description: "Relationship reference",
							reference: { kind: "relationship-id" },
						},
					},
				},
				new Map([...entityIds, ["member-source", "member-target"]]),
				relationshipIds,
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
				{ fields: {} },
				entityIds,
				relationshipIds,
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
		{ fields: {} },
		new Map(),
		new Map(),
	).pipe(
		Effect.flip,
		Effect.tap((error) =>
			Effect.sync(() => expect(error.reason).toBe("missing_reference_mapping")),
		),
	),
);
