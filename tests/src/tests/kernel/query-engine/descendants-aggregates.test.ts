import { Effect } from "effect";

import {
	buildRowsDoc,
	createAuthenticatedClient,
	createCourseLessonFilterFixture,
	createQueryEngineEntity,
	createQueryEnginePluginSchema,
	executeAggregateQueryEngine,
	executeQueryEngine,
	executeQueryEngineError,
	propertyRef,
	requireQueryEngineFieldValue,
	systemRef,
	type QueryEnginePayload,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Descendant source filters", () => {
	it.live("filters courses by descendant completed lesson count", () =>
		Effect.gen(function* () {
			const {
				client,
				courseSlug,
				moduleSlug,
				lessonSlug,
				completeSlug,
				moduleLessonSlug,
				courseModuleSlug,
			} = yield* createCourseLessonFilterFixture();
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

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const course = result.data.items[0];
			assertPresent(course, "Expected filtered course row");
			expect(requireQueryEngineFieldValue(course, "name").value).toBe("Advanced Course");
			expect(requireQueryEngineFieldValue(course, "completedLessonCount").value).toBe(2);
		}),
	);

	it.live("filters courses by a descendant lesson duration threshold", () =>
		Effect.gen(function* () {
			const { client, courseSlug, moduleSlug, lessonSlug, moduleLessonSlug, courseModuleSlug } =
				yield* createCourseLessonFilterFixture();
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

			const result = yield* executeQueryEngine(client, doc);

			const names = result.data.items.map(
				(item) => requireQueryEngineFieldValue(item, "name").value,
			);
			expect(names).toEqual(["Advanced Course", "Long Incomplete Course"]);
		}),
	);
});

describe("Arithmetic output fields", () => {
	it.live("computes arithmetic output fields and returns null for division by zero", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
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

			yield* createQueryEngineEntity(client, {
				name: "Half Done",
				entitySchemaSlug: schemaId,
				properties: { totalLessons: 10, completedLessons: 5 },
			});
			yield* createQueryEngineEntity(client, {
				name: "Empty Course",
				entitySchemaSlug: schemaId,
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

			const result = yield* executeQueryEngine(client, doc);

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
		}),
	);
});

describe("Aggregate returns", () => {
	it.live("returns ungrouped aggregate measures without pageInfo", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "AggregateLesson",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
						durationMinutes: { type: "integer", label: "Duration", description: "Duration" },
					},
				},
			});

			yield* Effect.all([
				createQueryEngineEntity(client, {
					name: "Lesson 1",
					entitySchemaSlug: schemaId,
					properties: { difficulty: "advanced", durationMinutes: 30 },
				}),
				createQueryEngineEntity(client, {
					name: "Lesson 2",
					entitySchemaSlug: schemaId,
					properties: { difficulty: "advanced", durationMinutes: 60 },
				}),
				createQueryEngineEntity(client, {
					name: "Lesson 3",
					entitySchemaSlug: schemaId,
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

			const result = yield* executeAggregateQueryEngine(client, doc);

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
		}),
	);

	it.live("returns grouped aggregates ordered by measureRef with limited pageInfo", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "GroupedAggregateLesson",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
					},
				},
			});

			yield* Effect.all([
				createQueryEngineEntity(client, {
					name: "Advanced 1",
					entitySchemaSlug: schemaId,
					properties: { difficulty: "advanced" },
				}),
				createQueryEngineEntity(client, {
					name: "Advanced 2",
					entitySchemaSlug: schemaId,
					properties: { difficulty: "advanced" },
				}),
				createQueryEngineEntity(client, {
					name: "Beginner 1",
					entitySchemaSlug: schemaId,
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

			const result = yield* executeAggregateQueryEngine(client, doc);

			expect(result.data.pageInfo).toEqual({ limit: 1, hasMore: true });
			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected grouped aggregate item");
			expect(requireQueryEngineFieldValue(item, "difficulty").value).toBe("advanced");
			expect(requireQueryEngineFieldValue(item, "count").value).toBe(2);
		}),
	);

	it.live("rejects duplicate aggregate output keys", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { slug } = yield* createQueryEnginePluginSchema(client, {
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

			const error = yield* executeQueryEngineError(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		}),
	);
});
