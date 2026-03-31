import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity, entitySchema, event, eventSchema } from "~/lib/db/schema";
import {
	type BuiltinMediaEntitySchemaSlug,
	type BuiltinMediaEventSchemaSlug,
	builtinMediaEntitySchemaSlugs,
	builtinMediaEventSchemaSlugs,
} from "~/lib/media/constants";

const recentActivitySelection = {
	id: event.id,
	entityName: entity.name,
	entityImage: entity.image,
	occurredAt: event.createdAt,
	properties: event.properties,
	eventSchemaSlug: eventSchema.slug,
	entitySchemaSlug: entitySchema.slug,
};

const mediaActivityPredicates = (input: {
	endAt?: Date;
	userId: string;
	startAt?: Date;
}) => {
	const predicates = [
		eq(event.userId, input.userId),
		inArray(entitySchema.slug, builtinMediaEntitySchemaSlugs),
		inArray(eventSchema.slug, builtinMediaEventSchemaSlugs),
	];

	if (input.startAt) {
		predicates.push(gte(event.createdAt, input.startAt));
	}

	if (input.endAt) {
		predicates.push(lt(event.createdAt, input.endAt));
	}

	return predicates;
};

const toNullableRating = (properties: unknown) => {
	if (!properties || typeof properties !== "object") {
		return null;
	}

	const rating = Reflect.get(properties, "rating");
	if (typeof rating === "number" && Number.isInteger(rating)) {
		return rating;
	}
	if (typeof rating === "string" && rating.trim().length > 0) {
		const parsed = Number(rating);
		return Number.isInteger(parsed) ? parsed : null;
	}

	return null;
};

const toNullableDate = (value: unknown) => {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === "string") {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	return null;
};

const resolveOccurredAt = (input: {
	createdAt: Date;
	properties: unknown;
	eventSchemaSlug: BuiltinMediaEventSchemaSlug;
}) => {
	if (input.eventSchemaSlug !== "complete") {
		return input.createdAt;
	}

	if (!input.properties || typeof input.properties !== "object") {
		return input.createdAt;
	}

	return (
		toNullableDate(Reflect.get(input.properties, "completedOn")) ??
		input.createdAt
	);
};

function isBuiltinMediaEntitySchemaSlug(
	value: string,
): value is BuiltinMediaEntitySchemaSlug {
	return builtinMediaEntitySchemaSlugs.includes(
		value as BuiltinMediaEntitySchemaSlug,
	);
}

function isBuiltinMediaEventSchemaSlug(
	value: string,
): value is BuiltinMediaEventSchemaSlug {
	return builtinMediaEventSchemaSlugs.includes(
		value as BuiltinMediaEventSchemaSlug,
	);
}

export const listRecentActivityEventsForUser = async (input: {
	limit: number;
	userId: string;
}) => {
	const rows = await db
		.select(recentActivitySelection)
		.from(event)
		.innerJoin(entity, eq(event.entityId, entity.id))
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.innerJoin(eventSchema, eq(event.eventSchemaId, eventSchema.id))
		.where(and(...mediaActivityPredicates({ userId: input.userId })))
		.orderBy(desc(event.createdAt), desc(event.id))
		.limit(input.limit);

	return rows.flatMap((row) => {
		if (
			!isBuiltinMediaEntitySchemaSlug(row.entitySchemaSlug) ||
			!isBuiltinMediaEventSchemaSlug(row.eventSchemaSlug)
		) {
			return [];
		}

		return [
			{
				id: row.id,
				eventSchemaSlug: row.eventSchemaSlug,
				rating: toNullableRating(row.properties),
				occurredAt: resolveOccurredAt({
					createdAt: row.occurredAt,
					properties: row.properties,
					eventSchemaSlug: row.eventSchemaSlug,
				}),
				entity: {
					name: row.entityName,
					image: row.entityImage,
					entitySchemaSlug: row.entitySchemaSlug,
				},
			},
		];
	});
};

export const listWeekActivityEventsForUser = async (input: {
	endAt: Date;
	startAt: Date;
	userId: string;
}) => {
	const rows = await db
		.select({ occurredAt: event.createdAt })
		.from(event)
		.innerJoin(entity, eq(event.entityId, entity.id))
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.innerJoin(eventSchema, eq(event.eventSchemaId, eventSchema.id))
		.where(
			and(
				...mediaActivityPredicates({
					endAt: input.endAt,
					userId: input.userId,
					startAt: input.startAt,
				}),
			),
		)
		.orderBy(desc(event.createdAt));

	return rows;
};
