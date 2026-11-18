import { expect, it } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";

import { ExerciseOverrideUpdateInputSchema } from "../../shared/workout-editor-context-operations";
import definition, { manifest } from "./exercise-override-update.sandbox";

const makeHost = (missing?: "exercise" | "membership") =>
	defineSandboxTestHost(manifest, {
		executeRyotql: (document) =>
			Effect.succeed({
				data: Object.fromEntries(
					Object.keys(bindTestRequest(document).queries).map((key) => {
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

it("merges only supplied nullable overrides into the existing membership", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const host = makeHost();
			const input = yield* Schema.decodeEffect(ExerciseOverrideUpdateInputSchema)({
				exerciseId: "exercise-1",
				overrides: { dropRestTime: 0, normalRestTime: null },
			});
			expect(yield* definition.run(input, host)).toEqual<unknown>({
				output: { kind: "saved" },
				changes: {
					relationships: {
						upserts: [
							{
								propertiesMode: "merge",
								relationshipSchemaSlug: "in-fitness-library",
								target: { kind: "existing", entityId: "library-1" },
								source: { kind: "existing", entityId: "exercise-1" },
								properties: { dropRestTime: 0, normalRestTime: null },
							},
						],
					},
				},
			});
		}),
	));

it.each(["exercise", "membership"] as const)(
	"rejects a missing %s without creating a membership",
	(missing) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const host = makeHost(missing);
				const input = yield* Schema.decodeEffect(ExerciseOverrideUpdateInputSchema)({
					exerciseId: "exercise-1",
					overrides: { normalRestTime: 0 },
				});
				expect(yield* definition.run(input, host)).toEqual({
					output: { kind: "missing-exercise" },
				});
			}),
		),
);
