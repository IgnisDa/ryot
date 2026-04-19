import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { type DbClient, db } from "~/lib/db";
import {
	entitySchema,
	entitySchemaScript,
	sandboxScript,
	savedView,
	tracker,
	trackerEntitySchema,
} from "~/lib/db/schema";
import {
	createDefaultDisplayConfiguration,
	createDefaultQueryDefinition,
} from "../saved-views/constants";
import { buildBuiltinSavedViewName } from "../saved-views/service";
import type { ListedEntitySchema, Provider } from "./schemas";
import type { EntitySchemaPropertiesShape } from "./service";

type EntitySchemaRow = Omit<ListedEntitySchema, "propertiesSchema"> & {
	propertiesSchema: unknown;
};

const listedEntitySchemaSelection = {
	id: entitySchema.id,
	name: entitySchema.name,
	icon: entitySchema.icon,
	slug: entitySchema.slug,
	isBuiltin: entitySchema.isBuiltin,
	accentColor: entitySchema.accentColor,
	trackerId: trackerEntitySchema.trackerId,
	propertiesSchema: entitySchema.propertiesSchema,
};

const builtinEntitySchemaSelection = {
	id: entitySchema.id,
	icon: entitySchema.icon,
	slug: entitySchema.slug,
	accentColor: entitySchema.accentColor,
};

const createdEntitySchemaSelection = {
	id: entitySchema.id,
	name: entitySchema.name,
	slug: entitySchema.slug,
	icon: entitySchema.icon,
	isBuiltin: entitySchema.isBuiltin,
	accentColor: entitySchema.accentColor,
	propertiesSchema: entitySchema.propertiesSchema,
};

const toListedEntitySchema = (row: EntitySchemaRow): ListedEntitySchema => ({
	...row,
	propertiesSchema: row.propertiesSchema as EntitySchemaPropertiesShape,
});

export const listEntitySchemasForUser = async (input: {
	userId: string;
	slugs?: string[];
	trackerId?: string;
}) => {
	const whereClauses = [eq(tracker.userId, input.userId)];
	if (input.slugs?.length) {
		whereClauses.push(inArray(entitySchema.slug, input.slugs));
	}
	if (input.trackerId) {
		whereClauses.push(eq(tracker.id, input.trackerId));
	}

	const rows = await db
		.select({
			...listedEntitySchemaSelection,
			scriptName: sandboxScript.name,
			scriptMetadata: sandboxScript.metadata,
			scriptId: entitySchemaScript.sandboxScriptId,
		})
		.from(trackerEntitySchema)
		.innerJoin(tracker, eq(tracker.id, trackerEntitySchema.trackerId))
		.innerJoin(
			entitySchema,
			eq(entitySchema.id, trackerEntitySchema.entitySchemaId),
		)
		.leftJoin(
			entitySchemaScript,
			eq(entitySchemaScript.entitySchemaId, entitySchema.id),
		)
		.leftJoin(
			sandboxScript,
			eq(sandboxScript.id, entitySchemaScript.sandboxScriptId),
		)
		.where(and(...whereClauses))
		.orderBy(asc(entitySchema.name), asc(entitySchema.createdAt));

	const schemaMap = new Map<
		string,
		{ entry: EntitySchemaRow; seen: Set<string> }
	>();
	for (const row of rows) {
		const schemaKey = `${row.id}::${row.trackerId}`;
		let record = schemaMap.get(schemaKey);
		if (!record) {
			record = { entry: { ...row, providers: [] }, seen: new Set() };
			schemaMap.set(schemaKey, record);
		}
		if (row.scriptId && row.scriptName) {
			if (!record.seen.has(row.scriptId)) {
				record.seen.add(row.scriptId);
				record.entry.providers.push({
					name: row.scriptName,
					scriptId: row.scriptId,
					searchDriverName: row.scriptMetadata?.searchDriverName,
				});
			}
		}
	}
	return Array.from(schemaMap.values()).map(({ entry }) =>
		toListedEntitySchema(entry),
	);
};

export const getEntitySchemaByIdForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const rows = await db
		.select({
			...listedEntitySchemaSelection,
			scriptName: sandboxScript.name,
			scriptId: entitySchemaScript.sandboxScriptId,
			scriptMetadata: sandboxScript.metadata,
		})
		.from(entitySchema)
		.innerJoin(
			trackerEntitySchema,
			eq(trackerEntitySchema.entitySchemaId, entitySchema.id),
		)
		.innerJoin(tracker, eq(tracker.id, trackerEntitySchema.trackerId))
		.leftJoin(
			entitySchemaScript,
			eq(entitySchemaScript.entitySchemaId, entitySchema.id),
		)
		.leftJoin(
			sandboxScript,
			eq(sandboxScript.id, entitySchemaScript.sandboxScriptId),
		)
		.where(
			and(
				eq(entitySchema.id, input.entitySchemaId),
				eq(tracker.userId, input.userId),
			),
		)
		.orderBy(asc(trackerEntitySchema.createdAt));

	const baseRow = rows[0];
	if (!baseRow) {
		return undefined;
	}

	const seenProviders = new Set<string>();
	const providers: Provider[] = [];
	for (const row of rows) {
		if (row.scriptId && row.scriptName) {
			if (!seenProviders.has(row.scriptId)) {
				seenProviders.add(row.scriptId);
				providers.push({
					name: row.scriptName,
					scriptId: row.scriptId,
					searchDriverName: row.scriptMetadata?.searchDriverName,
				});
			}
		}
	}
	return toListedEntitySchema({ ...baseRow, providers });
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
		.select(builtinEntitySchemaSelection)
		.from(entitySchema)
		.where(and(eq(entitySchema.isBuiltin, true), isNull(entitySchema.userId)));

	return rows;
};

export const getBuiltinEntitySchemaBySlug = async (slug: string) => {
	const [foundSchema] = await db
		.select({
			id: entitySchema.id,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.slug, slug),
				isNull(entitySchema.userId),
				eq(entitySchema.isBuiltin, true),
			),
		)
		.limit(1);

	return foundSchema;
};

export const createTrackerEntitySchemas = async (input: {
	database?: DbClient;
	links: Array<{
		trackerId: string;
		entitySchemaId: string;
		isDisabled?: boolean;
	}>;
}) => {
	if (!input.links.length) {
		return;
	}

	const database = input.database ?? db;

	await database.insert(trackerEntitySchema).values(
		input.links.map((link) => ({
			trackerId: link.trackerId,
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
	trackerId: string;
	accentColor: string;
	propertiesSchema: EntitySchemaPropertiesShape;
}) => {
	return db.transaction(async (tx) => {
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
			.returning(createdEntitySchemaSelection);

		if (!createdEntitySchema) {
			throw new Error("Could not persist entity schema");
		}

		const [createdTrackerEntitySchema] = await tx
			.insert(trackerEntitySchema)
			.values({
				trackerId: input.trackerId,
				entitySchemaId: createdEntitySchema.id,
			})
			.returning({ trackerId: trackerEntitySchema.trackerId });

		if (!createdTrackerEntitySchema) {
			throw new Error("Could not persist tracker entity schema link");
		}

		const [createdSavedView] = await tx
			.insert(savedView)
			.values({
				isBuiltin: true,
				icon: input.icon,
				userId: input.userId,
				trackerId: input.trackerId,
				accentColor: input.accentColor,
				name: buildBuiltinSavedViewName(input.name),
				displayConfiguration: createDefaultDisplayConfiguration(
					createdEntitySchema.slug,
				),
				queryDefinition: createDefaultQueryDefinition([
					createdEntitySchema.slug,
				]),
			})
			.returning({ id: savedView.id });

		if (!createdSavedView) {
			throw new Error("Could not persist built-in saved view");
		}

		return toListedEntitySchema({
			...createdEntitySchema,
			providers: [],
			trackerId: createdTrackerEntitySchema.trackerId,
		});
	});
};
