import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createEventSchema,
	createRelationship,
	createRelationshipSchema,
	createV2Entity,
	createV2Event,
	createV2TrackerAndSchema,
	executeQueryEngineV2,
	executeQueryEngineV2Error,
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
		fields?: V2ExecutePayload["output"]["fields"];
		orderByExpr?: V2ExecutePayload["output"]["orderBy"][number]["expr"];
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
