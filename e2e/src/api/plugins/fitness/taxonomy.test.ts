import { fitnessPlugin } from "@ryot-app/fitness-plugin";
import { exerciseListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import {
	equipmentListRecipe,
	exerciseEquipmentRecipe,
	exerciseTargetsRecipe,
	targetListRecipe,
} from "@ryot-app/fitness-plugin/taxonomy-recipes";
import { arrayContaining, stringContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	enqueueProviderEntityImport,
	executeRyotQLRecipe,
	getApiClient,
	getEntity,
	openLiveUpdatesScoped,
	pollProviderEntityImportResult,
} from "~/fixtures/kernel";
import { pollUntil } from "~/fixtures/kernel/polling";
import { shippedPluginTestProviders } from "~/fixtures/kernel/sandbox-provider";
import {
	attachFitnessTaxonomyProvider,
	findFitnessEntitySchema,
	findFitnessRelationshipSchema,
} from "~/fixtures/plugins/fitness";
import { assertCompleted, assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startIsolatedHarness } from "~/support/isolated-harness";

let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];
let fitnessProviders: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			harness = yield* startIsolatedHarness("Fitness Taxonomy");
			target = harness.target;
			fitnessProviders = yield* shippedPluginTestProviders(
				fitnessPlugin.metadata.packageId,
				target,
			);
		}),
	),
);

afterAll(() => runPromise(harness?.stop ?? Effect.void));

describe("Fitness taxonomy E2E", () => {
	it.live("keeps private taxonomy ownership and validates exercise links", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient(target);
			const otherUser = yield* createAuthenticatedClient(target);
			const [
				{ pluginId, schema: exerciseSchema },
				{ schema: targetSchema },
				{ schema: equipmentSchema },
				targetRelationshipSchema,
				equipmentRelationshipSchema,
			] = yield* Effect.all([
				findFitnessEntitySchema(owner.client, "exercise"),
				findFitnessEntitySchema(owner.client, "exercise-target"),
				findFitnessEntitySchema(owner.client, "exercise-equipment"),
				findFitnessRelationshipSchema(owner.client, "exercise-targets"),
				findFitnessRelationshipSchema(owner.client, "exercise-uses-equipment"),
			]);
			const suffix = yield* randomUuid;
			const exercise = yield* createEntity(owner.client, {
				entitySchema: exerciseSchema.reference,
				properties: { kind: "reps_and_weight" },
				name: `Private Taxonomy Exercise ${suffix}`,
			});
			const pelvicFloor = yield* createEntity(owner.client, {
				name: "Pelvic floor",
				entitySchema: targetSchema.reference,
				properties: { kind: "muscle_region" },
			});
			const plantarFascia = yield* createEntity(owner.client, {
				name: "Plantar fascia",
				properties: { kind: "fascia" },
				entitySchema: targetSchema.reference,
			});
			const anchoredBands = yield* createEntity(owner.client, {
				properties: {},
				name: "Bands with door anchor",
				entitySchema: equipmentSchema.reference,
			});
			const workoutMat = yield* createEntity(owner.client, {
				properties: {},
				name: `Workout mat ${suffix}`,
				entitySchema: equipmentSchema.reference,
			});
			const foreignTarget = yield* createEntity(otherUser.client, {
				properties: { kind: "region" },
				entitySchema: targetSchema.reference,
				name: `Other user's private target ${suffix}`,
			});

			const firstTargetLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: pelvicFloor.id,
				properties: { role: "stabilizer" },
				relationshipSchema: targetRelationshipSchema.reference,
			});
			const secondTargetLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: plantarFascia.id,
				relationshipSchema: targetRelationshipSchema.reference,
			});
			const firstEquipmentLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: anchoredBands.id,
				relationshipSchema: equipmentRelationshipSchema.reference,
			});
			const secondEquipmentLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: workoutMat.id,
				relationshipSchema: equipmentRelationshipSchema.reference,
			});
			const duplicateTargetLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: pelvicFloor.id,
				properties: { role: "stabilizer" },
				relationshipSchema: targetRelationshipSchema.reference,
			});
			const duplicateEquipmentLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: anchoredBands.id,
				relationshipSchema: equipmentRelationshipSchema.reference,
			});

			expect(firstTargetLink.wasInserted).toBe(true);
			expect(secondTargetLink.wasInserted).toBe(true);
			expect(firstEquipmentLink.wasInserted).toBe(true);
			expect(secondEquipmentLink.wasInserted).toBe(true);
			expect(duplicateTargetLink.wasInserted).toBe(false);
			expect(duplicateTargetLink.id).toBe(firstTargetLink.id);
			expect(duplicateEquipmentLink.wasInserted).toBe(false);
			expect(duplicateEquipmentLink.id).toBe(firstEquipmentLink.id);

			const [ownerTargets, ownerFascia, ownerEquipment, ownerMat] = yield* Effect.all([
				executeRyotQLRecipe(
					owner.client,
					targetListRecipe({ reference: { pluginId, kind: "local" } }),
					{ name: "Pelvic floor" },
					{ pages: { targets: { limit: 1 } } },
				),
				executeRyotQLRecipe(
					owner.client,
					targetListRecipe({ reference: { pluginId, kind: "local" } }),
					{ name: "Plantar fascia" },
					{ pages: { targets: { limit: 1 } } },
				),
				executeRyotQLRecipe(
					owner.client,
					equipmentListRecipe({ reference: { pluginId, kind: "local" } }),
					{ name: "Bands with door anchor" },
					{ pages: { equipment: { limit: 1 } } },
				),
				executeRyotQLRecipe(
					owner.client,
					equipmentListRecipe({ reference: { pluginId, kind: "local" } }),
					{ name: `Workout mat ${suffix}` },
					{ pages: { equipment: { limit: 1 } } },
				),
			]);
			const privateTarget = requirePresent(
				ownerTargets.items.find(({ name }) => name === "Pelvic floor"),
				"Expected owner to see the private pelvic floor target",
			);
			const privateEquipment = requirePresent(
				ownerEquipment.items.find(({ name }) => name === "Bands with door anchor"),
				"Expected owner to see the private bands equipment",
			);
			const fasciaTarget = requirePresent(
				ownerFascia.items[0],
				"Expected owner to see the private plantar fascia target",
			);
			const workoutMatEquipment = requirePresent(
				ownerMat.items[0],
				"Expected owner to see the private workout mat equipment",
			);
			expect(privateTarget).toMatchObject({ userId: owner.userId, kind: "muscle_region" });
			expect(fasciaTarget).toMatchObject({ kind: "fascia", userId: owner.userId });
			expect(privateEquipment.userId).toBe(owner.userId);
			expect(workoutMatEquipment.userId).toBe(owner.userId);

			const [otherUserTargets, otherUserFascia, otherUserEquipment, otherUserMat] =
				yield* Effect.all([
					executeRyotQLRecipe(
						otherUser.client,
						targetListRecipe({ reference: { pluginId, kind: "local" } }),
						{ name: "Pelvic floor" },
						{ pages: { targets: { limit: 1 } } },
					),
					executeRyotQLRecipe(
						otherUser.client,
						targetListRecipe({ reference: { pluginId, kind: "local" } }),
						{ name: "Plantar fascia" },
						{ pages: { targets: { limit: 1 } } },
					),
					executeRyotQLRecipe(
						otherUser.client,
						equipmentListRecipe({ reference: { pluginId, kind: "local" } }),
						{ name: "Bands with door anchor" },
						{ pages: { equipment: { limit: 1 } } },
					),
					executeRyotQLRecipe(
						otherUser.client,
						equipmentListRecipe({ reference: { pluginId, kind: "local" } }),
						{ name: `Workout mat ${suffix}` },
						{ pages: { equipment: { limit: 1 } } },
					),
				]);
			expect(otherUserTargets.items).toEqual([]);
			expect(otherUserFascia.items).toEqual([]);
			expect(otherUserEquipment.items).toEqual([]);
			expect(otherUserMat.items).toEqual([]);

			const graphBeforeRejections = yield* Effect.all([
				executeRyotQLRecipe(
					owner.client,
					exerciseTargetsRecipe({ reference: { pluginId, kind: "local" } }),
					{ exerciseId: exercise.id },
					{ pages: { targets: { limit: 100 } } },
				),
				executeRyotQLRecipe(
					owner.client,
					exerciseEquipmentRecipe({ reference: { pluginId, kind: "local" } }),
					{ exerciseId: exercise.id },
					{ pages: { equipment: { limit: 100 } } },
				),
			]);
			expect(graphBeforeRejections.map(({ items }) => items.length)).toEqual([2, 2]);
			const listedExercise = requirePresent(
				(yield* executeRyotQLRecipe(
					owner.client,
					exerciseListRecipe({ reference: { pluginId, kind: "local" } }),
					{ entityId: exercise.id },
					{ pages: { exercises: { limit: 1 } } },
				)).items[0],
				"Expected the exercise with its equipment links",
			);
			expect(listedExercise.equipment).toHaveLength(2);
			expect(listedExercise.equipment.map(({ id }) => id)).toEqual<unknown>(
				arrayContaining([anchoredBands.id, workoutMat.id]),
			);
			const omittedRoleTarget = requirePresent(
				graphBeforeRejections[0].items.find(({ name }) => name === "Plantar fascia"),
				"Expected a target link without an assigned role",
			);
			expect(omittedRoleTarget.role).toBeNull();
			const foreignLinkError = yield* Effect.flip(
				owner.client.call((c) =>
					c.relationships.create({
						payload: {
							sourceEntityId: exercise.id,
							targetEntityId: foreignTarget.id,
							relationshipSchema: targetRelationshipSchema.reference,
						},
					}),
				),
			);
			assertTaggedError(foreignLinkError, "RelationshipNotFound");
			expect(foreignLinkError.reason).toMatchObject({ code: "entity-not-found" });

			const invalidRoleError = yield* Effect.flip(
				owner.client.call((c) =>
					c.relationships.create({
						payload: {
							sourceEntityId: exercise.id,
							properties: { role: "tertiary" },
							targetEntityId: plantarFascia.id,
							relationshipSchema: targetRelationshipSchema.reference,
						},
					}),
				),
			);
			assertTaggedError(invalidRoleError, "RelationshipBadRequest");
			expect(invalidRoleError.reason).toMatchObject({ code: "invalid-properties" });

			const graphAfterRejections = yield* Effect.all([
				executeRyotQLRecipe(
					owner.client,
					exerciseTargetsRecipe({ reference: { pluginId, kind: "local" } }),
					{ exerciseId: exercise.id },
					{ pages: { targets: { limit: 100 } } },
				),
				executeRyotQLRecipe(
					owner.client,
					exerciseEquipmentRecipe({ reference: { pluginId, kind: "local" } }),
					{ exerciseId: exercise.id },
					{ pages: { equipment: { limit: 100 } } },
				),
			]);
			expect(graphAfterRejections).toEqual(graphBeforeRejections);
		}),
	);

	it.live("populates Free Exercise DB taxonomy and preserves user links", () =>
		Effect.gen(function* () {
			const provider = yield* attachFitnessTaxonomyProvider(fitnessProviders);
			const auth = yield* createAuthenticatedClient(target);
			const { client } = auth;
			const [
				{ pluginId, schema: exerciseSchema },
				{ schema: targetSchema },
				{ schema: equipmentSchema },
				targetRelationshipSchema,
				equipmentRelationshipSchema,
			] = yield* Effect.all([
				findFitnessEntitySchema(client, "exercise"),
				findFitnessEntitySchema(client, "exercise-target"),
				findFitnessEntitySchema(client, "exercise-equipment"),
				findFitnessRelationshipSchema(client, "exercise-targets"),
				findFitnessRelationshipSchema(client, "exercise-uses-equipment"),
			]);
			const seeded = yield* getApiClient(target).adminCall((c) =>
				c.testSupport.createGlobalEntity({
					payload: {
						populatedAt: null,
						name: provider.exerciseName,
						providerId: provider.providerId,
						externalId: provider.exerciseName,
						entitySchema: exerciseSchema.reference,
						properties: { images: [], kind: "reps", instructions: [] },
					},
				}),
			);
			const root = yield* getEntity(client, seeded.id);
			expect(root.id).toBe(seeded.id);
			expect(root.populatedAt).toBeNull();

			const suffix = yield* randomUuid;
			const privateTargetName = `Private provider target ${suffix}`;
			const privateEquipmentName = `Private provider equipment ${suffix}`;
			const privateTarget = yield* createEntity(client, {
				name: privateTargetName,
				properties: { kind: "region" },
				entitySchema: targetSchema.reference,
			});
			const privateEquipment = yield* createEntity(client, {
				properties: {},
				name: privateEquipmentName,
				entitySchema: equipmentSchema.reference,
			});
			yield* createRelationship(client, {
				sourceEntityId: root.id,
				targetEntityId: privateTarget.id,
				properties: { role: "stabilizer" },
				relationshipSchema: targetRelationshipSchema.reference,
			});
			yield* createRelationship(client, {
				sourceEntityId: root.id,
				targetEntityId: privateEquipment.id,
				relationshipSchema: equipmentRelationshipSchema.reference,
			});

			const stream = yield* openLiveUpdatesScoped(auth);
			yield* stream.populate([root.id], "interactive");
			expect(
				yield* stream.waitForEntityUpdated(root.id, "populated", { timeoutMs: 90_000 }),
			).toMatchObject({ entityId: root.id, reason: "populated" });

			const populated = yield* pollUntil(
				"fitness taxonomy population completed",
				getEntity(client, root.id).pipe(
					Effect.map((entity) =>
						entity.relatedPopulationStatus.state === "succeeded" &&
						entity.relatedPopulationStatus.availability === "complete"
							? entity
							: null,
					),
				),
			);
			expect(populated.id).toBe(root.id);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.properties).toMatchObject({
				force: "push",
				level: "beginner",
				mechanic: "compound",
				kind: "reps_and_weight",
				instructions: ["Press the bar with control."],
			});
			expect(populated.properties.images).toEqual([
				{ type: "remote", url: stringContaining("e2e-taxonomy.jpg") },
			]);

			const ownerTargets = yield* executeRyotQLRecipe(
				client,
				exerciseTargetsRecipe({ reference: { pluginId, kind: "local" } }),
				{ exerciseId: root.id },
				{ pages: { targets: { limit: 100 } } },
			);
			const chest = requirePresent(
				ownerTargets.items.find(({ name }) => name === "Chest"),
				"Expected population to create the shared Chest target",
			);
			const triceps = requirePresent(
				ownerTargets.items.find(({ name }) => name === "Triceps"),
				"Expected population to create the shared Triceps target",
			);
			const retainedTarget = requirePresent(
				ownerTargets.items.find(({ name }) => name === privateTargetName),
				"Expected population to retain the private target link",
			);
			expect(chest).toMatchObject({ userId: null, role: "primary", kind: "muscle_region" });
			expect(triceps).toMatchObject({ userId: null, role: "secondary", kind: "muscle_region" });
			expect(retainedTarget).toMatchObject({ role: "stabilizer", userId: auth.userId });
			yield* createRelationship(client, {
				sourceEntityId: root.id,
				targetEntityId: chest.id,
				properties: { role: "secondary" },
				relationshipSchema: targetRelationshipSchema.reference,
			});
			expect(
				(yield* executeRyotQLRecipe(
					client,
					exerciseTargetsRecipe({ reference: { pluginId, kind: "local" } }),
					{ exerciseId: root.id },
					{ pages: { targets: { limit: 100 } } },
				)).items.filter(({ id }) => id === chest.id),
			).toEqual([chest]);

			const ownerEquipment = yield* executeRyotQLRecipe(
				client,
				exerciseEquipmentRecipe({ reference: { pluginId, kind: "local" } }),
				{ exerciseId: root.id },
				{ pages: { equipment: { limit: 100 } } },
			);
			const barbell = requirePresent(
				ownerEquipment.items.find(({ name }) => name === "Barbell"),
				"Expected population to create the shared Barbell equipment",
			);
			const retainedEquipment = requirePresent(
				ownerEquipment.items.find(({ name }) => name === privateEquipmentName),
				"Expected population to retain the private equipment link",
			);
			expect(barbell.userId).toBeNull();
			expect(retainedEquipment.userId).toBe(auth.userId);

			const otherUser = yield* createAuthenticatedClient(target);
			const otherUserTargets = yield* executeRyotQLRecipe(
				otherUser.client,
				exerciseTargetsRecipe({ reference: { pluginId, kind: "local" } }),
				{ exerciseId: root.id },
				{ pages: { targets: { limit: 100 } } },
			);
			const otherUserEquipment = yield* executeRyotQLRecipe(
				otherUser.client,
				exerciseEquipmentRecipe({ reference: { pluginId, kind: "local" } }),
				{ exerciseId: root.id },
				{ pages: { equipment: { limit: 100 } } },
			);
			expect(otherUserTargets.items.map(({ name }) => name)).toEqual<unknown>(
				arrayContaining(["Chest", "Triceps"]),
			);
			expect(otherUserTargets.items.map(({ name }) => name)).not.toContain(privateTargetName);
			expect(otherUserEquipment.items.map(({ name }) => name)).toContain("Barbell");
			expect(otherUserEquipment.items.map(({ name }) => name)).not.toContain(privateEquipmentName);

			const reimport = yield* enqueueProviderEntityImport(client, {
				providerId: provider.providerId,
				externalId: provider.exerciseName,
			});
			const reimported = yield* pollProviderEntityImportResult(client, reimport.jobId);
			assertCompleted(reimported, "Free Exercise DB repeat import");
			expect(reimported.data.id).toBe(root.id);
			expect((yield* getEntity(client, root.id)).properties.kind).toBe("reps_and_weight");

			const reimportedTargets = yield* executeRyotQLRecipe(
				client,
				exerciseTargetsRecipe({ reference: { pluginId, kind: "local" } }),
				{ exerciseId: root.id },
				{ pages: { targets: { limit: 100 } } },
			);
			const reimportedEquipment = yield* executeRyotQLRecipe(
				client,
				exerciseEquipmentRecipe({ reference: { pluginId, kind: "local" } }),
				{ exerciseId: root.id },
				{ pages: { equipment: { limit: 100 } } },
			);
			expect(reimportedTargets).toEqual(ownerTargets);
			expect(reimportedEquipment).toEqual(ownerEquipment);
		}),
	);
});
