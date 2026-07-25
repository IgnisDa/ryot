import type { RowItem, RowsResult } from "@ryot/contract/modules/ryotql/language";
import {
	add,
	and,
	ascending,
	average,
	castNumber,
	coalesce,
	column,
	count,
	countDistinct,
	descending,
	divide,
	document,
	eq,
	exists,
	field,
	first,
	gt,
	gte,
	join,
	jsonPath,
	literal,
	maximum,
	minimum,
	multiply,
	rows,
	subtract,
	sum,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCourseLessonFilterFixture,
	createQueryEngineEntity,
	createQueryEnginePluginSchema,
	executeRyotQL,
	requireRyotQLFieldValue,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireRows = (result: RowsResult | undefined, key: string) => {
	if (!result) {
		throw new Error(`Expected '${key}' rows`);
	}
	return result;
};

const findByName = (items: readonly RowItem[], name: string) => {
	const item = items.find((value) => requireRyotQLFieldValue(value, "name").value === name);
	assertPresent(item, `Expected '${name}' row`);
	return item;
};

describe("RyotQL correlated expressions", () => {
	it.live("queries course descendants, first values, aggregates, fallback, and progress", () =>
		Effect.gen(function* () {
			const {
				client,
				courseSlug,
				moduleSlug,
				lessonSlug,
				completeSlug,
				moduleLessonSlug,
				courseModuleSlug,
			} = yield* createCourseLessonFilterFixture;
			const course = table("entity", "course");

			const durationExpressions = (suffix: string) => {
				const lesson = table("entity", `lesson${suffix}`);
				const moduleLesson = table("relationship", `moduleLesson${suffix}`);
				const courseModule = table("relationship", `courseModule${suffix}`);
				const duration = castNumber(jsonPath(column(lesson, "properties"), "durationMinutes"));
				const query = {
					where: and(
						eq(column(courseModule, "sourceEntityId"), column(course, "id")),
						eq(column(courseModule, "relationshipSchemaSlug"), literal(courseModuleSlug)),
						eq(column(moduleLesson, "relationshipSchemaSlug"), literal(moduleLessonSlug)),
						eq(column(lesson, "entitySchemaSlug"), literal(lessonSlug)),
					),
					joins: [
						join(
							"inner",
							moduleLesson,
							eq(column(courseModule, "targetEntityId"), column(moduleLesson, "sourceEntityId")),
						),
						join("inner", lesson, eq(column(moduleLesson, "targetEntityId"), column(lesson, "id"))),
					],
				} as const;
				return { courseModule, duration, lesson, query };
			};

			const completionExpressions = (suffix: string) => {
				const completion = table("event", `completion${suffix}`);
				const moduleLesson = table("relationship", `completedModuleLesson${suffix}`);
				const courseModule = table("relationship", `completedCourseModule${suffix}`);
				const query = {
					where: and(
						eq(column(courseModule, "sourceEntityId"), column(course, "id")),
						eq(column(courseModule, "relationshipSchemaSlug"), literal(courseModuleSlug)),
						eq(column(moduleLesson, "relationshipSchemaSlug"), literal(moduleLessonSlug)),
						eq(column(completion, "eventSchemaSlug"), literal(completeSlug)),
					),
					joins: [
						join(
							"inner",
							moduleLesson,
							eq(column(courseModule, "targetEntityId"), column(moduleLesson, "sourceEntityId")),
						),
						join(
							"inner",
							completion,
							eq(column(moduleLesson, "targetEntityId"), column(completion, "entityId")),
						),
					],
				} as const;
				return { completion, courseModule, query };
			};

			const courseFields = () => {
				const durations = durationExpressions("Fields");
				const completions = completionExpressions("Fields");
				const firstModule = table("entity", "firstModule");
				const firstCourseModule = table("relationship", "firstCourseModule");
				const totalLessons = count(durations.courseModule, durations.query);
				const completedLessons = countDistinct(
					completions.courseModule,
					column(completions.completion, "entityId"),
					completions.query,
				);
				return [
					field("name", column(course, "name")),
					field("totalLessons", totalLessons),
					field("completedLessons", completedLessons),
					field("completionRatio", divide(completedLessons, totalLessons)),
					field(
						"latestCompletionAt",
						first(completions.courseModule, {
							...completions.query,
							select: column(completions.completion, "occurredAt"),
							orderBy: [descending(column(completions.completion, "occurredAt"))],
						}),
					),
					field(
						"latestCompletionIdOrFallback",
						coalesce(
							first(completions.courseModule, {
								...completions.query,
								select: column(completions.completion, "id"),
								orderBy: [descending(column(completions.completion, "occurredAt"))],
							}),
							literal("none"),
						),
					),
					field(
						"firstModuleName",
						first(firstCourseModule, {
							select: column(firstModule, "name"),
							orderBy: [ascending(column(firstModule, "name"))],
							where: and(
								eq(column(firstCourseModule, "sourceEntityId"), column(course, "id")),
								eq(column(firstCourseModule, "relationshipSchemaSlug"), literal(courseModuleSlug)),
								eq(column(firstModule, "entitySchemaSlug"), literal(moduleSlug)),
							),
							joins: [
								join(
									"inner",
									firstModule,
									eq(column(firstCourseModule, "targetEntityId"), column(firstModule, "id")),
								),
							],
						}),
					),
					field("lessonCount", count(durations.courseModule, durations.query)),
					field(
						"distinctLessonCount",
						countDistinct(durations.courseModule, column(durations.lesson, "id"), durations.query),
					),
					field("totalDuration", sum(durations.courseModule, durations.duration, durations.query)),
					field(
						"averageDuration",
						average(durations.courseModule, durations.duration, durations.query),
					),
					field(
						"minimumDuration",
						minimum(durations.courseModule, durations.duration, durations.query),
					),
					field(
						"maximumDuration",
						maximum(durations.courseModule, durations.duration, durations.query),
					),
				];
			};

			const completed = completionExpressions("Filter");
			const longLesson = durationExpressions("Long");
			const result = yield* executeRyotQL(
				client,
				document({
					allCourses: rows(course, {
						fields: courseFields(),
						orderBy: [ascending(column(course, "name"))],
						where: eq(column(course, "entitySchemaSlug"), literal(courseSlug)),
					}),
					completedCourses: rows(course, {
						fields: [field("name", column(course, "name"))],
						where: and(
							eq(column(course, "entitySchemaSlug"), literal(courseSlug)),
							gte(
								countDistinct(
									completed.courseModule,
									column(completed.completion, "entityId"),
									completed.query,
								),
								literal(2),
							),
						),
					}),
					longCourses: rows(course, {
						fields: [field("name", column(course, "name"))],
						orderBy: [ascending(column(course, "name"))],
						where: and(
							eq(column(course, "entitySchemaSlug"), literal(courseSlug)),
							exists(longLesson.courseModule, {
								...longLesson.query,
								where: and(longLesson.query.where, gt(longLesson.duration, literal(45))),
							}),
						),
					}),
				}),
			);

			const allCourses = requireRows(result.data["allCourses"], "allCourses");
			expect(allCourses.items).toHaveLength(3);
			const advanced = findByName(allCourses.items, "Advanced Course");
			expect(requireRyotQLFieldValue(advanced, "totalLessons").value).toBe(2);
			expect(requireRyotQLFieldValue(advanced, "completedLessons").value).toBe(2);
			expect(requireRyotQLFieldValue(advanced, "completionRatio").value).toBe(1);
			expect(requireRyotQLFieldValue(advanced, "latestCompletionAt").kind).toBe("date");
			expect(requireRyotQLFieldValue(advanced, "firstModuleName").value).toBe(
				"Advanced Course Module 1",
			);
			expect(requireRyotQLFieldValue(advanced, "lessonCount").value).toBe(2);
			expect(requireRyotQLFieldValue(advanced, "distinctLessonCount").value).toBe(2);
			expect(requireRyotQLFieldValue(advanced, "totalDuration").value).toBe(100);
			expect(requireRyotQLFieldValue(advanced, "averageDuration").value).toBe(50);
			expect(requireRyotQLFieldValue(advanced, "minimumDuration").value).toBe(35);
			expect(requireRyotQLFieldValue(advanced, "maximumDuration").value).toBe(65);

			const incomplete = findByName(allCourses.items, "Long Incomplete Course");
			expect(requireRyotQLFieldValue(incomplete, "completedLessons").value).toBe(0);
			expect(requireRyotQLFieldValue(incomplete, "completionRatio").value).toBe(0);
			expect(requireRyotQLFieldValue(incomplete, "latestCompletionAt")).toEqual({
				kind: "null",
				value: null,
			});
			expect(requireRyotQLFieldValue(incomplete, "latestCompletionIdOrFallback")).toEqual({
				kind: "text",
				value: "none",
			});
			expect(
				requireRows(result.data["completedCourses"], "completedCourses").items.map(
					(item) => requireRyotQLFieldValue(item, "name").value,
				),
			).toEqual(["Advanced Course"]);
			expect(
				requireRows(result.data["longCourses"], "longCourses").items.map(
					(item) => requireRyotQLFieldValue(item, "name").value,
				),
			).toEqual(["Advanced Course", "Long Incomplete Course"]);
		}),
	);

	it.live("returns null for invalid arithmetic and division by zero", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "RyotQLArithmeticCourse",
				propertiesSchema: {
					fields: {
						total: { type: "integer", label: "Total", description: "Total" },
						completed: { type: "integer", label: "Completed", description: "Completed" },
					},
				},
			});
			yield* createQueryEngineEntity(client, {
				name: "Empty Course",
				entitySchemaSlug: schemaId,
				properties: { total: 0, completed: 0 },
			});

			const course = table("entity", "course");
			const selectedCourse = table("entity", "selectedCourse");
			const selectedCourseQuery = {
				where: eq(column(selectedCourse, "id"), column(course, "id")),
			} as const;
			const result = yield* executeRyotQL(
				client,
				document({
					courses: rows(course, {
						fields: [
							field(
								"ratio",
								divide(
									castNumber(jsonPath(column(course, "properties"), "completed")),
									castNumber(jsonPath(column(course, "properties"), "total")),
								),
							),
							field("invalid", divide(literal("invalid"), literal(1))),
							field("sum", add(literal(2), literal(3))),
							field("product", multiply(literal(2), literal(3))),
							field("difference", subtract(literal(5), literal(3))),
							field("coalescedRatio", divide(coalesce(literal("6"), literal(0)), literal(2))),
							field(
								"invalidCoalescedRatio",
								divide(coalesce(literal("invalid"), literal(6)), literal(2)),
							),
							field(
								"firstCoalescedRatio",
								divide(
									first(selectedCourse, {
										...selectedCourseQuery,
										select: coalesce(literal("6"), literal(0)),
										orderBy: [ascending(column(selectedCourse, "id"))],
									}),
									literal(2),
								),
							),
							field(
								"invalidFirstCoalescedRatio",
								divide(
									first(selectedCourse, {
										...selectedCourseQuery,
										select: coalesce(literal("invalid"), literal(6)),
										orderBy: [ascending(column(selectedCourse, "id"))],
									}),
									literal(2),
								),
							),
						],
						where: eq(column(course, "entitySchemaSlug"), literal(slug)),
					}),
				}),
			);

			const item = requireRows(result.data["courses"], "courses").items[0];
			assertPresent(item, "Expected arithmetic course");
			expect(requireRyotQLFieldValue(item, "ratio")).toEqual({ kind: "null", value: null });
			expect(requireRyotQLFieldValue(item, "invalid")).toEqual({ kind: "null", value: null });
			expect(requireRyotQLFieldValue(item, "sum").value).toBe(5);
			expect(requireRyotQLFieldValue(item, "product").value).toBe(6);
			expect(requireRyotQLFieldValue(item, "difference").value).toBe(2);
			expect(requireRyotQLFieldValue(item, "coalescedRatio").value).toBe(3);
			expect(requireRyotQLFieldValue(item, "invalidCoalescedRatio")).toEqual({
				kind: "null",
				value: null,
			});
			expect(requireRyotQLFieldValue(item, "firstCoalescedRatio").value).toBe(3);
			expect(requireRyotQLFieldValue(item, "invalidFirstCoalescedRatio")).toEqual({
				kind: "null",
				value: null,
			});
		}),
	);

	it.live("applies user visibility to every correlated query", () =>
		Effect.gen(function* () {
			const [owner, other] = yield* Effect.all([
				createAuthenticatedClient(),
				createAuthenticatedClient(),
			]);
			const ownerSchema = yield* createQueryEnginePluginSchema(owner.client, {
				schemaName: "RyotQLCorrelatedOwner",
			});
			const otherSchema = yield* createQueryEnginePluginSchema(other.client, {
				schemaName: "RyotQLCorrelatedHidden",
			});
			const ownEntity = yield* createQueryEngineEntity(owner.client, {
				name: "Visible Root",
				entitySchemaSlug: ownerSchema.schemaId,
			});
			const hiddenEntity = yield* createQueryEngineEntity(other.client, {
				name: "Hidden Child",
				entitySchemaSlug: otherSchema.schemaId,
			});

			const root = table("entity", "root");
			const hidden = table("entity", "hidden");
			const candidate = table("entity", "candidate");
			const hiddenJoin = table("entity", "hiddenJoin");
			const hiddenQuery = { where: eq(column(hidden, "id"), literal(hiddenEntity.id)) };
			const hiddenJoinQuery = {
				where: eq(column(candidate, "id"), literal(ownEntity.id)),
				joins: [join("inner", hiddenJoin, eq(column(hiddenJoin, "id"), literal(hiddenEntity.id)))],
			} as const;
			const result = yield* executeRyotQL(
				owner.client,
				document({
					entities: rows(root, {
						where: eq(column(root, "id"), literal(ownEntity.id)),
						fields: [
							field("exists", exists(hidden, hiddenQuery)),
							field("count", count(hidden, hiddenQuery)),
							field("sum", sum(hidden, literal(1), hiddenQuery)),
							field("average", average(hidden, literal(1), hiddenQuery)),
							field("minimum", minimum(hidden, literal(1), hiddenQuery)),
							field("maximum", maximum(hidden, literal(1), hiddenQuery)),
							field("joinedExists", exists(candidate, hiddenJoinQuery)),
							field("joinedCount", count(candidate, hiddenJoinQuery)),
							field(
								"first",
								first(hidden, {
									...hiddenQuery,
									select: column(hidden, "name"),
									orderBy: [ascending(column(hidden, "id"))],
								}),
							),
							field(
								"joinedFirst",
								first(candidate, {
									...hiddenJoinQuery,
									select: column(hiddenJoin, "name"),
									orderBy: [ascending(column(candidate, "id"))],
								}),
							),
						],
					}),
				}),
			);

			const item = requireRows(result.data["entities"], "entities").items[0];
			assertPresent(item, "Expected visible root");
			expect(requireRyotQLFieldValue(item, "exists")).toEqual({
				kind: "boolean",
				value: false,
			});
			expect(requireRyotQLFieldValue(item, "count")).toEqual({ kind: "number", value: 0 });
			expect(requireRyotQLFieldValue(item, "sum")).toEqual({ kind: "null", value: null });
			expect(requireRyotQLFieldValue(item, "average")).toEqual({ kind: "null", value: null });
			expect(requireRyotQLFieldValue(item, "minimum")).toEqual({ kind: "null", value: null });
			expect(requireRyotQLFieldValue(item, "maximum")).toEqual({ kind: "null", value: null });
			expect(requireRyotQLFieldValue(item, "first")).toEqual({ kind: "null", value: null });
			expect(requireRyotQLFieldValue(item, "joinedExists")).toEqual({
				kind: "boolean",
				value: false,
			});
			expect(requireRyotQLFieldValue(item, "joinedCount")).toEqual({ kind: "number", value: 0 });
			expect(requireRyotQLFieldValue(item, "joinedFirst")).toEqual({
				kind: "null",
				value: null,
			});
		}),
	);
});
