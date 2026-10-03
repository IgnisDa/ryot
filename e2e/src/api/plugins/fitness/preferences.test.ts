import { and, column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQL,
	getEntity,
	insertRelationshipRow,
	requireRows,
	requireRyotQLText,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	listPluginUserSettings,
	resetPluginUserSettings,
	savePluginUserSettings,
} from "~/fixtures/kernel/plugin-user-settings";
import { getUserSettings, setUserLanguage } from "~/fixtures/kernel/user-settings";
import {
	createExerciseEntityFixture,
	findFitnessEntitySchema,
	findFitnessRelationshipSchema,
} from "~/fixtures/plugins/fitness";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const fitnessSetting = Effect.fn(function* (client: Client) {
	return requirePresent(
		(yield* listPluginUserSettings(client)).find(({ name }) => name === "Fitness"),
		"Fitness settings not found",
	);
});

describe("Fitness preferences", () => {
	it.live(
		"saves zero and false choices on the exact Fitness installation and resets without changing kernel preferences",
		() =>
			Effect.gen(function* () {
				const owner = yield* createAuthenticatedClient();
				const other = yield* createAuthenticatedClient();
				yield* setUserLanguage(owner.client, "es");
				const initial = yield* fitnessSetting(owner.client);
				expect(initial.settings).toEqual({});
				const choices = {
					energyUnit: "kJ",
					normalRestTime: 0,
					muteSounds: false,
					unitSystem: "imperial",
					startTimerForDurationExercises: false,
				};
				yield* savePluginUserSettings(owner.client, initial.id, choices);
				expect((yield* fitnessSetting(owner.client)).settings).toEqual(choices);
				expect((yield* fitnessSetting(other.client)).settings).toEqual({});
				const foreignWrite = yield* Effect.flip(
					savePluginUserSettings(other.client, initial.id, { normalRestTime: 30 }),
				);
				assertTaggedError(foreignWrite, "PluginNotFoundError");
				const invalidChoices: Array<Parameters<typeof savePluginUserSettings>[2]> = [
					{ normalRestTime: -1 },
					{ normalRestTime: 1.5 },
					{ normalRestTime: null },
					{ muteSounds: null },
					{ energyUnit: "cal" },
					{ unknown: true, unitSystem: "imperial" },
				];
				for (const invalid of invalidChoices) {
					const error = yield* Effect.flip(
						savePluginUserSettings(owner.client, initial.id, invalid),
					);
					assertTaggedError(error, "PluginRequestError");
					expect(error.reason.code).toBe("validation-failed");
					expect((yield* fitnessSetting(owner.client)).settings).toEqual(choices);
				}
				yield* resetPluginUserSettings(owner.client, initial.id);
				expect((yield* fitnessSetting(owner.client)).settings).toEqual({});
				expect((yield* getUserSettings(owner.client)).preferences.language).toBe("es");
			}),
	);

	it.live("stores exercise overrides only on the user's library relationship", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { exerciseId } = yield* createExerciseEntityFixture(client, { kind: "duration" });
			const { pluginId } = yield* findFitnessEntitySchema(client, "fitness-library");
			const relationshipSchema = yield* findFitnessRelationshipSchema(client, "in-fitness-library");
			const library = table("entity", "fitnessLibrary");
			const result = yield* executeRyotQL(
				client,
				document({
					library: rows(library, {
						limit: 1,
						fields: [field("id", column(library, "id"))],
						where: and(
							eq(column(library, "entitySchemaPluginId"), literal(pluginId)),
							eq(column(library, "entitySchemaSlug"), literal("fitness-library")),
						),
					}),
				}),
			);
			const libraryId = requireRyotQLText(
				requirePresent(
					requireRows(result.data.library, "library").items[0],
					"Fitness library missing",
				),
				"id",
			);
			const identity = {
				targetEntityId: libraryId,
				sourceEntityId: exerciseId,
				relationshipSchema: relationshipSchema.reference,
			};
			const properties = { dropRestTime: 22, normalRestTime: 0, defaultDurationUnit: "seconds" };
			expect(
				(yield* insertRelationshipRow(client, { ...identity, properties })).properties,
			).toEqual(properties);
			const exercise = yield* getEntity(client, exerciseId);
			expect(exercise.properties).not.toHaveProperty("normalRestTime");
			expect(exercise.properties).not.toHaveProperty("defaultDurationUnit");
			const error = yield* Effect.flip(
				insertRelationshipRow(client, { ...identity, properties: { normalRestTime: -1 } }),
			);
			assertTaggedError(error, "RelationshipBadRequest");
			expect(error.reason.code).toBe("invalid-properties");
		}),
	);
});
