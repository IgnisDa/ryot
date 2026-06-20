import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import * as dbSchema from "#lib/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/db/service";
import { NotFound } from "#lib/errors";
import type { AppSchema } from "#lib/schema/property-schema";

export type VisibleEntityPropertySchema = { slug: string; propertiesSchema: AppSchema };

export const loadVisibleEntityPropertySchemas = Effect.fn("loadVisibleEntityPropertySchemas")(
	function* (userId: string, slugs: readonly string[]) {
		const uniqueSlugs = [...new Set(slugs)];
		if (uniqueSlugs.length === 0) {
			return [];
		}

		const db = yield* CurrentDb;
		return yield* dbEffect(() =>
			db
				.select({
					slug: dbSchema.entitySchema.slug,
					propertiesSchema: dbSchema.entitySchema.propertiesSchema,
				})
				.from(dbSchema.entitySchema)
				.where(
					and(
						inArray(dbSchema.entitySchema.slug, uniqueSlugs),
						or(eq(dbSchema.entitySchema.userId, userId), isNull(dbSchema.entitySchema.userId)),
					),
				),
		);
	},
);

// Every entity-schema slug the user can see (own + global builtins). Used by the interest reconciler
// to pass a guaranteed-visible schema list to the query engine (which 404s on any invisible slug).
export const loadVisibleEntitySchemaSlugs = Effect.fn("loadVisibleEntitySchemaSlugs")(function* (
	userId: string,
) {
	const db = yield* CurrentDb;
	const rows = yield* dbEffect(() =>
		db
			.select({ slug: dbSchema.entitySchema.slug })
			.from(dbSchema.entitySchema)
			.where(or(eq(dbSchema.entitySchema.userId, userId), isNull(dbSchema.entitySchema.userId))),
	);
	return rows.map((row) => row.slug);
});

export const loadVisibleEntitySchemas = Effect.fn("loadVisibleEntitySchemas")(function* (
	userId: string,
	slugs: readonly [string, ...string[]],
) {
	const db = yield* CurrentDb;
	const uniqueSlugs = [...new Set(slugs)];

	const rows = yield* dbEffect(() =>
		db
			.select({ id: dbSchema.entitySchema.id, slug: dbSchema.entitySchema.slug })
			.from(dbSchema.entitySchema)
			.where(
				and(
					inArray(dbSchema.entitySchema.slug, uniqueSlugs),
					or(eq(dbSchema.entitySchema.userId, userId), isNull(dbSchema.entitySchema.userId)),
				),
			),
	);

	const visibleSlugs = new Set(rows.map((row) => row.slug));
	for (const slug of uniqueSlugs) {
		if (!visibleSlugs.has(slug)) {
			return yield* new NotFound({ message: `Entity schema '${slug}' not found` });
		}
	}

	return rows;
});

export const loadVisibleRelationshipSchema = Effect.fn("loadVisibleRelationshipSchema")(function* (
	userId: string,
	slug: string,
) {
	const db = yield* CurrentDb;
	const rows = yield* dbEffect(() =>
		db
			.select({ id: dbSchema.relationshipSchema.id, slug: dbSchema.relationshipSchema.slug })
			.from(dbSchema.relationshipSchema)
			.where(
				and(
					eq(dbSchema.relationshipSchema.slug, slug),
					or(
						eq(dbSchema.relationshipSchema.userId, userId),
						isNull(dbSchema.relationshipSchema.userId),
					),
				),
			),
	);

	const schema = rows[0];
	if (!schema) {
		return yield* new NotFound({ message: `Relationship schema '${slug}' not found` });
	}
	return schema;
});

export const loadVisibleRelationshipSchemas = Effect.fn("loadVisibleRelationshipSchemas")(
	function* (userId: string, slugs: readonly [string, ...string[]]) {
		const db = yield* CurrentDb;
		const uniqueSlugs = [...new Set(slugs)];

		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.relationshipSchema.id, slug: dbSchema.relationshipSchema.slug })
				.from(dbSchema.relationshipSchema)
				.where(
					and(
						inArray(dbSchema.relationshipSchema.slug, uniqueSlugs),
						or(
							eq(dbSchema.relationshipSchema.userId, userId),
							isNull(dbSchema.relationshipSchema.userId),
						),
					),
				),
		);

		const visibleSlugs = new Set(rows.map((row) => row.slug));
		for (const slug of uniqueSlugs) {
			if (!visibleSlugs.has(slug)) {
				return yield* new NotFound({ message: `Relationship schema '${slug}' not found` });
			}
		}

		return rows;
	},
);

export const loadVisibleEventSchemas = Effect.fn("loadVisibleEventSchemas")(function* (
	userId: string,
	entitySchemaId: string,
	slugs: readonly [string, ...string[]],
) {
	const db = yield* CurrentDb;
	const uniqueSlugs = [...new Set(slugs)];

	const rows = yield* dbEffect(() =>
		db
			.select({ id: dbSchema.eventSchema.id, slug: dbSchema.eventSchema.slug })
			.from(dbSchema.eventSchema)
			.where(
				and(
					eq(dbSchema.eventSchema.entitySchemaId, entitySchemaId),
					inArray(dbSchema.eventSchema.slug, uniqueSlugs),
					or(eq(dbSchema.eventSchema.userId, userId), isNull(dbSchema.eventSchema.userId)),
				),
			),
	);

	const visibleSlugs = new Set(rows.map((row) => row.slug));
	for (const slug of uniqueSlugs) {
		if (!visibleSlugs.has(slug)) {
			return yield* new NotFound({ message: `Event schema '${slug}' not found` });
		}
	}

	return rows;
});

export const loadVisibleEventSchemasForEntitySchemas = Effect.fn(
	"loadVisibleEventSchemasForEntitySchemas",
)(function* (
	userId: string,
	entitySchemaIds: readonly string[],
	slugs: readonly [string, ...string[]],
) {
	const db = yield* CurrentDb;
	const uniqueSlugs = [...new Set(slugs)];

	const rows = yield* dbEffect(() =>
		db
			.select({ id: dbSchema.eventSchema.id, slug: dbSchema.eventSchema.slug })
			.from(dbSchema.eventSchema)
			.where(
				and(
					inArray(dbSchema.eventSchema.entitySchemaId, entitySchemaIds),
					inArray(dbSchema.eventSchema.slug, uniqueSlugs),
					or(eq(dbSchema.eventSchema.userId, userId), isNull(dbSchema.eventSchema.userId)),
				),
			),
	);

	const visibleSlugs = new Set(rows.map((row) => row.slug));
	for (const slug of uniqueSlugs) {
		if (!visibleSlugs.has(slug)) {
			return yield* new NotFound({ message: `Event schema '${slug}' not found` });
		}
	}

	return rows;
});
