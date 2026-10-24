import { assert, expect, layer } from "@effect/vitest";
import { decodeCollectionFields } from "@ryot-app/contract/modules/collections/fields";
import { parseAppSchemaPropertiesSafe } from "@ryot-app/contract/schema/property-values";
import { eq, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";

import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { buildCollectionEntityMigrationSql } from "../../../../../apps/server/src/migrations/collection-mapping";
import { collectionMembershipSchema, prepareCollectionFields } from "./fields";

const whitespace = [
	"\t",
	"\n",
	"\v",
	"\f",
	"\r",
	" ",
	"\u00a0",
	"\u1680",
	"\u2000",
	"\u2001",
	"\u2002",
	"\u2003",
	"\u2004",
	"\u2005",
	"\u2006",
	"\u2007",
	"\u2008",
	"\u2009",
	"\u200a",
	"\u2028",
	"\u2029",
	"\u202f",
	"\u205f",
	"\u3000",
	"\ufeff",
];

layer(revisionDatabaseLayer)((test) => {
	test.effect(
		"migrates trim-normalized declarations that remain editable and validate member defaults",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const template = whitespace.map((space, index) => ({
					lot: "String",
					required: true,
					default_value: `${space}B${space}`,
					name: `${space}Notes${index}${space}`,
					description: index % 2 === 0 ? space : `${space}Description${space}`,
					possible_values: [`${space}A${space}`, "A", `${space}B${space}`, space],
				}));
				const serializedTemplate = yield* Schema.encodeEffect(
					Schema.fromJsonString(Schema.Unknown),
				)(template);
				yield* session.transaction(
					session.run((db) =>
						Effect.gen(function* () {
							yield* db.execute(sql`CREATE TABLE "collection" (
					id text PRIMARY KEY, name text NOT NULL, user_id text NOT NULL,
					description text, information_template jsonb,
					created_on timestamptz NOT NULL DEFAULT now(),
					last_updated_on timestamptz NOT NULL DEFAULT now()
				)`);
							yield* db.execute(sql`INSERT INTO "collection" (id, name, user_id, information_template)
							VALUES ('trimmed-fields', 'Trimmed fields', 'owner', ${serializedTemplate}::jsonb)`);
							yield* db.execute(
								sql.raw(buildCollectionEntityMigrationSql({ pluginId: null, slug: "collection" })),
							);
						}),
					),
				);
				const [collection] = yield* session.run((db) =>
					db
						.select({ properties: tables.entity.properties })
						.from(tables.entity)
						.where(eq(tables.entity.id, "trimmed-fields")),
				);
				assert(collection);
				const fields = Result.getOrThrow(
					decodeCollectionFields(collection.properties["membershipFields"]),
				);
				expect(fields).toEqual(
					template.map((field, index) => ({
						type: "choice",
						required: true,
						key: field.name,
						defaultValue: "B",
						choices: ["A", "B"],
						label: field.name.trim(),
						description: index % 2 === 0 ? field.name.trim() : "Description",
					})),
				);
				expect(prepareCollectionFields(fields, new Set(fields.map(({ key }) => key)))).toEqual(
					Result.succeed(fields),
				);
				const propertiesSchema = Result.getOrThrow(
					collectionMembershipSchema(collection.properties["membershipFields"]),
				);
				expect(parseAppSchemaPropertiesSafe({ properties: {}, propertiesSchema })).toEqual({
					success: true,
					data: Object.fromEntries(template.map(({ name }) => [name, "B"])),
				});
				expect(
					parseAppSchemaPropertiesSafe({ propertiesSchema, properties: { undeclared: "B" } })
						.success,
				).toBe(false);
			}),
	);
});
