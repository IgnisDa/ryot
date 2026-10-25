import { fitnessPlugin } from "@ryot-app/fitness-plugin";
import type { ExerciseKind } from "@ryot-app/fitness-plugin/exercise-kinds";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { type Client, createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { getEntity } from "~/fixtures/kernel/entities";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	fakeProviderDetailsResult,
	shippedPluginTestProviders,
} from "~/fixtures/kernel/sandbox-provider";
import { assertCondition } from "~/support/assertions";
import { startIsolatedApiServer } from "~/support/isolated-harness";

import { findFitnessEntitySchema } from "./exercises";
import {
	editTarget,
	loadWorkoutBaseline,
	saveWorkoutData,
	type WorkoutData,
} from "./workout-editor";

export const saveHistoricalWorkoutData = Effect.fn("saveHistoricalWorkoutData")(function* (
	client: Client,
	data: WorkoutData,
) {
	assertCondition(data.target.kind === "create", "Expected a new historical fixture workout");
	const empty = yield* saveWorkoutData(client, { ...data, supersets: [], occurrences: [] });
	assertCondition(empty.kind === "saved", "Expected the empty historical workout to save");
	const baseline = yield* loadWorkoutBaseline(client, empty.entityId);
	return yield* saveWorkoutData(client, { ...data, target: editTarget(baseline) });
});

export const createKindChangingExerciseFixture = Effect.fn("createKindChangingExerciseFixture")(
	function* () {
		const suffix = yield* randomUuid;
		const { target } = yield* startIsolatedApiServer({ label: `Fitness records ${suffix}` });
		const { client } = yield* createAuthenticatedClient(target);
		const providers = yield* shippedPluginTestProviders(fitnessPlugin.metadata.packageId, target);
		const name = `Recorded kind exercise ${suffix}`;
		const details = (kind: ExerciseKind) =>
			fakeProviderDetailsResult({ name, properties: { kind, images: [], instructions: [] } });
		const provider = yield* providers.attachProvider({
			rootEntitySchemaSlug: "exercise",
			details: details("reps_and_weight"),
			slug: `exercise.e2e-records-${suffix}`,
		});
		const { schema } = yield* findFitnessEntitySchema(client, "exercise");
		const externalId = `recorded-kind-${suffix}`;
		const seeded = yield* getApiClient(target).adminCall((contract) =>
			contract.testSupport.createGlobalEntity({
				payload: {
					name,
					externalId,
					populatedAt: null,
					entitySchema: schema.reference,
					providerId: provider.providerId,
					properties: { images: [], instructions: [], kind: "reps_and_weight" },
				},
			}),
		);
		const refresh = Effect.fn("refreshRecordedExerciseKind")(function* (kind: ExerciseKind) {
			const idempotencyKey = yield* randomUuid;
			const accepted = yield* client.call((contract) =>
				contract.entities.requestEnrichment({
					params: { entityId: seeded.id },
					payload: {
						idempotencyKey,
						action: "refresh",
						operation: "population",
						pluginId: provider.pluginId,
					},
				}),
			);
			assertCondition(accepted.enrichmentRequestId !== null, "Expected provider refresh admission");
			return yield* pollUntil(
				`provider exercise ${seeded.id} refreshed to ${kind}`,
				getEntity(client, seeded.id).pipe(
					Effect.map((entity) =>
						entity.properties["kind"] === kind &&
						entity.relatedPopulationStatus.state === "succeeded" &&
						entity.relatedPopulationStatus.availability === "complete"
							? entity
							: null,
					),
				),
			);
		});
		const exercise = yield* refresh("reps_and_weight");
		return {
			client,
			exercise,
			externalId,
			exerciseId: seeded.id,
			providerId: provider.providerId,
			changeKind: Effect.fn("changeRecordedExerciseKind")(function* (kind: ExerciseKind) {
				yield* providers.update(provider.providerSlug, { details: details(kind) });
				return yield* refresh(kind);
			}),
		};
	},
);
