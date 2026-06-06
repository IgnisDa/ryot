import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, schema } from "#lib/db";
import type { DbError } from "#lib/errors";
import { BadRequest, NotFound } from "#lib/errors";
import type { QueryEventJoin, QueryRelationshipJoin } from "#lib/query-language";
import { decodeStoredAppSchema } from "#lib/schema";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "#lib/views/errors";
import type { QueryEngineEventJoinLike, QueryEngineEventSchemaLike } from "#lib/views/reference";

import type { LoadedRelationshipJoin } from "./context";
import type { QueryEngineSchemaRow } from "./query-cte-shared";

const tryQueryEngineSync = <T>(fn: () => T): Effect.Effect<T, NotFound | BadRequest> =>
	Effect.try({
		try: fn,
		catch: (error) => {
			if (error instanceof QueryEngineNotFoundError) {
				return new NotFound({ message: error.message });
			}
			return new BadRequest({
				message: error instanceof Error ? error.message : String(error),
			});
		},
	});

const groupRowsBySlug = <TRow extends { slug: string }>(rows: ReadonlyArray<TRow>) => {
	const rowsBySlug = new Map<string, TRow[]>();
	for (const row of rows) {
		const existing = rowsBySlug.get(row.slug) ?? [];
		existing.push(row);
		rowsBySlug.set(row.slug, existing);
	}
	return rowsBySlug;
};

const validateUniqueVisibleSlugs = <TRow extends { slug: string }>(input: {
	rows: ReadonlyArray<TRow>;
	slugs: ReadonlyArray<string>;
	onMissing: (slug: string) => Error;
	onDuplicate: (slug: string) => Error;
}) => {
	const rowsBySlug = groupRowsBySlug(input.rows);
	for (const slug of input.slugs) {
		const found = rowsBySlug.get(slug);
		if (!found?.length) {
			throw input.onMissing(slug);
		}

		if (found.length > 1) {
			throw input.onDuplicate(slug);
		}
	}
	return rowsBySlug;
};

const validatePresentSlugs = <TRow extends { slug: string }>(input: {
	rows: ReadonlyArray<TRow>;
	slugs: ReadonlyArray<string>;
	onMissing: (slug: string) => Error;
}) => {
	const rowsBySlug = groupRowsBySlug(input.rows);
	for (const slug of input.slugs) {
		if (!rowsBySlug.has(slug)) {
			throw input.onMissing(slug);
		}
	}
	return rowsBySlug;
};

type VisibleEventSchemaRow = QueryEngineEventSchemaLike & {
	entitySchemaSlug: string;
};

export const validateUniqueSchemaSlugs = (
	slugs: ReadonlyArray<string>,
	rows: ReadonlyArray<QueryEngineSchemaRow>,
) => {
	validateUniqueVisibleSlugs({
		rows,
		slugs,
		onMissing: (slug) => new QueryEngineNotFoundError(`Schema '${slug}' not found`),
		onDuplicate: (slug) =>
			new QueryEngineValidationError(`Schema '${slug}' resolves to multiple visible schemas`),
	});
};

const loadVisibleEventSchemaRows = (input: {
	userId: string;
	eventSchemaSlugs: ReadonlyArray<string>;
	runtimeSchemas: QueryEngineSchemaRow[];
}): Effect.Effect<VisibleEventSchemaRow[], DbError | BadRequest, CurrentDb> =>
	Effect.gen(function* () {
		const uniqueSlugs = [...new Set(input.eventSchemaSlugs)];
		if (!uniqueSlugs.length) {
			return [];
		}

		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select({
					id: schema.eventSchema.id,
					slug: schema.eventSchema.slug,
					entitySchemaSlug: schema.entitySchema.slug,
					entitySchemaId: schema.eventSchema.entitySchemaId,
					propertiesSchema: schema.eventSchema.propertiesSchema,
				})
				.from(schema.eventSchema)
				.innerJoin(
					schema.entitySchema,
					eq(schema.eventSchema.entitySchemaId, schema.entitySchema.id),
				)
				.where(
					and(
						inArray(
							schema.eventSchema.entitySchemaId,
							input.runtimeSchemas.map((s) => s.id),
						),
						inArray(schema.eventSchema.slug, uniqueSlugs),
						or(isNull(schema.eventSchema.userId), eq(schema.eventSchema.userId, input.userId)),
					),
				),
		);

		return yield* Effect.all(
			rows.map((row) =>
				decodeStoredAppSchema(
					row.propertiesSchema,
					"Invalid event schema properties in database",
				).pipe(
					Effect.map((propertiesSchema) => ({
						...row,
						propertiesSchema,
						entitySchemaSlug: row.entitySchemaSlug,
					})),
				),
			),
		);
	});

export const validateVisibleEventJoins = (
	eventJoins: ReadonlyArray<QueryEventJoin>,
	visibleEventSchemas: VisibleEventSchemaRow[],
): QueryEngineEventJoinLike[] => {
	const eventSchemasByEntitySchemaKey = new Map<string, QueryEngineEventSchemaLike>();
	for (const s of visibleEventSchemas) {
		const key = `${s.entitySchemaSlug}:${s.slug}`;
		if (eventSchemasByEntitySchemaKey.has(key)) {
			throw new QueryEngineValidationError(
				`Event schema '${s.slug}' resolves to multiple visible schemas for entity schema '${s.entitySchemaSlug}'`,
			);
		}

		eventSchemasByEntitySchemaKey.set(key, s);
	}

	return eventJoins.map((join) => {
		const eventSchemas = visibleEventSchemas.filter((s) => s.slug === join.eventSchemaSlug);
		if (!eventSchemas.length) {
			throw new QueryEngineValidationError(
				`Event schema '${join.eventSchemaSlug}' is not available for the requested entity schemas`,
			);
		}

		return {
			...join,
			eventSchemas,
			eventSchemaMap: new Map(eventSchemas.map((s) => [s.entitySchemaSlug, s])),
		};
	});
};

export const validateEventSchemaSlugs = (
	uniqueSlugs: ReadonlyArray<string>,
	rows: ReadonlyArray<{ slug: string }>,
) => {
	validatePresentSlugs({
		rows,
		slugs: uniqueSlugs,
		onMissing: (slug) =>
			new QueryEngineValidationError(
				`Event schema '${slug}' not found for the requested entity schemas`,
			),
	});
};

export const validateVisibleRelationshipSchemaRows = (
	slugs: ReadonlyArray<string>,
	rows: ReadonlyArray<{ id: string; slug: string }>,
) => {
	validateUniqueVisibleSlugs({
		rows,
		slugs,
		onMissing: (slug) => new QueryEngineValidationError(`Relationship schema '${slug}' not found`),
		onDuplicate: (slug) =>
			new QueryEngineValidationError(
				`Relationship schema '${slug}' resolves to multiple visible schemas`,
			),
	});
};

export const loadVisibleSchemas = (input: {
	userId: string;
	scope: ReadonlyArray<string>;
}): Effect.Effect<QueryEngineSchemaRow[], NotFound | BadRequest | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const uniqueSlugs = [...new Set(input.scope)];
		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select({
					id: schema.entitySchema.id,
					slug: schema.entitySchema.slug,
					propertiesSchema: schema.entitySchema.propertiesSchema,
				})
				.from(schema.entitySchema)
				.where(
					and(
						inArray(schema.entitySchema.slug, uniqueSlugs),
						or(isNull(schema.entitySchema.userId), eq(schema.entitySchema.userId, input.userId)),
					),
				),
		);

		const schemas = yield* Effect.all(
			rows.map((row) =>
				decodeStoredAppSchema(
					row.propertiesSchema,
					"Invalid entity schema properties in database",
				).pipe(Effect.map((propertiesSchema) => ({ ...row, propertiesSchema }))),
			),
		);

		yield* tryQueryEngineSync(() => {
			validateUniqueSchemaSlugs(uniqueSlugs, schemas);
		});

		return schemas;
	});

export const loadVisibleEventJoins = (input: {
	userId: string;
	eventJoins: ReadonlyArray<QueryEventJoin>;
	runtimeSchemas: QueryEngineSchemaRow[];
}): Effect.Effect<QueryEngineEventJoinLike[], NotFound | BadRequest | DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (!input.eventJoins.length) {
			return [];
		}

		const visibleEventSchemas = yield* loadVisibleEventSchemaRows({
			userId: input.userId,
			runtimeSchemas: input.runtimeSchemas,
			eventSchemaSlugs: input.eventJoins.map((join) => join.eventSchemaSlug),
		});

		return yield* tryQueryEngineSync(() =>
			validateVisibleEventJoins(input.eventJoins, visibleEventSchemas),
		);
	});

export const loadVisibleRelationshipJoins = (input: {
	userId: string;
	runtimeSchemas?: QueryEngineSchemaRow[];
	relationshipJoins: ReadonlyArray<QueryRelationshipJoin>;
}): Effect.Effect<LoadedRelationshipJoin[], NotFound | BadRequest | DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (!input.relationshipJoins.length) {
			return [];
		}

		const uniqueSlugs = [...new Set(input.relationshipJoins.map((r) => r.relationshipSchemaSlug))];
		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select({
					id: schema.relationshipSchema.id,
					slug: schema.relationshipSchema.slug,
					propertiesSchema: schema.relationshipSchema.propertiesSchema,
					sourceEntitySchemaId: schema.relationshipSchema.sourceEntitySchemaId,
					targetEntitySchemaId: schema.relationshipSchema.targetEntitySchemaId,
				})
				.from(schema.relationshipSchema)
				.where(
					and(
						inArray(schema.relationshipSchema.slug, uniqueSlugs),
						or(
							isNull(schema.relationshipSchema.userId),
							eq(schema.relationshipSchema.userId, input.userId),
						),
					),
				),
		);

		yield* tryQueryEngineSync(() => validateVisibleRelationshipSchemaRows(uniqueSlugs, rows));

		const entitySchemaIds = [
			...new Set(
				rows.flatMap((r) =>
					[r.sourceEntitySchemaId, r.targetEntitySchemaId].filter(
						(id): id is string => id !== null,
					),
				),
			),
		];

		const entitySchemaRows =
			entitySchemaIds.length > 0
				? yield* dbEffect(() =>
						db
							.select({
								id: schema.entitySchema.id,
								slug: schema.entitySchema.slug,
								propertiesSchema: schema.entitySchema.propertiesSchema,
							})
							.from(schema.entitySchema)
							.where(inArray(schema.entitySchema.id, entitySchemaIds)),
					)
				: [];

		const decodedEntitySchemaRows = yield* Effect.all(
			entitySchemaRows.map((row) =>
				decodeStoredAppSchema(
					row.propertiesSchema,
					"Invalid entity schema properties in database",
				).pipe(Effect.map((propertiesSchema) => ({ ...row, propertiesSchema }))),
			),
		);

		const entitySchemaById = new Map(decodedEntitySchemaRows.map((r) => [r.id, r]));
		const schemaBySlug = new Map(rows.map((r) => [r.slug, r]));
		const scopeSlugs = input.runtimeSchemas
			? new Set(input.runtimeSchemas.map((s) => s.slug))
			: null;

		return yield* Effect.all(
			input.relationshipJoins.map((join) =>
				Effect.gen(function* () {
					const relationshipSchemaRow = schemaBySlug.get(join.relationshipSchemaSlug);
					if (!relationshipSchemaRow) {
						return yield* new BadRequest({
							message: `Relationship schema '${join.relationshipSchemaSlug}' not found`,
						});
					}

					const sourceRow = relationshipSchemaRow.sourceEntitySchemaId
						? entitySchemaById.get(relationshipSchemaRow.sourceEntitySchemaId)
						: null;
					const targetRow = relationshipSchemaRow.targetEntitySchemaId
						? entitySchemaById.get(relationshipSchemaRow.targetEntitySchemaId)
						: null;

					if (scopeSlugs) {
						if (join.direction === "outgoing" && sourceRow && !scopeSlugs.has(sourceRow.slug)) {
							return yield* new BadRequest({
								message: `Relationship join '${join.key}': outgoing direction requires source entity schema '${sourceRow.slug}' to be in the query scope`,
							});
						}
						if (join.direction === "incoming" && targetRow && !scopeSlugs.has(targetRow.slug)) {
							return yield* new BadRequest({
								message: `Relationship join '${join.key}': incoming direction requires target entity schema '${targetRow.slug}' to be in the query scope`,
							});
						}
					}

					const propertiesSchema = yield* decodeStoredAppSchema(
						relationshipSchemaRow.propertiesSchema,
						"Invalid relationship schema properties in database",
					);

					return {
						...join,
						schemaId: relationshipSchemaRow.id,
						filter: join.filter ?? null,
						propertiesSchema,
						sourceEntitySchema: sourceRow
							? { slug: sourceRow.slug, propertiesSchema: sourceRow.propertiesSchema }
							: undefined,
						targetEntitySchema: targetRow
							? { slug: targetRow.slug, propertiesSchema: targetRow.propertiesSchema }
							: undefined,
					} satisfies LoadedRelationshipJoin;
				}),
			),
		);
	});

export const loadEventSchemaSlugs = (input: {
	userId: string;
	runtimeSchemas: QueryEngineSchemaRow[];
}): Effect.Effect<ReadonlySet<string>, DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (!input.runtimeSchemas.length) {
			return new Set();
		}

		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.selectDistinct({ slug: schema.eventSchema.slug })
				.from(schema.eventSchema)
				.where(
					and(
						inArray(
							schema.eventSchema.entitySchemaId,
							input.runtimeSchemas.map((s) => s.id),
						),
						or(isNull(schema.eventSchema.userId), eq(schema.eventSchema.userId, input.userId)),
					),
				),
		);

		return new Set(rows.map((r) => r.slug));
	});

export const loadEventSchemasBySlug = (input: {
	userId: string;
	eventSchemaSlugs: ReadonlyArray<string>;
	runtimeSchemas: QueryEngineSchemaRow[];
}): Effect.Effect<
	Map<string, QueryEngineEventSchemaLike[]>,
	NotFound | BadRequest | DbError,
	CurrentDb
> =>
	Effect.gen(function* () {
		if (!input.eventSchemaSlugs.length || !input.runtimeSchemas.length) {
			return new Map();
		}

		const uniqueSlugs = [...new Set(input.eventSchemaSlugs)];
		const rows = yield* loadVisibleEventSchemaRows({
			userId: input.userId,
			eventSchemaSlugs: uniqueSlugs,
			runtimeSchemas: input.runtimeSchemas,
		});

		yield* tryQueryEngineSync(() => validateEventSchemaSlugs(uniqueSlugs, rows));

		const eventSchemaMap = new Map<string, QueryEngineEventSchemaLike[]>();
		for (const row of rows) {
			const existing = eventSchemaMap.get(row.slug) ?? [];
			existing.push(row);
			eventSchemaMap.set(row.slug, existing);
		}

		return eventSchemaMap;
	});
