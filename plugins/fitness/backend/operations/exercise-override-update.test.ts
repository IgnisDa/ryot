import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { expect, it } from "vitest";

import { ExerciseOverrideUpdateInputSchema } from "../../shared/workout-editor-context-operations";
import definition, { manifest } from "./exercise-override-update.sandbox";

it("removes inheritance overrides while preserving unrelated membership values and identity", () =>
	Effect.runPromise(
		Effect.gen(function* () {
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
							Object.keys(document.queries).map((key) => [
								key,
								{
									type: "rows",
									pageInfo: { limit: 100, hasMore: false, nextCursor: null },
									items:
										key === "exercises"
											? [{ properties: {}, id: "exercise-1", name: "Exercise" }]
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
												],
								},
							]),
						),
					}),
			});
			const input = yield* Schema.decodeEffect(ExerciseOverrideUpdateInputSchema)({
				exerciseId: "exercise-1",
				set: { dropRestTime: 0 },
				remove: ["normalRestTime"],
			});
			expect(yield* definition.run(input, host)).toEqual({ kind: "saved" });
			expect(writes).toEqual([
				[
					{
						deletes: [],
						creates: [
							{
								propertiesMode: "replace",
								targetEntityId: "library-1",
								sourceEntityId: "exercise-1",
								relationshipSchemaSlug: "in-fitness-library",
								properties: { dropRestTime: 0, defaultDurationUnit: "minutes" },
							},
						],
					},
				],
			]);
		}),
	));
