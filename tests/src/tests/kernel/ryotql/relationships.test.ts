import type {
	FieldValue,
	IncludeResult,
	RowItem,
	RowsResult,
} from "@ryot/contract/modules/ryotql/language";
import {
	and,
	ascending,
	castNumber,
	castText,
	column,
	descending,
	document,
	eq,
	field,
	gt,
	inArray,
	include,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventSchema,
	createQueryEngineEntity,
	createQueryEngineEvent,
	createQueryEnginePluginSchema,
	createRelationship,
	createRelationshipSchema,
	executeRyotQL,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireRows = (result: RowsResult | undefined, key: string) => {
	if (!result) {
		throw new Error(`Expected '${key}' rows`);
	}
	return result;
};

const requireField = (item: RowItem, key: string): FieldValue => {
	const value = item[key];
	if (!value || !("kind" in value)) {
		throw new Error(`Expected '${key}' field`);
	}
	return value;
};

const requireInclude = (item: RowItem, key: string): IncludeResult => {
	const value = item[key];
	if (!value || !("items" in value)) {
		throw new Error(`Expected '${key}' include`);
	}
	return value;
};

describe("RyotQL relationship rows and includes", () => {
	it.live(
		"projects relationship roots through ordinary joins and preserves join multiplicity",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schemaId: courseSchemaId, slug: courseSlug } = yield* createQueryEnginePluginSchema(
					client,
					{ schemaName: "RyotQLRelationshipCourse" },
				);
				const { schemaId: memberSchemaId, slug: memberSlug } = yield* createQueryEnginePluginSchema(
					client,
					{ schemaName: "RyotQLRelationshipMember" },
				);
				const relationshipSlug = `ryotql-membership-${crypto.randomUUID()}`;
				const relationshipSchema = yield* createRelationshipSchema(client, {
					slug: relationshipSlug,
					name: "RyotQL Membership",
					targetEntitySchemaSlug: courseSchemaId,
					sourceEntitySchemaSlug: memberSchemaId,
					propertiesSchema: {
						fields: { role: { type: "string", label: "Role", description: "Member role" } },
					},
				});
				const course = yield* createQueryEngineEntity(client, {
					name: "Relationship Course",
					entitySchemaSlug: courseSchemaId,
				});
				const members = yield* Effect.all(
					(
						[
							["Member A", "owner"],
							["Member B", "guest"],
						] as const
					).map(([name, role]) =>
						Effect.gen(function* () {
							const member = yield* createQueryEngineEntity(client, {
								name,
								entitySchemaSlug: memberSchemaId,
							});
							yield* createRelationship(client, {
								properties: { role },
								sourceEntityId: member.id,
								targetEntityId: course.id,
								relationshipSchemaSlug: relationshipSchema.id,
							});
							return member;
						}),
					),
				);

				const member = table("entity", "member");
				const courseRoot = table("entity", "course");
				const joinedCourse = table("entity", "joinedCourse");
				const membership = table("relationship", "membership");
				const multipliedMembership = table("relationship", "multipliedMembership");
				const multipliedPage = (page: number) =>
					rows(courseRoot, {
						page,
						limit: 1,
						orderBy: [ascending(column(courseRoot, "id"))],
						fields: [
							field("courseId", column(courseRoot, "id")),
							field("role", castText(jsonPath(column(multipliedMembership, "properties"), "role"))),
						],
						where: eq(column(courseRoot, "id"), literal(course.id)),
						joins: [
							join(
								"inner",
								multipliedMembership,
								eq(column(courseRoot, "id"), column(multipliedMembership, "targetEntityId")),
							),
						],
					});
				const result = yield* executeRyotQL(
					client,
					document({
						memberships: rows(membership, {
							orderBy: [ascending(column(member, "name"))],
							fields: [
								field("memberName", column(member, "name")),
								field("courseName", column(joinedCourse, "name")),
								field("role", castText(jsonPath(column(membership, "properties"), "role"))),
							],
							where: and(
								eq(column(membership, "relationshipSchemaSlug"), literal(relationshipSlug)),
								eq(column(member, "entitySchemaSlug"), literal(memberSlug)),
								eq(column(joinedCourse, "entitySchemaSlug"), literal(courseSlug)),
							),
							joins: [
								join(
									"inner",
									member,
									eq(column(membership, "sourceEntityId"), column(member, "id")),
								),
								join(
									"inner",
									joinedCourse,
									eq(column(membership, "targetEntityId"), column(joinedCourse, "id")),
								),
							],
						}),
						multipliedPageOne: multipliedPage(1),
						multipliedPageTwo: multipliedPage(2),
					}),
				);

				const memberships = requireRows(result.data["memberships"], "memberships");
				expect(memberships.items.map((item) => requireField(item, "memberName").value)).toEqual([
					"Member A",
					"Member B",
				]);
				expect(memberships.items.map((item) => requireField(item, "role").value)).toEqual([
					"owner",
					"guest",
				]);
				const firstMembership = memberships.items[0];
				assertPresent(firstMembership, "Expected first membership");
				expect(requireField(firstMembership, "courseName").value).toBe("Relationship Course");
				const multipliedPageOne = requireRows(
					result.data["multipliedPageOne"],
					"multipliedPageOne",
				);
				const multipliedPageTwo = requireRows(
					result.data["multipliedPageTwo"],
					"multipliedPageTwo",
				);
				expect(multipliedPageOne.pageInfo.total).toBe(2);
				expect(multipliedPageTwo.pageInfo.total).toBe(2);
				const multipliedItems = [multipliedPageOne, multipliedPageTwo].flatMap(
					(page) => page.items,
				);
				expect(new Set(multipliedItems.map((item) => requireField(item, "role").value))).toEqual(
					new Set(["guest", "owner"]),
				);
				const firstMultipliedItem = multipliedPageOne.items[0];
				assertPresent(firstMultipliedItem, "Expected first multiplied page item");
				expect(requireField(firstMultipliedItem, "courseId").value).toBe(course.id);
				expect(members).toHaveLength(2);
			}),
	);

	it.live("returns filtered nested relationship and event includes with per-parent limits", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: courseSchemaId, slug: courseSlug } = yield* createQueryEnginePluginSchema(
				client,
				{ schemaName: "RyotQLIncludeCourse" },
			);
			const { schemaId: moduleSchemaId } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "RyotQLIncludeModule",
				propertiesSchema: {
					fields: { position: { type: "integer", label: "Position", description: "Module order" } },
				},
			});
			const { schemaId: lessonSchemaId } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "RyotQLIncludeLesson",
				propertiesSchema: {
					fields: { position: { type: "integer", label: "Position", description: "Lesson order" } },
				},
			});
			const courseModuleSlug = `ryotql-course-module-${crypto.randomUUID()}`;
			const moduleLessonSlug = `ryotql-module-lesson-${crypto.randomUUID()}`;
			const courseModuleSchema = yield* createRelationshipSchema(client, {
				slug: courseModuleSlug,
				name: "RyotQL Course Module",
				targetEntitySchemaSlug: moduleSchemaId,
				sourceEntitySchemaSlug: courseSchemaId,
				propertiesSchema: {
					fields: { position: { type: "integer", label: "Position", description: "Module order" } },
				},
			});
			const moduleLessonSchema = yield* createRelationshipSchema(client, {
				slug: moduleLessonSlug,
				name: "RyotQL Module Lesson",
				targetEntitySchemaSlug: lessonSchemaId,
				sourceEntitySchemaSlug: moduleSchemaId,
			});
			const completionSlug = `ryotql-completion-${crypto.randomUUID()}`;
			const completionSchema = yield* createEventSchema(client, {
				slug: completionSlug,
				name: "RyotQL Completion",
				entitySchemaSlug: lessonSchemaId,
				propertiesSchema: {
					fields: { score: { type: "integer", label: "Score", description: "Score" } },
				},
			});

			const course = yield* createQueryEngineEntity(client, {
				name: "Course With Modules",
				entitySchemaSlug: courseSchemaId,
			});
			yield* createQueryEngineEntity(client, {
				name: "Empty Course",
				entitySchemaSlug: courseSchemaId,
			});
			const moduleOne = yield* createQueryEngineEntity(client, {
				name: "Module One",
				properties: { position: 1 },
				entitySchemaSlug: moduleSchemaId,
			});
			const moduleTwo = yield* createQueryEngineEntity(client, {
				name: "Module Two",
				properties: { position: 2 },
				entitySchemaSlug: moduleSchemaId,
			});
			const lessonOne = yield* createQueryEngineEntity(client, {
				name: "Lesson One",
				properties: { position: 1 },
				entitySchemaSlug: lessonSchemaId,
			});
			const lessonTwo = yield* createQueryEngineEntity(client, {
				name: "Lesson Two",
				properties: { position: 2 },
				entitySchemaSlug: lessonSchemaId,
			});
			yield* createRelationship(client, {
				sourceEntityId: course.id,
				properties: { position: 2 },
				targetEntityId: moduleTwo.id,
				relationshipSchemaSlug: courseModuleSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: course.id,
				properties: { position: 1 },
				targetEntityId: moduleOne.id,
				relationshipSchemaSlug: courseModuleSchema.id,
			});
			for (const lesson of [lessonOne, lessonTwo]) {
				yield* createRelationship(client, {
					targetEntityId: lesson.id,
					sourceEntityId: moduleOne.id,
					relationshipSchemaSlug: moduleLessonSchema.id,
				});
			}
			yield* createQueryEngineEvent(client, {
				entityId: lessonTwo.id,
				properties: { score: 9 },
				eventSchemaSlug: completionSchema.id,
			});

			const courseTable = table("entity", "course");
			const moduleTable = table("entity", "module");
			const lessonTable = table("entity", "lesson");
			const completion = table("event", "completion");
			const courseModule = table("relationship", "courseModule");
			const moduleLesson = table("relationship", "moduleLesson");
			const score = castNumber(jsonPath(column(completion, "properties"), "score"));
			const completions = include(completion, {
				limit: 10,
				key: "completions",
				fields: [field("score", score)],
				orderBy: [descending(column(completion, "occurredAt"))],
				where: and(
					eq(column(completion, "entityId"), column(lessonTable, "id")),
					eq(column(completion, "eventSchemaSlug"), literal(completionSlug)),
				),
			});
			const lessonPosition = castNumber(jsonPath(column(lessonTable, "properties"), "position"));
			const lessons = include(moduleLesson, {
				limit: 10,
				key: "lessons",
				include: [completions],
				orderBy: [ascending(lessonPosition)],
				fields: [field("name", column(lessonTable, "name"))],
				where: and(
					eq(column(moduleLesson, "sourceEntityId"), column(moduleTable, "id")),
					eq(column(moduleLesson, "relationshipSchemaSlug"), literal(moduleLessonSlug)),
					gt(lessonPosition, literal(1)),
				),
				joins: [
					join(
						"inner",
						lessonTable,
						eq(column(moduleLesson, "targetEntityId"), column(lessonTable, "id")),
					),
				],
			});
			const modulePosition = castNumber(jsonPath(column(courseModule, "properties"), "position"));
			const modules = include(courseModule, {
				limit: 1,
				key: "modules",
				include: [lessons],
				orderBy: [ascending(modulePosition)],
				fields: [field("name", column(moduleTable, "name")), field("position", modulePosition)],
				where: and(
					eq(column(courseModule, "sourceEntityId"), column(courseTable, "id")),
					eq(column(courseModule, "relationshipSchemaSlug"), literal(courseModuleSlug)),
				),
				joins: [
					join(
						"inner",
						moduleTable,
						eq(column(courseModule, "targetEntityId"), column(moduleTable, "id")),
					),
				],
			});
			const result = yield* executeRyotQL(
				client,
				document({
					courses: rows(courseTable, {
						include: [modules],
						orderBy: [ascending(column(courseTable, "name"))],
						fields: [field("name", column(courseTable, "name"))],
						where: eq(column(courseTable, "entitySchemaSlug"), literal(courseSlug)),
					}),
				}),
			);

			const courses = requireRows(result.data["courses"], "courses");
			const populatedCourse = courses.items.find(
				(item) => requireField(item, "name").value === "Course With Modules",
			);
			const emptyCourse = courses.items.find(
				(item) => requireField(item, "name").value === "Empty Course",
			);
			assertPresent(populatedCourse, "Expected populated course");
			assertPresent(emptyCourse, "Expected empty course");
			const includedModules = requireInclude(populatedCourse, "modules");
			expect(includedModules.pageInfo).toEqual({ limit: 1, hasMore: true });
			expect(includedModules.items).toHaveLength(1);
			const firstModule = includedModules.items[0];
			assertPresent(firstModule, "Expected first module");
			expect(requireField(firstModule, "name").value).toBe("Module One");
			expect(requireField(firstModule, "position").value).toBe(1);
			const includedLessons = requireInclude(firstModule, "lessons");
			expect(includedLessons.items).toHaveLength(1);
			const secondLesson = includedLessons.items[0];
			assertPresent(secondLesson, "Expected filtered lesson");
			expect(requireField(secondLesson, "name").value).toBe("Lesson Two");
			const includedCompletions = requireInclude(secondLesson, "completions");
			expect(includedCompletions.items).toHaveLength(1);
			const firstCompletion = includedCompletions.items[0];
			assertPresent(firstCompletion, "Expected completion");
			expect(requireField(firstCompletion, "score").value).toBe(9);
			expect(requireInclude(emptyCourse, "modules")).toEqual({
				items: [],
				pageInfo: { limit: 1, hasMore: false },
			});
		}),
	);

	it.live("applies relationship and endpoint visibility before left joins", () =>
		Effect.gen(function* () {
			const [userA, userB] = yield* Effect.all([
				createAuthenticatedClient(),
				createAuthenticatedClient(),
			]);
			const ownSchema = yield* createQueryEnginePluginSchema(userA.client, {
				schemaName: "RyotQLVisibleRelationship",
			});
			const otherSchema = yield* createQueryEnginePluginSchema(userB.client, {
				schemaName: "RyotQLHiddenRelationship",
			});
			const ownRelationshipSlug = `ryotql-visible-${crypto.randomUUID()}`;
			const otherRelationshipSlug = `ryotql-hidden-${crypto.randomUUID()}`;
			const ownRelationshipSchema = yield* createRelationshipSchema(userA.client, {
				slug: ownRelationshipSlug,
				name: "RyotQL Visible Relationship",
				targetEntitySchemaSlug: ownSchema.schemaId,
				sourceEntitySchemaSlug: ownSchema.schemaId,
			});
			const otherRelationshipSchema = yield* createRelationshipSchema(userB.client, {
				slug: otherRelationshipSlug,
				name: "RyotQL Hidden Relationship",
				targetEntitySchemaSlug: otherSchema.schemaId,
				sourceEntitySchemaSlug: otherSchema.schemaId,
			});
			const ownSource = yield* createQueryEngineEntity(userA.client, {
				name: "Visible Source",
				entitySchemaSlug: ownSchema.schemaId,
			});
			const ownTarget = yield* createQueryEngineEntity(userA.client, {
				name: "Visible Target",
				entitySchemaSlug: ownSchema.schemaId,
			});
			const otherSource = yield* createQueryEngineEntity(userB.client, {
				name: "Hidden Source",
				entitySchemaSlug: otherSchema.schemaId,
			});
			const otherTarget = yield* createQueryEngineEntity(userB.client, {
				name: "Hidden Target",
				entitySchemaSlug: otherSchema.schemaId,
			});
			const ownRelationship = yield* createRelationship(userA.client, {
				sourceEntityId: ownSource.id,
				targetEntityId: ownTarget.id,
				properties: { scope: "visible" },
				relationshipSchemaSlug: ownRelationshipSchema.id,
			});
			const otherRelationship = yield* createRelationship(userB.client, {
				sourceEntityId: otherSource.id,
				targetEntityId: otherTarget.id,
				properties: { scope: "hidden" },
				relationshipSchemaSlug: otherRelationshipSchema.id,
			});

			const entityRoot = table("entity", "entityRoot");
			const visibleSource = table("entity", "visibleSource");
			const hiddenEndpoint = table("entity", "hiddenEndpoint");
			const hiddenRelationship = table("relationship", "hiddenRelationship");
			const visibleRelationship = table("relationship", "visibleRelationship");
			const securedRoot = table("entity", "securedRoot");
			const includedRelationship = table("relationship", "includedRelationship");
			const includedHiddenEndpoint = table("entity", "includedHiddenEndpoint");
			const securedRelationships = include(includedRelationship, {
				limit: 10,
				key: "relationships",
				fields: [
					field("slug", column(includedRelationship, "relationshipSchemaSlug")),
					field("scope", castText(jsonPath(column(includedRelationship, "properties"), "scope"))),
					field("hiddenName", column(includedHiddenEndpoint, "name")),
				],
				orderBy: [ascending(column(includedRelationship, "id"))],
				joins: [
					join(
						"left",
						includedHiddenEndpoint,
						eq(column(includedHiddenEndpoint, "id"), literal(otherTarget.id)),
					),
				],
				where: and(
					eq(column(securedRoot, "id"), literal(ownSource.id)),
					inArray(column(includedRelationship, "relationshipSchemaSlug"), [
						literal(ownRelationshipSlug),
						literal(otherRelationshipSlug),
					]),
				),
			});
			const result = yield* executeRyotQL(
				userA.client,
				document({
					visibleOnly: rows(visibleRelationship, {
						fields: [field("slug", column(visibleRelationship, "relationshipSchemaSlug"))],
						where: inArray(column(visibleRelationship, "relationshipSchemaSlug"), [
							literal(ownRelationshipSlug),
							literal(otherRelationshipSlug),
						]),
					}),
					partialEndpoints: rows(visibleRelationship, {
						where: eq(column(visibleRelationship, "id"), literal(ownRelationship.id)),
						fields: [
							field("sourceName", column(visibleSource, "name")),
							field("hiddenName", column(hiddenEndpoint, "name")),
						],
						joins: [
							join(
								"inner",
								visibleSource,
								eq(column(visibleRelationship, "sourceEntityId"), column(visibleSource, "id")),
							),
							join(
								"left",
								hiddenEndpoint,
								eq(column(hiddenEndpoint, "id"), literal(otherTarget.id)),
							),
						],
					}),
					leftJoinHiddenRelationship: rows(entityRoot, {
						where: eq(column(entityRoot, "id"), literal(ownSource.id)),
						fields: [
							field("name", column(entityRoot, "name")),
							field("hiddenProperties", column(hiddenRelationship, "properties")),
						],
						joins: [
							join(
								"left",
								hiddenRelationship,
								eq(column(hiddenRelationship, "id"), literal(otherRelationship.id)),
							),
						],
					}),
					securedIncludes: rows(securedRoot, {
						fields: [],
						include: [securedRelationships],
						where: eq(column(securedRoot, "id"), literal(ownSource.id)),
					}),
				}),
			);

			const visibleOnly = requireRows(result.data["visibleOnly"], "visibleOnly");
			expect(visibleOnly.items.map((item) => requireField(item, "slug").value)).toEqual([
				ownRelationshipSlug,
			]);
			const partial = requireRows(result.data["partialEndpoints"], "partialEndpoints").items[0];
			assertPresent(partial, "Expected visible relationship");
			expect(requireField(partial, "sourceName").value).toBe("Visible Source");
			expect(requireField(partial, "hiddenName")).toEqual({ kind: "null", value: null });
			const preserved = requireRows(
				result.data["leftJoinHiddenRelationship"],
				"leftJoinHiddenRelationship",
			).items[0];
			assertPresent(preserved, "Expected left root row");
			expect(requireField(preserved, "name").value).toBe("Visible Source");
			expect(requireField(preserved, "hiddenProperties")).toEqual({ kind: "null", value: null });
			const secured = requireRows(result.data["securedIncludes"], "securedIncludes").items[0];
			assertPresent(secured, "Expected secured include root");
			const relationships = requireInclude(secured, "relationships");
			expect(relationships.items).toHaveLength(1);
			const included = relationships.items[0];
			assertPresent(included, "Expected visible included relationship");
			expect(requireField(included, "slug").value).toBe(ownRelationshipSlug);
			expect(requireField(included, "scope").value).toBe("visible");
			expect(requireField(included, "hiddenName")).toEqual({ kind: "null", value: null });
		}),
	);
});
