import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createEventSchema,
	createRelationship,
	createRelationshipSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEngineTrackerAndSchema,
	executeAggregateQueryEngine,
	executeQueryEngine,
	executeQueryEngineError,
	executeTimeSeriesQueryEngine,
	findBuiltinSchemaBySlug,
	listEventSchemas,
	listRelationshipSchemas,
	propertyRef,
	postBackendJson,
	requireEventSchemaBySlug,
	requireQueryEngineIncludeValue,
	requireQueryEngineFieldValue,
	requireRelationshipSchemaBySlug,
	schemaMetaRef,
	seedMediaEntity,
	systemRef,
	waitForEventCount,
	type QueryEnginePayload,
} from "../fixtures";
import { createGlobalBookEntityFixture, insertLibraryMembership } from "../fixtures/media";
import { getPgClient } from "../setup";
import { assertPresent, requireObjectRecord, requireString } from "../test-support/assertions";

const buildRowsDoc = (
	overrides: Partial<QueryEnginePayload> & {
		alias: string;
		page?: number;
		limit?: number;
		schemas: [string, ...string[]];
		fields?: Extract<QueryEnginePayload["output"], { type: "rows" }>["fields"];
		orderByExpr?: Extract<
			QueryEnginePayload["output"],
			{ type: "rows" }
		>["orderBy"][number]["expr"];
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

const expectMalformedQueryBadRequest = async (body: unknown, cookies: string) => {
	const response = await postBackendJson("/query-engine/execute", body, cookies);
	const error = requireObjectRecord(await response.json(), "Expected BadRequest response");

	expect(response.status).toBe(400);
	expect(requireString(error._tag, "Expected error tag")).toBe("BadRequest");
};

const getBuiltinEntitySchemaId = async (slug: string) => {
	const result = await getPgClient().query<{ id: string }>(
		`select id from entity_schema where slug = $1 and user_id is null and is_builtin = true limit 1`,
		[slug],
	);
	const row = result.rows[0];
	assertPresent(row, `Expected builtin entity schema '${slug}'`);
	return row.id;
};

const insertGlobalRelationship = async (input: {
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

const showEpisodeEventExistsSource = (episodeAlias: string, eventSlug: string) =>
	({
		where: null,
		type: "events",
		schemas: [eventSlug],
		alias: `${episodeAlias}${eventSlug}`,
		entityRef: episodeAlias,
	}) as const;

const showSeasonSource = (alias: string, where: QueryEnginePayload["source"]["where"]) =>
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

const createCourseLessonFilterFixture = async () => {
	const { client } = await createAuthenticatedClient();
	const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
		client,
		{
			schemaName: "FilterCourse",
		},
	);
	const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
		client,
		{
			schemaName: "FilterModule",
		},
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

describe("Query Engine E2E", () => {
	describe("Single-schema entity rows query", () => {
		it("returns entities with system field values", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "Course",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty level" },
					},
				},
			});

			await createQueryEngineEntity(client, {
				entitySchemaId: schemaId,
				name: "Advanced TypeScript",
				properties: { difficulty: "advanced" },
			});
			await createQueryEngineEntity(client, {
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

			const result = await executeQueryEngine(client, doc);

			expect(result.type).toBe("rows");
			expect(result.data.items).toHaveLength(2);

			const names = result.data.items.map(
				(item) => requireQueryEngineFieldValue(item, "name").value,
			);
			expect(names).toContain("Advanced TypeScript");
			expect(names).toContain("Beginner Rust");

			for (const item of result.data.items) {
				expect(requireQueryEngineFieldValue(item, "name").kind).toBe("text");
				expect(requireQueryEngineFieldValue(item, "id").kind).toBe("text");
				expect(typeof requireQueryEngineFieldValue(item, "id").value).toBe("string");
			}
		});

		it("returns property field values for matching schema", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "Book",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Book author" } },
				},
			});

			await createQueryEngineEntity(client, {
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

			const result = await executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireQueryEngineFieldValue(item, "name").value).toBe("Clean Code");
			expect(requireQueryEngineFieldValue(item, "author").value).toBe("Robert Martin");
			expect(requireQueryEngineFieldValue(item, "author").kind).toBe("text");
		});

		it("returns schema metadata fields", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "TaggedCourse",
			});

			await createQueryEngineEntity(client, { name: "First Course", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				alias: "c",
				schemas: [slug],
				fields: [
					{ key: "schemaSlug", expr: schemaMetaRef("c", "slug") },
					{ key: "schemaName", expr: schemaMetaRef("c", "name") },
				],
			});

			const result = await executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireQueryEngineFieldValue(item, "schemaSlug").value).toBe(slug);
			expect(requireQueryEngineFieldValue(item, "schemaName").value).toBe("TaggedCourse");
		});
	});

	describe("Multi-schema property query", () => {
		it("returns null for property fields that do not match the row's schema", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: bookSchemaId, slug: bookSlug } = await createQueryEngineTrackerAndSchema(
				client,
				{
					schemaName: "MultiBook",
					propertiesSchema: {
						fields: { author: { type: "string", label: "Author", description: "Book author" } },
					},
				},
			);
			const { schemaId: movieSchemaId, slug: movieSlug } = await createQueryEngineTrackerAndSchema(
				client,
				{
					schemaName: "MultiMovie",
					propertiesSchema: {
						fields: {
							director: { type: "string", label: "Director", description: "Movie director" },
						},
					},
				},
			);

			await createQueryEngineEntity(client, {
				name: "A Great Book",
				entitySchemaId: bookSchemaId,
				properties: { author: "Author A" },
			});
			await createQueryEngineEntity(client, {
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

			const result = await executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(2);

			const bookItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "A Great Book",
			);
			const movieItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "A Great Movie",
			);

			assertPresent(bookItem, "Expected bookItem");
			assertPresent(movieItem, "Expected movieItem");

			expect(requireQueryEngineFieldValue(bookItem, "author").value).toBe("Author A");
			expect(requireQueryEngineFieldValue(bookItem, "director").kind).toBe("null");

			expect(requireQueryEngineFieldValue(movieItem, "director").value).toBe("Director B");
			expect(requireQueryEngineFieldValue(movieItem, "author").kind).toBe("null");
		});
	});

	describe("Pagination", () => {
		it("returns correct pagination metadata for multiple pages", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "PaginatedItem",
			});

			await Promise.all(
				Array.from({ length: 5 }, (_, i) =>
					createQueryEngineEntity(client, {
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

			const result = await executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(5);
			expect(result.data.pageInfo.page).toBe(1);
			expect(result.data.pageInfo.limit).toBe(2);
			expect(result.data.pageInfo.hasMore).toBe(true);
			expect(result.data.items).toHaveLength(2);
		});

		it("returns hasMore=false on the last page", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "LastPageItem",
			});

			await createQueryEngineEntity(client, { name: "Only Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 1,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = await executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(1);
			expect(result.data.pageInfo.hasMore).toBe(false);
		});

		it("returns empty items and zero total for second page beyond results", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "SparseItem",
			});

			await createQueryEngineEntity(client, { name: "One Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 2,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = await executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(0);
			expect(result.data.items).toHaveLength(0);
			expect(result.data.pageInfo.hasMore).toBe(false);
		});
	});

	describe("Relationship includes", () => {
		it("returns one-hop entity includes with limit metadata", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "IncludeCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				await createQueryEngineTrackerAndSchema(client, {
					schemaName: "IncludeModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
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

			const courseA = await createQueryEngineEntity(client, {
				name: "Course A",
				entitySchemaId: courseSchemaId,
			});
			const courseB = await createQueryEngineEntity(client, {
				name: "Course B",
				entitySchemaId: courseSchemaId,
			});
			const moduleOne = await createQueryEngineEntity(client, {
				name: "Module One",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleTwo = await createQueryEngineEntity(client, {
				name: "Module Two",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 2 },
			});
			const moduleThree = await createQueryEngineEntity(client, {
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

			const result = await executeQueryEngine(client, doc);

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
		});

		it("orders nested includes numerically by an integer property, not lexicographically", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "NumOrderCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				await createQueryEngineTrackerAndSchema(client, {
					schemaName: "NumOrderModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `num-course-module-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				name: "Num Course Module",
				slug: relationshipSlug,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: courseSchemaId,
				targetEntitySchemaId: moduleSchemaId,
			});

			const course = await createQueryEngineEntity(client, {
				name: "Numbered Course",
				entitySchemaId: courseSchemaId,
			});
			// 10 created before 2 so insertion order can't mask the sort: numeric order must give 2, 10.
			const moduleTen = await createQueryEngineEntity(client, {
				name: "Module Ten",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 10 },
			});
			const moduleTwo = await createQueryEngineEntity(client, {
				name: "Module Two",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 2 },
			});
			await createRelationship(client, {
				properties: {},
				sourceEntityId: course.id,
				targetEntityId: moduleTen.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
				properties: {},
				sourceEntityId: course.id,
				targetEntityId: moduleTwo.id,
				relationshipSchemaId: relationshipSchema.id,
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

			const result = await executeQueryEngine(client, doc);
			const courseItem = result.data.items[0];
			assertPresent(courseItem, "Expected course row");
			const modules = requireQueryEngineIncludeValue(courseItem, "modules");
			expect(
				modules.items.map((item) => requireQueryEngineFieldValue(item, "moduleNumber").value),
			).toEqual([2, 10]);
		});

		it("returns deep entity includes with event existence fields", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "DeepCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				await createQueryEngineTrackerAndSchema(client, {
					schemaName: "DeepModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				await createQueryEngineTrackerAndSchema(client, {
					schemaName: "DeepLesson",
					propertiesSchema: {
						fields: {
							lessonNumber: { type: "integer", label: "Lesson Number", description: "Sort order" },
						},
					},
				});
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

			const course = await createQueryEngineEntity(client, {
				name: "Course",
				entitySchemaId: courseSchemaId,
			});
			const module = await createQueryEngineEntity(client, {
				name: "Module",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const secondLesson = await createQueryEngineEntity(client, {
				name: "Lesson Two",
				entitySchemaId: lessonSchemaId,
				properties: { lessonNumber: 2 },
			});
			const firstLesson = await createQueryEngineEntity(client, {
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
			await createQueryEngineEvent(client, {
				entityId: firstLesson.id,
				eventSchemaId: completeSchema.id,
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

			const result = await executeQueryEngine(client, doc);

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
		});

		it("returns builtin show seasons and episodes with derived episode state", async () => {
			const { client } = await createAuthenticatedClient();
			const { schema: showSchema } = await findBuiltinSchemaBySlug(client, "show");
			const showSeasonSchemaId = await getBuiltinEntitySchemaId("show-season");
			const showEpisodeSchemaId = await getBuiltinEntitySchemaId("show-episode");
			const relationshipSchemas = await listRelationshipSchemas(client, {
				slugs: ["show-to-show-season", "show-season-to-show-episode"],
			});
			const showSeasonRelationship = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"show-to-show-season",
			);
			const seasonEpisodeRelationship = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"show-season-to-show-episode",
			);
			const showEvents = await listEventSchemas(client, showSchema.id);
			const seasonEvents = await listEventSchemas(client, showSeasonSchemaId);
			const episodeEvents = await listEventSchemas(client, showEpisodeSchemaId);
			const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
			const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

			expect(showEvents.some((schema) => schema.slug === "progress")).toBe(false);
			expect(seasonEvents.map((schema) => schema.slug)).toEqual(["complete"]);
			expect(episodeEvents.map((schema) => schema.slug).sort()).toEqual(["complete", "progress"]);

			const fixtureSuffix = crypto.randomUUID();
			const show = await seedMediaEntity({
				image: null,
				userId: null,
				sandboxScriptId: null,
				name: "Episodic Test Show",
				entitySchemaId: showSchema.id,
				externalId: `show-${fixtureSuffix}`,
				properties: {
					images: [],
					genres: [],
					isNsfw: null,
					sourceUrl: null,
					totalSeasons: 3,
					totalEpisodes: 2,
					description: null,
					publishYear: null,
					publishDate: null,
					providerRating: null,
					productionStatus: null,
				},
			});
			const specialSeason = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Specials",
				sandboxScriptId: null,
				entitySchemaId: showSeasonSchemaId,
				externalId: `season-0-${fixtureSuffix}`,
				properties: { seasonNumber: 0, description: "Specials", releaseDate: null },
			});
			const firstSeason = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Season 1",
				sandboxScriptId: null,
				entitySchemaId: showSeasonSchemaId,
				externalId: `season-1-${fixtureSuffix}`,
				properties: { seasonNumber: 1, description: "First", releaseDate: null },
			});
			const secondSeason = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Season 2",
				sandboxScriptId: null,
				entitySchemaId: showSeasonSchemaId,
				externalId: `season-2-${fixtureSuffix}`,
				properties: { seasonNumber: 2, description: "Second", releaseDate: null },
			});
			const specialEpisode = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Special Episode",
				sandboxScriptId: null,
				entitySchemaId: showEpisodeSchemaId,
				externalId: `episode-0-1-${fixtureSuffix}`,
				properties: {
					runtime: 10,
					seasonNumber: 0,
					episodeNumber: 1,
					publishDate: null,
					description: "Special",
				},
			});
			const firstEpisode = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Episode One",
				sandboxScriptId: null,
				entitySchemaId: showEpisodeSchemaId,
				externalId: `episode-1-1-${fixtureSuffix}`,
				properties: {
					runtime: 45,
					seasonNumber: 1,
					episodeNumber: 1,
					publishDate: null,
					description: "First",
				},
			});
			const secondEpisode = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Episode Two",
				sandboxScriptId: null,
				entitySchemaId: showEpisodeSchemaId,
				externalId: `episode-2-1-${fixtureSuffix}`,
				properties: {
					runtime: 50,
					seasonNumber: 2,
					episodeNumber: 1,
					publishDate: null,
					description: "Second",
				},
			});

			await insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: specialSeason.id,
				relationshipSchemaId: showSeasonRelationship.id,
			});
			await insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: firstSeason.id,
				relationshipSchemaId: showSeasonRelationship.id,
			});
			await insertGlobalRelationship({
				sourceEntityId: show.id,
				targetEntityId: secondSeason.id,
				relationshipSchemaId: showSeasonRelationship.id,
			});
			await insertGlobalRelationship({
				sourceEntityId: specialSeason.id,
				targetEntityId: specialEpisode.id,
				relationshipSchemaId: seasonEpisodeRelationship.id,
			});
			await insertGlobalRelationship({
				sourceEntityId: firstSeason.id,
				targetEntityId: firstEpisode.id,
				relationshipSchemaId: seasonEpisodeRelationship.id,
			});
			await insertGlobalRelationship({
				sourceEntityId: secondSeason.id,
				targetEntityId: secondEpisode.id,
				relationshipSchemaId: seasonEpisodeRelationship.id,
			});

			await createQueryEngineEvent(client, {
				entityId: firstEpisode.id,
				eventSchemaId: episodeProgressSchema.id,
				occurredAt: "2026-06-25T00:00:00.000Z",
				properties: { progressPercent: 100, consumedOn: "Jellyfin" },
			});
			await waitForEventCount(client, firstEpisode.id, 2);
			await createQueryEngineEvent(client, {
				entityId: secondEpisode.id,
				eventSchemaId: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});
			await createQueryEngineEvent(client, {
				entityId: specialEpisode.id,
				eventSchemaId: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});

			const showNameWhere = {
				operator: "eq" as const,
				type: "comparison" as const,
				left: systemRef("show", "id"),
				right: { type: "literal" as const, value: show.id },
			};
			const completedRegularSeasonSource = (aliasSuffix: string) =>
				showSeasonSource(`seasonCompleted${aliasSuffix}`, {
					type: "and",
					values: [
						{
							operator: "gt",
							type: "comparison",
							right: { type: "literal", value: 0 },
							left: propertyRef(`seasonCompleted${aliasSuffix}`, "show-season", "seasonNumber"),
						},
						{
							type: "exists",
							source: {
								type: "entities",
								schemas: ["show-episode"],
								alias: `episodeCompleted${aliasSuffix}`,
								via: {
									direction: "outgoing",
									schema: "show-season-to-show-episode",
									entityRef: `seasonCompleted${aliasSuffix}`,
									alias: `seasonEpisodeCompleted${aliasSuffix}`,
								},
								where: {
									type: "exists",
									source: showEpisodeEventExistsSource(
										`episodeCompleted${aliasSuffix}`,
										"complete",
									),
								},
							},
						},
					],
				});

			const detailDoc = buildRowsDoc({
				limit: 1,
				alias: "show",
				schemas: ["show"],
				fields: [{ key: "name", expr: systemRef("show", "name") }],
				source: { alias: "show", type: "entities", schemas: ["show"], where: showNameWhere },
				output: {
					type: "rows",
					pagination: { page: 1, limit: 1 },
					fields: [{ key: "name", expr: systemRef("show", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("show", "name") }],
					include: [
						{
							limit: 10,
							key: "seasons",
							fields: [
								{ key: "name", expr: systemRef("season", "name") },
								{ key: "seasonNumber", expr: propertyRef("season", "show-season", "seasonNumber") },
							],
							orderBy: [
								{ order: "asc", expr: propertyRef("season", "show-season", "seasonNumber") },
							],
							source: {
								where: null,
								alias: "season",
								type: "entities",
								schemas: ["show-season"],
								via: {
									entityRef: "show",
									alias: "showSeason",
									direction: "outgoing",
									schema: "show-to-show-season",
								},
							},
							include: [
								{
									limit: 10,
									key: "episodes",
									orderBy: [
										{ order: "asc", expr: propertyRef("episode", "show-episode", "episodeNumber") },
									],
									fields: [
										{ key: "name", expr: systemRef("episode", "name") },
										{
											key: "episodeNumber",
											expr: propertyRef("episode", "show-episode", "episodeNumber"),
										},
										{
											key: "hasProgress",
											expr: {
												type: "exists",
												source: showEpisodeEventExistsSource("episode", "progress"),
											},
										},
										{
											key: "isComplete",
											expr: {
												type: "exists",
												source: showEpisodeEventExistsSource("episode", "complete"),
											},
										},
									],
									source: {
										where: null,
										alias: "episode",
										type: "entities",
										schemas: ["show-episode"],
										via: {
											entityRef: "season",
											direction: "outgoing",
											alias: "seasonEpisode",
											schema: "show-season-to-show-episode",
										},
									},
								},
							],
						},
					],
				},
			});

			const detailResult = await executeQueryEngine(client, detailDoc);
			const showRow = detailResult.data.items[0];
			assertPresent(showRow, "Expected show row");
			const seasons = requireQueryEngineIncludeValue(showRow, "seasons");
			expect(
				seasons.items.map((season) => requireQueryEngineFieldValue(season, "seasonNumber").value),
			).toEqual([0, 1, 2]);
			const firstSeasonRow = seasons.items[1];
			assertPresent(firstSeasonRow, "Expected first regular season row");
			const firstSeasonEpisodes = requireQueryEngineIncludeValue(firstSeasonRow, "episodes");
			const firstEpisodeRow = firstSeasonEpisodes.items[0];
			assertPresent(firstEpisodeRow, "Expected first episode row");
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "name").value).toBe("Episode One");
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "hasProgress")).toEqual({
				kind: "boolean",
				value: true,
			});
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "isComplete")).toEqual({
				kind: "boolean",
				value: true,
			});

			const currentlyWatchingDoc = buildRowsDoc({
				limit: 10,
				alias: "show",
				schemas: ["show"],
				fields: [{ key: "name", expr: systemRef("show", "name") }],
				source: {
					alias: "show",
					type: "entities",
					schemas: ["show"],
					where: {
						type: "and",
						values: [
							showNameWhere,
							{
								type: "not",
								expr: {
									type: "exists",
									source: {
										where: null,
										type: "events",
										entityRef: "show",
										schemas: ["complete"],
										alias: "showCompletion",
									},
								},
							},
							{
								type: "exists",
								source: showSeasonSource("seasonWatching", {
									type: "exists",
									source: {
										type: "entities",
										alias: "episodeWatching",
										schemas: ["show-episode"],
										where: {
											type: "exists",
											source: showEpisodeEventExistsSource("episodeWatching", "progress"),
										},
										via: {
											direction: "outgoing",
											entityRef: "seasonWatching",
											alias: "seasonEpisodeWatching",
											schema: "show-season-to-show-episode",
										},
									},
								}),
							},
						],
					},
				},
			});
			const currentlyWatchingResult = await executeQueryEngine(client, currentlyWatchingDoc);
			expect(currentlyWatchingResult.data.items).toHaveLength(1);

			const fullyWatchedDoc = buildRowsDoc({
				limit: 10,
				alias: "show",
				schemas: ["show"],
				fields: [{ key: "name", expr: systemRef("show", "name") }],
				source: {
					alias: "show",
					type: "entities",
					schemas: ["show"],
					where: {
						type: "and",
						values: [
							showNameWhere,
							{
								operator: "eq",
								type: "comparison",
								left: {
									type: "aggregate",
									aggregation: { function: "count" },
									source: completedRegularSeasonSource("Filter"),
								},
								right: {
									type: "aggregate",
									aggregation: { function: "count" },
									source: showSeasonSource("seasonRegularFilter", {
										operator: "gt",
										type: "comparison",
										right: { type: "literal", value: 0 },
										left: propertyRef("seasonRegularFilter", "show-season", "seasonNumber"),
									}),
								},
							},
						],
					},
				},
			});
			const fullyWatchedResult = await executeQueryEngine(client, fullyWatchedDoc);
			expect(fullyWatchedResult.data.items).toHaveLength(1);
		});

		it("returns builtin podcast episodes with derived episode state", async () => {
			const { client } = await createAuthenticatedClient();
			const { schema: podcastSchema } = await findBuiltinSchemaBySlug(client, "podcast");
			const podcastEpisodeSchemaId = await getBuiltinEntitySchemaId("podcast-episode");
			const relationshipSchemas = await listRelationshipSchemas(client, {
				slugs: ["podcast-to-podcast-episode"],
			});
			const podcastEpisodeRelationship = requireRelationshipSchemaBySlug(
				relationshipSchemas,
				"podcast-to-podcast-episode",
			);
			const podcastEvents = await listEventSchemas(client, podcastSchema.id);
			const episodeEvents = await listEventSchemas(client, podcastEpisodeSchemaId);
			const episodeProgressSchema = requireEventSchemaBySlug(episodeEvents, "progress");
			const episodeCompleteSchema = requireEventSchemaBySlug(episodeEvents, "complete");

			expect(podcastEvents.some((schema) => schema.slug === "progress")).toBe(false);
			expect(episodeEvents.map((schema) => schema.slug).sort()).toEqual(["complete", "progress"]);

			const fixtureSuffix = crypto.randomUUID();
			const podcast = await seedMediaEntity({
				image: null,
				userId: null,
				sandboxScriptId: null,
				name: "Episodic Test Podcast",
				entitySchemaId: podcastSchema.id,
				externalId: `podcast-${fixtureSuffix}`,
				properties: {
					images: [],
					genres: [],
					isNsfw: null,
					sourceUrl: null,
					totalEpisodes: 2,
					description: null,
					publishYear: null,
					publishDate: null,
					providerRating: null,
					unlinkedCreators: [],
					productionStatus: null,
				},
			});
			const secondEpisode = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Episode Two",
				sandboxScriptId: null,
				entitySchemaId: podcastEpisodeSchemaId,
				externalId: `podcast-episode-2-${fixtureSuffix}`,
				properties: { runtime: 40, episodeNumber: 2, publishDate: null, description: "Second" },
			});
			const firstEpisode = await seedMediaEntity({
				image: null,
				userId: null,
				name: "Episode One",
				sandboxScriptId: null,
				entitySchemaId: podcastEpisodeSchemaId,
				externalId: `podcast-episode-1-${fixtureSuffix}`,
				properties: { runtime: 30, episodeNumber: 1, publishDate: null, description: "First" },
			});

			await insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: secondEpisode.id,
				relationshipSchemaId: podcastEpisodeRelationship.id,
			});
			await insertGlobalRelationship({
				sourceEntityId: podcast.id,
				targetEntityId: firstEpisode.id,
				relationshipSchemaId: podcastEpisodeRelationship.id,
			});

			await createQueryEngineEvent(client, {
				entityId: firstEpisode.id,
				occurredAt: "2026-06-25T00:00:00.000Z",
				eventSchemaId: episodeProgressSchema.id,
				properties: { progressPercent: 100, consumedOn: "Audiobookshelf" },
			});
			await waitForEventCount(client, firstEpisode.id, 2);
			await createQueryEngineEvent(client, {
				entityId: secondEpisode.id,
				eventSchemaId: episodeCompleteSchema.id,
				properties: { completionMode: "unknown" },
			});

			const podcastIdWhere = {
				operator: "eq" as const,
				type: "comparison" as const,
				left: systemRef("podcast", "id"),
				right: { type: "literal" as const, value: podcast.id },
			};
			const detailDoc = buildRowsDoc({
				limit: 1,
				alias: "podcast",
				schemas: ["podcast"],
				fields: [{ key: "name", expr: systemRef("podcast", "name") }],
				source: { alias: "podcast", type: "entities", schemas: ["podcast"], where: podcastIdWhere },
				output: {
					type: "rows",
					pagination: { page: 1, limit: 1 },
					fields: [{ key: "name", expr: systemRef("podcast", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("podcast", "name") }],
					include: [
						{
							limit: 10,
							key: "episodes",
							orderBy: [
								{ order: "asc", expr: propertyRef("episode", "podcast-episode", "episodeNumber") },
							],
							fields: [
								{ key: "name", expr: systemRef("episode", "name") },
								{
									key: "episodeNumber",
									expr: propertyRef("episode", "podcast-episode", "episodeNumber"),
								},
								{
									key: "hasProgress",
									expr: {
										type: "exists",
										source: showEpisodeEventExistsSource("episode", "progress"),
									},
								},
								{
									key: "isComplete",
									expr: {
										type: "exists",
										source: showEpisodeEventExistsSource("episode", "complete"),
									},
								},
							],
							source: {
								where: null,
								alias: "episode",
								type: "entities",
								schemas: ["podcast-episode"],
								via: {
									entityRef: "podcast",
									direction: "outgoing",
									alias: "podcastEpisode",
									schema: "podcast-to-podcast-episode",
								},
							},
						},
					],
				},
			});

			const detailResult = await executeQueryEngine(client, detailDoc);
			const podcastRow = detailResult.data.items[0];
			assertPresent(podcastRow, "Expected podcast row");
			const episodes = requireQueryEngineIncludeValue(podcastRow, "episodes");
			expect(
				episodes.items.map(
					(episode) => requireQueryEngineFieldValue(episode, "episodeNumber").value,
				),
			).toEqual([1, 2]);
			const firstEpisodeRow = episodes.items[0];
			assertPresent(firstEpisodeRow, "Expected first podcast episode row");
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "name").value).toBe("Episode One");
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "hasProgress")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireQueryEngineFieldValue(firstEpisodeRow, "isComplete")).toEqual({
				value: true,
				kind: "boolean",
			});
		});

		it("filters included child rows by a child property while keeping parents with zero matches", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "WhereIncludeCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				await createQueryEngineTrackerAndSchema(client, {
					schemaName: "WhereIncludeModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `where-course-module-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				name: "Where Course Module",
				slug: relationshipSlug,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: courseSchemaId,
				targetEntitySchemaId: moduleSchemaId,
			});

			const courseWithMatch = await createQueryEngineEntity(client, {
				name: "Course With Match",
				entitySchemaId: courseSchemaId,
			});
			const courseWithoutMatch = await createQueryEngineEntity(client, {
				name: "Course Without Match",
				entitySchemaId: courseSchemaId,
			});
			const moduleLow = await createQueryEngineEntity(client, {
				name: "Module Low",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleHigh = await createQueryEngineEntity(client, {
				name: "Module High",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 5 },
			});
			const onlyLowModule = await createQueryEngineEntity(client, {
				name: "Only Low Module",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});

			await createRelationship(client, {
				sourceEntityId: courseWithMatch.id,
				targetEntityId: moduleLow.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
				sourceEntityId: courseWithMatch.id,
				targetEntityId: moduleHigh.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
				sourceEntityId: courseWithoutMatch.id,
				targetEntityId: onlyLowModule.id,
				relationshipSchemaId: relationshipSchema.id,
			});

			const doc = buildRowsDoc({
				limit: 10,
				alias: "course",
				schemas: [courseSlug],
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
								{ key: "name", expr: systemRef("module", "name") },
								{ key: "moduleNumber", expr: propertyRef("module", moduleSlug, "moduleNumber") },
							],
							source: {
								alias: "module",
								type: "entities",
								schemas: [moduleSlug],
								where: {
									type: "comparison",
									operator: "gt",
									right: { type: "literal", value: 1 },
									left: propertyRef("module", moduleSlug, "moduleNumber"),
								},
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

			const result = await executeQueryEngine(client, doc);

			const matchItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Course With Match",
			);
			const noMatchItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Course Without Match",
			);
			assertPresent(matchItem, "Expected Course With Match row");
			assertPresent(noMatchItem, "Expected Course Without Match row");

			const matchedModules = requireQueryEngineIncludeValue(matchItem, "modules");
			expect(matchedModules.items).toHaveLength(1);
			const matchedModule = matchedModules.items[0];
			assertPresent(matchedModule, "Expected matched module row");
			expect(requireQueryEngineFieldValue(matchedModule, "name").value).toBe("Module High");
			expect(requireQueryEngineFieldValue(matchedModule, "moduleNumber").value).toBe(5);

			const emptyModules = requireQueryEngineIncludeValue(noMatchItem, "modules");
			expect(emptyModules.items).toHaveLength(0);
			expect(emptyModules.pageInfo).toEqual({ limit: 10, hasMore: false });
		});

		it("includes event sources under an entity as a nested list of event rows", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "EventIncludeLesson" });
			const completeSlug = `event-include-complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "Event Include Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
				},
			});

			const lesson = await createQueryEngineEntity(client, {
				name: "Lesson With Completions",
				entitySchemaId: lessonSchemaId,
			});
			await createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 1 },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
			});
			await createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 2 },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
			});

			const doc = buildRowsDoc({
				limit: 10,
				alias: "lesson",
				schemas: [lessonSlug],
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					fields: [{ key: "name", expr: systemRef("lesson", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("lesson", "name") }],
					include: [
						{
							limit: 10,
							key: "completions",
							orderBy: [{ order: "desc", expr: systemRef("completion", "occurredAt") }],
							fields: [
								{ key: "occurredAt", expr: systemRef("completion", "occurredAt") },
								{ key: "score", expr: propertyRef("completion", completeSlug, "score") },
								{ key: "lessonName", expr: systemRef("lesson", "name") },
							],
							source: {
								where: null,
								type: "events",
								entityRef: "lesson",
								alias: "completion",
								schemas: [completeSlug],
							},
						},
					],
				},
			});

			const result = await executeQueryEngine(client, doc);

			const lessonItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson With Completions",
			);
			assertPresent(lessonItem, "Expected lesson row");
			const completions = requireQueryEngineIncludeValue(lessonItem, "completions");
			expect(completions.items).toHaveLength(2);
			expect(completions.pageInfo).toEqual({ limit: 10, hasMore: false });
			const firstCompletion = completions.items[0];
			const secondCompletion = completions.items[1];
			assertPresent(firstCompletion, "Expected first completion row");
			assertPresent(secondCompletion, "Expected second completion row");
			expect(requireQueryEngineFieldValue(firstCompletion, "score").value).toBe(2);
			expect(requireQueryEngineFieldValue(secondCompletion, "score").value).toBe(1);
			expect(requireQueryEngineFieldValue(firstCompletion, "lessonName").value).toBe(
				"Lesson With Completions",
			);
		});

		it("reports hasMore on an event include with a low limit", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "EventIncludeHasMore" });
			const completeSlug = `event-include-hasmore-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "Event Include HasMore",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { score: { type: "integer", label: "Score", description: "Completion score" } },
				},
			});

			const lesson = await createQueryEngineEntity(client, {
				name: "Lesson HasMore",
				entitySchemaId: lessonSchemaId,
			});
			await createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 1 },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
			});
			await createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { score: 2 },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-02-01T00:00:00.000Z",
			});

			const doc = buildRowsDoc({
				limit: 10,
				alias: "lesson",
				schemas: [lessonSlug],
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					fields: [{ key: "name", expr: systemRef("lesson", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("lesson", "name") }],
					include: [
						{
							limit: 1,
							key: "completions",
							orderBy: [{ order: "desc", expr: systemRef("completion", "occurredAt") }],
							fields: [{ key: "score", expr: propertyRef("completion", completeSlug, "score") }],
							source: {
								where: null,
								type: "events",
								entityRef: "lesson",
								alias: "completion",
								schemas: [completeSlug],
							},
						},
					],
				},
			});

			const result = await executeQueryEngine(client, doc);

			const lessonItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson HasMore",
			);
			assertPresent(lessonItem, "Expected lesson row");
			const completions = requireQueryEngineIncludeValue(lessonItem, "completions");
			expect(completions.items).toHaveLength(1);
			expect(completions.pageInfo).toEqual({ limit: 1, hasMore: true });
			const onlyCompletion = completions.items[0];
			assertPresent(onlyCompletion, "Expected the single completion row");
			expect(requireQueryEngineFieldValue(onlyCompletion, "score").value).toBe(2);
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

			const result = await executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const course = result.data.items[0];
			assertPresent(course, "Expected filtered course row");
			expect(requireQueryEngineFieldValue(course, "name").value).toBe("Advanced Course");
			expect(requireQueryEngineFieldValue(course, "completedLessonCount").value).toBe(2);
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

			const result = await executeQueryEngine(client, doc);

			const names = result.data.items.map(
				(item) => requireQueryEngineFieldValue(item, "name").value,
			);
			expect(names).toEqual(["Advanced Course", "Long Incomplete Course"]);
		});
	});

	describe("Arithmetic output fields", () => {
		it("computes arithmetic output fields and returns null for division by zero", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "ArithmeticCourse",
				propertiesSchema: {
					fields: {
						totalLessons: { type: "integer", label: "Total Lessons", description: "Total lessons" },
						completedLessons: {
							type: "integer",
							label: "Completed Lessons",
							description: "Completed lessons",
						},
					},
				},
			});

			await createQueryEngineEntity(client, {
				name: "Half Done",
				entitySchemaId: schemaId,
				properties: { totalLessons: 10, completedLessons: 5 },
			});
			await createQueryEngineEntity(client, {
				name: "Empty Course",
				entitySchemaId: schemaId,
				properties: { totalLessons: 0, completedLessons: 0 },
			});

			const doc = buildRowsDoc({
				alias: "course",
				schemas: [slug],
				fields: [
					{ key: "name", expr: systemRef("course", "name") },
					{
						key: "completionRatio",
						expr: {
							operator: "divide",
							type: "arithmetic",
							left: propertyRef("course", slug, "completedLessons"),
							right: propertyRef("course", slug, "totalLessons"),
						},
					},
					{
						key: "remainingLessons",
						expr: {
							operator: "subtract",
							type: "arithmetic",
							left: propertyRef("course", slug, "totalLessons"),
							right: propertyRef("course", slug, "completedLessons"),
						},
					},
				],
			});

			const result = await executeQueryEngine(client, doc);

			const halfDone = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Half Done",
			);
			const emptyCourse = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Empty Course",
			);
			assertPresent(halfDone, "Expected Half Done course row");
			assertPresent(emptyCourse, "Expected Empty Course row");

			expect(requireQueryEngineFieldValue(halfDone, "completionRatio")).toEqual({
				kind: "number",
				value: 0.5,
			});
			expect(requireQueryEngineFieldValue(halfDone, "remainingLessons").value).toBe(5);
			expect(requireQueryEngineFieldValue(emptyCourse, "completionRatio")).toEqual({
				kind: "null",
				value: null,
			});
		});
	});

	describe("Aggregate returns", () => {
		it("returns ungrouped aggregate measures without pageInfo", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "AggregateLesson",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
						durationMinutes: { type: "integer", label: "Duration", description: "Duration" },
					},
				},
			});

			await Promise.all([
				createQueryEngineEntity(client, {
					name: "Lesson 1",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced", durationMinutes: 30 },
				}),
				createQueryEngineEntity(client, {
					name: "Lesson 2",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced", durationMinutes: 60 },
				}),
				createQueryEngineEntity(client, {
					name: "Lesson 3",
					entitySchemaId: schemaId,
					properties: { difficulty: "beginner", durationMinutes: 90 },
				}),
			]);

			const doc: QueryEnginePayload = {
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

			const result = await executeAggregateQueryEngine(client, doc);

			expect(result.data.pageInfo).toBeUndefined();
			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected aggregate item");
			expect(requireQueryEngineFieldValue(item, "count").value).toBe(3);
			expect(requireQueryEngineFieldValue(item, "difficultyCount").value).toBe(2);
			expect(requireQueryEngineFieldValue(item, "totalDuration").value).toBe(180);
			expect(requireQueryEngineFieldValue(item, "averageDuration").value).toBe(60);
			expect(requireQueryEngineFieldValue(item, "minimumDuration").value).toBe(30);
			expect(requireQueryEngineFieldValue(item, "maximumDuration").value).toBe(90);
		});

		it("returns grouped aggregates ordered by measureRef with limited pageInfo", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "GroupedAggregateLesson",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
					},
				},
			});

			await Promise.all([
				createQueryEngineEntity(client, {
					name: "Advanced 1",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced" },
				}),
				createQueryEngineEntity(client, {
					name: "Advanced 2",
					entitySchemaId: schemaId,
					properties: { difficulty: "advanced" },
				}),
				createQueryEngineEntity(client, {
					name: "Beginner 1",
					entitySchemaId: schemaId,
					properties: { difficulty: "beginner" },
				}),
			]);

			const doc: QueryEnginePayload = {
				source: { type: "entities", alias: "lesson", schemas: [slug], where: null },
				output: {
					limit: 1,
					type: "aggregate",
					measures: [{ key: "count", aggregation: { function: "count" } }],
					orderBy: [{ order: "desc", expr: { type: "measureRef", key: "count" } }],
					groupBy: [{ key: "difficulty", expr: propertyRef("lesson", slug, "difficulty") }],
				},
			};

			const result = await executeAggregateQueryEngine(client, doc);

			expect(result.data.pageInfo).toEqual({ limit: 1, hasMore: true });
			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected grouped aggregate item");
			expect(requireQueryEngineFieldValue(item, "difficulty").value).toBe("advanced");
			expect(requireQueryEngineFieldValue(item, "count").value).toBe(2);
		});

		it("rejects duplicate aggregate output keys", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "DuplicateAggregateKeys",
			});
			const doc: QueryEnginePayload = {
				source: { type: "entities", alias: "entity", schemas: [slug], where: null },
				output: {
					limit: 10,
					type: "aggregate",
					measures: [{ key: "count", aggregation: { function: "count" } }],
					orderBy: [{ order: "desc", expr: { type: "measureRef", key: "count" } }],
					groupBy: [{ key: "count", expr: systemRef("entity", "name") }],
				},
			};

			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});
	});

	describe("Event roots and first expressions", () => {
		it("returns root event rows with event and attached entity fields", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "EventRootLesson" });
			const completeSlug = `event-root-complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "Event Root Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { notes: { type: "string", label: "Notes", description: "Completion notes" } },
				},
			});
			const firstLesson = await createQueryEngineEntity(client, {
				entitySchemaId: lessonSchemaId,
				name: "First Lesson With Events",
			});
			const latestLesson = await createQueryEngineEntity(client, {
				entitySchemaId: lessonSchemaId,
				name: "Latest Lesson With Events",
			});

			await createQueryEngineEvent(client, {
				entityId: firstLesson.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { notes: "first completion" },
			});
			await createQueryEngineEvent(client, {
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

			const result = await executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(2);
			const latest = result.data.items[0];
			assertPresent(latest, "Expected latest event row");
			expect(requireQueryEngineFieldValue(latest, "occurredAt").kind).toBe("date");
			expect(
				new Date(String(requireQueryEngineFieldValue(latest, "occurredAt").value)).toISOString(),
			).toBe("2026-02-01T00:00:00.000Z");
			expect(requireQueryEngineFieldValue(latest, "notes").value).toBe("latest completion");
			expect(requireQueryEngineFieldValue(latest, "lessonName").value).toBe(
				"Latest Lesson With Events",
			);
			expect(requireQueryEngineFieldValue(latest, "eventSchemaSlug").value).toBe(completeSlug);
		});

		it("returns latest event scalar values with first and null when no event matches", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "FirstExprLesson" });
			const completeSlug = `first-complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "First Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { notes: { type: "string", label: "Notes", description: "Completion notes" } },
				},
			});
			const lessonWithEvents = await createQueryEngineEntity(client, {
				name: "Lesson A",
				entitySchemaId: lessonSchemaId,
			});
			await createQueryEngineEntity(client, { name: "Lesson B", entitySchemaId: lessonSchemaId });

			await createQueryEngineEvent(client, {
				entityId: lessonWithEvents.id,
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-03-01T00:00:00.000Z",
			});
			await createQueryEngineEvent(client, {
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

			const result = await executeQueryEngine(client, doc);

			const lessonA = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson A",
			);
			const lessonB = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "Lesson B",
			);
			assertPresent(lessonA, "Expected Lesson A row");
			assertPresent(lessonB, "Expected Lesson B row");
			expect(
				new Date(
					String(requireQueryEngineFieldValue(lessonA, "latestCompletionAt").value),
				).toISOString(),
			).toBe("2026-04-01T00:00:00.000Z");
			expect(requireQueryEngineFieldValue(lessonB, "latestCompletionAt")).toEqual({
				value: null,
				kind: "null",
			});
		});

		it("selects the first related child entity by an ordered edge property", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "FirstEntityCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				await createQueryEngineTrackerAndSchema(client, {
					schemaName: "FirstEntityModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `first-entity-course-module-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
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

			const courseWithModules = await createQueryEngineEntity(client, {
				name: "Course With Modules",
				entitySchemaId: courseSchemaId,
			});
			await createQueryEngineEntity(client, {
				name: "Course Without Modules",
				entitySchemaId: courseSchemaId,
			});
			const moduleOne = await createQueryEngineEntity(client, {
				name: "Module One",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleTwo = await createQueryEngineEntity(client, {
				name: "Module Two",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 2 },
			});

			await createRelationship(client, {
				sourceEntityId: courseWithModules.id,
				properties: { position: 2 },
				targetEntityId: moduleTwo.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
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

			const result = await executeQueryEngine(client, doc);

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
		});

		it("uses a first-derived scalar inside coalesce fields and where filters", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "FirstWhereCourse" });
			const { schemaId: moduleSchemaId, slug: moduleSlug } =
				await createQueryEngineTrackerAndSchema(client, {
					schemaName: "FirstWhereModule",
					propertiesSchema: {
						fields: {
							moduleNumber: { type: "integer", label: "Module Number", description: "Sort order" },
						},
					},
				});
			const relationshipSlug = `first-where-course-module-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
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

			const startsAtOne = await createQueryEngineEntity(client, {
				name: "Starts At One",
				entitySchemaId: courseSchemaId,
			});
			const startsAtFive = await createQueryEngineEntity(client, {
				name: "Starts At Five",
				entitySchemaId: courseSchemaId,
			});
			await createQueryEngineEntity(client, {
				name: "No Modules",
				entitySchemaId: courseSchemaId,
			});
			const moduleAtOne = await createQueryEngineEntity(client, {
				name: "Module At One",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 1 },
			});
			const moduleAtFive = await createQueryEngineEntity(client, {
				name: "Module At Five",
				entitySchemaId: moduleSchemaId,
				properties: { moduleNumber: 5 },
			});

			await createRelationship(client, {
				sourceEntityId: startsAtOne.id,
				properties: { position: 1 },
				targetEntityId: moduleAtOne.id,
				relationshipSchemaId: relationshipSchema.id,
			});
			await createRelationship(client, {
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

			const result = await executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const onlyMatch = result.data.items[0];
			assertPresent(onlyMatch, "Expected the course whose first module position is 1");
			expect(requireQueryEngineFieldValue(onlyMatch, "name").value).toBe("Starts At One");
			expect(requireQueryEngineFieldValue(onlyMatch, "firstPositionOrFallback").value).toBe(1);
		});
	});

	describe("Relationship root sources", () => {
		it("returns relationship rows with relationship and endpoint entity fields sorted by relationship createdAt", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "RelRootMember" });
			const { schemaId: collectionSchemaId, slug: collectionSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "RelRootCollection" });
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

			const memberOne = await createQueryEngineEntity(client, {
				name: "Member One",
				entitySchemaId: memberSchemaId,
			});
			const memberTwo = await createQueryEngineEntity(client, {
				name: "Member Two",
				entitySchemaId: memberSchemaId,
			});
			const collection = await createQueryEngineEntity(client, {
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

			const doc: QueryEnginePayload = {
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

			const result = await executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(2);
			expect(result.data.pageInfo.total).toBe(2);

			const [first, second] = result.data.items;
			assertPresent(first, "Expected first relationship row");
			assertPresent(second, "Expected second relationship row");
			const firstCreatedAt = new Date(
				String(requireQueryEngineFieldValue(first, "createdAt").value),
			);
			const secondCreatedAt = new Date(
				String(requireQueryEngineFieldValue(second, "createdAt").value),
			);
			expect(firstCreatedAt.getTime()).toBeGreaterThanOrEqual(secondCreatedAt.getTime());

			const byMember = new Map(
				result.data.items.map((item) => [
					requireQueryEngineFieldValue(item, "sourceEntityId").value,
					item,
				]),
			);
			const memberOneRow = byMember.get(memberOne.id);
			const memberTwoRow = byMember.get(memberTwo.id);
			assertPresent(memberOneRow, "Expected Member One's relationship row");
			assertPresent(memberTwoRow, "Expected Member Two's relationship row");
			expect(requireQueryEngineFieldValue(memberOneRow, "memberName").value).toBe("Member One");
			expect(requireQueryEngineFieldValue(memberOneRow, "collectionName").value).toBe("Collection");
			expect(requireQueryEngineFieldValue(memberOneRow, "role").value).toBe("first");
			expect(requireQueryEngineFieldValue(memberTwoRow, "memberName").value).toBe("Member Two");
			expect(requireQueryEngineFieldValue(memberTwoRow, "role").value).toBe("second");
		});

		it("enforces visibility on relationship rows and both endpoint entities", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			const { schemaId: memberSchemaIdA, slug: memberSlugA } =
				await createQueryEngineTrackerAndSchema(userA.client, { schemaName: "RelRootIsoMember" });
			const { schemaId: collectionSchemaIdA, slug: collectionSlugA } =
				await createQueryEngineTrackerAndSchema(userA.client, {
					schemaName: "RelRootIsoCollection",
				});
			const relationshipSlugA = `rel-root-iso-${crypto.randomUUID()}`;
			const relationshipSchemaA = await createRelationshipSchema(userA.client, {
				name: "Rel Root Iso",
				slug: relationshipSlugA,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: memberSchemaIdA,
				targetEntitySchemaId: collectionSchemaIdA,
			});
			const memberA = await createQueryEngineEntity(userA.client, {
				name: "User A Member",
				entitySchemaId: memberSchemaIdA,
			});
			const collectionA = await createQueryEngineEntity(userA.client, {
				name: "User A Collection",
				entitySchemaId: collectionSchemaIdA,
			});
			await createRelationship(userA.client, {
				sourceEntityId: memberA.id,
				targetEntityId: collectionA.id,
				relationshipSchemaId: relationshipSchemaA.id,
			});

			const docA: QueryEnginePayload = {
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

			const errorForUserB = await executeQueryEngineError(userB.client, docA);
			expect(errorForUserB).toMatchObject({ _tag: "NotFound" });

			const { schemaId: memberSchemaIdB, slug: memberSlugB } =
				await createQueryEngineTrackerAndSchema(userB.client, { schemaName: "RelRootIsoMember" });
			const { schemaId: collectionSchemaIdB, slug: collectionSlugB } =
				await createQueryEngineTrackerAndSchema(userB.client, {
					schemaName: "RelRootIsoCollection",
				});
			const relationshipSlugB = `rel-root-iso-${crypto.randomUUID()}`;
			const relationshipSchemaB = await createRelationshipSchema(userB.client, {
				name: "Rel Root Iso",
				slug: relationshipSlugB,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: memberSchemaIdB,
				targetEntitySchemaId: collectionSchemaIdB,
			});
			const memberB = await createQueryEngineEntity(userB.client, {
				name: "User B Member",
				entitySchemaId: memberSchemaIdB,
			});
			const collectionB = await createQueryEngineEntity(userB.client, {
				name: "User B Collection",
				entitySchemaId: collectionSchemaIdB,
			});
			await createRelationship(userB.client, {
				sourceEntityId: memberB.id,
				targetEntityId: collectionB.id,
				relationshipSchemaId: relationshipSchemaB.id,
			});

			const docB: QueryEnginePayload = {
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

			const resultB = await executeQueryEngine(userB.client, docB);
			expect(resultB.data.items).toHaveLength(1);
			const itemB = resultB.data.items[0];
			assertPresent(itemB, "Expected User B's relationship row");
			expect(requireQueryEngineFieldValue(itemB, "memberName").value).toBe("User B Member");
		});

		it("filters relationship rows by a where on a relationship property", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "RelWhereMember" });
			const { schemaId: collectionSchemaId, slug: collectionSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "RelWhereCollection" });
			const relationshipSlug = `rel-where-membership-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				name: "Rel Where Membership",
				slug: relationshipSlug,
				sourceEntitySchemaId: memberSchemaId,
				targetEntitySchemaId: collectionSchemaId,
				propertiesSchema: {
					fields: { role: { type: "string", label: "Role", description: "Membership role" } },
				},
			});

			const collection = await createQueryEngineEntity(client, {
				name: "Collection",
				entitySchemaId: collectionSchemaId,
			});
			await Promise.all(
				(
					[
						["Owner One", "owner"],
						["Owner Two", "owner"],
						["Guest One", "guest"],
					] as const
				).map(async ([name, role]) => {
					const member = await createQueryEngineEntity(client, {
						name,
						entitySchemaId: memberSchemaId,
					});
					await createRelationship(client, {
						properties: { role },
						sourceEntityId: member.id,
						targetEntityId: collection.id,
						relationshipSchemaId: relationshipSchema.id,
					});
				}),
			);

			const doc: QueryEnginePayload = {
				source: {
					alias: "membership",
					type: "relationships",
					schemas: [relationshipSlug],
					sourceEntity: { alias: "memberEntity", schemas: [memberSlug] },
					targetEntity: { alias: "collectionEntity", schemas: [collectionSlug] },
					where: {
						type: "comparison",
						operator: "eq",
						right: { type: "literal", value: "owner" },
						left: propertyRef("membership", relationshipSlug, "role"),
					},
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 10 },
					orderBy: [{ order: "asc", expr: systemRef("memberEntity", "name") }],
					fields: [
						{ key: "memberName", expr: systemRef("memberEntity", "name") },
						{ key: "role", expr: propertyRef("membership", relationshipSlug, "role") },
					],
				},
			};

			const result = await executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(2);
			expect(result.data.items).toHaveLength(2);
			for (const item of result.data.items) {
				expect(requireQueryEngineFieldValue(item, "role").value).toBe("owner");
			}
			const names = result.data.items.map(
				(item) => requireQueryEngineFieldValue(item, "memberName").value,
			);
			expect(names).toEqual(["Owner One", "Owner Two"]);
		});

		it("orders relationship rows by a source endpoint entity name", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "RelOrderMember" });
			const { schemaId: collectionSchemaId, slug: collectionSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "RelOrderCollection" });
			const relationshipSlug = `rel-order-membership-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				name: "Rel Order Membership",
				slug: relationshipSlug,
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: memberSchemaId,
				targetEntitySchemaId: collectionSchemaId,
			});

			const collection = await createQueryEngineEntity(client, {
				name: "Collection",
				entitySchemaId: collectionSchemaId,
			});
			await Promise.all(
				["Charlie", "Alice", "Bravo"].map(async (name) => {
					const member = await createQueryEngineEntity(client, {
						name,
						entitySchemaId: memberSchemaId,
					});
					await createRelationship(client, {
						sourceEntityId: member.id,
						targetEntityId: collection.id,
						relationshipSchemaId: relationshipSchema.id,
					});
				}),
			);

			const orderedDoc = (order: "asc" | "desc"): QueryEnginePayload => ({
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
					orderBy: [{ order, expr: systemRef("memberEntity", "name") }],
					fields: [{ key: "memberName", expr: systemRef("memberEntity", "name") }],
				},
			});

			const ascending = await executeQueryEngine(client, orderedDoc("asc"));
			expect(
				ascending.data.items.map((item) => requireQueryEngineFieldValue(item, "memberName").value),
			).toEqual(["Alice", "Bravo", "Charlie"]);

			const descending = await executeQueryEngine(client, orderedDoc("desc"));
			expect(
				descending.data.items.map((item) => requireQueryEngineFieldValue(item, "memberName").value),
			).toEqual(["Charlie", "Bravo", "Alice"]);
		});
	});

	describe("Time series returns", () => {
		it("returns event buckets with half-open range filtering and zero fill", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: lessonSchemaId, slug: lessonSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "TimeSeriesEventLesson" });
			const completeSlug = `time-series-complete-${crypto.randomUUID()}`;
			const completeSchema = await createEventSchema(client, {
				slug: completeSlug,
				name: "Time Series Complete",
				entitySchemaId: lessonSchemaId,
				propertiesSchema: {
					fields: { note: { type: "string", label: "Note", description: "Completion note" } },
				},
			});
			const lesson = await createQueryEngineEntity(client, {
				name: "Time Series Lesson",
				entitySchemaId: lessonSchemaId,
			});

			await createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { note: "included" },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-01T12:00:00.000Z",
			});
			await createQueryEngineEvent(client, {
				entityId: lesson.id,
				properties: { note: "excluded" },
				eventSchemaId: completeSchema.id,
				occurredAt: "2026-01-03T00:00:00.000Z",
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
					type: "timeSeries",
					measure: { aggregation: { function: "count" } },
					time: {
						bucket: "day",
						expr: systemRef("completion", "occurredAt"),
						range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
					},
				},
			};

			const result = await executeTimeSeriesQueryEngine(client, doc);

			expect(result.data.buckets).toEqual([
				{ value: 1, endAt: "2026-01-02T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				{ value: 0, endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-02T00:00:00.000Z" },
			]);
		});

		it("returns entity buckets using a date property", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "TimeSeriesEntity",
				propertiesSchema: {
					fields: {
						publishedAt: { type: "datetime", label: "Published At", description: "Published at" },
					},
				},
			});
			await Promise.all([
				createQueryEngineEntity(client, {
					name: "Entity One",
					entitySchemaId: schemaId,
					properties: { publishedAt: "2026-01-01T12:00:00.000Z" },
				}),
				createQueryEngineEntity(client, {
					name: "Entity Two",
					entitySchemaId: schemaId,
					properties: { publishedAt: "2026-01-01T13:00:00.000Z" },
				}),
			]);

			const doc: QueryEnginePayload = {
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

			const result = await executeTimeSeriesQueryEngine(client, doc);

			expect(result.data.buckets).toHaveLength(2);
			expect(result.data.buckets[0]?.value).toBe(2);
			expect(result.data.buckets[1]?.value).toBe(0);
		});

		it("returns relationship buckets using relationship createdAt", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: memberSchemaId, slug: memberSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "TimeSeriesRelMember" });
			const { schemaId: collectionSchemaId, slug: collectionSlug } =
				await createQueryEngineTrackerAndSchema(client, { schemaName: "TimeSeriesRelCollection" });
			const relationshipSlug = `time-series-membership-${crypto.randomUUID()}`;
			const relationshipSchema = await createRelationshipSchema(client, {
				slug: relationshipSlug,
				name: "Time Series Membership",
				propertiesSchema: { fields: {} },
				sourceEntitySchemaId: memberSchemaId,
				targetEntitySchemaId: collectionSchemaId,
			});
			const member = await createQueryEngineEntity(client, {
				name: "Time Series Member",
				entitySchemaId: memberSchemaId,
			});
			const collection = await createQueryEngineEntity(client, {
				name: "Time Series Collection",
				entitySchemaId: collectionSchemaId,
			});
			await createRelationship(client, {
				sourceEntityId: member.id,
				targetEntityId: collection.id,
				relationshipSchemaId: relationshipSchema.id,
			});

			const doc: QueryEnginePayload = {
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

			const result = await executeTimeSeriesQueryEngine(client, doc);

			expect(result.data.buckets.some((bucket) => bucket.value === 1)).toBe(true);
		});

		it("rejects date ranges that produce more than 1000 buckets", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "TimeSeriesBucketCap",
			});
			const doc: QueryEnginePayload = {
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

			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});
	});

	describe("Visibility boundary", () => {
		it("does not allow a user to query another user's private entity schema", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			const { slug } = await createQueryEngineTrackerAndSchema(userA.client, {
				schemaName: "UserAPrivateCourse",
			});

			const doc = buildRowsDoc({ fields: [], alias: "course", schemas: [slug] });

			const error = await executeQueryEngineError(userB.client, doc);
			expect(error).toMatchObject({ _tag: "NotFound" });
		});

		it("only returns entities owned by the authenticated user", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			// Both users need access to the same schema slug. Use a unique slug per user
			// to avoid cross-schema contamination; in practice each user has their own schema.
			const { schemaId: schemaA, slug: slugA } = await createQueryEngineTrackerAndSchema(
				userA.client,
				{
					schemaName: "VisibilityCourse",
				},
			);
			const { schemaId: schemaB, slug: slugB } = await createQueryEngineTrackerAndSchema(
				userB.client,
				{
					schemaName: "VisibilityCourse",
				},
			);

			await createQueryEngineEntity(userA.client, {
				name: "User A Entity",
				entitySchemaId: schemaA,
			});
			await createQueryEngineEntity(userB.client, {
				name: "User B Entity",
				entitySchemaId: schemaB,
			});

			const resultA = await executeQueryEngine(
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
			expect(requireQueryEngineFieldValue(itemA, "name").value).toBe("User A Entity");

			const resultB = await executeQueryEngine(
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
			expect(requireQueryEngineFieldValue(itemB, "name").value).toBe("User B Entity");
		});
	});

	describe("In-library filter", () => {
		it("isolates global media entities by library membership per user", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();
			const { entity, schema } = await createGlobalBookEntityFixture(userA.client, {
				name: `Isolated Library Entity ${crypto.randomUUID()}`,
				externalId: `isolated-library-entity-${crypto.randomUUID()}`,
			});

			await insertLibraryMembership(userA.client, {
				userId: userA.userId,
				mediaEntityId: entity.id,
			});

			const doc: QueryEnginePayload = {
				source: {
					alias: "entity",
					schemas: [schema.slug],
					type: "entities",
					where: {
						type: "exists",
						source: {
							where: null,
							type: "entities",
							alias: "library",
							schemas: ["library"],
							via: {
								alias: "inLibrary",
								entityRef: "entity",
								schema: "in-library",
								direction: "outgoing",
							},
						},
					},
				},
				output: {
					type: "rows",
					pagination: { page: 1, limit: 20 },
					fields: [{ key: "name", expr: systemRef("entity", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("entity", "name") }],
				},
			};

			const userAResult = await executeQueryEngine(userA.client, doc);
			const userBResult = await executeQueryEngine(userB.client, doc);

			const userANames = userAResult.data.items.map(
				(item) => requireQueryEngineFieldValue(item, "name").value,
			);
			expect(userANames).toContain(entity.name);
			expect(userBResult.data.items).toHaveLength(0);
		});
	});

	describe("Validation errors", () => {
		it("rejects a pagination limit exceeding 100", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "LimitTestSchema",
			});

			const doc = buildRowsDoc({ alias: "e", schemas: [slug], limit: 101 });
			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects an invalid system field for an entity source", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "SystemFieldTestSchema",
			});

			const doc = buildRowsDoc({
				alias: "e",
				schemas: [slug],
				// occurredAt is an event-only system field
				orderByExpr: systemRef("e", "occurredAt"),
			});
			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects a property field that references a schema not in the source schemas", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
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
			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects duplicate source schema slugs", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "DuplicateSchemaGuardrail",
			});

			const doc = buildRowsDoc({ alias: "e", schemas: [slug, slug] });
			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects old predicate operand keys", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "OldPredicateGuardrail",
			});
			const invalidExpr = {
				type: "and" as const,
				predicates: [{ type: "literal", value: true }],
				values: [{ type: "literal" as const, value: true }] as const,
			};

			const doc = buildRowsDoc({ alias: "e", schemas: [slug], orderByExpr: invalidExpr });
			await expectMalformedQueryBadRequest(doc, cookies);
		});

		it("rejects unsupported legacy filter keys", async () => {
			const { client, cookies } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
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
			} as QueryEnginePayload;
			await expectMalformedQueryBadRequest(doc, cookies);
		});

		it("rejects ordering a string property against a number literal", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "TypeCheckOrderingGuardrail",
				propertiesSchema: {
					fields: { title: { type: "string", label: "Title", description: "Title" } },
				},
			});

			const doc = buildRowsDoc({
				alias: "e",
				schemas: [slug],
				source: {
					alias: "e",
					schemas: [slug],
					type: "entities",
					where: {
						operator: "gt",
						type: "comparison",
						left: propertyRef("e", slug, "title"),
						right: { type: "literal", value: 5 },
					},
				},
			});
			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects arithmetic with a non-numeric operand", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createQueryEngineTrackerAndSchema(client, {
				schemaName: "TypeCheckArithmeticGuardrail",
				propertiesSchema: {
					fields: { title: { type: "string", label: "Title", description: "Title" } },
				},
			});

			const doc = buildRowsDoc({
				alias: "e",
				schemas: [slug],
				fields: [
					{
						key: "computed",
						expr: {
							type: "arithmetic",
							operator: "add",
							left: propertyRef("e", slug, "title"),
							right: { type: "literal", value: 1 },
						},
					},
				],
			});
			const error = await executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});
	});
});
