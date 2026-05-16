import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createEventSchema,
	createRelationship,
	createRelationshipSchema,
	createV2Entity,
	createV2Event,
	createV2TrackerAndSchema,
	executeAggregateQueryEngineV2,
	executeQueryEngineV2,
	executeQueryEngineV2Error,
	executeTimeSeriesQueryEngineV2,
	propertyRef,
	requireV2IncludeValue,
	requireV2FieldValue,
	schemaMetaRef,
	systemRef,
	type V2ExecutePayload,
} from "../fixtures";
import { assertPresent, assertTaggedError } from "../test-support/assertions";

const buildRowsDoc = (
	overrides: Partial<V2ExecutePayload> & {
		alias: string;
		page?: number;
		limit?: number;
		schemas: [string, ...string[]];
		fields?: Extract<V2ExecutePayload["output"], { type: "rows" }>["fields"];
		orderByExpr?: Extract<V2ExecutePayload["output"], { type: "rows" }>["orderBy"][number]["expr"];
	},
): V2ExecutePayload => {
	const { alias, schemas, fields = [], orderByExpr, page = 1, limit = 10, ...rest } = overrides;
	return {
		version: 2,
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

const createCourseLessonFilterFixture = async () => {
	const { client } = await createAuthenticatedClient();
	const { schemaId: courseSchemaId, slug: courseSlug } = await createV2TrackerAndSchema(client, {
		schemaName: "FilterCourse",
	});
	const { schemaId: moduleSchemaId, slug: moduleSlug } = await createV2TrackerAndSchema(client, {
		schemaName: "FilterModule",
	});
	const { schemaId: lessonSchemaId, slug: lessonSlug } = await createV2TrackerAndSchema(client, {
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
		const course = await createV2Entity(client, { name, entitySchemaId: courseSchemaId });
		await Promise.all(
			lessons.map(async (lessonInput, index) => {
				const [module, lesson] = await Promise.all([
					createV2Entity(client, {
						entitySchemaId: moduleSchemaId,
						name: `${name} Module ${index + 1}`,
					}),
					createV2Entity(client, {
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
					await createV2Event(client, { entityId: lesson.id, eventSchemaId: completeSchema.id });
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

describe("Query Engine V2 E2E", () => {
	describe("Single-schema entity rows query", () => {
		it("returns entities with system field values", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "Course",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty level" },
					},
				},
			});

			await createV2Entity(client, {
				entitySchemaId: schemaId,
				name: "Advanced TypeScript",
				properties: { difficulty: "advanced" },
			});
			await createV2Entity(client, {
				name: "Beginner Rust",
				entitySchemaId: schemaId,
				properties: { difficulty: "beginner" },
			});

			const doc = buildRowsDoc({
				alias: "course",
				schemas: [slug],
				fields: [
					{ key: "name", expr: systemRef("course", "name") },
					{ key: "id", expr: systemRef("course", "id") },
				],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.type).toBe("rows");
			expect(result.data.items).toHaveLength(2);

			const names = result.data.items.map((item) => requireV2FieldValue(item, "name").value);
			expect(names).toContain("Advanced TypeScript");
			expect(names).toContain("Beginner Rust");

			for (const item of result.data.items) {
				expect(requireV2FieldValue(item, "name").kind).toBe("text");
				expect(requireV2FieldValue(item, "id").kind).toBe("text");
				expect(typeof requireV2FieldValue(item, "id").value).toBe("string");
			}
		});

		it("returns property field values for matching schema", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "Book",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Book author" } },
				},
			});

			await createV2Entity(client, {
				name: "Clean Code",
				entitySchemaId: schemaId,
				properties: { author: "Robert Martin" },
			});

			const doc = buildRowsDoc({
				alias: "book",
				schemas: [slug],
				fields: [
					{ key: "name", expr: systemRef("book", "name") },
					{ key: "author", expr: propertyRef("book", slug, "author") },
				],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireV2FieldValue(item, "name").value).toBe("Clean Code");
			expect(requireV2FieldValue(item, "author").value).toBe("Robert Martin");
			expect(requireV2FieldValue(item, "author").kind).toBe("text");
		});

		it("returns schema metadata fields", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "TaggedCourse",
			});

			await createV2Entity(client, { name: "First Course", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				alias: "c",
				schemas: [slug],
				fields: [
					{ key: "schemaSlug", expr: schemaMetaRef("c", "slug") },
					{ key: "schemaName", expr: schemaMetaRef("c", "name") },
				],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireV2FieldValue(item, "schemaSlug").value).toBe(slug);
			expect(requireV2FieldValue(item, "schemaName").value).toBe("TaggedCourse");
		});
	});

	describe("Multi-schema property query", () => {
		it("returns null for property fields that do not match the row's schema", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: bookSchemaId, slug: bookSlug } = await createV2TrackerAndSchema(client, {
				schemaName: "MultiBook",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Book author" } },
				},
			});
			const { schemaId: movieSchemaId, slug: movieSlug } = await createV2TrackerAndSchema(client, {
				schemaName: "MultiMovie",
				propertiesSchema: {
					fields: {
						director: { type: "string", label: "Director", description: "Movie director" },
					},
				},
			});

			await createV2Entity(client, {
				name: "A Great Book",
				entitySchemaId: bookSchemaId,
				properties: { author: "Author A" },
			});
			await createV2Entity(client, {
				name: "A Great Movie",
				entitySchemaId: movieSchemaId,
				properties: { director: "Director B" },
			});

			const doc = buildRowsDoc({
				alias: "media",
				schemas: [bookSlug, movieSlug],
				fields: [
					{ key: "name", expr: systemRef("media", "name") },
					{ key: "author", expr: propertyRef("media", bookSlug, "author") },
					{ key: "director", expr: propertyRef("media", movieSlug, "director") },
				],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(2);

			const bookItem = result.data.items.find(
				(item) => requireV2FieldValue(item, "name").value === "A Great Book",
			);
			const movieItem = result.data.items.find(
				(item) => requireV2FieldValue(item, "name").value === "A Great Movie",
			);

			assertPresent(bookItem, "Expected bookItem");
			assertPresent(movieItem, "Expected movieItem");

			expect(requireV2FieldValue(bookItem, "author").value).toBe("Author A");
			expect(requireV2FieldValue(bookItem, "director").kind).toBe("null");

			expect(requireV2FieldValue(movieItem, "director").value).toBe("Director B");
			expect(requireV2FieldValue(movieItem, "author").kind).toBe("null");
		});
	});

	describe("Pagination", () => {
		it("returns correct pagination metadata for multiple pages", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "PaginatedItem",
			});

			await Promise.all(
				Array.from({ length: 5 }, (_, i) =>
					createV2Entity(client, {
						entitySchemaId: schemaId,
						name: `Item ${String(i + 1).padStart(2, "0")}`,
					}),
				),
			);

			const doc = buildRowsDoc({
				page: 1,
				limit: 2,
				alias: "item",
				schemas: [slug],
				fields: [{ key: "name", expr: systemRef("item", "name") }],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.pageInfo.total).toBe(5);
			expect(result.data.pageInfo.page).toBe(1);
			expect(result.data.pageInfo.limit).toBe(2);
			expect(result.data.pageInfo.hasMore).toBe(true);
			expect(result.data.items).toHaveLength(2);
		});

		it("returns hasMore=false on the last page", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "LastPageItem",
			});

			await createV2Entity(client, { name: "Only Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 1,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.pageInfo.total).toBe(1);
			expect(result.data.pageInfo.hasMore).toBe(false);
		});

		it("returns empty items and zero total for second page beyond results", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "SparseItem",
			});

			await createV2Entity(client, { name: "One Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 2,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.pageInfo.total).toBe(0);
			expect(result.data.items).toHaveLength(0);
			expect(result.data.pageInfo.hasMore).toBe(false);
		});
	});

	describe("Relationship includes", () => {
		it("returns one-hop entity includes with limit metadata", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "IncludeCourse" },
			);
			const { schemaId: moduleSchemaId, slug: moduleSlug } = await createV2TrackerAndSchema(
				client,
				{
					schemaName: "IncludeModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				},
			);
			const relationshipSlug = `course-module-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				name: "Course Module",
				slug: relationshipSlug,
				sourceEntitySchemaId: courseSchemaId,
				targetEntitySchemaId: moduleSchemaId,
				propertiesSchema: {
					fields: {
						position: { type: "integer", label: "Position", description: "Edge sort order" },
					},
				},
			});

			const courseA = await createV2Entity(client, {
				name: "Course A",
				entitySchemaId: courseSchemaId,
			});
			const courseB = await createV2Entity(client, {
				name: "Course B",
				entitySchemaId: courseSchemaId,
			});
			const moduleOne = await createV2Entity(client, {
				name: "Module One",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleTwo = await createV2Entity(client, {
				name: "Module Two",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 2 },
			});
			const moduleThree = await createV2Entity(client, {
				name: "Module Three",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 3 },
			});

			await createRelationship(client, {
				sourceEntityId: courseA.id,
				properties: { position: 2 },
				targetEntityId: moduleTwo.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
				sourceEntityId: courseA.id,
				properties: { position: 1 },
				targetEntityId: moduleOne.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
				sourceEntityId: courseB.id,
				properties: { position: 3 },
				targetEntityId: moduleThree.id,
				relationshipSchemaId: relationshipSchema.id,
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

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(2);
			expect(result.data.pageInfo.total).toBe(2);
			const courseAItem = result.data.items.find(
				(item) => requireV2FieldValue(item, "name").value === "Course A",
			);
			assertPresent(courseAItem, "Expected Course A row");
			const modules = requireV2IncludeValue(courseAItem, "modules");
			expect(modules.items).toHaveLength(1);
			expect(modules.pageInfo).toEqual({ limit: 1, hasMore: true });
			const firstModule = modules.items[0];
			assertPresent(firstModule, "Expected first module row");
			expect(requireV2FieldValue(firstModule, "name").value).toBe("Module One");
			expect(requireV2FieldValue(firstModule, "moduleNumber").value).toBe(1);
			expect(requireV2FieldValue(firstModule, "position").value).toBe(1);
		});

		it("returns deep entity includes with event existence fields", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "DeepCourse" },
			);
			const { schemaId: moduleSchemaId, slug: moduleSlug } = await createV2TrackerAndSchema(
				client,
				{
					schemaName: "DeepModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				},
			);
			const { schemaId: lessonSchemaId, slug: lessonSlug } = await createV2TrackerAndSchema(
				client,
				{
					schemaName: "DeepLesson",
					propertiesSchema: {
						fields: {
							lessonNumber: { type: "integer", label: "Lesson Number", description: "Sort order" },
						},
					},
				},
			);
			const completeSlug = `complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Completion note" } },
				},
			});
			const courseModuleSlug = `deep-course-module-${crypto.randomUUID()}`;
			const moduleLessonSlug = `deep-module-lesson-${crypto.randomUUID()}`;
			const courseModuleSchema = await createRelationshipSchema(client, {
				slug: courseModuleSlug,
				name: "Deep Course Module",
				propertiesSchema: { fields: {} },
				targetEntitySchemaId: moduleSchemaId,
				sourceEntitySchemaId: courseSchemaId,
			});
			const moduleLessonSchema = await createRelationshipSchema(client, {
				slug: moduleLessonSlug,
				name: "Deep Module Lesson",
				propertiesSchema: { fields: {} },
				targetEntitySchemaId: lessonSchemaId,
				sourceEntitySchemaId: moduleSchemaId,
			});

			const course = await createV2Entity(client, {
				name: "Course",
				entitySchemaId: courseSchemaId,
			});
			const module = await createV2Entity(client, {
				name: "Module",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const secondLesson = await createV2Entity(client, {
				name: "Lesson Two",
				entitySchemaId: lessonSchemaId,
				properties: { lessonNumber: 2 },
			});
			const firstLesson = await createV2Entity(client, {
				name: "Lesson One",
				entitySchemaId: lessonSchemaId,
				properties: { lessonNumber: 1 },
			});

			await createRelationship(client, {
				targetEntityId: module.id,
				sourceEntityId: course.id,
				relationshipSchemaId: courseModuleSchema.id,
			});
			await createRelationship(client, {
				sourceEntityId: module.id,
				targetEntityId: secondLesson.id,
				relationshipSchemaId: moduleLessonSchema.id,
			});
			await createRelationship(client, {
				sourceEntityId: module.id,
				targetEntityId: firstLesson.id,
				relationshipSchemaId: moduleLessonSchema.id,
			});
			await createV2Event(client, { entityId: firstLesson.id, eventSchemaId: completeSchema.id });

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

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(1);
			const courseItem = result.data.items[0];
			assertPresent(courseItem, "Expected course row");
			const modules = requireV2IncludeValue(courseItem, "modules");
			expect(modules.items).toHaveLength(1);
			const moduleItem = modules.items[0];
			assertPresent(moduleItem, "Expected module row");
			const lessons = requireV2IncludeValue(moduleItem, "lessons");
			expect(lessons.items).toHaveLength(2);

			const lessonOne = lessons.items[0];
			const lessonTwo = lessons.items[1];
			assertPresent(lessonOne, "Expected first lesson row");
			assertPresent(lessonTwo, "Expected second lesson row");
			expect(requireV2FieldValue(lessonOne, "name").value).toBe("Lesson One");
			expect(requireV2FieldValue(lessonOne, "lessonNumber").value).toBe(1);
			expect(requireV2FieldValue(lessonOne, "isComplete")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireV2FieldValue(lessonTwo, "name").value).toBe("Lesson Two");
			expect(requireV2FieldValue(lessonTwo, "isComplete")).toEqual({
				value: false,
				kind: "boolean",
			});
		});
	});

	describe("Descendant source filters", () => {
		it("filters courses by descendant completed lesson count", async () => {
			const {
				client,
				courseSlug,
				moduleSlug,
				lessonSlug,
				completeSlug,
				moduleLessonSlug,
				courseModuleSlug,
			} = await createCourseLessonFilterFixture();
			const completedLessonModulesSource = (suffix: string) =>
				({
					type: "entities",
					schemas: [moduleSlug],
					alias: `module${suffix}`,
					via: {
						entityRef: "course",
						direction: "outgoing",
						schema: courseModuleSlug,
						alias: `courseModule${suffix}`,
					},
					where: {
						type: "exists",
						source: {
							type: "entities",
							schemas: [lessonSlug],
							alias: `lesson${suffix}`,
							via: {
								direction: "outgoing",
								schema: moduleLessonSlug,
								entityRef: `module${suffix}`,
								alias: `moduleLesson${suffix}`,
							},
							where: {
								type: "exists",
								source: {
									where: null,
									type: "events",
									schemas: [completeSlug],
									entityRef: `lesson${suffix}`,
									alias: `completion${suffix}`,
								},
							},
						},
					},
				}) as const;
			const doc = buildRowsDoc({
				alias: "course",
				schemas: [courseSlug],
				fields: [
					{ key: "name", expr: systemRef("course", "name") },
					{
						key: "completedLessonCount",
						expr: {
							type: "coalesce",
							values: [
								{
									type: "aggregate",
									aggregation: { function: "count" },
									source: completedLessonModulesSource("Field"),
								},
								{ type: "literal", value: 0 },
							],
						},
					},
				],
				source: {
					alias: "course",
					type: "entities",
					schemas: [courseSlug],
					where: {
						operator: "gte",
						type: "comparison",
						right: { type: "literal", value: 2 },
						left: {
							type: "aggregate",
							aggregation: { function: "count" },
							source: completedLessonModulesSource("Filter"),
						},
					},
				},
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(1);
			const course = result.data.items[0];
			assertPresent(course, "Expected filtered course row");
			expect(requireV2FieldValue(course, "name").value).toBe("Advanced Course");
			expect(requireV2FieldValue(course, "completedLessonCount").value).toBe(2);
		});

		it("filters courses by a descendant lesson duration threshold", async () => {
			const { client, courseSlug, moduleSlug, lessonSlug, moduleLessonSlug, courseModuleSlug } =
				await createCourseLessonFilterFixture();
			const doc = buildRowsDoc({
				alias: "course",
				schemas: [courseSlug],
				fields: [{ key: "name", expr: systemRef("course", "name") }],
				source: {
					alias: "course",
					type: "entities",
					schemas: [courseSlug],
					where: {
						type: "exists",
						source: {
							alias: "module",
							where: {
								type: "exists",
								source: {
									alias: "lesson",
									type: "entities",
									schemas: [lessonSlug],
									where: {
										operator: "gt",
										type: "comparison",
										right: { type: "literal", value: 45 },
										left: propertyRef("lesson", lessonSlug, "durationMinutes"),
									},
									via: {
										entityRef: "module",
										alias: "moduleLesson",
										direction: "outgoing",
										schema: moduleLessonSlug,
									},
								},
							},
							type: "entities",
							schemas: [moduleSlug],
							via: {
								entityRef: "course",
								alias: "courseModule",
								direction: "outgoing",
								schema: courseModuleSlug,
							},
						},
					},
				},
			});

			const result = await executeQueryEngineV2(client, doc);

			const names = result.data.items.map((item) => requireV2FieldValue(item, "name").value);
			expect(names).toEqual(["Advanced Course", "Long Incomplete Course"]);
		});
	});

	describe("Aggregate returns", () => {
		it("returns ungrouped aggregate measures without pageInfo", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "AggregateLesson",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
						durationMinutes: { type: "integer", label: "Duration", description: "Duration" },
					},
				},
			});

			await Promise.all([
				createV2Entity(client, {
					name: "Lesson 1",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced", durationMinutes: 30 },
				}),
				createV2Entity(client, {
					name: "Lesson 2",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced", durationMinutes: 60 },
				}),
				createV2Entity(client, {
					name: "Lesson 3",
					entitySchemaId: schemaId,
					properties: { difficulty: "beginner", durationMinutes: 90 },
				}),
			]);

			const doc: V2ExecutePayload = {
				version: 2,
				source: { type: "entities", alias: "lesson", schemas: [slug], where: null },
				output: {
					type: "aggregate",
					measures: [
						{ key: "count", aggregation: { function: "count" } },
						{
							key: "difficultyCount",
							aggregation: {
								function: "count",
								distinctBy: propertyRef("lesson", slug, "difficulty"),
							},
						},
						{
							key: "totalDuration",
							aggregation: {
								function: "sum",
								expr: propertyRef("lesson", slug, "durationMinutes"),
							},
						},
						{
							key: "averageDuration",
							aggregation: {
								function: "average",
								expr: propertyRef("lesson", slug, "durationMinutes"),
							},
						},
						{
							key: "minimumDuration",
							aggregation: {
								function: "minimum",
								expr: propertyRef("lesson", slug, "durationMinutes"),
							},
						},
						{
							key: "maximumDuration",
							aggregation: {
								function: "maximum",
								expr: propertyRef("lesson", slug, "durationMinutes"),
							},
						},
					],
				},
			};

			const result = await executeAggregateQueryEngineV2(client, doc);

			expect(result.data.pageInfo).toBeUndefined();
			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected aggregate item");
			expect(requireV2FieldValue(item, "count").value).toBe(3);
			expect(requireV2FieldValue(item, "difficultyCount").value).toBe(2);
			expect(requireV2FieldValue(item, "totalDuration").value).toBe(180);
			expect(requireV2FieldValue(item, "averageDuration").value).toBe(60);
			expect(requireV2FieldValue(item, "minimumDuration").value).toBe(30);
			expect(requireV2FieldValue(item, "maximumDuration").value).toBe(90);
		});

		it("returns grouped aggregates ordered by measureRef with limited pageInfo", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "GroupedAggregateLesson",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
					},
				},
			});

			await Promise.all([
				createV2Entity(client, {
					name: "Advanced 1",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced" },
				}),
				createV2Entity(client, {
					name: "Advanced 2",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced" },
				}),
				createV2Entity(client, {
					name: "Beginner 1",
					entitySchemaId: schemaId,
					properties: { difficulty: "beginner" },
				}),
			]);

			const doc: V2ExecutePayload = {
				version: 2,
				source: { type: "entities", alias: "lesson", schemas: [slug], where: null },
				output: {
					limit: 1,
					type: "aggregate",
					measures: [{ key: "count", aggregation: { function: "count" } }],
					orderBy: [{ order: "desc", expr: { type: "measureRef", key: "count" } }],
					groupBy: [{ key: "difficulty", expr: propertyRef("lesson", slug, "difficulty") }],
				},
			};

			const result = await executeAggregateQueryEngineV2(client, doc);

			expect(result.data.pageInfo).toEqual({ limit: 1, hasMore: true });
			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected grouped aggregate item");
			expect(requireV2FieldValue(item, "difficulty").value).toBe("advanced");
			expect(requireV2FieldValue(item, "count").value).toBe(2);
		});

		it("rejects duplicate aggregate output keys", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "DuplicateAggregateKeys",
			});
			const doc: V2ExecutePayload = {
				version: 2,
				source: { type: "entities", alias: "entity", schemas: [slug], where: null },
				output: {
					limit: 10,
					type: "aggregate",
					measures: [{ key: "count", aggregation: { function: "count" } }],
					orderBy: [{ order: "desc", expr: { type: "measureRef", key: "count" } }],
					groupBy: [{ key: "count", expr: systemRef("entity", "name") }],
				},
			};

			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});
	});

	describe("Event roots and first expressions", () => {
		it("returns root event rows with event and attached entity fields", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "EventRootLesson" },
			);
			const completeSlug = `event-root-complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "Event Root Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { notes: { type: "string", label: "Notes", description: "Completion notes" } },
				},
			});
			const firstLesson = await createV2Entity(client, {
				entitySchemaId: lessonSchemaId,
				name: "First Lesson With Events",
			});
			const latestLesson = await createV2Entity(client, {
				entitySchemaId: lessonSchemaId,
				name: "Latest Lesson With Events",
			});

			await createV2Event(client, {
				entityId: firstLesson.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { notes: "first completion" },
			});
			await createV2Event(client, {
				entityId: latestLesson.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
				properties: { notes: "latest completion" },
			});

			const doc: V2ExecutePayload = {
				version: 2,
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

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(2);
			const latest = result.data.items[0];
			assertPresent(latest, "Expected latest event row");
			expect(requireV2FieldValue(latest, "occurredAt").kind).toBe("date");
			expect(new Date(String(requireV2FieldValue(latest, "occurredAt").value)).toISOString()).toBe(
				"2026-02-01T00:00:00.000Z",
			);
			expect(requireV2FieldValue(latest, "notes").value).toBe("latest completion");
			expect(requireV2FieldValue(latest, "lessonName").value).toBe("Latest Lesson With Events");
			expect(requireV2FieldValue(latest, "eventSchemaSlug").value).toBe(completeSlug);
		});

		it("returns latest event scalar values with first and null when no event matches", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "FirstExprLesson" },
			);
			const completeSlug = `first-complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "First Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { notes: { type: "string", label: "Notes", description: "Completion notes" } },
				},
			});
			const lessonWithEvents = await createV2Entity(client, {
				name: "Lesson A",
				entitySchemaId: lessonSchemaId,
			});
			await createV2Entity(client, { name: "Lesson B", entitySchemaId: lessonSchemaId });

			await createV2Event(client, {
				entityId: lessonWithEvents.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-03-01T00:00:00.000Z",
			});
			await createV2Event(client, {
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

			const result = await executeQueryEngineV2(client, doc);

			const lessonA = result.data.items.find(
				(item) => requireV2FieldValue(item, "name").value === "Lesson A",
			);
			const lessonB = result.data.items.find(
				(item) => requireV2FieldValue(item, "name").value === "Lesson B",
			);
			assertPresent(lessonA, "Expected Lesson A row");
			assertPresent(lessonB, "Expected Lesson B row");
			expect(
				new Date(String(requireV2FieldValue(lessonA, "latestCompletionAt").value)).toISOString(),
			).toBe("2026-04-01T00:00:00.000Z");
			expect(requireV2FieldValue(lessonB, "latestCompletionAt")).toEqual({
				value: null,
				kind: "null",
			});
		});
	});

	describe("Relationship root sources", () => {
		it("returns relationship rows with relationship and endpoint entity fields sorted by relationship createdAt", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "RelRootMember" },
			);
			const { schemaId: collectionSchemaId, slug: collectionSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "RelRootCollection" },
			);
			const relationshipSlug = `rel-root-membership-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				name: "Rel Root Membership",
				slug: relationshipSlug,
				sourceEntitySchemaId: memberSchemaId,
				targetEntitySchemaId: collectionSchemaId,
				propertiesSchema: {
					fields: { role: { type: "string", label: "Role", description: "Membership role" } },
				},
			});

			const memberOne = await createV2Entity(client, {
				name: "Member One",
				entitySchemaId: memberSchemaId,
			});
			const memberTwo = await createV2Entity(client, {
				name: "Member Two",
				entitySchemaId: memberSchemaId,
			});
			const collection = await createV2Entity(client, {
				name: "Collection",
				entitySchemaId: collectionSchemaId,
			});

			await createRelationship(client, {
				sourceEntityId: memberOne.id,
				targetEntityId: collection.id,
				properties: { role: "first" },
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
				sourceEntityId: memberTwo.id,
				targetEntityId: collection.id,
				properties: { role: "second" },
				relationshipSchemaId: relationshipSchema.id,
			});

			const doc: V2ExecutePayload = {
				version: 2,
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlug],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "desc", expr: systemRef("membership", "createdAt") }],
					fields: [
						{ key: "createdAt", expr: systemRef("membership", "createdAt") },
						{ key: "sourceEntityId", expr: systemRef("membership", "sourceEntityId") },
						{ key: "memberName", expr: systemRef("memberEntity", "name") },
						{ key: "collectionName", expr: systemRef("collectionEntity", "name") },
						{ key: "role", expr: propertyRef("membership", relationshipSlug, "role") },
					],
				},
			};

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(2);
			expect(result.data.pageInfo.total).toBe(2);

			const [first, second] = result.data.items;
			assertPresent(first, "Expected first relationship row");
			assertPresent(second, "Expected second relationship row");
			const firstCreatedAt = new Date(String(requireV2FieldValue(first, "createdAt").value));
			const secondCreatedAt = new Date(String(requireV2FieldValue(second, "createdAt").value));
			expect(firstCreatedAt.getTime()).toBeGreaterThanOrEqual(secondCreatedAt.getTime());

			const byMember = new Map(
				result.data.items.map((item) => [requireV2FieldValue(item, "sourceEntityId").value, item]),
			);
			const memberOneRow = byMember.get(memberOne.id);
			const memberTwoRow = byMember.get(memberTwo.id);
			assertPresent(memberOneRow, "Expected Member One's relationship row");
			assertPresent(memberTwoRow, "Expected Member Two's relationship row");
			expect(requireV2FieldValue(memberOneRow, "memberName").value).toBe("Member One");
			expect(requireV2FieldValue(memberOneRow, "collectionName").value).toBe("Collection");
			expect(requireV2FieldValue(memberOneRow, "role").value).toBe("first");
			expect(requireV2FieldValue(memberTwoRow, "memberName").value).toBe("Member Two");
			expect(requireV2FieldValue(memberTwoRow, "role").value).toBe("second");
		});

		it("enforces visibility on relationship rows and both endpoint entities", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			const { schemaId: memberSchemaIdA, slug: memberSlugA } = await createV2TrackerAndSchema(
				userA.client,
				{ schemaName: "RelRootIsoMember" },
			);
			const { schemaId: collectionSchemaIdA, slug: collectionSlugA } =
				await createV2TrackerAndSchema(userA.client, { schemaName: "RelRootIsoCollection" });
			const relationshipSlugA = `rel-root-iso-${crypto.randomUUID()}`;
			const relationshipSchemaA = await createRelationshipSchema(userA.client, {
				name: "Rel Root Iso",
				slug: relationshipSlugA,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: memberSchemaIdA,
				targetEntitySchemaId: collectionSchemaIdA,
			});
			const memberA = await createV2Entity(userA.client, {
				name: "User A Member",
				entitySchemaId: memberSchemaIdA,
			});
			const collectionA = await createV2Entity(userA.client, {
				name: "User A Collection",
				entitySchemaId: collectionSchemaIdA,
			});
			await createRelationship(userA.client, {
				sourceEntityId: memberA.id,
				targetEntityId: collectionA.id,
				relationshipSchemaId: relationshipSchemaA.id,
			});

			const docA: V2ExecutePayload = {
				version: 2,
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlugA],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlugA] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlugA] },
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "desc", expr: systemRef("membership", "createdAt") }],
					fields: [{ key: "memberName", expr: systemRef("memberEntity", "name") }],
				},
			};

			const errorForUserB = await executeQueryEngineV2Error(userB.client, docA);
			expect(errorForUserB).toMatchObject({ _tag: "NotFound" });

			const { schemaId: memberSchemaIdB, slug: memberSlugB } = await createV2TrackerAndSchema(
				userB.client,
				{ schemaName: "RelRootIsoMember" },
			);
			const { schemaId: collectionSchemaIdB, slug: collectionSlugB } =
				await createV2TrackerAndSchema(userB.client, { schemaName: "RelRootIsoCollection" });
			const relationshipSlugB = `rel-root-iso-${crypto.randomUUID()}`;
			const relationshipSchemaB = await createRelationshipSchema(userB.client, {
				name: "Rel Root Iso",
				slug: relationshipSlugB,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: memberSchemaIdB,
				targetEntitySchemaId: collectionSchemaIdB,
			});
			const memberB = await createV2Entity(userB.client, {
				name: "User B Member",
				entitySchemaId: memberSchemaIdB,
			});
			const collectionB = await createV2Entity(userB.client, {
				name: "User B Collection",
				entitySchemaId: collectionSchemaIdB,
			});
			await createRelationship(userB.client, {
				sourceEntityId: memberB.id,
				targetEntityId: collectionB.id,
				relationshipSchemaId: relationshipSchemaB.id,
			});

			const docB: V2ExecutePayload = {
				...docA,
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlugB],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlugB] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlugB] },
				},
			};

			const resultB = await executeQueryEngineV2(userB.client, docB);
			expect(resultB.data.items).toHaveLength(1);
			const itemB = resultB.data.items[0];
			assertPresent(itemB, "Expected User B's relationship row");
			expect(requireV2FieldValue(itemB, "memberName").value).toBe("User B Member");
		});
	});

	describe("Time series returns", () => {
		it("returns event buckets with half-open range filtering and zero fill", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "TimeSeriesEventLesson" },
			);
			const completeSlug = `time-series-complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "Time Series Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Completion note" } },
				},
			});
			const lesson = await createV2Entity(client, {
				name: "Time Series Lesson",
				entitySchemaId: lessonSchemaId,
			});

			await createV2Event(client, {
				entityId: lesson.id,
				properties: { note: "included" },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-01T12:00:00.000Z",
			});
			await createV2Event(client, {
				entityId: lesson.id,
				properties: { note: "excluded" },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-03T00:00:00.000Z",
			});

			const doc: V2ExecutePayload = {
				version: 2,
				source: {
					where: null,
					type: "events",
					alias: "completion",
					schemas: [completeSlug],
					entity: { alias: "lesson", schemas: [lessonSlug] },
				},
				output: {
					type: "timeSeries",
					measure: { aggregation: { function: "count" } },
					time: {
						bucket: "day",
						expr: systemRef("completion", "occurredAt"),
						range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
					},
				},
			};

			const result = await executeTimeSeriesQueryEngineV2(client, doc);

			expect(result.data.buckets).toEqual([
				{ value: 1, endAt: "2026-01-02T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				{ value: 0, endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-02T00:00:00.000Z" },
			]);
		});

		it("returns entity buckets using a date property", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "TimeSeriesEntity",
				propertiesSchema: {
					fields: {
						publishedAt: { type: "datetime", label: "Published At", description: "Published at" },
					},
				},
			});
			await Promise.all([
				createV2Entity(client, {
					name: "Entity One",
					entitySchemaId: schemaId,
					properties: { publishedAt: "2026-01-01T12:00:00.000Z" },
				}),
				createV2Entity(client, {
					name: "Entity Two",
					entitySchemaId: schemaId,
					properties: { publishedAt: "2026-01-01T13:00:00.000Z" },
				}),
			]);

			const doc: V2ExecutePayload = {
				version: 2,
				source: { where: null, type: "entities", alias: "entity", schemas: [slug] },
				output: {
					type: "timeSeries",
					measure: { aggregation: { function: "count" } },
					time: {
						bucket: "day",
						expr: propertyRef("entity", slug, "publishedAt"),
						range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
					},
				},
			};

			const result = await executeTimeSeriesQueryEngineV2(client, doc);

			expect(result.data.buckets).toHaveLength(2);
			expect(result.data.buckets[0]?.value).toBe(2);
			expect(result.data.buckets[1]?.value).toBe(0);
		});

		it("returns relationship buckets using relationship createdAt", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "TimeSeriesRelMember" },
			);
			const { schemaId: collectionSchemaId, slug: collectionSlug } = await createV2TrackerAndSchema(
				client,
				{ schemaName: "TimeSeriesRelCollection" },
			);
			const relationshipSlug = `time-series-membership-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				slug: relationshipSlug,
				name: "Time Series Membership",
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: memberSchemaId,
				targetEntitySchemaId: collectionSchemaId,
			});
			const member = await createV2Entity(client, {
				name: "Time Series Member",
				entitySchemaId: memberSchemaId,
			});
			const collection = await createV2Entity(client, {
				name: "Time Series Collection",
				entitySchemaId: collectionSchemaId,
			});
			await createRelationship(client, {
				sourceEntityId: member.id,
				targetEntityId: collection.id,
				relationshipSchemaId: relationshipSchema.id,
			});

			const doc: V2ExecutePayload = {
				version: 2,
				output: {
					type: "timeSeries",
					measure: { aggregation: { function: "count" } },
					time: {
						bucket: "month",
						expr: systemRef("membership", "createdAt"),
						range: { endAt: "2031-01-01T00:00:00.000Z", startAt: "2020-01-01T00:00:00.000Z" },
					},
				},
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlug],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
				},
			};

			const result = await executeTimeSeriesQueryEngineV2(client, doc);

			expect(result.data.buckets.some((bucket) => bucket.value === 1)).toBe(true);
		});

		it("rejects date ranges that produce more than 1000 buckets", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "TimeSeriesBucketCap",
			});
			const doc: V2ExecutePayload = {
				version: 2,
				source: { where: null, type: "entities", alias: "entity", schemas: [slug] },
				output: {
					type: "timeSeries",
					measure: { aggregation: { function: "count" } },
					time: {
						bucket: "day",
						expr: systemRef("entity", "createdAt"),
						range: { endAt: "2028-10-01T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
					},
				},
			};

			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});
	});

	describe("Visibility boundary", () => {
		it("does not allow a user to query another user's private entity schema", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			const { slug } = await createV2TrackerAndSchema(userA.client, {
				schemaName: "UserAPrivateCourse",
			});

			const doc = buildRowsDoc({ fields: [], alias: "course", schemas: [slug] });

			const error = await executeQueryEngineV2Error(userB.client, doc);
			expect(error).toMatchObject({ _tag: "NotFound" });
		});

		it("only returns entities owned by the authenticated user", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			// Both users need access to the same schema slug. Use a unique slug per user
			// to avoid cross-schema contamination; in practice each user has their own schema.
			const { schemaId: schemaA, slug: slugA } = await createV2TrackerAndSchema(userA.client, {
				schemaName: "VisibilityCourse",
			});
			const { schemaId: schemaB, slug: slugB } = await createV2TrackerAndSchema(userB.client, {
				schemaName: "VisibilityCourse",
			});

			await createV2Entity(userA.client, { name: "User A Entity", entitySchemaId: schemaA });
			await createV2Entity(userB.client, { name: "User B Entity", entitySchemaId: schemaB });

			const resultA = await executeQueryEngineV2(
				userA.client,
				buildRowsDoc({
					alias: "course",
					schemas: [slugA],
					fields: [{ key: "name", expr: systemRef("course", "name") }],
				}),
			);

			expect(resultA.data.items).toHaveLength(1);
			const itemA = resultA.data.items[0];
			assertPresent(itemA, "Expected User A's result item");
			expect(requireV2FieldValue(itemA, "name").value).toBe("User A Entity");

			const resultB = await executeQueryEngineV2(
				userB.client,
				buildRowsDoc({
					alias: "course",
					schemas: [slugB],
					fields: [{ key: "name", expr: systemRef("course", "name") }],
				}),
			);

			expect(resultB.data.items).toHaveLength(1);
			const itemB = resultB.data.items[0];
			assertPresent(itemB, "Expected User B's result item");
			expect(requireV2FieldValue(itemB, "name").value).toBe("User B Entity");
		});
	});

	describe("Validation errors", () => {
		it("rejects a pagination limit exceeding 100", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "LimitTestSchema",
			});

			const doc = buildRowsDoc({ alias: "e", schemas: [slug], limit: 101 });
			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects an invalid system field for an entity source", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "SystemFieldTestSchema",
			});

			const doc = buildRowsDoc({
				alias: "e",
				schemas: [slug],
				// occurredAt is an event-only system field
				orderByExpr: systemRef("e", "occurredAt"),
			});
			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects a property field that references a schema not in the source schemas", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "PropSchemaTestSchema",
				propertiesSchema: {
					fields: { title: { type: "string", label: "Title", description: "Title value" } },
				},
			});

			const doc = buildRowsDoc({
				alias: "e",
				schemas: [slug],
				fields: [{ key: "title", expr: propertyRef("e", "other-schema", "title") }],
			});
			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects duplicate source schema slugs", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "DuplicateSchemaGuardrail",
			});

			const doc = buildRowsDoc({ alias: "e", schemas: [slug, slug] });
			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects old predicate operand keys", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "OldPredicateGuardrail",
			});
			const invalidExpr = {
				type: "and" as const,
				predicates: [{ type: "literal", value: true }],
				values: [{ type: "literal" as const, value: true }] as const,
			};

			const doc = buildRowsDoc({ alias: "e", schemas: [slug], orderByExpr: invalidExpr });
			const error = await executeQueryEngineV2Error(client, doc);
			assertTaggedError(error, "ParseError");
		});

		it("rejects unsupported legacy filter keys", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "LegacyFilterGuardrail",
			});

			const doc = {
				...buildRowsDoc({ alias: "e", schemas: [slug] }),
				source: {
					alias: "e",
					where: null,
					schemas: [slug],
					type: "entities",
					filter: { type: "literal", value: true },
				},
			} as V2ExecutePayload;
			const error = await executeQueryEngineV2Error(client, doc);
			assertTaggedError(error, "ParseError");
		});
	});
});
