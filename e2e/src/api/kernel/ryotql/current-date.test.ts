import {
	and,
	ascending,
	castDate,
	column,
	currentDate,
	document,
	eq,
	field,
	gt,
	jsonPath,
	literal,
	lte,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Clock, Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntityFixture,
	createPluginEntitySchema,
	executeRyotQL,
	requireRows,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("RyotQL currentDate", () => {
	it.live("compares stored dates against the server's UTC day", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const schema = yield* createPluginEntitySchema(client, {
				schemaName: "RyotQLCurrentDate",
				propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
			});
			yield* Effect.all([
				createEntityFixture(client, {
					name: "Past",
					entitySchemaSlug: schema.schemaId,
					properties: { publishDate: "2000-01-01" },
				}),
				createEntityFixture(client, {
					name: "Future",
					entitySchemaSlug: schema.schemaId,
					properties: { publishDate: "2999-01-01" },
				}),
			]);

			const entity = table("entity", "entity");
			const publishDate = castDate(jsonPath(column(entity, "properties"), "publishDate"));
			const bySchema = eq(column(entity, "entitySchemaSlug"), literal(schema.slug));
			const query = (where: ReturnType<typeof lte>) =>
				rows(entity, {
					where: and(bySchema, where),
					orderBy: [ascending(column(entity, "name"))],
					fields: [field("name", column(entity, "name")), field("today", currentDate())],
				});
			const result = yield* executeRyotQL(
				client,
				document({
					aired: query(lte(publishDate, currentDate())),
					upcoming: query(gt(publishDate, currentDate())),
				}),
			);

			const aired = requireRows(result.data["aired"], "aired").items;
			const upcoming = requireRows(result.data["upcoming"], "upcoming").items;
			expect(aired.map((item) => item["name"])).toEqual(["Past"]);
			expect(upcoming.map((item) => item["name"])).toEqual(["Future"]);

			const today = String(aired[0]?.["today"]);
			expect(today).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
			const now = yield* Clock.currentTimeMillis;
			expect(Math.abs(Date.parse(today) - now)).toBeLessThan(24 * 60 * 60 * 1000);
		}),
	);
});
