import { and, asc, eq, inArray } from "drizzle-orm";
import { Either, Effect, Schema } from "effect";

import { CurrentDb, dbEffect, isUniqueConstraintError, schema } from "../../lib/db";
import { DbError, conflict } from "../../lib/errors";
import { AppSchema } from "../../lib/schema";
import type { ListedEntitySchema } from "./schemas";

export type ProviderWithMetadata = {
	readonly name: string;
	readonly scriptId: string;
	readonly scriptMetadata?: unknown;
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

const toListedEntitySchema = (row: ListedEntitySchemaWithMetadata): ListedEntitySchema => {
	const { providers, ...rest } = row;
	return { ...rest, providers: providers.map(({ scriptMetadata: _m, ...p }) => p) };
};

const entitySchemaUserSlugConstraint = "entity_schema_user_slug_unique";

const buildEntitySchemaRows = (
	rows: Array<{
		id: string;
		name: string;
		icon: string;
		slug: string;
		trackerId: string;
		isBuiltin: boolean;
		accentColor: string;
		scriptId: string | null;
		scriptName: string | null;
		propertiesSchema: Record<string, unknown>;
		scriptMetadata: Record<string, unknown> | null;
	}>,
): Effect.Effect<ListedEntitySchemaWithMetadata[], DbError> => {
	const schemaMap = new Map<string, { entry: ListedEntitySchemaWithMetadata; seen: Set<string> }>();
	for (const row of rows) {
		const schemaKey = `${row.id}::${row.trackerId}`;
		let record = schemaMap.get(schemaKey);
		if (!record) {
			const decoded = Schema.decodeUnknownEither(AppSchema)(row.propertiesSchema);
			if (Either.isLeft(decoded)) {
				return Effect.fail(new DbError({ message: "Invalid properties schema in database" }));
			}
			record = {
				seen: new Set(),
				entry: {
					id: row.id,
					providers: [],
					name: row.name,
					icon: row.icon,
					slug: row.slug,
					trackerId: row.trackerId,
					isBuiltin: row.isBuiltin,
					accentColor: row.accentColor,
					propertiesSchema: decoded.right,
				},
			};
			schemaMap.set(schemaKey, record);
		}
		if (row.scriptId && row.scriptName) {
			if (!record.seen.has(row.scriptId)) {
				record.seen.add(row.scriptId);
				record.entry.providers.push({
					name: row.scriptName,
					scriptId: row.scriptId,
					scriptMetadata: row.scriptMetadata ?? undefined,
				});
			}
		}
	}
	return Effect.succeed(Array.from(schemaMap.values()).map(({ entry }) => entry));
};

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

					const baseRow = rows[0];
					if (!baseRow) {
						return null;
					}

					const seenProviders = new Set<string>();
					const providers: ProviderWithMetadata[] = [];
					for (const row of rows) {
						if (row.scriptId && row.scriptName) {
							if (!seenProviders.has(row.scriptId)) {
								seenProviders.add(row.scriptId);
								providers.push({
									name: row.scriptName,
									scriptId: row.scriptId,
									scriptMetadata: row.scriptMetadata ?? undefined,
								});
							}
						}
					}

					const decoded = Schema.decodeUnknownEither(AppSchema)(baseRow.propertiesSchema);
					if (Either.isLeft(decoded)) {
						return yield* new DbError({ message: "Invalid properties schema in database" });
					}

					return toListedEntitySchema({
						providers,
						id: baseRow.id,
						name: baseRow.name,
						icon: baseRow.icon,
						slug: baseRow.slug,
						trackerId: baseRow.trackerId,
						isBuiltin: baseRow.isBuiltin,
						accentColor: baseRow.accentColor,
						propertiesSchema: decoded.right,
					});
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

					const decoded = Schema.decodeUnknownEither(AppSchema)(row.propertiesSchema);
					if (Either.isLeft(decoded)) {
						return yield* new DbError({ message: "Invalid properties schema in database" });
					}

					return {
						id: row.id,
						name: row.name,
						icon: row.icon,
						slug: row.slug,
						isBuiltin: row.isBuiltin,
						accentColor: row.accentColor,
						propertiesSchema: decoded.right,
					};
				}),
			linkToTracker: (input: { trackerId: string; entitySchemaId: string }) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.insert(schema.trackerEntitySchema)
							.values({ trackerId: input.trackerId, entitySchemaId: input.entitySchemaId })
							.returning({ trackerId: schema.trackerEntitySchema.trackerId }),
					);

					if (!row) {
						return yield* new DbError({
							message: "Tracker entity schema link insert returned no row",
						});
					}

					return row.trackerId;
				}),
			createDefaultSavedView: (input: {
				icon: string;
				userId: string;
				trackerId: string;
				accentColor: string;
				entitySchemaSlug: string;
				entitySchemaName: string;
			}) =>
				Effect.gen(function* () {
					const db = yield* CurrentDb;
					const builtinSavedViewName = `All ${input.entitySchemaName}s`;
					const viewSlug = builtinSavedViewName
						.replaceAll("_", "-")
						.trim()
						.toLowerCase()
						.replace(/\s+/g, "-")
						.replace(/[^a-z0-9-]/g, "")
						.replace(/-+/g, "-")
						.replace(/^-+|-+$/g, "");

					const defaultQueryDefinition = {
						filter: null,
						eventJoins: [],
						mode: "entities",
						computedFields: [],
						relationshipJoins: [],
						scope: [input.entitySchemaSlug],
						sort: {
							direction: "asc",
							expression: {
								type: "reference",
								reference: { type: "entity", path: ["name"], slug: input.entitySchemaSlug },
							},
						},
					};

					const nameColumnExpr = {
						type: "reference",
						reference: { path: ["name"], type: "entity", slug: input.entitySchemaSlug },
					};

					const defaultDisplayConfiguration = {
						table: { columns: [{ label: "Name", expression: nameColumnExpr }] },
						entityIdProperty: {
							type: "reference",
							reference: { path: ["id"], type: "entity", slug: input.entitySchemaSlug },
						},
						grid: {
							calloutProperty: null,
							primarySubtitleProperty: null,
							titleProperty: nameColumnExpr,
							secondarySubtitleProperty: null,
							eyebrowProperty: nameColumnExpr,
							imageProperty: {
								type: "reference",
								reference: { type: "entity", path: ["image"], slug: input.entitySchemaSlug },
							},
						},
						list: {
							calloutProperty: null,
							primarySubtitleProperty: null,
							titleProperty: nameColumnExpr,
							secondarySubtitleProperty: null,
							eyebrowProperty: nameColumnExpr,
							imageProperty: {
								type: "reference",
								reference: { type: "entity", path: ["image"], slug: input.entitySchemaSlug },
							},
						},
					};

					yield* dbEffect(() =>
						db.insert(schema.savedView).values({
							slug: viewSlug,
							isBuiltin: true,
							icon: input.icon,
							userId: input.userId,
							name: builtinSavedViewName,
							trackerId: input.trackerId,
							accentColor: input.accentColor,
							queryDefinition: defaultQueryDefinition,
							displayConfiguration: defaultDisplayConfiguration,
						}),
					);
				}),
		}),
	},
) {}
