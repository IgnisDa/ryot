import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipSchemaId,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import { createAuthenticatedClient, type Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { createEventSchema } from "./event-schemas";
import { listEventsForEntity } from "./events";
import { pollUntil } from "./polling";
import { createRelationshipSchema } from "./relationship-schemas";
import { createRelationship } from "./relationships";
import { createTracker } from "./trackers";

export const createQueryEngineTrackerAndSchema = (
	client: Client,
	options: {
		schemaName: string;
		schemaSlug?: string;
		propertiesSchema?: Parameters<typeof createEntitySchema>[1]["propertiesSchema"];
	},
) =>
	Effect.gen(function* () {
		const { trackerId } = yield* createTracker(client);
		const { schemaId, slug } = yield* createEntitySchema(client, {
			trackerId,
			name: options.schemaName,
			...(options.schemaSlug ? { slug: options.schemaSlug } : {}),
			...(options.propertiesSchema ? { propertiesSchema: options.propertiesSchema } : {}),
		});
		return { trackerId, schemaId, slug };
	});

export const createQueryEngineEntity = (
	client: Client,
	input: { name: string; entitySchemaId: string; properties?: Record<string, unknown> },
) =>
	createEntity(client, {
		name: input.name,
		properties: input.properties ?? {},
		entitySchemaId: EntitySchemaId.make(input.entitySchemaId),
	});

export const createQueryEngineEvent = (
	client: Client,
	input: {
		entityId: string;
		occurredAt?: string;
		eventSchemaId: string;
		sessionEntityId?: string;
		properties?: Record<string, unknown>;
	},
) =>
	Effect.gen(function* () {
		const countMatchingEvents = Effect.gen(function* () {
			const events = yield* listEventsForEntity(client, input.entityId);
			return events.filter(
				(event) =>
					event.eventSchemaId === input.eventSchemaId &&
					(input.occurredAt === undefined || event.occurredAt === input.occurredAt),
			).length;
		});

		const previousCount = yield* countMatchingEvents;
		const result = yield* client.call((c) =>
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

		yield* pollUntil(
			`query-engine event ${input.eventSchemaId} on entity ${input.entityId}`,
			Effect.gen(function* () {
				const count = yield* countMatchingEvents;
				return count > previousCount ? count : null;
			}),
			{ timeoutMs: 15000, intervalMs: 250 },
		);

		return result;
	});

export const insertGlobalRelationship = (input: {
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
	properties?: Record<string, unknown>;
}) =>
	getBackendClient().call(
		(c) =>
			c.testSupport.upsertGlobalRelationship({
				payload: {
					properties: input.properties,
					sourceEntityId: EntityId.make(input.sourceEntityId),
					targetEntityId: EntityId.make(input.targetEntityId),
					relationshipSchemaId: RelationshipSchemaId.make(input.relationshipSchemaId),
				},
			}),
		adminHeaders,
	);

export const createCourseLessonFilterFixture = () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { schemaId: courseSchemaId, slug: courseSlug } = yield* createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "FilterCourse" },
		);
		const { schemaId: moduleSchemaId, slug: moduleSlug } = yield* createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "FilterModule" },
		);
		const { schemaId: lessonSchemaId, slug: lessonSlug } = yield* createQueryEngineTrackerAndSchema(
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
		const completeSchema = yield* createEventSchema(client, {
			slug: completeSlug,
			name: "Filter Complete",
			entitySchemaId: lessonSchemaId,
		});
		const courseModuleSlug = `filter-course-module-${crypto.randomUUID()}`;
		const moduleLessonSlug = `filter-module-lesson-${crypto.randomUUID()}`;
		const courseModuleSchema = yield* createRelationshipSchema(client, {
			slug: courseModuleSlug,
			name: "Filter Course Module",
			targetEntitySchemaId: moduleSchemaId,
			sourceEntitySchemaId: courseSchemaId,
		});
		const moduleLessonSchema = yield* createRelationshipSchema(client, {
			slug: moduleLessonSlug,
			name: "Filter Module Lesson",
			targetEntitySchemaId: lessonSchemaId,
			sourceEntitySchemaId: moduleSchemaId,
		});

		const createCourse = (
			name: string,
			lessons: readonly { durationMinutes: number; complete: boolean }[],
		) =>
			Effect.gen(function* () {
				const course = yield* createQueryEngineEntity(client, {
					name,
					entitySchemaId: courseSchemaId,
				});
				yield* Effect.all(
					lessons.map((lessonInput, index) =>
						Effect.gen(function* () {
							const [module, lesson] = yield* Effect.all([
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
							yield* Effect.all([
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
								yield* createQueryEngineEvent(client, {
									entityId: lesson.id,
									eventSchemaId: completeSchema.id,
								});
							}
						}),
					),
				);
			});

		yield* createCourse("Advanced Course", [
			{ complete: true, durationMinutes: 35 },
			{ complete: true, durationMinutes: 65 },
		]);
		yield* createCourse("Short Course", [{ complete: true, durationMinutes: 30 }]);
		yield* createCourse("Long Incomplete Course", [{ complete: false, durationMinutes: 90 }]);

		return {
			client,
			courseSlug,
			moduleSlug,
			lessonSlug,
			completeSlug,
			moduleLessonSlug,
			courseModuleSlug,
		};
	});
