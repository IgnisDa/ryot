import type { Expr } from "@ryot/contract/modules/query-engine/language";
import {
	EntitySchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
} from "@ryot/contract/schema/brands";
import { sql as rawSql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { reconstructMeasureValue, reconstructOutputValue } from "../reconstruct";
import { compileBool, compileValue } from "./expr";
import { bucketStartSql, bucketStepSql, entitySourceSql, rowVisibleSql } from "./fragments";
import { compileIncludes } from "./includes";
import { rootScope } from "./scope";

type ComparisonOp = Extract<Expr, { type: "comparison" }>["operator"];

const dialect = new PgDialect();
const render = (fragment: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(fragment);

const scope = (language: string | null = null) =>
	rootScope(
		{ type: "entities", alias: "course", schemas: ["course"], where: null },
		{ type: "user", userId: "user-1" },
		language,
	);

const ref = (name: string): Expr => ({
	type: "ref",
	sourceAlias: "course",
	field: { type: "system", name },
});

const translationStatusRef: Expr = {
	type: "ref",
	sourceAlias: "course",
	field: { type: "systemComputed", name: "translationStatus" },
};
const schemaSlugRef: Expr = {
	type: "ref",
	sourceAlias: "course",
	field: { type: "schema", name: "slug" },
};
const prop = (path: string): Expr => ({
	type: "ref",
	sourceAlias: "course",
	field: { type: "property", schema: "course", path: [path] },
});
const lit = (value: unknown, valueType?: "date"): Expr => ({ type: "literal", value, valueType });
const cmp = (operator: ComparisonOp, left: Expr, right: Expr): Expr => ({
	type: "comparison",
	operator,
	left,
	right,
});

describe("compileBool", () => {
	it("wraps comparisons in COALESCE(..., false) to preserve null-as-false", () => {
		const { sql } = render(compileBool(cmp("eq", prop("difficulty"), lit("hard")), scope()));
		expect(sql).toContain("COALESCE(");
		expect(sql).toContain(", false)");
	});

	it("compiles neq to a guarded <>", () => {
		const { sql } = render(compileBool(cmp("neq", prop("difficulty"), lit("hard")), scope()));
		expect(sql).toContain("<>");
		expect(sql).toContain("COALESCE(");
	});

	it("compiles not by negating the null-collapsed child", () => {
		const inner = cmp("eq", prop("difficulty"), lit("hard"));
		const { sql } = render(compileBool({ type: "not", expr: inner }, scope()));
		expect(sql).toContain("NOT ");
	});

	it('orders and compares text under COLLATE "C"', () => {
		const { sql } = render(compileBool(cmp("gt", prop("title"), lit("m")), scope()));
		expect(sql).toContain('COLLATE "C"');
	});

	it("compiles a numeric property comparison with a jsonb_typeof guard", () => {
		const { sql } = render(compileBool(cmp("gte", prop("duration"), lit(10)), scope()));
		expect(sql).toContain("jsonb_typeof(");
		expect(sql).toContain("double precision");
	});

	it("compiles contains to an escaped ILIKE for a literal needle", () => {
		const { sql, params } = render(
			compileBool({ type: "contains", left: prop("title"), right: lit("du_ne") }, scope()),
		);
		expect(sql).toContain("ILIKE");
		expect(params).toContain("%du\\_ne%");
	});

	it("compiles exists to EXISTS (SELECT 1 ...) with visibility", () => {
		const existsExpr: Expr = {
			type: "exists",
			source: { type: "events", alias: "ev", entityRef: "course", schemas: ["watch"], where: null },
		};
		const { sql } = render(compileBool(existsExpr, scope()));
		expect(sql).toContain("EXISTS (SELECT 1");
		expect(sql).toContain("user_id");
	});

	it("compiles a correlated count aggregate comparison to a scalar subquery", () => {
		const aggExpr: Expr = {
			type: "comparison",
			operator: "gte",
			left: {
				type: "aggregate",
				aggregation: { function: "count" },
				source: {
					type: "entities",
					alias: "m",
					schemas: ["module"],
					where: null,
					via: { entityRef: "course", alias: "cm", direction: "outgoing", schema: "course-module" },
				},
			},
			right: lit(2),
		};
		const { sql } = render(compileBool(aggExpr, scope()));
		expect(sql).toContain("SELECT COUNT(*)");
	});
});

describe("system query visibility", () => {
	const system = {
		type: "system" as const,
		pluginSlug: PluginSlug.make("media"),
		eventSchemas: [],
		entitySchemaSlugs: [EntitySchemaSlug.make("media")],
		relationshipSchemaSlugs: [RelationshipSchemaSlug.make("media-monitoring")],
	};

	it("keeps entities global while allowing plugin relationship rows across users", () => {
		const entity = render(rowVisibleSql("entity", "e", system));
		const endpoint = render(
			rowVisibleSql("entity", "e", system, {
				type: "relationshipEndpoint",
				endpoint: "target",
				relationshipSchemaSlugs: ["media-monitoring"],
			}),
		);
		const event = render(rowVisibleSql("event", "ev", system));
		const relationship = render(rowVisibleSql("relationship", "r", system));

		expect(entity.sql).toContain("e.user_id IS NULL");
		expect(entity.params).toHaveLength(0);
		expect(endpoint.sql).toBe("true");
		expect(endpoint.params).toHaveLength(0);
		expect(event.sql).toBe("true");
		expect(event.params).toHaveLength(0);
		expect(relationship.sql).toBe("true");
		expect(relationship.params).toHaveLength(0);
	});

	it("preserves user visibility for entities, events, and relationships", () => {
		const user = { type: "user" as const, userId: "user-1" };
		const entity = render(rowVisibleSql("entity", "e", user));
		const event = render(rowVisibleSql("event", "ev", user));
		const relationship = render(rowVisibleSql("relationship", "r", user));

		expect(entity.sql).toBe("(e.user_id = $1 OR e.user_id IS NULL)");
		expect(entity.params).toEqual(["user-1"]);
		expect(event.sql).toBe("(ev.user_id = $1 OR ev.user_id IS NULL)");
		expect(event.params).toEqual(["user-1"]);
		expect(relationship.sql).toBe("(r.user_id = $1 OR r.user_id IS NULL)");
		expect(relationship.params).toEqual(["user-1"]);
	});

	it("limits cross-user entity visibility to relationship-bound correlated sources", () => {
		const compileScope = rootScope(
			{ type: "entities", alias: "media", schemas: ["media"], where: null },
			system,
			null,
		);
		const relationshipSource = {
			where: null,
			type: "entities" as const,
			alias: "library",
			schemas: ["library"] as [string, ...string[]],
			via: {
				alias: "monitoring",
				direction: "outgoing" as const,
				entityRef: "media",
				schema: "media-monitoring",
			},
		};
		const libraryId: Expr = {
			type: "ref",
			sourceAlias: "library",
			field: { type: "system", name: "id" },
		};
		const fragments = [
			compileBool({ type: "exists", source: relationshipSource }, compileScope),
			compileValue(
				{ type: "aggregate", source: relationshipSource, aggregation: { function: "count" } },
				compileScope,
			).value,
			compileValue(
				{
					type: "first",
					select: libraryId,
					source: relationshipSource,
					orderBy: [{ order: "asc", expr: libraryId }],
				},
				compileScope,
			).value,
			compileIncludes(
				[
					{
						key: "libraries",
						limit: 1,
						include: [],
						fields: [{ key: "id", expr: libraryId }],
						source: relationshipSource,
						orderBy: [{ order: "asc", expr: libraryId }],
					},
				],
				compileScope,
				"e",
			).laterals,
		];

		for (const fragment of fragments) {
			const compiled = render(fragment);
			expect(compiled.sql).toContain("relationship");
			expect(compiled.sql).not.toMatch(/e\d+\.user_id IS NULL/);
		}

		const direct = render(
			compileBool(
				{
					type: "exists",
					source: {
						where: null,
						type: "entities",
						alias: "otherMedia",
						schemas: ["media"],
					},
				},
				compileScope,
			),
		);
		expect(direct.sql).toMatch(/e\d+\.user_id IS NULL/);
	});
});

describe("compileValue", () => {
	it("tags a system date column with the date kind and null-guards it", () => {
		const { sql, params } = render(compileValue(ref("createdAt"), scope()).kind);
		expect(sql).toContain("IS NULL");
		expect(params).toContain("date");
	});

	it("derives a property's kind from jsonb_typeof at runtime", () => {
		const { sql } = render(compileValue(prop("difficulty"), scope()).kind);
		expect(sql).toContain("jsonb_typeof(");
	});

	it("casts a literal before to_jsonb so the parameter type is known", () => {
		const { sql } = render(compileValue(lit(5), scope()).value);
		expect(sql).toContain("to_jsonb(");
		expect(sql).toContain("double precision");
	});

	it("reads an entity schema slug from the entity row", () => {
		const { sql } = render(compileValue(schemaSlugRef, scope()).value);
		expect(sql).toBe("to_jsonb(e.entity_schema_slug)");
	});

	it("compiles count-distinct to COUNT(DISTINCT ...)", () => {
		const distinctAgg: Expr = {
			type: "aggregate",
			aggregation: { function: "count", distinctBy: prop("difficulty") },
			source: {
				type: "entities",
				alias: "m",
				schemas: ["module"],
				where: null,
				via: { entityRef: "course", alias: "cm", direction: "outgoing", schema: "course-module" },
			},
		};
		const { sql } = render(compileValue(distinctAgg, scope()).value);
		expect(sql).toContain("COUNT(DISTINCT");
	});

	it("compiles first to an ordered LIMIT 1 subquery", () => {
		const occurredAt: Expr = {
			type: "ref",
			sourceAlias: "ev",
			field: { type: "system", name: "occurredAt" },
		};
		const firstExpr: Expr = {
			type: "first",
			select: occurredAt,
			orderBy: [{ order: "desc", expr: occurredAt }],
			source: { type: "events", alias: "ev", entityRef: "course", schemas: ["watch"], where: null },
		};
		const { sql } = render(compileValue(firstExpr, scope()).value);
		expect(sql).toContain("ORDER BY");
		expect(sql).toContain("LIMIT 1");
	});
});

describe("reconstructOutputValue", () => {
	it("maps kind + value pairs to FieldValues", () => {
		expect(reconstructOutputValue("hi", "text")).toEqual({ kind: "text", value: "hi" });
		expect(reconstructOutputValue(3, "number")).toEqual({ kind: "number", value: 3 });
		expect(reconstructOutputValue(true, "boolean")).toEqual({ kind: "boolean", value: true });
	});

	it("treats a null value or 'null' kind as the null kind", () => {
		expect(reconstructOutputValue(null, "text")).toEqual({ kind: "null", value: null });
		expect(reconstructOutputValue("x", "null")).toEqual({ kind: "null", value: null });
	});
});

describe("reconstructMeasureValue", () => {
	it("maps a numeric aggregate and null-over-empty", () => {
		expect(reconstructMeasureValue("5")).toEqual({ kind: "number", value: 5 });
		expect(reconstructMeasureValue(null)).toEqual({ kind: "null", value: null });
	});
});

describe("entity source localization", () => {
	it("returns the bare entity table token for canonical (null language)", () => {
		const { sql, params } = render(entitySourceSql(null));
		expect(sql).toBe("entity");
		expect(params).toHaveLength(0);
	});

	it("coalesces name and merges properties from the (entity_id, language) translation row", () => {
		const { sql, params } = render(entitySourceSql("es"));
		expect(sql).toContain("entity_translation");
		expect(sql).toContain("COALESCE(et.name, e0.name) AS name");
		expect(sql).toContain("e0.properties || COALESCE(et.properties, '{}'::jsonb) AS properties");
		expect(sql).toContain("et.language =");
		expect(params).toContain("es");
	});

	it("localizes the entity source inside a correlated sub-source when a language is set", () => {
		const aggExpr: Expr = {
			type: "aggregate",
			aggregation: { function: "count" },
			source: {
				alias: "m",
				where: null,
				type: "entities",
				schemas: ["module"],
				via: { entityRef: "course", alias: "cm", direction: "outgoing", schema: "course-module" },
			},
		};
		const localized = render(compileValue(aggExpr, scope("es")).value);
		expect(localized.sql).toContain("entity_translation");
		expect(localized.params).toContain("es");

		const canonical = render(compileValue(aggExpr, scope()).value);
		expect(canonical.sql).not.toContain("entity_translation");
	});
});

describe("translationStatus computed field", () => {
	it("constant-folds to to_jsonb('none'::text) for a canonical (null language) reader", () => {
		const { sql, params } = render(compileValue(translationStatusRef, scope()).value);
		expect(sql).toBe("to_jsonb('none'::text)");
		expect(params).toHaveLength(0);
	});

	it("emits no entity_translation read when unlocalized, so canonical SQL is unchanged", () => {
		const { sql } = render(compileValue(translationStatusRef, scope()).value);
		expect(sql).not.toContain("entity_translation");
		expect(sql).not.toContain("CASE");
	});

	it("tags the folded value with the text kind", () => {
		const { sql } = render(compileValue(translationStatusRef, scope()).kind);
		expect(sql).toBe("'text'");
	});

	it("emits its own correlated sandbox_provider and entity_translation reads when a language is set", () => {
		const { sql, params } = render(compileValue(translationStatusRef, scope("es")).value);
		expect(sql).toContain("CASE");
		expect(sql).toContain("provider_id IS NULL");
		expect(sql).toContain("populated_at IS NULL");
		expect(sql).toContain("SELECT p.information ->> 'canonicalLanguage' FROM sandbox_provider p");
		expect(sql).toContain("NOT EXISTS (SELECT 1 FROM entity_translation t");
		expect(params).toContain("es");
	});
});

describe("time-series grid fragments", () => {
	it("truncates to a naive-UTC bucket start without re-attaching a zone", () => {
		const { sql } = render(bucketStartSql("week", rawSql`ev.occurred_at`));
		expect(sql).toContain("date_trunc(");
		expect(sql).toContain("AT TIME ZONE 'UTC'");
		// Naive result: exactly one AT TIME ZONE (the conversion in), none re-attached out.
		expect(sql.match(/AT TIME ZONE/g)).toHaveLength(1);
	});

	it("renders a calendar-aware month step interval", () => {
		expect(render(bucketStepSql("month")).sql).toContain("interval '1 month'");
		expect(render(bucketStepSql("week")).sql).toContain("interval '7 days'");
	});
});
