import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	buildEventFirstCte,
	buildJoinedCte,
	buildLatestEventJoinCte,
} from "./query-ctes";

const dialect = new PgDialect();

const minimalEventJoin = {
	key: "review",
	kind: "latestEvent" as const,
	eventSchemaSlug: "review",
	eventSchemas: [
		{
			slug: "review",
			id: "es_review",
			entitySchemaId: "schema_a",
			entitySchemaSlug: "device",
			propertiesSchema: {
				fields: {
					rating: {
						label: "Rating",
						type: "integer" as const,
						description: "Numeric rating",
					},
				},
			},
		},
	],
	eventSchemaMap: new Map([
		[
			"review",
			{
				id: "es_review",
				slug: "review",
				entitySchemaId: "schema_a",
				entitySchemaSlug: "device",
				propertiesSchema: { fields: {} },
			},
		],
	]),
};

describe("buildEventFirstCte", () => {
	it("scopes to userId, entity schema IDs, and event schema slugs", () => {
		const cte = buildEventFirstCte({
			userId: "user_1",
			cteName: "base_events",
			entitySchemaIds: ["schema_a", "schema_b"],
			eventSchemaSlugs: ["review", "complete"],
		});

		const { params } = dialect.sqlToQuery(cte);
		expect(params).toContain("user_1");
		expect(params).toContain("schema_a");
		expect(params).toContain("schema_b");
		expect(params).toContain("review");
		expect(params).toContain("complete");
	});

	it("uses the supplied cteName in the SQL output", () => {
		const cte = buildEventFirstCte({
			userId: "user_1",
			cteName: "my_custom_cte",
			eventSchemaSlugs: ["review"],
			entitySchemaIds: ["schema_a"],
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("my_custom_cte");
	});

	it("includes entity_schema_data and event_schema_data as JSONB builds", () => {
		const cte = buildEventFirstCte({
			userId: "user_1",
			cteName: "base_events",
			eventSchemaSlugs: ["review"],
			entitySchemaIds: ["schema_a"],
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("entity_schema_data");
		expect(sql).toContain("event_schema_data");
		expect(sql).toContain("jsonb_build_object");
	});

	it("includes entity-prefixed columns for event-first row layout", () => {
		const cte = buildEventFirstCte({
			userId: "user_1",
			cteName: "base_events",
			eventSchemaSlugs: ["review"],
			entitySchemaIds: ["schema_a"],
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("entity_id");
		expect(sql).toContain("entity_properties");
		expect(sql).toContain("entity_created_at");
		expect(sql).toContain("entity_updated_at");
	});

	it("adds date range filters when dateRange is provided", () => {
		const cte = buildEventFirstCte({
			userId: "user_1",
			cteName: "base_events",
			eventSchemaSlugs: ["review"],
			entitySchemaIds: ["schema_a"],
			dateRange: {
				endAt: "2026-01-08T00:00:00.000Z",
				startAt: "2026-01-01T00:00:00.000Z",
			},
		});

		const { sql, params } = dialect.sqlToQuery(cte);
		expect(params).toContain("2026-01-01T00:00:00.000Z");
		expect(params).toContain("2026-01-08T00:00:00.000Z");
		expect(sql).toContain("::timestamptz");
	});

	it("omits date range filters when dateRange is not provided", () => {
		const cte = buildEventFirstCte({
			userId: "user_1",
			cteName: "base_events",
			eventSchemaSlugs: ["review"],
			entitySchemaIds: ["schema_a"],
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).not.toContain("::timestamptz");
	});
});

describe("buildJoinedCte", () => {
	it("selects all columns from the base CTE and uses no LEFT JOIN when there are no event joins", () => {
		const cte = buildJoinedCte({
			eventJoins: [],
			baseCte: "base_events",
			cteName: "joined_events",
			entityIdColumn: "entity_id",
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("base_events.*");
		expect(sql.toLowerCase()).not.toContain("left join");
	});

	it("adds a LEFT JOIN and select column for each event join", () => {
		const cte = buildJoinedCte({
			baseCte: "base_events",
			cteName: "joined_events",
			entityIdColumn: "entity_id",
			eventJoins: [minimalEventJoin],
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql.toLowerCase()).toContain("left join");
		expect(sql).toContain("latest_event_join_review");
	});

	it("adds one LEFT JOIN per join when multiple event joins are present", () => {
		const baseEventSchema = {
			slug: "review",
			id: "es_review",
			entitySchemaId: "schema_a",
			entitySchemaSlug: "device",
			propertiesSchema: { fields: {} },
		};
		const watchJoin = {
			...minimalEventJoin,
			key: "watch",
			eventSchemaSlug: "watch",
			eventSchemas: [{ ...baseEventSchema, slug: "watch", id: "es_watch" }],
			eventSchemaMap: new Map([
				["watch", { ...baseEventSchema, slug: "watch", id: "es_watch" }],
			]),
		};
		const cte = buildJoinedCte({
			baseCte: "base_events",
			cteName: "joined_events",
			entityIdColumn: "entity_id",
			eventJoins: [minimalEventJoin, watchJoin],
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("latest_event_join_review");
		expect(sql).toContain("latest_event_join_watch");
	});

	it("joins on the specified entityIdColumn from the base CTE", () => {
		const cte = buildJoinedCte({
			baseCte: "base_events",
			cteName: "joined_events",
			entityIdColumn: "entity_id",
			eventJoins: [minimalEventJoin],
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("entity_id");
	});
});

describe("buildLatestEventJoinCte", () => {
	it("scopes to userId and event schema IDs", () => {
		const cte = buildLatestEventJoinCte({
			userId: "user_1",
			join: minimalEventJoin,
		});

		const { params } = dialect.sqlToQuery(cte);
		expect(params).toContain("user_1");
		expect(params).toContain("es_review");
	});

	it("uses DISTINCT ON entity_id for the latest event per entity", () => {
		const cte = buildLatestEventJoinCte({
			userId: "user_1",
			join: minimalEventJoin,
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql.toLowerCase()).toContain("distinct on");
		expect(sql).toContain("entity_id");
	});

	it("uses the join key to name the CTE", () => {
		const cte = buildLatestEventJoinCte({
			userId: "user_1",
			join: minimalEventJoin,
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("latest_event_join_review");
	});

	it("builds a JSONB object for the latest event row", () => {
		const cte = buildLatestEventJoinCte({
			userId: "user_1",
			join: minimalEventJoin,
		});

		const { sql } = dialect.sqlToQuery(cte);
		expect(sql).toContain("jsonb_build_object");
		expect(sql).toContain("latest_event");
	});
});
