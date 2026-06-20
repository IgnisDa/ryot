import { DbError, conflict } from "@ryot/contract/errors";
import type { ListedEntitySchema, Provider } from "@ryot/contract/modules/entity-schemas/schemas";
import {
	EntitySchemaId,
	SandboxScriptId,
	type Slug,
	TrackerId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { decodeStoredAppSchema } from "@ryot/contract/schema/core";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/db/schema/tables/combined";
import { CurrentDb, dbEffect, isUniqueConstraintError } from "#lib/db/service";

type BuildEntitySchemaRow = Pick<
	typeof schema.entitySchema.$inferSelect,
	"id" | "name" | "icon" | "slug" | "isBuiltin" | "accentColor" | "propertiesSchema"
> & {
	readonly trackerId: (typeof schema.trackerEntitySchema.$inferSelect)["trackerId"];
	readonly scriptId:
		| (typeof schema.entitySchemaSandboxScript.$inferSelect)["sandboxScriptId"]
		| null;
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

const buildEntitySchemaRows = Effect.fn(function* (rows: Array<BuildEntitySchemaRow>) {
	const schemaMap = new Map<string, { entry: ListedEntitySchemaWithMetadata; seen: Set<string> }>();
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
					id: EntitySchemaId.make(row.id),
					providers: [],
					name: row.name,
					icon: row.icon,
					slug: row.slug,
					propertiesSchema,
					isBuiltin: row.isBuiltin,
					trackerId: TrackerId.make(row.trackerId),
					accentColor: row.accentColor,
				},
			};
			schemaMap.set(schemaKey, record);
		}
		if (row.scriptId && row.scriptName && !record.seen.has(row.scriptId)) {
			record.seen.add(row.scriptId);
			record.entry.providers.push({
				name: row.scriptName,
				scriptId: SandboxScriptId.make(row.scriptId),
				scriptMetadata: row.scriptMetadata ?? undefined,
			});
		}
	}
	return Array.from(schemaMap.values()).map(({ entry }) => entry);
});

export class EntitySchemasRepository extends Effect.Service<EntitySchemasRepository>()(
	"EntitySchemasRepository",
	{
		sync: () => {
			const listVisibleBySlugs = Effect.fn("EntitySchemasRepository.listVisibleBySlugs")(function* (
				userId: UserId,
				slugs: readonly [string, ...string[]],
			) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({
							slug: schema.entitySchema.slug,
							propertiesSchema: schema.entitySchema.propertiesSchema,
						})
						.from(schema.entitySchema)
						.where(
							and(
								inArray(schema.entitySchema.slug, [...new Set(slugs)]),
								or(eq(schema.entitySchema.userId, userId), isNull(schema.entitySchema.userId)),
							),
						),
				);

				return rows.map((row) => ({
					propertiesSchema: row.propertiesSchema,
					slug: row.slug,
				}));
			});

			const listByUser = Effect.fn("EntitySchemasRepository.listByUser")(function* (input: {
				userId: UserId;
				trackerId?: TrackerId;
				slugs?: ReadonlyArray<string>;
			}) {
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
							scriptId: schema.entitySchemaSandboxScript.sandboxScriptId,
						})
						.from(schema.trackerEntitySchema)
						.innerJoin(schema.tracker, eq(schema.tracker.id, schema.trackerEntitySchema.trackerId))
						.innerJoin(
							schema.entitySchema,
							eq(schema.entitySchema.id, schema.trackerEntitySchema.entitySchemaId),
						)
						.leftJoin(
							schema.entitySchemaSandboxScript,
							eq(schema.entitySchemaSandboxScript.entitySchemaId, schema.entitySchema.id),
						)
						.leftJoin(
							schema.sandboxScript,
							eq(schema.sandboxScript.id, schema.entitySchemaSandboxScript.sandboxScriptId),
						)
						.where(and(...clauses))
						.orderBy(asc(schema.entitySchema.name), asc(schema.entitySchema.createdAt)),
				);

				const builtRows = yield* buildEntitySchemaRows(rows);
				return builtRows.map(toListedEntitySchema);
			});

			const getByIdForUser = Effect.fn("EntitySchemasRepository.getByIdForUser")(function* (input: {
				userId: UserId;
				entitySchemaId: EntitySchemaId;
			}) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({
							...listedEntitySchemaSelection,
							scriptName: schema.sandboxScript.name,
							scriptMetadata: schema.sandboxScript.metadata,
							scriptId: schema.entitySchemaSandboxScript.sandboxScriptId,
						})
						.from(schema.entitySchema)
						.innerJoin(
							schema.trackerEntitySchema,
							eq(schema.trackerEntitySchema.entitySchemaId, schema.entitySchema.id),
						)
						.innerJoin(schema.tracker, eq(schema.tracker.id, schema.trackerEntitySchema.trackerId))
						.leftJoin(
							schema.entitySchemaSandboxScript,
							eq(schema.entitySchemaSandboxScript.entitySchemaId, schema.entitySchema.id),
						)
						.leftJoin(
							schema.sandboxScript,
							eq(schema.sandboxScript.id, schema.entitySchemaSandboxScript.sandboxScriptId),
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
			});

			const findBySlug = Effect.fn("EntitySchemasRepository.findBySlug")(function* (
				userId: UserId,
				slug: string,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.entitySchema.id })
						.from(schema.entitySchema)
						.where(and(eq(schema.entitySchema.userId, userId), eq(schema.entitySchema.slug, slug)))
						.limit(1),
				);
				return row ? { id: EntitySchemaId.make(row.id) } : null;
			});

			const getBuiltinBySlug = Effect.fn("EntitySchemasRepository.getBuiltinBySlug")(function* (
				slug: string,
			) {
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
				return row ? { id: EntitySchemaId.make(row.id) } : null;
			});

			const createEntitySchema = Effect.fn("EntitySchemasRepository.createEntitySchema")(
				function* (input: {
					icon: string;
					name: string;
					slug: Slug;
					userId: UserId;
					accentColor: string;
					propertiesSchema: AppSchema;
				}) {
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
						id: EntitySchemaId.make(row.id),
						name: row.name,
						icon: row.icon,
						slug: row.slug,
						propertiesSchema,
						isBuiltin: row.isBuiltin,
						accentColor: row.accentColor,
					};
				},
			);

			return {
				listVisibleBySlugs,
				listByUser,
				getByIdForUser,
				findBySlug,
				getBuiltinBySlug,
				createEntitySchema,
			};
		},
	},
) {}
