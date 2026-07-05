import { DbError } from "@ryot/contract/errors";
import { EntitySchemaSlug, type SandboxScriptId, type UserId } from "@ryot/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";

const listed = (definition: NonNullable<ReturnType<DefinitionRegistry["getEntitySchema"]>>) => ({
	id: EntitySchemaSlug.make(definition.slug),
	name: definition.name,
	icon: definition.icon,
	slug: definition.slug,
	isBuiltin: true,
	accentColor: definition.accentColor,
	propertiesSchema: definition.propertiesSchema,
});

export class EntitySchemasRepository extends Effect.Service<EntitySchemasRepository>()(
	"EntitySchemasRepository",
	{
		effect: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const getBuiltinBySlug = (slug: string) =>
				Effect.succeed(definitions.getEntitySchema(slug)).pipe(
					Effect.map((definition) =>
						definition
							? {
									id: EntitySchemaSlug.make(definition.slug),
									propertiesSchema: definition.propertiesSchema,
								}
							: null,
					),
				);
			const listVisibleBySlugs = (_userId: UserId, slugs: ReadonlyArray<string>) =>
				Effect.succeed(
					slugs.flatMap((slug) => {
						const definition = definitions.getEntitySchema(slug);
						return definition ? [listed(definition)] : [];
					}),
				);
			const getBuiltinDetailsBySlug = (slug: string) =>
				Effect.succeed(definitions.getEntitySchema(slug)).pipe(
					Effect.map((definition) => (definition ? listed(definition) : null)),
				);
			const deleteSandboxScriptLinks = Effect.fn(function* (sandboxScriptId: SandboxScriptId) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.delete(schema.entitySchemaSandboxScript)
						.where(eq(schema.entitySchemaSandboxScript.sandboxScriptId, sandboxScriptId))
						.returning({ id: schema.entitySchemaSandboxScript.id }),
				);
				return rows.length;
			});
			const linkSandboxScript = Effect.fn(function* (input: {
				entitySchemaSlug: EntitySchemaSlug;
				sandboxScriptId: SandboxScriptId;
			}) {
				if (!definitions.getEntitySchema(input.entitySchemaSlug)) {
					return null;
				}
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.entitySchemaSandboxScript)
						.values(input)
						.onConflictDoNothing()
						.returning({ id: schema.entitySchemaSandboxScript.id }),
				);
				if (row) {
					return row;
				}
				const [existing] = yield* dbEffect(() =>
					db
						.select({ id: schema.entitySchemaSandboxScript.id })
						.from(schema.entitySchemaSandboxScript)
						.where(
							and(
								eq(schema.entitySchemaSandboxScript.entitySchemaSlug, input.entitySchemaSlug),
								eq(schema.entitySchemaSandboxScript.sandboxScriptId, input.sandboxScriptId),
							),
						)
						.limit(1),
				);
				if (!existing) {
					return yield* new DbError({
						message: "Entity schema script link conflict but not found",
					});
				}
				return existing;
			});
			return {
				getBuiltinBySlug,
				listVisibleBySlugs,
				getBuiltinDetailsBySlug,
				deleteSandboxScriptLinks,
				linkSandboxScript,
			};
		}),
	},
) {}
