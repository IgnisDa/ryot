import { and, asc, eq, isNull } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import {
	entitySchema,
	facet,
	facetEntitySchema,
	savedView,
} from "~/lib/db/schema";
import { buildBuiltinSavedViewName } from "../saved-views/service";
import type { ListedEntitySchema } from "./schemas";
import type { EntitySchemaPropertiesShape } from "./service";

type EntitySchemaRow = Omit<ListedEntitySchema, "propertiesSchema"> & {
	propertiesSchema: unknown;
};

const toListedEntitySchema = (row: EntitySchemaRow): ListedEntitySchema => ({
	...row,
	propertiesSchema: row.propertiesSchema as EntitySchemaPropertiesShape,
});

export const listEntitySchemasByFacetForUser = async (input: {
	userId: string;
	facetId: string;
}) => {
	const rows = await db
		.select({
			id: entitySchema.id,
			name: entitySchema.name,
			icon: entitySchema.icon,
			slug: entitySchema.slug,
			facetId: facetEntitySchema.facetId,
			isBuiltin: entitySchema.isBuiltin,
			accentColor: entitySchema.accentColor,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(facetEntitySchema)
		.innerJoin(facet, eq(facet.id, facetEntitySchema.facetId))
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, facetEntitySchema.entitySchemaId),
		)
		.where(
			and(
				eq(facet.id, input.facetId),
				eq(facet.userId, input.userId),
				eq(facetEntitySchema.isDisabled, false),
			),
		)
		.orderBy(asc(entitySchema.name), asc(entitySchema.createdAt));

	return rows.map(toListedEntitySchema);
};

export const getEntitySchemaBySlugForUser = async (input: {
	slug: string;
	userId: string;
}) => {
	const [foundEntitySchema] = await db
		.select({ id: entitySchema.id })
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.userId, input.userId),
				eq(entitySchema.slug, input.slug),
			),
		)
		.limit(1);

	return foundEntitySchema;
};

export const listBuiltinEntitySchemas = async (input?: {
	database?: DbClient;
}) => {
	const database = input?.database ?? db;

	const rows = await database
		.select({
			id: entitySchema.id,
			icon: entitySchema.icon,
			slug: entitySchema.slug,
			accentColor: entitySchema.accentColor,
		})
		.from(entitySchema)
		.where(and(eq(entitySchema.isBuiltin, true), isNull(entitySchema.userId)));

	return rows;
};

export const createFacetEntitySchemas = async (input: {
	database?: DbClient;
	links: Array<{
		facetId: string;
		entitySchemaId: string;
		isDisabled?: boolean;
	}>;
}) => {
	if (!input.links.length) return;

	const database = input.database ?? db;

	await database.insert(facetEntitySchema).values(
		input.links.map((link) => ({
			facetId: link.facetId,
			entitySchemaId: link.entitySchemaId,
			isDisabled: link.isDisabled ?? false,
		})),
	);
};

export const createEntitySchemaForUser = async (input: {
	icon: string;
	name: string;
	slug: string;
	userId: string;
	facetId: string;
	accentColor: string;
	propertiesSchema: EntitySchemaPropertiesShape;
}) => {
	return await db.transaction(async (tx) => {
		const [createdEntitySchema] = await tx
			.insert(entitySchema)
			.values({
				icon: input.icon,
				name: input.name,
				slug: input.slug,
				isBuiltin: false,
				userId: input.userId,
				accentColor: input.accentColor,
				propertiesSchema: input.propertiesSchema,
			})
			.returning({
				id: entitySchema.id,
				name: entitySchema.name,
				slug: entitySchema.slug,
				icon: entitySchema.icon,
				isBuiltin: entitySchema.isBuiltin,
				accentColor: entitySchema.accentColor,
				propertiesSchema: entitySchema.propertiesSchema,
			});

		if (!createdEntitySchema)
			throw new Error("Could not persist entity schema");

		const [createdFacetEntitySchema] = await tx
			.insert(facetEntitySchema)
			.values({
				facetId: input.facetId,
				entitySchemaId: createdEntitySchema.id,
			})
			.returning({ facetId: facetEntitySchema.facetId });

		if (!createdFacetEntitySchema)
			throw new Error("Could not persist facet entity schema link");

		const [createdSavedView] = await tx
			.insert(savedView)
			.values({
				isBuiltin: true,
				icon: input.icon,
				userId: input.userId,
				facetId: input.facetId,
				accentColor: input.accentColor,
				name: buildBuiltinSavedViewName(input.name),
				queryDefinition: { entitySchemaIds: [createdEntitySchema.id] },
			})
			.returning({ id: savedView.id });

		if (!createdSavedView)
			throw new Error("Could not persist built-in saved view");

		return toListedEntitySchema({
			...createdEntitySchema,
			facetId: createdFacetEntitySchema.facetId,
		});
	});
};
