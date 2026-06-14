import { expect } from "bun:test";

import { EntityId, EntitySchemaId, EventSchemaId } from "@ryot/app-backend/schema/brands";

import { getPgClient } from "../setup";
import { assertPresent, requireObjectRecord, requireString } from "../test-support/assertions";
import { createAuthenticatedClient, type Client } from "./auth";
import { postBackendJson, type ContractPayload, type ContractSuccess } from "./contract-client";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { createEventSchema } from "./event-schemas";
import { pollUntil } from "./polling";
import { createRelationshipSchema } from "./relationship-schemas";
import { createRelationship } from "./relationships";
import { createTracker } from "./trackers";

type QueryEngineRowValue = QueryEngineRowItem[string];
type QueryEngineRowItem = QueryEngineRowsResponse["data"]["items"][number];
type QueryEngineFieldValue = Extract<QueryEngineRowValue, { kind: string }>;
type QueryEngineRowsResponse = Extract<QueryEngineExecuteResponse, { type: "rows" }>;
type QueryEngineExecuteResponse = ContractSuccess<"queryEngine", "execute">;
type QueryEngineRowsOutput = Extract<QueryEnginePayload["output"], { type: "rows" }>;
type QueryEngineIncludeValue = Extract<
	QueryEngineRowValue,
	{ items: readonly QueryEngineRowItem[] }
>;
export type QueryEnginePayload = ContractPayload<"queryEngine", "execute">;
type QueryEngineAggregateResponse = Extract<QueryEngineExecuteResponse, { type: "aggregate" }>;
type QueryEngineTimeSeriesResponse = Extract<QueryEngineExecuteResponse, { type: "timeSeries" }>;
export async function executeQueryEngine(
	client: Client,
	doc: QueryEnginePayload,
): Promise<QueryEngineRowsResponse> {
	const result = await client.run((c) => c.queryEngine.execute({ payload: doc }));
	if (result.type !== "rows") {
		throw new Error(`Expected rows response, received ${result.type}`);
	}
	return result;
}

export async function executeAggregateQueryEngine(
	client: Client,
	doc: QueryEnginePayload,
): Promise<QueryEngineAggregateResponse> {
	const result = await client.run((c) => c.queryEngine.execute({ payload: doc }));
	if (result.type !== "aggregate") {
		throw new Error(`Expected aggregate response, received ${result.type}`);
	}
	return result;
}

export async function executeTimeSeriesQueryEngine(
	client: Client,
	doc: QueryEnginePayload,
): Promise<QueryEngineTimeSeriesResponse> {
	const result = await client.run((c) => c.queryEngine.execute({ payload: doc }));
	if (result.type !== "timeSeries") {
		throw new Error(`Expected timeSeries response, received ${result.type}`);
	}
	return result;
}

export async function executeQueryEngineError(client: Client, doc: QueryEnginePayload) {
	return client.runError((c) => c.queryEngine.execute({ payload: doc }));
}

export async function createQueryEngineTrackerAndSchema(
	client: Client,
	options: {
		schemaName: string;
		schemaSlug?: string;
		propertiesSchema?: Parameters<typeof createEntitySchema>[1]["propertiesSchema"];
	},
) {
	const { trackerId } = await createTracker(client);
	const { schemaId, slug } = await createEntitySchema(client, {
		trackerId,
		name: options.schemaName,
		...(options.schemaSlug ? { slug: options.schemaSlug } : {}),
		...(options.propertiesSchema ? { propertiesSchema: options.propertiesSchema } : {}),
	});
	return { trackerId, schemaId, slug };
}

export async function createQueryEngineEntity(
	client: Client,
	input: { name: string; entitySchemaId: string; properties?: Record<string, unknown> },
) {
	return createEntity(client, {
		name: input.name,
		properties: input.properties ?? {},
		entitySchemaId: EntitySchemaId.make(input.entitySchemaId),
	});
}

export async function createQueryEngineEvent(
	client: Client,
	input: {
		entityId: string;
		occurredAt?: string;
		eventSchemaId: string;
		sessionEntityId?: string;
		properties?: Record<string, unknown>;
	},
) {
	const countMatchingEvents = async () => {
		const events = await client.run((c) =>
			c.events.list({ urlParams: { entityId: EntityId.make(input.entityId) } }),
		);
		return events.filter(
			(event) =>
				event.eventSchemaId === input.eventSchemaId &&
				(input.occurredAt === undefined || event.occurredAt === input.occurredAt),
		).length;
	};

	const previousCount = await countMatchingEvents();
	const result = await client.run((c) =>
		c.events.create({
			payload: [
				{
					entityId: EntityId.make(input.entityId),
					properties: input.properties ?? {},
					...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
					eventSchemaId: EventSchemaId.make(input.eventSchemaId),
					...(input.sessionEntityId
						? { sessionEntityId: EntityId.make(input.sessionEntityId) }
						: {}),
				},
			],
		}),
	);

	await pollUntil(
		`query-engine event ${input.eventSchemaId} on entity ${input.entityId}`,
		async () => {
			const count = await countMatchingEvents();
			return count > previousCount ? count : null;
		},
		{ timeoutMs: 15000, intervalMs: 250 },
	);

	return result;
}

export const systemRef = (
	alias: string,
	name: string,
): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "system", name },
});

export const propertyRef = (
	alias: string,
	schema: string,
	...path: [string, ...string[]]
): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "property", schema, path },
});

export const schemaMetaRef = (
	alias: string,
	name: "slug" | "name" | "isBuiltin",
): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "schema", name },
});

export const literalExpr = (value: unknown): QueryEngineRowsOutput["orderBy"][number]["expr"] => ({
	type: "literal",
	value,
});

export const buildEntityRowsQueryDocument = (input: {
	alias: string;
	page?: number;
	limit?: number;
	include?: QueryEngineRowsOutput["include"];
	fields?: QueryEngineRowsOutput["fields"];
	orderBy?: QueryEngineRowsOutput["orderBy"];
	schemas: [string, ...string[]];
	where?: Extract<QueryEnginePayload["source"], { type: "entities" }>["where"];
}): QueryEnginePayload => ({
	source: {
		type: "entities",
		alias: input.alias,
		schemas: input.schemas,
		where: input.where ?? null,
	},
	output: {
		type: "rows",
		fields: input.fields ?? [],
		include: input.include ?? [],
		pagination: { page: input.page ?? 1, limit: input.limit ?? 10 },
		orderBy: input.orderBy ?? [{ order: "asc", expr: systemRef(input.alias, "name") }],
	},
});

export const buildEventRowsDoc = (input: {
	page?: number;
	limit?: number;
	eventAlias: string;
	entityAlias: string;
	eventSchemas: [string, ...string[]];
	entitySchemas: [string, ...string[]];
	fields: QueryEngineRowsOutput["fields"];
	orderBy: QueryEngineRowsOutput["orderBy"];
	where?: Extract<QueryEnginePayload["source"], { type: "events" }>["where"];
}): QueryEnginePayload => ({
	output: {
		type: "rows",
		fields: input.fields,
		orderBy: input.orderBy,
		pagination: { page: input.page ?? 1, limit: input.limit ?? 10 },
	},
	source: {
		type: "events",
		alias: input.eventAlias,
		where: input.where ?? null,
		schemas: input.eventSchemas,
		entity: { alias: input.entityAlias, schemas: input.entitySchemas },
	},
});

export const buildRowsDoc = (
	overrides: Partial<QueryEnginePayload> & {
		alias: string;
		page?: number;
		limit?: number;
		schemas: [string, ...string[]];
		fields?: QueryEngineRowsOutput["fields"];
		orderByExpr?: QueryEngineRowsOutput["orderBy"][number]["expr"];
	},
): QueryEnginePayload => {
	const { alias, schemas, fields = [], orderByExpr, page = 1, limit = 10, ...rest } = overrides;
	return {
		source: { type: "entities", alias, schemas, where: null },
		output: {
			fields,
			type: "rows",
			pagination: { page, limit },
			orderBy: [{ order: "asc", expr: orderByExpr ?? systemRef(alias, "name") }],
		},
		...rest,
	};
};

export const expectMalformedQueryBadRequest = async (body: unknown, cookies: string) => {
	const response = await postBackendJson("/query-engine/execute", body, cookies);
	const error = requireObjectRecord(await response.json(), "Expected BadRequest response");

	expect(response.status).toBe(400);
	expect(requireString(error._tag, "Expected error tag")).toBe("BadRequest");
};

export const getBuiltinEntitySchemaId = async (slug: string) => {
	const result = await getPgClient().query<{ id: string }>(
		`select id from entity_schema where slug = $1 and user_id is null and is_builtin = true limit 1`,
		[slug],
	);
	const row = result.rows[0];
	assertPresent(row, `Expected builtin entity schema '${slug}'`);
	return row.id;
};

export const insertGlobalRelationship = async (input: {
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
}) => {
	await getPgClient().query(
		`insert into relationship (
			id,
			user_id,
			properties,
			source_entity_id,
			target_entity_id,
			relationship_schema_id
		) values ($1, null, '{}'::jsonb, $2, $3, $4)
		on conflict (user_id, source_entity_id, target_entity_id, relationship_schema_id)
		where user_id is null do nothing`,
		[crypto.randomUUID(), input.sourceEntityId, input.targetEntityId, input.relationshipSchemaId],
	);
};

export const showEpisodeEventExistsSource = (episodeAlias: string, eventSlug: string) =>
	({
		where: null,
		type: "events",
		schemas: [eventSlug],
		alias: `${episodeAlias}${eventSlug}`,
		entityRef: episodeAlias,
	}) as const;

export const showSeasonSource = (alias: string, where: QueryEnginePayload["source"]["where"]) =>
	({
		where,
		alias,
		type: "entities",
		schemas: ["show-season"],
		via: {
			entityRef: "show",
			alias: `${alias}Rel`,
			direction: "outgoing",
			schema: "show-to-show-season",
		},
	}) as const;

export const seasonEpisodeSource = (
	seasonAlias: string,
	episodeAlias: string,
	where: QueryEnginePayload["source"]["where"],
) =>
	({
		where,
		type: "entities",
		alias: episodeAlias,
		schemas: ["show-episode"],
		via: {
			direction: "outgoing",
			entityRef: seasonAlias,
			alias: `${episodeAlias}Rel`,
			schema: "show-season-to-show-episode",
		},
	}) as const;

export const podcastEpisodeSource = (
	episodeAlias: string,
	where: QueryEnginePayload["source"]["where"],
) =>
	({
		where,
		type: "entities",
		alias: episodeAlias,
		schemas: ["podcast-episode"],
		via: {
			entityRef: "podcast",
			direction: "outgoing",
			alias: `${episodeAlias}Rel`,
			schema: "podcast-to-podcast-episode",
		},
	}) as const;

export const createCourseLessonFilterFixture = async () => {
	const { client } = await createAuthenticatedClient();
	const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
		client,
		{ schemaName: "FilterCourse" },
	);
	const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
		client,
		{ schemaName: "FilterModule" },
	);
	const { schemaId: lessonSchemaId, slug: lessonSlug } = await createQueryEngineTrackerAndSchema(
		client,
		{
			schemaName: "FilterLesson",
			propertiesSchema: {
				fields: {
					durationMinutes: {
						type: "integer",
						label: "Duration Minutes",
						description: "Lesson duration in minutes",
					},
				},
			},
		},
	);
	const completeSlug = `filter-complete-${crypto.randomUUID()}`;
	const completeSchema = await createEventSchema(client, {
		slug: completeSlug,
		name: "Filter Complete",
		entitySchemaId: lessonSchemaId,
		propertiesSchema: {
			fields: { note: { type: "string", label: "Note", description: "Completion note" } },
		},
	});
	const courseModuleSlug = `filter-course-module-${crypto.randomUUID()}`;
	const moduleLessonSlug = `filter-module-lesson-${crypto.randomUUID()}`;
	const courseModuleSchema = await createRelationshipSchema(client, {
		slug: courseModuleSlug,
		name: "Filter Course Module",
		propertiesSchema: { fields: {} },
		targetEntitySchemaId: moduleSchemaId,
		sourceEntitySchemaId: courseSchemaId,
	});
	const moduleLessonSchema = await createRelationshipSchema(client, {
		slug: moduleLessonSlug,
		name: "Filter Module Lesson",
		propertiesSchema: { fields: {} },
		targetEntitySchemaId: lessonSchemaId,
		sourceEntitySchemaId: moduleSchemaId,
	});

	const createCourse = async (
		name: string,
		lessons: readonly { durationMinutes: number; complete: boolean }[],
	) => {
		const course = await createQueryEngineEntity(client, { name, entitySchemaId: courseSchemaId });
		await Promise.all(
			lessons.map(async (lessonInput, index) => {
				const [module, lesson] = await Promise.all([
					createQueryEngineEntity(client, {
						entitySchemaId: moduleSchemaId,
						name: `${name} Module ${index + 1}`,
					}),
					createQueryEngineEntity(client, {
						entitySchemaId: lessonSchemaId,
						name: `${name} Lesson ${index + 1}`,
						properties: { durationMinutes: lessonInput.durationMinutes },
					}),
				]);
				await Promise.all([
					createRelationship(client, {
						targetEntityId: module.id,
						sourceEntityId: course.id,
						relationshipSchemaId: courseModuleSchema.id,
					}),
					createRelationship(client, {
						targetEntityId: lesson.id,
						sourceEntityId: module.id,
						relationshipSchemaId: moduleLessonSchema.id,
					}),
				]);
				if (lessonInput.complete) {
					await createQueryEngineEvent(client, {
						entityId: lesson.id,
						eventSchemaId: completeSchema.id,
					});
				}
			}),
		);
	};

	await createCourse("Advanced Course", [
		{ complete: true, durationMinutes: 35 },
		{ complete: true, durationMinutes: 65 },
	]);
	await createCourse("Short Course", [{ complete: true, durationMinutes: 30 }]);
	await createCourse("Long Incomplete Course", [{ complete: false, durationMinutes: 90 }]);

	return {
		client,
		courseSlug,
		moduleSlug,
		lessonSlug,
		completeSlug,
		moduleLessonSlug,
		courseModuleSlug,
	};
};

export const getQueryEngineFieldValue = (
	item: QueryEngineRowItem,
	key: string,
): QueryEngineRowValue | undefined => item[key];

export const getQueryEngineFieldOrThrow = (item: QueryEngineRowItem | undefined, key: string) => {
	if (item === undefined) {
		throw new Error("Expected query engine row");
	}
	const value = getQueryEngineFieldValue(item, key);
	if (value === undefined || !("kind" in value)) {
		throw new Error(`Expected field '${key}' in row`);
	}
	return { ...value, key };
};

export const requireQueryEngineFieldValue = (
	item: QueryEngineRowItem,
	key: string,
): QueryEngineFieldValue => {
	const val = getQueryEngineFieldValue(item, key);
	if (val === undefined || !("kind" in val)) {
		throw new Error(`Expected field '${key}' in row`);
	}
	return val;
};

export const requireQueryEngineIncludeValue = (
	item: QueryEngineRowItem,
	key: string,
): QueryEngineIncludeValue => {
	const val = getQueryEngineFieldValue(item, key);
	if (val === undefined || !("items" in val)) {
		throw new Error(`Expected include '${key}' in row`);
	}
	return val;
};
