import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as dbSchema from "#lib/db/schema/tables";
import { type DbError, NotFound } from "#lib/errors";

import type { VisibleEventSchema, VisibleRelationshipSchema, VisibleSchema } from "./types";

export const loadVisibleEntitySchemas = (
	userId: string,
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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

export const loadVisibleRelationshipSchema = (
	userId: string,
	slug: string,
): Effect.Effect<VisibleRelationshipSchema, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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

export const loadVisibleRelationshipSchemas = (
	userId: string,
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleRelationshipSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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
	});

export const loadVisibleEventSchemas = (
	userId: string,
	entitySchemaId: string,
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleEventSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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

export const loadVisibleEventSchemasForEntitySchemas = (
	userId: string,
	entitySchemaIds: readonly string[],
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleEventSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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
