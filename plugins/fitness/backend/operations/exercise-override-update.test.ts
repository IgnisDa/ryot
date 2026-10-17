import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { expect, it } from "vitest";

import { ExerciseOverrideUpdateInputSchema } from "../../shared/workout-editor-context-operations";
import definition, { manifest } from "./exercise-override-update.sandbox";

const makeHost = (missing?: "exercise" | "membership") => {
	const writes: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		changeUserRelationships: (batch) =>
			Effect.sync(() => {
				writes.push(batch);
				return [{ created: 1, deleted: 0 }];
			}),
		executeRyotql: (document) =>
			Effect.succeed({
				data: Object.fromEntries(
					Object.keys(document.queries).map((key) => {
						const items =
							key === "exercises"
								? [
										{
											images: null,
											properties: {},
											id: "exercise-1",
											name: "Exercise",
											instructions: null,
										},
									]
								: [
										{
											id: "membership-1",
											targetEntityId: "library-1",
											properties: {
												dropRestTime: 10,
												normalRestTime: 30,
												defaultDurationUnit: "minutes",
											},
										},
									];
						const omitted =
							(missing === "exercise" && key === "exercises") ||
							(missing === "membership" && key !== "exercises");
						return [
							key,
							{
								type: "rows",
								items: omitted ? [] : items,
								pageInfo: { limit: 100, hasMore: false, nextCursor: null },
							},
						];
					}),
				),
			}),
	});
	return { host, writes };
};

it("merges only supplied nullable overrides into the existing membership", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { host, writes } = makeHost();
			const input = yield* Schema.decodeEffect(ExerciseOverrideUpdateInputSchema)({
				exerciseId: "exercise-1",
				overrides: { dropRestTime: 0, normalRestTime: null },
			});
			expect(yield* definition.run(input, host)).toEqual({ kind: "saved" });
			expect(writes).toEqual([
				[
					{
						deletes: [],
						creates: [
							{
								propertiesMode: "merge",
								targetEntityId: "library-1",
								sourceEntityId: "exercise-1",
								relationshipSchemaSlug: "in-fitness-library",
								properties: { dropRestTime: 0, normalRestTime: null },
							},
						],
					},
				],
			]);
		}),
	));

it.each(["exercise", "membership"] as const)(
	"rejects a missing %s without creating a membership",
	(missing) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { host, writes } = makeHost(missing);
				const input = yield* Schema.decodeEffect(ExerciseOverrideUpdateInputSchema)({
					exerciseId: "exercise-1",
					overrides: { normalRestTime: 0 },
				});
				expect(yield* definition.run(input, host)).toEqual({ kind: "missing-exercise" });
				expect(writes).toEqual([]);
			}),
		),
);
