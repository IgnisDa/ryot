import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { mapPluginIdentityReferences } from "@ryot-app/contract/modules/ryotql/language";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	add,
	aggregate,
	ascending,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	dateBucket,
	document,
	entitySchemaPredicate,
	eq,
	exists,
	field,
	first,
	floor,
	include,
	integer,
	isNotNull,
	join,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonPath,
	literal,
	measure,
	pluginId,
	relationshipSchemaPredicate,
	round,
	rows,
	schemaOwnerPredicate,
	startsWith,
	sum,
	table,
	timeSeries,
	transform,
} from "./index";

const selfReference: PluginIdentityReference = { kind: "self" };
const localOwner: PluginIdentityReference = { kind: "local", pluginId: PluginId.make("owner-a") };

const pluginReferenceDocument = (reference: PluginIdentityReference) => {
	const entity = table("entity", "entity");
	const related = table("relationship", "related");
	const child = table("entity", "child");
	const leaf = table("entity", "leaf");
	const event = table("event", "event");
	const plugin = () => pluginId(reference);
	const byPluginId = (tableAlias: ReturnType<typeof table>) =>
		eq(plugin(), column(tableAlias, "id"));

	const leafInclude = include(leaf, {
		limit: 2,
		key: "leaf",
		where: byPluginId(leaf),
		orderBy: [ascending(plugin())],
		fields: [field("owner", plugin())],
		joins: [join("inner", event, byPluginId(event))],
	});
	const childInclude = include(child, {
		limit: 3,
		key: "child",
		include: [leafInclude],
		where: byPluginId(child),
		orderBy: [ascending(plugin())],
		fields: [field("owner", plugin())],
		joins: [join("inner", event, byPluginId(event))],
	});

	return document({
		aggregates: aggregate(entity, {
			where: byPluginId(entity),
			groupBy: [field("owner", plugin())],
			joins: [join("inner", event, byPluginId(event))],
			measures: [measure("total", { expr: plugin(), function: "sum" })],
		}),
		series: timeSeries(event, {
			bucket: "day",
			time: plugin(),
			endAt: "2026-01-02",
			startAt: "2026-01-01",
			where: byPluginId(event),
			measure: { expr: plugin(), function: "sum" },
			joins: [join("inner", related, byPluginId(related))],
		}),
		entities: rows(entity, {
			include: [childInclude],
			where: byPluginId(entity),
			orderBy: [ascending(plugin())],
			joins: [join("inner", event, byPluginId(event))],
			fields: [
				field("owner", plugin()),
				field("conditional", conditional(byPluginId(entity), plugin(), plugin())),
				field("arithmetic", add(plugin(), plugin())),
				field("coalesce", coalesce(plugin(), plugin())),
				field("concat", concat(plugin(), plugin())),
				field("floor", floor(plugin())),
				field("round", round(plugin())),
				field("integer", integer(plugin())),
				field("isNotNull", isNotNull(plugin())),
				field("cast", castText(plugin())),
				field("jsonPath", jsonPath(plugin(), "owner")),
				field("dateBucket", dateBucket(plugin(), { bucket: "day", timeZone: "UTC" })),
				field("transform", transform("titleCase", plugin())),
				field("startsWith", conditional(startsWith(plugin(), plugin()), plugin(), plugin())),
				field(
					"exists",
					exists(event, {
						where: byPluginId(event),
						joins: [join("inner", entity, byPluginId(entity))],
					}),
				),
				field(
					"first",
					first(event, {
						select: plugin(),
						where: byPluginId(event),
						orderBy: [ascending(plugin())],
						joins: [join("inner", entity, byPluginId(entity))],
					}),
				),
				field(
					"correlatedAggregate",
					sum(event, plugin(), {
						where: byPluginId(event),
						joins: [join("inner", entity, byPluginId(entity))],
					}),
				),
				field("jsonExists", jsonArrayExists(plugin(), byPluginId(entity))),
				field(
					"jsonFirst",
					jsonArrayFirst(plugin(), {
						select: plugin(),
						where: byPluginId(entity),
						orderBy: [ascending(plugin())],
					}),
				),
				field("jsonCount", jsonArrayCount(plugin(), byPluginId(entity))),
				field("literalPluginShape", literal({ type: "pluginId", reference: { kind: "self" } })),
			],
		}),
	});
};

describe("RyotQL plugin identity references", () => {
	it("maps typed references throughout documents and leaves literal JSON unchanged", () => {
		const source = pluginReferenceDocument(selfReference);
		const transformedReferences: PluginIdentityReference[] = [];
		const mapped = mapPluginIdentityReferences(source, (reference) => {
			transformedReferences.push(reference);
			return localOwner;
		});

		expect(transformedReferences).toHaveLength(58);
		expect(transformedReferences).toEqual(Array.from({ length: 58 }, () => selfReference));
		expect(mapped).toEqual(pluginReferenceDocument(localOwner));
	});

	it("maps local references through package identity without changing literal strings", () => {
		const sourceOwner: PluginIdentityReference = {
			kind: "local",
			pluginId: PluginId.make("owner-a"),
		};
		const packageReference: PluginIdentityReference = {
			kind: "package",
			scope: "system",
			packageId: PluginPackageId.make("test/primary"),
		};
		const targetOwner: PluginIdentityReference = {
			kind: "local",
			pluginId: PluginId.make("owner-b"),
		};
		const literalValue = {
			pluginId: "owner-a",
			nested: ["owner-a", { ids: ["owner-a", "owner-b"] }],
		};
		const buildDocument = (reference: PluginIdentityReference) => {
			const entity = table("entity", "entity");
			return document({
				entities: rows(entity, {
					fields: [field("owner", pluginId(reference)), field("literal", literal(literalValue))],
				}),
			});
		};

		const packaged = mapPluginIdentityReferences(
			buildDocument(sourceOwner),
			() => packageReference,
		);
		const remapped = mapPluginIdentityReferences(packaged, () => targetOwner);

		expect(packaged).toEqual(buildDocument(packageReference));
		expect(remapped).toEqual(buildDocument(targetOwner));
	});

	it("builds exact schema owner predicates for plugin and kernel owners", () => {
		const entity = table("entity", "entity");
		const relationship = table("relationship", "relationship");

		expect(schemaOwnerPredicate(entity, "entitySchemaPluginId", localOwner)).toEqual({
			operator: "eq",
			type: "comparison",
			right: { type: "pluginId", reference: localOwner },
			left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
		});
		expect(entitySchemaPredicate(entity, "film", localOwner)).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { value: "film", type: "literal" },
					left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
				},
				{
					operator: "eq",
					type: "comparison",
					right: { type: "pluginId", reference: localOwner },
					left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
				},
			],
		});
		expect(relationshipSchemaPredicate(relationship, "credits", localOwner)).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "credits" },
					left: { type: "column", tableAlias: "relationship", field: "relationshipSchemaSlug" },
				},
				{
					operator: "eq",
					type: "comparison",
					right: { type: "pluginId", reference: localOwner },
					left: { type: "column", tableAlias: "relationship", field: "relationshipSchemaPluginId" },
				},
			],
		});
		expect(entitySchemaPredicate(entity, "film", { kind: "kernel" })).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { value: "film", type: "literal" },
					left: { type: "column", tableAlias: "entity", field: "entitySchemaSlug" },
				},
				{
					type: "isNull",
					expr: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
				},
			],
		});
		expect(relationshipSchemaPredicate(relationship, "credits", { kind: "kernel" })).toEqual({
			type: "and",
			predicates: [
				{
					operator: "eq",
					type: "comparison",
					right: { type: "literal", value: "credits" },
					left: { type: "column", tableAlias: "relationship", field: "relationshipSchemaSlug" },
				},
				{
					type: "isNull",
					expr: { type: "column", tableAlias: "relationship", field: "relationshipSchemaPluginId" },
				},
			],
		});
	});
});
