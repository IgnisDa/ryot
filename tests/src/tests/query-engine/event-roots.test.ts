import { DateTime, Effect } from "effect";

import {
	buildRowsDoc,
	createAuthenticatedClient,
	createEventSchema,
	createRelationship,
	createRelationshipSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	propertyRef,
	requireQueryEngineFieldValue,
	schemaMetaRef,
	systemRef,
	type QueryEnginePayload,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Event roots and first expressions", () => {
	it.live("returns root event rows with event and attached entity fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "EventRootLesson" });
			const completeSlug = `event-root-complete-${crypto.randomUUID()}`;
			const completeSchema = yield* createEventSchema(client, {
				slug: completeSlug,
				name: "Event Root Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { notes: { type: "string", label: "Notes", description: "Completion notes" } },
				},
			});
			const firstLesson = yield* createQueryEngineEntity(client, {
				entitySchemaId: lessonSchemaId,
				name: "First Lesson With Events",
			});
			const latestLesson = yield* createQueryEngineEntity(client, {
				entitySchemaId: lessonSchemaId,
				name: "Latest Lesson With Events",
			});

			yield* createQueryEngineEvent(client, {
				entityId: firstLesson.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { notes: "first completion" },
			});
			yield* createQueryEngineEvent(client, {
				entityId: latestLesson.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
				properties: { notes: "latest completion" },
			});

			const doc: QueryEnginePayload = {
				source: {
					where: null,
					type: "events",
					alias: "completion",
					schemas: [completeSlug],
					entity: { alias: "lesson", schemas: [lessonSlug] },
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "desc", expr: systemRef("completion", "occurredAt") }],
					fields: [
						{ key: "occurredAt", expr: systemRef("completion", "occurredAt") },
						{ key: "notes", expr: propertyRef("completion", completeSlug, "notes") },
						{ key: "lessonName", expr: systemRef("lesson", "name") },
						{ key: "eventSchemaSlug", expr: schemaMetaRef("completion", "slug") },
					],
				},
			};

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(2);
			const latest = result.data.items[0];
			assertPresent(latest, "Expected latest event row");
			expect(requireQueryEngineFieldValue(latest, "occurredAt").kind).toBe("date");
			expect(
				DateTime.formatIso(
					DateTime.unsafeMake(String(requireQueryEngineFieldValue(latest, "occurredAt").value)),
				),
			).toBe("2026-02-01T00:00:00.000Z");
			expect(requireQueryEngineFieldValue(latest, "notes").value).toBe("latest completion");
			expect(requireQueryEngineFieldValue(latest, "lessonName").value).toBe(
				"Latest Lesson With Events",
			);
			expect(requireQueryEngineFieldValue(latest, "eventSchemaSlug").value).toBe(completeSlug);
		}),
	);

	it.live("returns latest event scalar values with first and null when no event matches", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "FirstExprLesson" });
			const completeSlug = `first-complete-${crypto.randomUUID()}`;
			const completeSchema = yield* createEventSchema(client, {
				slug: completeSlug,
				name: "First Complete",
				entitySchemaId: lessonSchemaId,
			});
			const lessonWithEvents = yield* createQueryEngineEntity(client, {
				name: "Lesson A",
				entitySchemaId: lessonSchemaId,
			});
			yield* createQueryEngineEntity(client, { name: "Lesson B", entitySchemaId: lessonSchemaId });

			yield* createQueryEngineEvent(client, {
				entityId: lessonWithEvents.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-03-01T00:00:00.000Z",
			});
			yield* createQueryEngineEvent(client, {
				entityId: lessonWithEvents.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-04-01T00:00:00.000Z",
			});

			const doc = buildRowsDoc({
				alias: "lesson",
				schemas: [lessonSlug],
				fields: [
					{ key: "name", expr: systemRef("lesson", "name") },
					{
						key: "latestCompletionAt",
						expr: {
							type: "first",
							select: systemRef("completion", "occurredAt"),
							orderBy: [{ order: "desc", expr: systemRef("completion", "occurredAt") }],
							source: {
								where: null,
								type: "events",
								alias: "completion",
								entityRef: "lesson",
								schemas: [completeSlug],
							},
						},
					},
				],
			});

			const result = yield* executeQueryEngine(client, doc);

			const lessonA = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson A",
			);
			const lessonB = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson B",
			);
			assertPresent(lessonA, "Expected Lesson A row");
			assertPresent(lessonB, "Expected Lesson B row");
			expect(
				DateTime.formatIso(
					DateTime.unsafeMake(
						String(requireQueryEngineFieldValue(lessonA, "latestCompletionAt").value),
					),
				),
			).toBe("2026-04-01T00:00:00.000Z");
			expect(requireQueryEngineFieldValue(lessonB, "latestCompletionAt")).toEqual({
				value: null,
				kind: "null",
			});
		}),
	);

	it.live("selects the first related child entity by an ordered edge property", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "FirstEntityCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				yield* createQueryEngineTrackerAndSchema(client, {
					schemaName: "FirstEntityModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `first-entity-course-module-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				name: "First Entity Course Module",
				slug: relationshipSlug,
				sourceEntitySchemaId: courseSchemaId,
				targetEntitySchemaId: moduleSchemaId,
				propertiesSchema: {
					fields: {
						position: { type: "integer", label: "Position", description: "Edge sort order" },
					},
				},
			});

			const courseWithModules = yield* createQueryEngineEntity(client, {
				name: "Course With Modules",
				entitySchemaId: courseSchemaId,
			});
			yield* createQueryEngineEntity(client, {
				name: "Course Without Modules",
				entitySchemaId: courseSchemaId,
			});
			const moduleOne = yield* createQueryEngineEntity(client, {
				name: "Module One",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleTwo = yield* createQueryEngineEntity(client, {
				name: "Module Two",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 2 },
			});

			yield* createRelationship(client, {
				sourceEntityId: courseWithModules.id,
				properties: { position: 2 },
				targetEntityId: moduleTwo.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: courseWithModules.id,
				properties: { position: 1 },
				targetEntityId: moduleOne.id,
				relationshipSchemaId: relationshipSchema.id,
			});

			const firstModuleNameExpr: Extract<
				QueryEnginePayload["output"],
				{ type: "rows" }
			>["fields"][number]["expr"] = {
				type: "first",
				select: systemRef("module", "name"),
				orderBy: [
					{ order: "asc", expr: propertyRef("courseModule", relationshipSlug, "position") },
				],
				source: {
					where: null,
					alias: "module",
					type: "entities",
					schemas: [moduleSlug],
					via: {
						entityRef: "course",
						alias: "courseModule",
						direction: "outgoing",
						schema: relationshipSlug,
					},
				},
			};

			const doc = buildRowsDoc({
				alias: "course",
				schemas: [courseSlug],
				fields: [
					{ key: "name", expr: systemRef("course", "name") },
					{ key: "firstModuleName", expr: firstModuleNameExpr },
				],
			});

			const result = yield* executeQueryEngine(client, doc);

			const withModules = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Course With Modules",
			);
			const without = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Course Without Modules",
			);
			assertPresent(withModules, "Expected Course With Modules row");
			assertPresent(without, "Expected Course Without Modules row");
			expect(requireQueryEngineFieldValue(withModules, "firstModuleName").value).toBe("Module One");
			expect(requireQueryEngineFieldValue(without, "firstModuleName")).toEqual({
				value: null,
				kind: "null",
			});
		}),
	);

	it.live("uses a first-derived scalar inside coalesce fields and where filters", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "FirstWhereCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				yield* createQueryEngineTrackerAndSchema(client, {
					schemaName: "FirstWhereModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `first-where-course-module-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				name: "First Where Course Module",
				slug: relationshipSlug,
				sourceEntitySchemaId: courseSchemaId,
				targetEntitySchemaId: moduleSchemaId,
				propertiesSchema: {
					fields: {
						position: { type: "integer", label: "Position", description: "Edge sort order" },
					},
				},
			});

			const startsAtOne = yield* createQueryEngineEntity(client, {
				name: "Starts At One",
				entitySchemaId: courseSchemaId,
			});
			const startsAtFive = yield* createQueryEngineEntity(client, {
				name: "Starts At Five",
				entitySchemaId: courseSchemaId,
			});
			yield* createQueryEngineEntity(client, {
				name: "No Modules",
				entitySchemaId: courseSchemaId,
			});
			const moduleAtOne = yield* createQueryEngineEntity(client, {
				name: "Module At One",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleAtFive = yield* createQueryEngineEntity(client, {
				name: "Module At Five",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 5 },
			});

			yield* createRelationship(client, {
				sourceEntityId: startsAtOne.id,
				properties: { position: 1 },
				targetEntityId: moduleAtOne.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: startsAtFive.id,
				properties: { position: 5 },
				targetEntityId: moduleAtFive.id,
				relationshipSchemaId: relationshipSchema.id,
			});

			const buildFirstPositionExpr = (
				moduleAlias: string,
				edgeAlias: string,
			): Extract<QueryEnginePayload["output"], { type: "rows" }>["fields"][number]["expr"] => ({
				type: "first",
				select: propertyRef(edgeAlias, relationshipSlug, "position"),
				orderBy: [{ order: "asc", expr: propertyRef(edgeAlias, relationshipSlug, "position") }],
				source: {
					where: null,
					alias: moduleAlias,
					type: "entities",
					schemas: [moduleSlug],
					via: {
						entityRef: "course",
						alias: edgeAlias,
						direction: "outgoing",
						schema: relationshipSlug,
					},
				},
			});

			const doc: QueryEnginePayload = {
				source: {
					alias: "course",
					type: "entities",
					schemas: [courseSlug],
					where: {
						operator: "eq",
						type: "comparison",
						left: buildFirstPositionExpr("module", "courseModule"),
						right: { type: "literal", value: 1 },
					},
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
					fields: [
						{ key: "name", expr: systemRef("course", "name") },
						{
							key: "firstPositionOrFallback",
							expr: {
								type: "coalesce",
								values: [
									buildFirstPositionExpr("moduleField", "courseModuleField"),
									{ type: "literal", value: -1 },
								],
							},
						},
					],
				},
			};

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const onlyMatch = result.data.items[0];
			assertPresent(onlyMatch, "Expected the course whose first module position is 1");
			expect(requireQueryEngineFieldValue(onlyMatch, "name").value).toBe("Starts At One");
			expect(requireQueryEngineFieldValue(onlyMatch, "firstPositionOrFallback").value).toBe(1);
		}),
	);
});
