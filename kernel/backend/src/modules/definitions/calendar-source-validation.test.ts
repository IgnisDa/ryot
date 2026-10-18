import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	castBoolean,
	castJson,
	castText,
	column,
	eq,
	field,
	literal,
	pluginId,
	table,
} from "@ryot-app/ryotql";
import { describe, expect, it } from "vitest";

import { validateSystemPluginSet } from "#modules/plugins/packages/system-set";
import { fixtureManifest, testPluginPackageId } from "#modules/plugins/test-support";

import { calendarSourceIssue } from "./calendar-source-validation";
import { kernelDefinitionSource } from "./kernel-source";
import { buildDefinitionSnapshot } from "./snapshot";
import { materializeCalendarSource, mergeManifestDefinitions } from "./source";

const entity = table("entity", "entity");

const authoredSource = (overrides: Partial<PluginCalendarSource> = {}): PluginCalendarSource => ({
	icon: "calendar",
	startAt: "startAt",
	caption: "caption",
	precision: "instant",
	name: "Entity dates",
	slug: "entity-dates",
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("fixture-entity") }],
	},
	query: {
		from: entity,
		where: eq(column(entity, "entitySchemaPluginId"), pluginId({ kind: "self" })),
		output: {
			type: "rows",
			fields: [
				field("startAt", column(entity, "createdAt")),
				field("caption", column(entity, "name")),
				field("art", castJson(column(entity, "properties"))),
				field("done", castBoolean(literal(true))),
				field("label", castText(column(entity, "createdAt"))),
			],
		},
	},
	...overrides,
});

const issue = (overrides: Partial<PluginCalendarSource> = {}) =>
	calendarSourceIssue(materializeCalendarSource(authoredSource(overrides), "plugin-1"));

const backupRun = table("backupRun", "run");
const inaccessibleQuery: PluginCalendarSource["query"] = {
	from: entity,
	output: { type: "rows", fields: [field("startAt", column(backupRun, "createdAt"))] },
	joins: [
		{ type: "inner", table: backupRun, on: eq(column(backupRun, "id"), column(entity, "id")) },
	],
};

describe("calendar source definition validation", () => {
	it("accepts typed projections over an entity subject", () => {
		expect(issue({ art: "art", done: "done" })).toBeUndefined();
	});

	it("requires the named fields to have their calendar kinds", () => {
		expect(issue({ startAt: "caption" })).toBe("startAt field 'caption' must be a date expression");
		expect(issue({ caption: "startAt" })).toBe("caption field 'startAt' must be a text expression");
		expect(issue({ done: "caption" })).toBe("done field 'caption' must be a boolean expression");
		expect(issue({ art: "label" })).toBe("art field 'label' must be a json expression");
		expect(issue({ art: "missing" })).toBe("art field 'missing' must be a projected field");
	});

	it("requires the subject alias to name an entity table", () => {
		const run = table("event", "run");
		expect(
			issue({
				subject: { ...authoredSource().subject, entityAlias: "run" },
				query: {
					...authoredSource().query,
					joins: [
						{ table: run, type: "inner", on: eq(column(run, "entityId"), column(entity, "id")) },
					],
				},
			}),
		).toBe("subject alias 'run' must be an entity table in the query");
		const [schema] = authoredSource().subject.schemas;
		expect(issue({ subject: { entityAlias: "entity", schemas: [schema, schema] } })).toBe(
			"subject schemas must not contain duplicates",
		);
	});

	it("checks table and field access with the plugin audience", () => {
		expect(issue({ query: inaccessibleQuery })).toContain("backupRun");
		const installation = table("pluginInstallation", "installation");
		expect(
			issue({
				query: {
					from: entity,
					joins: [
						{
							type: "inner",
							table: installation,
							on: eq(column(installation, "pluginId"), column(entity, "entitySchemaPluginId")),
						},
					],
					output: {
						type: "rows",
						fields: [
							field("startAt", column(entity, "createdAt")),
							field("caption", castText(column(installation, "config"))),
						],
					},
				},
			}),
		).toContain("config");
	});

	it("rejects ordering and pagination that bypassed the authored schema", () => {
		const source = materializeCalendarSource(authoredSource(), "plugin-1");
		for (const output of [{ orderBy: [] }, { pagination: { limit: 20 } }]) {
			expect(
				calendarSourceIssue({
					...source,
					query: { ...source.query, output: { ...source.query.output, ...output } },
				}),
			).toBe("ordering and pagination are owned by the kernel");
		}
	});
});

const plugin = (calendarSource: PluginCalendarSource) => ({
	id: "plugin-1",
	manifest: { ...fixtureManifest(testPluginPackageId()), calendarSources: [calendarSource] },
});

describe("calendar sources in definition snapshots", () => {
	it("indexes valid sources and rejects invalid ones during installation validation", () => {
		const snapshot = buildDefinitionSnapshot(
			mergeManifestDefinitions(kernelDefinitionSource(), [plugin(authoredSource())]),
		);
		expect(Object.values(snapshot.calendarSources)).toMatchObject([
			{ pluginId: "plugin-1", slug: "entity-dates" },
		]);
		for (const invalid of [
			authoredSource({ query: inaccessibleQuery }),
			authoredSource({ startAt: "caption" }),
		]) {
			expect(() =>
				buildDefinitionSnapshot(
					mergeManifestDefinitions(kernelDefinitionSource(), [plugin(invalid)]),
				),
			).toThrow("Invalid calendar source entity-dates");
			expect(() => validateSystemPluginSet(kernelDefinitionSource(), [plugin(invalid)])).toThrow(
				"Invalid calendar source entity-dates",
			);
		}
	});
});
