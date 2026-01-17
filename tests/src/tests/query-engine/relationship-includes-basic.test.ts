import { Effect } from "effect";

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
	requireQueryEngineIncludeValue,
	systemRef,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Relationship includes", () => {
	it.live("returns one-hop entity includes with limit metadata", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "IncludeCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				yield* createQueryEngineTrackerAndSchema(client, {
					schemaName: "IncludeModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `course-module-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				name: "Course Module",
				slug: relationshipSlug,
				sourceEntitySchemaSlug: courseSchemaId,
				targetEntitySchemaSlug: moduleSchemaId,
				propertiesSchema: {
					fields: {
						position: { type: "integer", label: "Position", description: "Edge sort order" },
					},
				},
			});

			const courseA = yield* createQueryEngineEntity(client, {
				name: "Course A",
				entitySchemaSlug: courseSchemaId,
			});
			const courseB = yield* createQueryEngineEntity(client, {
				name: "Course B",
				entitySchemaSlug: courseSchemaId,
			});
			const moduleOne = yield* createQueryEngineEntity(client, {
				name: "Module One",
				entitySchemaSlug: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleTwo = yield* createQueryEngineEntity(client, {
				name: "Module Two",
				entitySchemaSlug: moduleSchemaId,
				properties: { moduleNumber: 2 },
			});
			const moduleThree = yield* createQueryEngineEntity(client, {
				name: "Module Three",
				entitySchemaSlug: moduleSchemaId,
				properties: { moduleNumber: 3 },
			});

			yield* createRelationship(client, {
				sourceEntityId: courseA.id,
				properties: { position: 2 },
				targetEntityId: moduleTwo.id,
				relationshipSchemaSlug: relationshipSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: courseA.id,
				properties: { position: 1 },
				targetEntityId: moduleOne.id,
				relationshipSchemaSlug: relationshipSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: courseB.id,
				properties: { position: 3 },
				targetEntityId: moduleThree.id,
				relationshipSchemaSlug: relationshipSchema.id,
			});

			const doc = buildRowsDoc({
				limit: 2,
				alias: "course",
				schemas: [courseSlug],
				fields: [{ key: "name", expr: systemRef("course", "name") }],
				output: {
					fields: [{ key: "name", expr: systemRef("course", "name") }],
					type: "rows",
					pagination: { page: 1, limit: 2 },
					orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
					include: [
						{
							limit: 1,
							key: "modules",
							orderBy: [{ order: "asc", expr: propertyRef("module", moduleSlug, "moduleNumber") }],
							fields: [
								{ key: "name", expr: systemRef("module", "name") },
								{ key: "moduleNumber", expr: propertyRef("module", moduleSlug, "moduleNumber") },
								{
									key: "position",
									expr: propertyRef("courseModule", relationshipSlug, "position"),
								},
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
						},
					],
				},
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(2);
			expect(result.data.pageInfo.total).toBe(2);
			const courseAItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Course A",
			);
			assertPresent(courseAItem, "Expected Course A row");
			const modules = requireQueryEngineIncludeValue(courseAItem, "modules");
			expect(modules.items).toHaveLength(1);
			expect(modules.pageInfo).toEqual({ limit: 1, hasMore: true });
			const firstModule = modules.items[0];
			assertPresent(firstModule, "Expected first module row");
			expect(requireQueryEngineFieldValue(firstModule, "name").value).toBe("Module One");
			expect(requireQueryEngineFieldValue(firstModule, "moduleNumber").value).toBe(1);
			expect(requireQueryEngineFieldValue(firstModule, "position").value).toBe(1);
		}),
	);

	it.live("orders nested includes numerically by an integer property, not lexicographically", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "NumOrderCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				yield* createQueryEngineTrackerAndSchema(client, {
					schemaName: "NumOrderModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `num-course-module-${crypto.randomUUID()}`;
			const relationshipSchema = yield* createRelationshipSchema(client, {
				name: "Num Course Module",
				slug: relationshipSlug,
				sourceEntitySchemaSlug: courseSchemaId,
				targetEntitySchemaSlug: moduleSchemaId,
			});

			const course = yield* createQueryEngineEntity(client, {
				name: "Numbered Course",
				entitySchemaSlug: courseSchemaId,
			});
			// 10 created before 2 so insertion order can't mask the sort: numeric order must give 2, 10.
			const moduleTen = yield* createQueryEngineEntity(client, {
				name: "Module Ten",
				entitySchemaSlug: moduleSchemaId,
				properties: { moduleNumber: 10 },
			});
			const moduleTwo = yield* createQueryEngineEntity(client, {
				name: "Module Two",
				entitySchemaSlug: moduleSchemaId,
				properties: { moduleNumber: 2 },
			});
			yield* createRelationship(client, {
				properties: {},
				sourceEntityId: course.id,
				targetEntityId: moduleTen.id,
				relationshipSchemaSlug: relationshipSchema.id,
			});
			yield* createRelationship(client, {
				properties: {},
				sourceEntityId: course.id,
				targetEntityId: moduleTwo.id,
				relationshipSchemaSlug: relationshipSchema.id,
			});

			const doc = buildRowsDoc({
				alias: "course",
				schemas: [courseSlug],
				fields: [{ key: "name", expr: systemRef("course", "name") }],
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					fields: [{ key: "name", expr: systemRef("course", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
					include: [
						{
							limit: 10,
							key: "modules",
							orderBy: [{ order: "asc", expr: propertyRef("module", moduleSlug, "moduleNumber") }],
							fields: [
								{ key: "moduleNumber", expr: propertyRef("module", moduleSlug, "moduleNumber") },
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
						},
					],
				},
			});

			const result = yield* executeQueryEngine(client, doc);
			const courseItem = result.data.items[0];
			assertPresent(courseItem, "Expected course row");
			const modules = requireQueryEngineIncludeValue(courseItem, "modules");
			expect(
				modules.items.map((item) => requireQueryEngineFieldValue(item, "moduleNumber").value),
			).toEqual([2, 10]);
		}),
	);

	it.live("returns deep entity includes with event existence fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				yield* createQueryEngineTrackerAndSchema(client, { schemaName: "DeepCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				yield* createQueryEngineTrackerAndSchema(client, {
					schemaName: "DeepModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				yield* createQueryEngineTrackerAndSchema(client, {
					schemaName: "DeepLesson",
					propertiesSchema: {
						fields: {
							lessonNumber: { type: "integer", label: "Lesson Number", description: "Sort order" },
						},
					},
				});
			const completeSlug = `complete-${crypto.randomUUID()}`;
			const completeSchema = yield* createEventSchema(client, {
				slug: completeSlug,
				name: "Complete",
				entitySchemaSlug: lessonSchemaId,
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Completion note" } },
				},
			});
			const courseModuleSlug = `deep-course-module-${crypto.randomUUID()}`;
			const moduleLessonSlug = `deep-module-lesson-${crypto.randomUUID()}`;
			const courseModuleSchema = yield* createRelationshipSchema(client, {
				slug: courseModuleSlug,
				name: "Deep Course Module",
				targetEntitySchemaSlug: moduleSchemaId,
				sourceEntitySchemaSlug: courseSchemaId,
			});
			const moduleLessonSchema = yield* createRelationshipSchema(client, {
				slug: moduleLessonSlug,
				name: "Deep Module Lesson",
				targetEntitySchemaSlug: lessonSchemaId,
				sourceEntitySchemaSlug: moduleSchemaId,
			});

			const course = yield* createQueryEngineEntity(client, {
				name: "Course",
				entitySchemaSlug: courseSchemaId,
			});
			const module = yield* createQueryEngineEntity(client, {
				name: "Module",
				entitySchemaSlug: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const secondLesson = yield* createQueryEngineEntity(client, {
				name: "Lesson Two",
				entitySchemaSlug: lessonSchemaId,
				properties: { lessonNumber: 2 },
			});
			const firstLesson = yield* createQueryEngineEntity(client, {
				name: "Lesson One",
				entitySchemaSlug: lessonSchemaId,
				properties: { lessonNumber: 1 },
			});

			yield* createRelationship(client, {
				targetEntityId: module.id,
				sourceEntityId: course.id,
				relationshipSchemaSlug: courseModuleSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: module.id,
				targetEntityId: secondLesson.id,
				relationshipSchemaSlug: moduleLessonSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: module.id,
				targetEntityId: firstLesson.id,
				relationshipSchemaSlug: moduleLessonSchema.id,
			});
			yield* createQueryEngineEvent(client, {
				entityId: firstLesson.id,
				eventSchemaSlug: completeSchema.id,
			});

			const doc = buildRowsDoc({
				limit: 1,
				alias: "course",
				schemas: [courseSlug],
				fields: [{ key: "name", expr: systemRef("course", "name") }],
				output: {
					fields: [{ key: "name", expr: systemRef("course", "name") }],
					type: "rows",
					pagination: { page: 1, limit: 1 },
					orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
					include: [
						{
							limit: 10,
							key: "modules",
							fields: [{ key: "name", expr: systemRef("module", "name") }],
							orderBy: [{ order: "asc", expr: propertyRef("module", moduleSlug, "moduleNumber") }],
							source: {
								where: null,
								alias: "module",
								type: "entities",
								schemas: [moduleSlug],
								via: {
									entityRef: "course",
									alias: "courseModule",
									direction: "outgoing",
									schema: courseModuleSlug,
								},
							},
							include: [
								{
									limit: 10,
									key: "lessons",
									orderBy: [
										{ order: "asc", expr: propertyRef("lesson", lessonSlug, "lessonNumber") },
									],
									fields: [
										{ key: "name", expr: systemRef("lesson", "name") },
										{
											key: "lessonNumber",
											expr: propertyRef("lesson", lessonSlug, "lessonNumber"),
										},
										{
											key: "isComplete",
											expr: {
												type: "exists",
												source: {
													where: null,
													type: "events",
													entityRef: "lesson",
													schemas: [completeSlug],
													alias: "lessonCompletion",
												},
											},
										},
									],
									source: {
										where: null,
										alias: "lesson",
										type: "entities",
										schemas: [lessonSlug],
										via: {
											entityRef: "module",
											alias: "moduleLesson",
											direction: "outgoing",
											schema: moduleLessonSlug,
										},
									},
								},
							],
						},
					],
				},
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const courseItem = result.data.items[0];
			assertPresent(courseItem, "Expected course row");
			const modules = requireQueryEngineIncludeValue(courseItem, "modules");
			expect(modules.items).toHaveLength(1);
			const moduleItem = modules.items[0];
			assertPresent(moduleItem, "Expected module row");
			const lessons = requireQueryEngineIncludeValue(moduleItem, "lessons");
			expect(lessons.items).toHaveLength(2);

			const lessonOne = lessons.items[0];
			const lessonTwo = lessons.items[1];
			assertPresent(lessonOne, "Expected first lesson row");
			assertPresent(lessonTwo, "Expected second lesson row");
			expect(requireQueryEngineFieldValue(lessonOne, "name").value).toBe("Lesson One");
			expect(requireQueryEngineFieldValue(lessonOne, "lessonNumber").value).toBe(1);
			expect(requireQueryEngineFieldValue(lessonOne, "isComplete")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireQueryEngineFieldValue(lessonTwo, "name").value).toBe("Lesson Two");
			expect(requireQueryEngineFieldValue(lessonTwo, "isComplete")).toEqual({
				value: false,
				kind: "boolean",
			});
		}),
	);
});
