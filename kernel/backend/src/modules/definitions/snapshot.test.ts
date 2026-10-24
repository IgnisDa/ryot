import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { assert, expect, it } from "vitest";

import { kernelDefinitionSource } from "./kernel-source";
import {
	buildDefinitionSnapshot,
	definitionLookup,
	type DefinitionSource,
	type SavedViewDefinition,
} from "./snapshot";

const source = (pluginId: null | string): DefinitionSource => ({
	savedViews: [],
	calendarSources: [],
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
		calendarSources: [],
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

const bottleBrowserView = (settings: Readonly<Record<string, JsonValue>>): SavedViewDefinition => {
	const entity = table("entity", "entity");
	return {
		icon: "box",
		sortOrder: 0,
		pluginId: null,
		slug: "bottles",
		name: "Bottles",
		renderer: { kind: "kernel", name: "entity-browser" },
		dataSources: document({
			source: rows(entity, { fields: [field("name", column(entity, "name"))] }),
		}),
		settings: {
			pageSize: 20,
			addAction: null,
			searchFields: [],
			layouts: ["grid"],
			tableColumns: null,
			sourceName: "source",
			defaultLayout: "grid",
			summary: { image: null, subtitle: null },
			subject: { entityAlias: "entity", schemas: [{ slug: "bottle", owner: { kind: "kernel" } }] },
			...settings,
		},
	};
};

const buildBottleView = (settings: Readonly<Record<string, JsonValue>>) =>
	buildDefinitionSnapshot({ ...source(null), savedViews: [bottleBrowserView(settings)] });

it("throws for configured fields the source does not project during snapshot validation", () => {
	expect(() => buildBottleView({ searchFields: ["name"] })).not.toThrow();
	expect(() => buildBottleView({ searchFields: ["title"] })).toThrow(
		"Invalid saved view bottles: configured field 'title' must be a projected scalar field",
	);
	expect(() => buildBottleView({ summary: { image: "cover", subtitle: null } })).toThrow(
		"Invalid saved view bottles: configured field 'cover' must be a projected scalar field",
	);
});

it("rejects entity-browser filter fields and validates entity schema browse fields", () => {
	const nameField = { key: "name", type: "text", label: "Name", kind: "value", field: "name" };
	expect(() => buildBottleView({ filterFields: [nameField] })).toThrow(
		/Invalid saved view bottles/,
	);
	const subject = table("entity", "subject");
	const browsed = (key: string, expression = column(subject, "createdAt")) => {
		const base = source(null);
		const [bottle] = base.entitySchemas;
		assert(bottle);
		return buildDefinitionSnapshot({
			...base,
			entitySchemas: [
				{
					...bottle,
					browse: { fields: [{ key, expression, type: "date", kind: "value", label: "Bottled" }] },
				},
			],
		});
	};
	expect(() => browsed("bottledAt")).not.toThrow();
	expect(() => browsed("bottled-at")).toThrow(
		"Entity schema bottle browse field key 'bottled-at' must be camelCase letters and digits",
	);
	expect(() => browsed("bottledAt", column(subject, "name"))).toThrow(
		"Entity schema bottle browse field 'bottledAt' expression has kind 'text'",
	);
});

it("builds the kernel source with its calendar view", () => {
	const snapshot = buildDefinitionSnapshot(kernelDefinitionSource());
	expect(
		snapshot.savedViews[definitionKey("saved-view", definitionOwner(null), "calendar")],
	).toEqual(
		expect.objectContaining({
			settings: {},
			dataSources: null,
			renderer: { kind: "kernel", name: "calendar" },
		}),
	);
});

const buildKernelView = (savedView: SavedViewDefinition) =>
	buildDefinitionSnapshot({ ...source(null), savedViews: [savedView] });

it("rejects calendar views with settings or data sources", () => {
	const calendar: SavedViewDefinition = {
		settings: {},
		sortOrder: 0,
		pluginId: null,
		icon: "calendar",
		slug: "calendar",
		name: "Calendar",
		dataSources: null,
		renderer: { kind: "kernel", name: "calendar" },
	};
	const entity = table("entity", "entity");
	expect(() => buildKernelView(calendar)).not.toThrow();
	expect(() => buildKernelView({ ...calendar, settings: { layout: "month" } })).toThrow(
		"Invalid saved view calendar: calendar views take no settings or data sources",
	);
	expect(() =>
		buildKernelView({
			...calendar,
			dataSources: document({
				source: rows(entity, { fields: [field("name", column(entity, "name"))] }),
			}),
		}),
	).toThrow("Invalid saved view calendar: calendar views take no settings or data sources");
});
