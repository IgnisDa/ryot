import type { ContractPayload } from "@ryot-app/contract/client";
import { EntityId, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { HarnessTarget } from "~/support/harness-target";

import { type Client, createAuthenticatedClient } from "./auth";
import { getApiClient } from "./contract-client";
import { createEntity } from "./entities";
import { createEntitySchema } from "./entity-schemas";
import { createEventSchema } from "./event-schemas";
import { listEventsForEntity } from "./events";
import { createPluginScope } from "./plugins";
import { pollUntil } from "./polling";
import { createRelationshipSchema } from "./relationship-schemas";
import { createRelationship } from "./relationships";

export const createPluginEntitySchema = (
	client: Client,
	options: {
		schemaName: string;
		schemaSlug?: string;
		propertiesSchema?: Parameters<typeof createEntitySchema>[1]["propertiesSchema"];
		pluginSlug?: string;
	},
) =>
	Effect.gen(function* () {
		const pluginSlug = options.pluginSlug ?? createPluginScope();
		const { slug, schemaId, pluginId, reference } = yield* createEntitySchema(client, {
			pluginSlug,
			name: options.schemaName,
			...(options.schemaSlug ? { slug: options.schemaSlug } : {}),
			...(options.propertiesSchema ? { propertiesSchema: options.propertiesSchema } : {}),
		});
		return { slug, schemaId, pluginId, reference, pluginSlug };
	});

export const createEntityFixture = (
	client: Client,
	input: Pick<ContractPayload<"entities", "create">, "name" | "entitySchema"> & {
		properties?: Record<string, unknown>;
	},
) =>
	createEntity(client, {
		name: input.name,
		entitySchema: input.entitySchema,
		properties: input.properties ?? {},
	});

export const createEventFixture = (
	client: Client,
	input: {
		entityId: string;
		occurredAt?: string;
		eventSchemaSlug: string;
		sessionEntityId?: string;
		properties?: Record<string, unknown>;
	},
) =>
	Effect.gen(function* () {
		const countMatchingEvents = Effect.gen(function* () {
			const events = yield* listEventsForEntity(client, input.entityId, undefined, 100);
			return events.filter(
				(event) =>
					event.eventSchemaSlug === input.eventSchemaSlug &&
					(input.occurredAt === undefined || event.occurredAt === input.occurredAt),
			).length;
		});

		const previousCount = yield* countMatchingEvents;
		const result = yield* client.call((c) =>
			c.events.create({
				payload: [
					{
						properties: input.properties ?? {},
						entityId: EntityId.make(input.entityId),
						...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
						eventSchemaSlug: EventSchemaSlug.make(input.eventSchemaSlug),
						...(input.sessionEntityId
							? { sessionEntityId: EntityId.make(input.sessionEntityId) }
							: {}),
					},
				],
			}),
		);

		yield* pollUntil(
			`event ${input.eventSchemaSlug} on entity ${input.entityId}`,
			Effect.gen(function* () {
				const count = yield* countMatchingEvents;
				return count > previousCount ? count : null;
			}),
		);

		return result;
	});

export const insertGlobalRelationship = (input: {
	target?: HarnessTarget;
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchema: ContractPayload<"relationships", "create">["relationshipSchema"];
	properties?: Record<string, unknown>;
}) =>
	getApiClient(input.target).adminCall((c) =>
		c.testSupport.upsertGlobalRelationship({
			payload: {
				properties: input.properties,
				relationshipSchema: input.relationshipSchema,
				sourceEntityId: EntityId.make(input.sourceEntityId),
				targetEntityId: EntityId.make(input.targetEntityId),
			},
		}),
	);

export const createCourseLessonFilterFixture = Effect.gen(function* () {
	const { client } = yield* createAuthenticatedClient();
	const pluginSlug = createPluginScope();
	const {
		slug: courseSlug,
		schemaId: courseSchemaId,
		reference: courseReference,
	} = yield* createPluginEntitySchema(client, { pluginSlug, schemaName: "FilterCourse" });
	const {
		slug: moduleSlug,
		schemaId: moduleSchemaId,
		reference: moduleReference,
	} = yield* createPluginEntitySchema(client, { pluginSlug, schemaName: "FilterModule" });
	const {
		slug: lessonSlug,
		schemaId: lessonSchemaId,
		reference: lessonReference,
	} = yield* createPluginEntitySchema(client, {
		pluginSlug,
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
	});
	const completeSlug = `filter-complete-${crypto.randomUUID()}`;
	const completeSchema = yield* createEventSchema(client, {
		slug: completeSlug,
		name: "Filter Complete",
		entitySchema: lessonReference,
	});
	const courseModuleSlug = `filter-course-module-${crypto.randomUUID()}`;
	const moduleLessonSlug = `filter-module-lesson-${crypto.randomUUID()}`;
	const courseModuleSchema = yield* createRelationshipSchema(client, {
		pluginSlug,
		slug: courseModuleSlug,
		name: "Filter Course Module",
		targetEntitySchemaSlug: moduleSchemaId,
		sourceEntitySchemaSlug: courseSchemaId,
	});
	const moduleLessonSchema = yield* createRelationshipSchema(client, {
		pluginSlug,
		slug: moduleLessonSlug,
		name: "Filter Module Lesson",
		targetEntitySchemaSlug: lessonSchemaId,
		sourceEntitySchemaSlug: moduleSchemaId,
	});

	const createCourse = (
		name: string,
		lessons: readonly { durationMinutes: number; complete: boolean }[],
	) =>
		Effect.gen(function* () {
			const course = yield* createEntityFixture(client, { name, entitySchema: courseReference });
			yield* Effect.forEach(lessons, (lessonInput, index) =>
				Effect.gen(function* () {
					const [module, lesson] = yield* Effect.all([
						createEntityFixture(client, {
							entitySchema: moduleReference,
							name: `${name} Module ${index + 1}`,
						}),
						createEntityFixture(client, {
							entitySchema: lessonReference,
							name: `${name} Lesson ${index + 1}`,
							properties: { durationMinutes: lessonInput.durationMinutes },
						}),
					]);
					yield* Effect.all([
						createRelationship(client, {
							targetEntityId: module.id,
							sourceEntityId: course.id,
							relationshipSchema: courseModuleSchema.reference,
						}),
						createRelationship(client, {
							targetEntityId: lesson.id,
							sourceEntityId: module.id,
							relationshipSchema: moduleLessonSchema.reference,
						}),
					]);
					if (lessonInput.complete) {
						yield* createEventFixture(client, {
							entityId: lesson.id,
							eventSchemaSlug: completeSchema.id,
						});
					}
				}),
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
