import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, isUniqueConstraintError, schema } from "#lib/db";
import { DbError, conflict } from "#lib/errors";
import type { AppSchema } from "#lib/schema/core";
import { decodeStoredAppSchema } from "#lib/schema/core";

import type { ListedEntitySchema, Provider } from "./schemas";

type BuildEntitySchemaRow = Pick<
	typeof schema.entitySchema.$inferSelect,
	"id" | "name" | "icon" | "slug" | "isBuiltin" | "accentColor" | "propertiesSchema"
> & {
	readonly trackerId: (typeof schema.trackerEntitySchema.$inferSelect)["trackerId"];
	readonly scriptId: (typeof schema.entitySchemaScript.$inferSelect)["sandboxScriptId"] | null;
	readonly scriptName: (typeof schema.sandboxScript.$inferSelect)["name"] | null;
	readonly scriptMetadata: (typeof schema.sandboxScript.$inferSelect)["metadata"] | null;
};

export type ProviderWithMetadata = Provider & {
	readonly scriptMetadata?: BuildEntitySchemaRow["scriptMetadata"];
};

export type ListedEntitySchemaWithMetadata = Omit<ListedEntitySchema, "providers"> & {
	readonly providers: ProviderWithMetadata[];
};

const listedEntitySchemaSelection = {
	id: schema.entitySchema.id,
	name: schema.entitySchema.name,
	icon: schema.entitySchema.icon,
	slug: schema.entitySchema.slug,
	isBuiltin: schema.entitySchema.isBuiltin,
	accentColor: schema.entitySchema.accentColor,
	trackerId: schema.trackerEntitySchema.trackerId,
	propertiesSchema: schema.entitySchema.propertiesSchema,
};

const toListedEntitySchema = (row: ListedEntitySchemaWithMetadata) => {
	const { providers, ...rest } = row;
	return { ...rest, providers: providers.map(({ scriptMetadata: _m, ...p }) => p) };
};

const entitySchemaUserSlugConstraint = "entity_schema_user_slug_unique";

const buildEntitySchemaRows = (rows: Array<BuildEntitySchemaRow>) =>
	Effect.gen(function* () {
		const schemaMap = new Map<
			string,
			{ entry: ListedEntitySchemaWithMetadata; seen: Set<string> }
		>();
		for (const row of rows) {
			const schemaKey = `${row.id}::${row.trackerId}`;
			let record = schemaMap.get(schemaKey);
			if (!record) {
				const propertiesSchema = yield* decodeStoredAppSchema(
					row.propertiesSchema,
					"Invalid properties schema in database",
				);
				record = {
					seen: new Set(),
					entry: {
						id: row.id,
						providers: [],
						name: row.name,
						icon: row.icon,
						slug: row.slug,
						propertiesSchema,
						trackerId: row.trackerId,
						isBuiltin: row.isBuiltin,
						accentColor: row.accentColor,
					},
				};
				schemaMap.set(schemaKey, record);
			}
			if (row.scriptId && row.scriptName && !record.seen.has(row.scriptId)) {
				record.seen.add(row.scriptId);
				record.entry.providers.push({
					name: row.scriptName,
					scriptId: row.scriptId,
					scriptMetadata: row.scriptMetadata ?? undefined,
				});
			}
		}
		return Array.from(schemaMap.values()).map(({ entry }) => entry);
	});

export class EntitySchemasRepository extends Effect.Service<EntitySchemasRepository>()(
	"EntitySchemasRepository",
	{
		sync: () => ({
			listByUser: (input: { userId: string; trackerId?: string; slugs?: ReadonlyArray<string> }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const clauses = [eq(schema.tracker.userId, input.userId)];

					if (input.slugs && input.slugs.length > 0) {
						clauses.push(inArray(schema.entitySchema.slug, [...input.slugs]));
					}
					if (input.trackerId) {
						clauses.push(eq(schema.tracker.id, input.trackerId));
					}

					const rows = yield* dbEffect(() =>
						db
							.select({
								...listedEntitySchemaSelection,
								scriptName: schema.sandboxScript.name,
								scriptMetadata: schema.sandboxScript.metadata,
								scriptId: schema.entitySchemaScript.sandboxScriptId,
							})
							.from(schema.trackerEntitySchema)
							.innerJoin(
								schema.tracker,
								eq(schema.tracker.id, schema.trackerEntitySchema.trackerId),
							)
							.innerJoin(
								schema.entitySchema,
								eq(schema.entitySchema.id, schema.trackerEntitySchema.entitySchemaId),
							)
							.leftJoin(
								schema.entitySchemaScript,
								eq(schema.entitySchemaScript.entitySchemaId, schema.entitySchema.id),
							)
							.leftJoin(
								schema.sandboxScript,
								eq(schema.sandboxScript.id, schema.entitySchemaScript.sandboxScriptId),
							)
							.where(and(...clauses))
							.orderBy(asc(schema.entitySchema.name), asc(schema.entitySchema.createdAt)),
					);

					const builtRows = yield* buildEntitySchemaRows(rows);
					return builtRows.map(toListedEntitySchema);
				}),
			getByIdForUser: (input: { userId: string; entitySchemaId: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select({
								...listedEntitySchemaSelection,
								scriptName: schema.sandboxScript.name,
								scriptMetadata: schema.sandboxScript.metadata,
								scriptId: schema.entitySchemaScript.sandboxScriptId,
							})
							.from(schema.entitySchema)
							.innerJoin(
								schema.trackerEntitySchema,
								eq(schema.trackerEntitySchema.entitySchemaId, schema.entitySchema.id),
							)
							.innerJoin(
								schema.tracker,
								eq(schema.tracker.id, schema.trackerEntitySchema.trackerId),
							)
							.leftJoin(
								schema.entitySchemaScript,
								eq(schema.entitySchemaScript.entitySchemaId, schema.entitySchema.id),
							)
							.leftJoin(
								schema.sandboxScript,
								eq(schema.sandboxScript.id, schema.entitySchemaScript.sandboxScriptId),
							)
							.where(
								and(
									eq(schema.entitySchema.id, input.entitySchemaId),
									eq(schema.tracker.userId, input.userId),
								),
							)
							.orderBy(asc(schema.trackerEntitySchema.createdAt)),
					);

					const [entry] = yield* buildEntitySchemaRows(rows);
					return entry ? toListedEntitySchema(entry) : null;
				}),
			findBySlug: (userId: string, slug: string) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.entitySchema.id })
							.from(schema.entitySchema)
							.where(
								and(eq(schema.entitySchema.userId, userId), eq(schema.entitySchema.slug, slug)),
							)
							.limit(1),
					);
					return row ?? null;
				}),
			getBuiltinBySlug: (slug: string) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.entitySchema.id })
							.from(schema.entitySchema)
							.where(
								and(
									eq(schema.entitySchema.slug, slug),
									isNull(schema.entitySchema.userId),
									eq(schema.entitySchema.isBuiltin, true),
								),
							)
							.limit(1),
					);
					return row ?? null;
				}),
			createEntitySchema: (input: {
				icon: string;
				name: string;
				slug: string;
				userId: string;
				accentColor: string;
				propertiesSchema: AppSchema;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const result = yield* dbEffect(() =>
						db
							.insert(schema.entitySchema)
							.values({
								isBuiltin: false,
								icon: input.icon,
								name: input.name,
								slug: input.slug,
								userId: input.userId,
								accentColor: input.accentColor,
								propertiesSchema: input.propertiesSchema,
							})
							.returning({
								id: schema.entitySchema.id,
								name: schema.entitySchema.name,
								icon: schema.entitySchema.icon,
								slug: schema.entitySchema.slug,
								isBuiltin: schema.entitySchema.isBuiltin,
								accentColor: schema.entitySchema.accentColor,
								propertiesSchema: schema.entitySchema.propertiesSchema,
							}),
					).pipe(
						Effect.mapError((error) =>
							isUniqueConstraintError(entitySchemaUserSlugConstraint)(error)
								? conflict("Entity schema slug already exists")
								: error,
						),
					);

					const row = result[0];
					if (!row) {
						return yield* new DbError({ message: "Entity schema insert returned no row" });
					}

					const propertiesSchema = yield* decodeStoredAppSchema(
						row.propertiesSchema,
						"Invalid properties schema in database",
					);

					return {
						id: row.id,
						name: row.name,
						icon: row.icon,
						slug: row.slug,
						propertiesSchema,
						isBuiltin: row.isBuiltin,
						accentColor: row.accentColor,
					};
				}),
		}),
	},
) {}
