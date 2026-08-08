import type { RowItem } from "@ryot/contract/modules/ryotql/language";
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
	createEntityFixture,
	createPluginEntitySchema,
	executeRyotQL,
	requireRows,
	requireRyotQLValue,
} from "~/fixtures/kernel";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const findByName = (items: readonly RowItem[], name: string) => {
	const item = items.find((value) => requireRyotQLValue(value, "name") === name);
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
			expect(requireRyotQLValue(advanced, "totalLessons")).toBe(2);
			expect(requireRyotQLValue(advanced, "completedLessons")).toBe(2);
			expect(requireRyotQLValue(advanced, "completionRatio")).toBe(1);
			expect(requireRyotQLValue(advanced, "latestCompletionAt")).toEqual(expect.any(String));
			expect(requireRyotQLValue(advanced, "firstModuleName")).toBe("Advanced Course Module 1");
			expect(requireRyotQLValue(advanced, "lessonCount")).toBe(2);
			expect(requireRyotQLValue(advanced, "distinctLessonCount")).toBe(2);
			expect(requireRyotQLValue(advanced, "totalDuration")).toBe(100);
			expect(requireRyotQLValue(advanced, "averageDuration")).toBe(50);
			expect(requireRyotQLValue(advanced, "minimumDuration")).toBe(35);
			expect(requireRyotQLValue(advanced, "maximumDuration")).toBe(65);

			const incomplete = findByName(allCourses.items, "Long Incomplete Course");
			expect(requireRyotQLValue(incomplete, "completedLessons")).toBe(0);
			expect(requireRyotQLValue(incomplete, "completionRatio")).toBe(0);
			expect(requireRyotQLValue(incomplete, "latestCompletionAt")).toBeNull();
			expect(requireRyotQLValue(incomplete, "latestCompletionIdOrFallback")).toBe("none");
			expect(
				requireRows(result.data["completedCourses"], "completedCourses").items.map((item) =>
					requireRyotQLValue(item, "name"),
				),
			).toEqual(["Advanced Course"]);
			expect(
				requireRows(result.data["longCourses"], "longCourses").items.map((item) =>
					requireRyotQLValue(item, "name"),
				),
			).toEqual(["Advanced Course", "Long Incomplete Course"]);
		}),
	);

	it.live("returns null for invalid arithmetic and division by zero", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createPluginEntitySchema(client, {
				schemaName: "RyotQLArithmeticCourse",
				propertiesSchema: {
					fields: {
						total: { type: "integer", label: "Total", description: "Total" },
						completed: { type: "integer", label: "Completed", description: "Completed" },
					},
				},
			});
			yield* createEntityFixture(client, {
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
			expect(requireRyotQLValue(item, "ratio")).toBeNull();
			expect(requireRyotQLValue(item, "invalid")).toBeNull();
			expect(requireRyotQLValue(item, "sum")).toBe(5);
			expect(requireRyotQLValue(item, "product")).toBe(6);
			expect(requireRyotQLValue(item, "difference")).toBe(2);
			expect(requireRyotQLValue(item, "coalescedRatio")).toBe(3);
			expect(requireRyotQLValue(item, "invalidCoalescedRatio")).toBeNull();
			expect(requireRyotQLValue(item, "firstCoalescedRatio")).toBe(3);
			expect(requireRyotQLValue(item, "invalidFirstCoalescedRatio")).toBeNull();
		}),
	);

	it.live("applies user visibility to every correlated query", () =>
		Effect.gen(function* () {
			const [owner, other] = yield* Effect.all([
				createAuthenticatedClient(),
				createAuthenticatedClient(),
			]);
			const ownerSchema = yield* createPluginEntitySchema(owner.client, {
				schemaName: "RyotQLCorrelatedOwner",
			});
			const otherSchema = yield* createPluginEntitySchema(other.client, {
				schemaName: "RyotQLCorrelatedHidden",
			});
			const ownEntity = yield* createEntityFixture(owner.client, {
				name: "Visible Root",
				entitySchemaSlug: ownerSchema.schemaId,
			});
			const hiddenEntity = yield* createEntityFixture(other.client, {
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
			expect(requireRyotQLValue(item, "exists")).toBe(false);
			expect(requireRyotQLValue(item, "count")).toBe(0);
			expect(requireRyotQLValue(item, "sum")).toBeNull();
			expect(requireRyotQLValue(item, "average")).toBeNull();
			expect(requireRyotQLValue(item, "minimum")).toBeNull();
			expect(requireRyotQLValue(item, "maximum")).toBeNull();
			expect(requireRyotQLValue(item, "first")).toBeNull();
			expect(requireRyotQLValue(item, "joinedExists")).toBe(false);
			expect(requireRyotQLValue(item, "joinedCount")).toBe(0);
			expect(requireRyotQLValue(item, "joinedFirst")).toBeNull();
		}),
	);
});
