import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { assert, expect, it } from "vitest";

import { buildDefinitionSnapshot, definitionLookup, type DefinitionSource } from "./snapshot";

const source = (pluginId: string | null): DefinitionSource => ({
	savedViews: [],
	relationshipSchemas: [
		{
			pluginId,
			slug: "bottled-by",
			name: "Bottled by",
			sourceEntitySchemaSlug: "bottle",
			targetEntitySchemaSlug: "bottle",
			propertiesSchema: { fields: {} },
		},
	],
	entitySchemas: [
		{
			pluginId,
			icon: "box",
			slug: "bottle",
			propertiesSchema: { fields: {} },
			name: pluginId ?? "Kernel bottle",
			eventSchemas: [
				{ pluginId, slug: "tasted", name: "Tasted", propertiesSchema: { fields: {} } },
			],
		},
	],
	signalSchemas: [
		{
			pluginId,
			slug: "catalog",
			name: "Catalog",
			catalogState: "active",
			notificationHookSlug: "notify",
			propertiesSchema: { fields: {} },
			audiencePolicy: {
				kind: "related_users",
				subjectSide: "source",
				relationshipSchemaSlug: "bottled-by",
			},
		},
	],
});

it("indexes matching local names independently for kernel and plugin owners", () => {
	const a = source("a");
	const b = source("b");
	const kernel = source(null);
	const snapshot = buildDefinitionSnapshot({
		savedViews: [],
		entitySchemas: [...a.entitySchemas, ...b.entitySchemas, ...kernel.entitySchemas],
		signalSchemas: [...a.signalSchemas, ...b.signalSchemas, ...kernel.signalSchemas],
		relationshipSchemas: [
			...a.relationshipSchemas,
			...b.relationshipSchemas,
			...kernel.relationshipSchemas,
		],
	});
	const lookup = definitionLookup(snapshot);
	expect(Object.keys(snapshot.entitySchemas)).toEqual([
		definitionKey("entity", definitionOwner("a"), "bottle"),
		definitionKey("entity", definitionOwner("b"), "bottle"),
		definitionKey("entity", definitionOwner(null), "bottle"),
	]);
	for (const pluginId of ["a", "b", null]) {
		const owner = definitionOwner(pluginId);
		expect(lookup.getEntitySchema({ owner, slug: "bottle" })?.pluginId).toBe(pluginId);
		expect(
			lookup.getEventSchema({
				owner,
				slug: EventSchemaSlug.make("tasted"),
				entitySchemaSlug: EntitySchemaSlug.make("bottle"),
			})?.pluginId,
		).toBe(pluginId);
		expect(lookup.getRelationshipSchema({ owner, slug: "bottled-by" })?.pluginId).toBe(pluginId);
		expect(lookup.getSignalSchema({ owner, slug: "catalog" })?.pluginId).toBe(pluginId);
	}
	expect(
		lookup.getEntitySchema({ slug: "bottle", owner: definitionOwner("missing") }),
	).toBeUndefined();
	expect(
		lookup.getEventSchema({
			owner: definitionOwner("missing"),
			slug: EventSchemaSlug.make("tasted"),
			entitySchemaSlug: EntitySchemaSlug.make("bottle"),
		}),
	).toBeUndefined();
});

it("rejects duplicates within an owner and events within their parent", () => {
	const a = source("a");
	const entity = a.entitySchemas[0];
	assert(entity);
	expect(() => buildDefinitionSnapshot({ ...a, entitySchemas: [entity, entity] })).toThrow(
		"Duplicate entity schema slug: bottle",
	);
	expect(() =>
		buildDefinitionSnapshot({
			...a,
			entitySchemas: [
				{ ...entity, eventSchemas: [...entity.eventSchemas, ...entity.eventSchemas] },
			],
		}),
	).toThrow("Duplicate event schema for bottle slug: tasted");
	expect(() =>
		buildDefinitionSnapshot({
			...a,
			entitySchemas: [
				{
					...entity,
					eventSchemas: Array.from(entity.eventSchemas, (event) => ({ ...event, pluginId: "b" })),
				},
			],
		}),
	).toThrow("owner does not match");
});

it("does not satisfy local relationship and audience references from another owner", () => {
	const a = source("a");
	const b = source("b");
	expect(() => buildDefinitionSnapshot({ ...a, entitySchemas: b.entitySchemas })).toThrow(
		"references missing entity schema bottle",
	);
	expect(() =>
		buildDefinitionSnapshot({
			...a,
			relationshipSchemas: b.relationshipSchemas,
			entitySchemas: [...a.entitySchemas, ...b.entitySchemas],
		}),
	).toThrow("references missing relationship schema bottled-by");
});
