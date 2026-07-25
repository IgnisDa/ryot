import type { AggregateResult, RyotQLResult } from "@ryot/contract/modules/ryotql/language";
import {
	aggregate,
	and,
	castBoolean,
	castNumber,
	column,
	document,
	eq,
	field,
	inArray,
	join,
	jsonPath,
	literal,
	measure,
	measureAscending,
	measureDescending,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEnginePluginSchema,
	createRelationship,
	createRelationshipSchema,
	executeRyotQL,
	requireRyotQLFieldValue,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireAggregate = (result: RyotQLResult | undefined, key: string): AggregateResult => {
	if (result?.type !== "aggregate") {
		throw new Error(`Expected '${key}' aggregate`);
	}
	return result;
};

describe("RyotQL aggregate outputs", () => {
	it.live("returns grouped, ungrouped, empty, null, and runtime-kind aggregate values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "RyotQLAggregateLesson",
				propertiesSchema: {
					unknownKeys: "passthrough",
					fields: {
						featured: { type: "boolean", label: "Featured", description: "Featured" },
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
						durationMinutes: { type: "integer", label: "Duration", description: "Duration" },
					},
				},
			});
			const lessons = yield* Effect.all([
				createQueryEngineEntity(client, {
					name: "Advanced One",
					entitySchemaSlug: schemaId,
					properties: {
						featured: true,
						durationMinutes: 30,
						difficulty: "advanced",
						metadata: { format: "video" },
					},
				}),
				createQueryEngineEntity(client, {
					name: "Advanced Two",
					entitySchemaSlug: schemaId,
					properties: { featured: false, difficulty: "advanced", durationMinutes: 60 },
				}),
				createQueryEngineEntity(client, {
					name: "Beginner",
					entitySchemaSlug: schemaId,
					properties: { featured: false, difficulty: "beginner", durationMinutes: 90 },
				}),
				createQueryEngineEntity(client, {
					name: "Unclassified",
					entitySchemaSlug: schemaId,
					properties: { featured: false },
				}),
			]);

			const lesson = table("entity", "lesson");
			const properties = column(lesson, "properties");
			const duration = castNumber(jsonPath(properties, "durationMinutes"));
			const difficulty = jsonPath(properties, "difficulty");
			const measures = [
				measure("count", { function: "count" }),
				measure("difficultyCount", { function: "countDistinct", expr: difficulty }),
				measure("totalDuration", { function: "sum", expr: duration }),
				measure("averageDuration", { function: "average", expr: duration }),
				measure("minimumDuration", { function: "minimum", expr: duration }),
				measure("maximumDuration", { function: "maximum", expr: duration }),
			] as const;
			const schemaFilter = eq(column(lesson, "entitySchemaSlug"), literal(slug));
			const result = yield* executeRyotQL(
				client,
				document({
					allLessons: aggregate(lesson, { measures, where: schemaFilter }),
					emptyLessons: aggregate(lesson, {
						measures,
						where: eq(
							column(lesson, "entitySchemaSlug"),
							literal(`missing-${crypto.randomUUID()}`),
						),
					}),
					difficultyGroups: aggregate(lesson, {
						limit: 10,
						where: schemaFilter,
						orderBy: [measureDescending("count")],
						groupBy: [field("difficulty", difficulty)],
						measures: [measure("count", { function: "count" })],
					}),
					limitedDifficultyGroups: aggregate(lesson, {
						limit: 1,
						where: schemaFilter,
						orderBy: [measureDescending("count")],
						groupBy: [field("difficulty", difficulty)],
						measures: [measure("count", { function: "count" })],
					}),
					nullMeasureAscending: aggregate(lesson, {
						limit: 10,
						where: schemaFilter,
						orderBy: [measureAscending("totalDuration")],
						groupBy: [field("difficulty", difficulty)],
						measures: [measure("totalDuration", { function: "sum", expr: duration })],
					}),
					nullMeasureDescending: aggregate(lesson, {
						limit: 10,
						where: schemaFilter,
						orderBy: [measureDescending("totalDuration")],
						groupBy: [field("difficulty", difficulty)],
						measures: [measure("totalDuration", { function: "sum", expr: duration })],
					}),
					kindGroup: aggregate(lesson, {
						limit: 10,
						orderBy: [measureDescending("count")],
						measures: [measure("count", { function: "count" })],
						where: eq(column(lesson, "id"), literal(lessons[0].id)),
						groupBy: [
							field("text", column(lesson, "name")),
							field("number", duration),
							field("boolean", castBoolean(jsonPath(properties, "featured"))),
							field("date", column(lesson, "createdAt")),
							field("json", jsonPath(properties, "metadata")),
							field("missing", jsonPath(properties, "missing")),
						],
					}),
				}),
			);

			const allLessons = requireAggregate(result.data["allLessons"], "allLessons");
			expect(allLessons.pageInfo).toBeUndefined();
			const all = allLessons.items[0];
			assertPresent(all, "Expected ungrouped aggregate item");
			expect(requireRyotQLFieldValue(all, "count").value).toBe(4);
			expect(requireRyotQLFieldValue(all, "difficultyCount").value).toBe(2);
			expect(requireRyotQLFieldValue(all, "totalDuration").value).toBe(180);
			expect(requireRyotQLFieldValue(all, "averageDuration").value).toBe(60);
			expect(requireRyotQLFieldValue(all, "minimumDuration").value).toBe(30);
			expect(requireRyotQLFieldValue(all, "maximumDuration").value).toBe(90);

			const empty = requireAggregate(result.data["emptyLessons"], "emptyLessons").items[0];
			assertPresent(empty, "Expected empty aggregate item");
			expect(requireRyotQLFieldValue(empty, "count")).toEqual({ kind: "number", value: 0 });
			expect(requireRyotQLFieldValue(empty, "difficultyCount")).toEqual({
				value: 0,
				kind: "number",
			});
			for (const key of [
				"totalDuration",
				"averageDuration",
				"minimumDuration",
				"maximumDuration",
			]) {
				expect(requireRyotQLFieldValue(empty, key)).toEqual({ kind: "null", value: null });
			}

			const grouped = requireAggregate(result.data["difficultyGroups"], "difficultyGroups");
			expect(grouped.pageInfo).toEqual({ limit: 10, hasMore: false });
			expect(grouped.items).toHaveLength(3);
			const advanced = grouped.items.find(
				(item) => requireRyotQLFieldValue(item, "difficulty").value === "advanced",
			);
			const nullGroup = grouped.items.find(
				(item) => requireRyotQLFieldValue(item, "difficulty").kind === "null",
			);
			assertPresent(advanced, "Expected advanced group");
			assertPresent(nullGroup, "Expected null group");
			expect(requireRyotQLFieldValue(advanced, "count").value).toBe(2);
			expect(requireRyotQLFieldValue(nullGroup, "count").value).toBe(1);
			const limited = requireAggregate(
				result.data["limitedDifficultyGroups"],
				"limitedDifficultyGroups",
			);
			expect(limited.pageInfo).toEqual({ limit: 1, hasMore: true });
			expect(limited.items).toHaveLength(1);
			const limitedItem = limited.items[0];
			assertPresent(limitedItem, "Expected limited difficulty group");
			expect(requireRyotQLFieldValue(limitedItem, "difficulty").value).toBe("advanced");
			for (const key of ["nullMeasureAscending", "nullMeasureDescending"]) {
				const ordered = requireAggregate(result.data[key], key);
				const last = ordered.items.at(-1);
				assertPresent(last, `Expected '${key}' group`);
				expect(requireRyotQLFieldValue(last, "totalDuration")).toEqual({
					value: null,
					kind: "null",
				});
			}

			const kindItem = requireAggregate(result.data["kindGroup"], "kindGroup").items[0];
			assertPresent(kindItem, "Expected runtime-kind group");
			expect(requireRyotQLFieldValue(kindItem, "text")).toEqual({
				kind: "text",
				value: "Advanced One",
			});
			expect(requireRyotQLFieldValue(kindItem, "number")).toEqual({
				value: 30,
				kind: "number",
			});
			expect(requireRyotQLFieldValue(kindItem, "boolean")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(kindItem, "date")).toEqual({
				kind: "date",
				value: lessons[0].createdAt,
			});
			expect(requireRyotQLFieldValue(kindItem, "json")).toEqual({
				kind: "json",
				value: { format: "video" },
			});
			expect(requireRyotQLFieldValue(kindItem, "missing")).toEqual({
				value: null,
				kind: "null",
			});
		}),
	);

	it.live("uses visible rows and ordinary join multiplicity for measures", () =>
		Effect.gen(function* () {
			const [owner, other] = yield* Effect.all([
				createAuthenticatedClient(),
				createAuthenticatedClient(),
			]);
			const ownerSchema = yield* createQueryEnginePluginSchema(owner.client, {
				schemaName: "RyotQLAggregateVisible",
			});
			const otherSchema = yield* createQueryEnginePluginSchema(other.client, {
				schemaName: "RyotQLAggregateHidden",
			});
			const ownerRelationship = yield* createRelationshipSchema(owner.client, {
				name: "RyotQL Aggregate Visible Link",
				targetEntitySchemaSlug: ownerSchema.schemaId,
				sourceEntitySchemaSlug: ownerSchema.schemaId,
				slug: `ryotql-aggregate-visible-${crypto.randomUUID()}`,
			});
			const otherRelationship = yield* createRelationshipSchema(other.client, {
				name: "RyotQL Aggregate Hidden Link",
				targetEntitySchemaSlug: otherSchema.schemaId,
				sourceEntitySchemaSlug: otherSchema.schemaId,
				slug: `ryotql-aggregate-hidden-${crypto.randomUUID()}`,
			});
			const ownerEntities = yield* Effect.all(
				["Visible Source", "Visible Target One", "Visible Target Two"].map((name) =>
					createQueryEngineEntity(owner.client, {
						name,
						entitySchemaSlug: ownerSchema.schemaId,
					}),
				),
			);
			const otherEntities = yield* Effect.all(
				["Hidden Source", "Hidden Target"].map((name) =>
					createQueryEngineEntity(other.client, { name, entitySchemaSlug: otherSchema.schemaId }),
				),
			);
			const [ownerSource, ownerTargetOne, ownerTargetTwo] = ownerEntities;
			const [otherSource, otherTarget] = otherEntities;
			assertPresent(ownerSource, "Expected visible source");
			assertPresent(ownerTargetOne, "Expected first visible target");
			assertPresent(ownerTargetTwo, "Expected second visible target");
			assertPresent(otherSource, "Expected hidden source");
			assertPresent(otherTarget, "Expected hidden target");
			const createdRelationships = yield* Effect.all([
				createRelationship(owner.client, {
					sourceEntityId: ownerSource.id,
					targetEntityId: ownerTargetOne.id,
					relationshipSchemaSlug: ownerRelationship.id,
				}),
				createRelationship(owner.client, {
					sourceEntityId: ownerSource.id,
					targetEntityId: ownerTargetTwo.id,
					relationshipSchemaSlug: ownerRelationship.id,
				}),
				createRelationship(other.client, {
					sourceEntityId: otherSource.id,
					targetEntityId: otherTarget.id,
					relationshipSchemaSlug: otherRelationship.id,
				}),
			]);
			const hiddenRelationship = createdRelationships[2];
			assertPresent(hiddenRelationship, "Expected hidden relationship");

			const entity = table("entity", "entity");
			const relationship = table("relationship", "relationship");
			const result = yield* executeRyotQL(
				owner.client,
				document({
					joined: aggregate(entity, {
						measures: [
							measure("count", { function: "count" }),
							measure("distinctEntities", {
								function: "countDistinct",
								expr: column(entity, "id"),
							}),
						],
						joins: [
							join(
								"inner",
								relationship,
								eq(column(entity, "id"), column(relationship, "sourceEntityId")),
							),
						],
						where: and(
							inArray(column(entity, "id"), [literal(ownerSource.id), literal(otherSource.id)]),
							inArray(column(relationship, "relationshipSchemaSlug"), [
								literal(ownerRelationship.id),
								literal(otherRelationship.id),
							]),
						),
					}),
					hiddenLeftJoin: aggregate(entity, {
						where: eq(column(entity, "id"), literal(ownerSource.id)),
						measures: [
							measure("rootCount", { function: "count" }),
							measure("hiddenRelationshipCount", {
								function: "countDistinct",
								expr: column(relationship, "id"),
							}),
						],
						joins: [
							join(
								"left",
								relationship,
								eq(column(relationship, "id"), literal(hiddenRelationship.id)),
							),
						],
					}),
				}),
			);

			const item = requireAggregate(result.data["joined"], "joined").items[0];
			assertPresent(item, "Expected joined aggregate item");
			expect(requireRyotQLFieldValue(item, "count").value).toBe(2);
			expect(requireRyotQLFieldValue(item, "distinctEntities").value).toBe(1);
			const hiddenLeftJoin = requireAggregate(result.data["hiddenLeftJoin"], "hiddenLeftJoin")
				.items[0];
			assertPresent(hiddenLeftJoin, "Expected secured left-join aggregate item");
			expect(requireRyotQLFieldValue(hiddenLeftJoin, "rootCount").value).toBe(1);
			expect(requireRyotQLFieldValue(hiddenLeftJoin, "hiddenRelationshipCount").value).toBe(0);
		}),
	);
});
