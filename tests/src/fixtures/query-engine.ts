import { EntityId, EntitySchemaId, EventSchemaId } from "@ryot/contract/schema/brands";

import { getPgClient } from "../setup";
import { createAuthenticatedClient, type Client } from "./auth";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { createEventSchema } from "./event-schemas";
import { listEventsForEntity } from "./events";
import { pollUntil } from "./polling";
import type { QueryEnginePayload } from "./query-engine-core";
import { createRelationshipSchema } from "./relationship-schemas";
import { createRelationship } from "./relationships";
import { createTracker } from "./trackers";

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
		const events = await listEventsForEntity(client, input.entityId);
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
	});
	const courseModuleSlug = `filter-course-module-${crypto.randomUUID()}`;
	const moduleLessonSlug = `filter-module-lesson-${crypto.randomUUID()}`;
	const courseModuleSchema = await createRelationshipSchema(client, {
		slug: courseModuleSlug,
		name: "Filter Course Module",
		targetEntitySchemaId: moduleSchemaId,
		sourceEntitySchemaId: courseSchemaId,
	});
	const moduleLessonSchema = await createRelationshipSchema(client, {
		slug: moduleLessonSlug,
		name: "Filter Module Lesson",
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
