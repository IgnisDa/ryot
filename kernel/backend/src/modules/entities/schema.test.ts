import { expect, layer } from "@effect/vitest";
import { sql } from "drizzle-orm";
import { Result, Effect } from "effect";
import { Client } from "pg";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { revisionDatabaseLayer } from "#modules/plugins/revision.test-support";

layer(revisionDatabaseLayer)((test) => {
	test.effect("qualifies external identities across nullable ownership and provenance", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				Effect.gen(function* () {
					yield* db
						.insert(tables.plugin)
						.values({ slug: "schema", status: "inactive", id: "schema-plugin" });
					yield* db
						.insert(tables.plugin)
						.values({ slug: "provider", status: "inactive", id: "provider-plugin" });
					yield* db
						.insert(tables.sandboxProvider)
						.values({
							id: "provider",
							slug: "provider",
							name: "Provider",
							pluginId: "provider-plugin",
							rootEntitySchemaSlug: "item",
							information: { source: "fixture" },
						});
				}),
			);
			for (const [index, input] of [null, "owner", "recipient"]
				.flatMap((userId) =>
					[null, "provider"].flatMap((providerId) =>
						[null, "schema-plugin"].flatMap((entitySchemaPluginId) =>
							[null, "external"].map((externalId) => ({
								userId,
								providerId,
								externalId,
								entitySchemaPluginId,
							})),
						),
					),
				)
				.entries()) {
				const values = { ...input, name: "Item", entitySchemaSlug: "item" };
				yield* session.run((db) =>
					db.insert(tables.entity).values({ ...values, id: `first-${index}` }),
				);
				const duplicate = yield* Effect.result(
					session.transaction(
						session.run((db) =>
							db.insert(tables.entity).values({ ...values, id: `second-${index}` }),
						),
					),
				);
				const shouldBeUnique =
					input.externalId !== null && (input.userId === null || input.providerId !== null);
				expect(Result.isFailure(duplicate)).toBe(shouldBeUnique);
			}
		}),
	);

	test.effect("admits only one concurrent insert for a global external identity", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const [schemaRow] = yield* session.run((db) =>
					db
						.select({ schemaName: sql<string>`current_schema()` })
						.from(tables.user)
						.limit(1),
				);
				if (!schemaRow) {
					throw new Error("Missing test schema");
				}
				const openConnection = Effect.gen(function* () {
					const client = new Client({ connectionString: testDatabaseUrl() });
					yield* Effect.tryPromise(() => client.connect());
					return client;
				});
				const left = yield* Effect.acquireRelease(openConnection, (client) =>
					Effect.tryPromise(() => client.end()).pipe(Effect.orDie),
				);
				const right = yield* Effect.acquireRelease(openConnection, (client) =>
					Effect.tryPromise(() => client.end()).pipe(Effect.orDie),
				);
				yield* Effect.forEach(
					[left, right],
					(client) =>
						Effect.tryPromise(() =>
							client.query("select set_config('search_path', $1, false)", [schemaRow.schemaName]),
						),
					{ discard: true, concurrency: "unbounded" },
				);
				const inserted = yield* Effect.forEach(
					[left, right],
					(client, index) =>
						Effect.result(
							Effect.tryPromise(() =>
								client.query(
									"insert into entity (id, name, entity_schema_slug, external_id) values ($1, 'Item', 'item', 'shared')",
									[`concurrent-${index}`],
								),
							),
						),
					{ concurrency: "unbounded" },
				);
				expect(inserted.filter(Result.isSuccess)).toHaveLength(1);
				expect(inserted.filter(Result.isFailure)).toHaveLength(1);
			}),
		),
	);
});
