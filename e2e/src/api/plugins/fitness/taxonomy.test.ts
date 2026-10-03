import { exerciseListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import {
	equipmentListRecipe,
	exerciseEquipmentRecipe,
	exerciseTargetsRecipe,
	targetListRecipe,
} from "@ryot-app/fitness-plugin/taxonomy-recipes";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	enqueueProviderEntityImport,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	getApiClient,
	getEntity,
	openInterestWebSocketScoped,
	pollProviderEntityImportResult,
} from "~/fixtures/kernel";
import { uninstallTestPlugin } from "~/fixtures/kernel/test-plugin";
import {
	findBuiltinRelationshipSchemaSlug,
	installFitnessTaxonomyProviderFixture,
} from "~/fixtures/plugins/fitness";
import { assertCompleted, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Fitness taxonomy E2E", () => {
	it.live("keeps private taxonomy ownership and validates exercise links", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const otherUser = yield* createAuthenticatedClient();
			const [
				{ schema: exerciseSchema },
				{ schema: targetSchema },
				{ schema: equipmentSchema },
				targetRelationshipSchemaSlug,
				equipmentRelationshipSchemaSlug,
			] = yield* Effect.all([
				findBuiltinSchemaBySlug(owner.client, "exercise"),
				findBuiltinSchemaBySlug(owner.client, "exercise-target"),
				findBuiltinSchemaBySlug(owner.client, "exercise-equipment"),
				findBuiltinRelationshipSchemaSlug(owner.client, "exercise-targets"),
				findBuiltinRelationshipSchemaSlug(owner.client, "exercise-uses-equipment"),
			]);
			const suffix = crypto.randomUUID();
			const exercise = yield* createEntity(owner.client, {
				entitySchemaSlug: exerciseSchema.id,
				properties: { kind: "reps_and_weight" },
				name: `Private Taxonomy Exercise ${suffix}`,
			});
			const pelvicFloor = yield* createEntity(owner.client, {
				name: "Pelvic floor",
				entitySchemaSlug: targetSchema.id,
				properties: { kind: "muscle_region" },
			});
			const plantarFascia = yield* createEntity(owner.client, {
				name: "Plantar fascia",
				properties: { kind: "fascia" },
				entitySchemaSlug: targetSchema.id,
			});
			const anchoredBands = yield* createEntity(owner.client, {
				properties: {},
				name: "Bands with door anchor",
				entitySchemaSlug: equipmentSchema.id,
			});
			const workoutMat = yield* createEntity(owner.client, {
				properties: {},
				name: `Workout mat ${suffix}`,
				entitySchemaSlug: equipmentSchema.id,
			});
			const foreignTarget = yield* createEntity(otherUser.client, {
				properties: { kind: "region" },
				entitySchemaSlug: targetSchema.id,
				name: `Other user's private target ${suffix}`,
			});

			const firstTargetLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: pelvicFloor.id,
				properties: { role: "stabilizer" },
				relationshipSchemaSlug: targetRelationshipSchemaSlug,
			});
			const secondTargetLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: plantarFascia.id,
				relationshipSchemaSlug: targetRelationshipSchemaSlug,
			});
			const firstEquipmentLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: anchoredBands.id,
				relationshipSchemaSlug: equipmentRelationshipSchemaSlug,
			});
			const secondEquipmentLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: workoutMat.id,
				relationshipSchemaSlug: equipmentRelationshipSchemaSlug,
			});
			const duplicateTargetLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: pelvicFloor.id,
				properties: { role: "stabilizer" },
				relationshipSchemaSlug: targetRelationshipSchemaSlug,
			});
			const duplicateEquipmentLink = yield* createRelationship(owner.client, {
				sourceEntityId: exercise.id,
				targetEntityId: anchoredBands.id,
				relationshipSchemaSlug: equipmentRelationshipSchemaSlug,
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
				executeRyotQLRecipe(owner.client, targetListRecipe({ limit: 1, name: "Pelvic floor" })),
				executeRyotQLRecipe(owner.client, targetListRecipe({ limit: 1, name: "Plantar fascia" })),
				executeRyotQLRecipe(
					owner.client,
					equipmentListRecipe({ limit: 1, name: "Bands with door anchor" }),
				),
				executeRyotQLRecipe(
					owner.client,
					equipmentListRecipe({ limit: 1, name: `Workout mat ${suffix}` }),
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
						targetListRecipe({ limit: 1, name: "Pelvic floor" }),
					),
					executeRyotQLRecipe(
						otherUser.client,
						targetListRecipe({ limit: 1, name: "Plantar fascia" }),
					),
					executeRyotQLRecipe(
						otherUser.client,
						equipmentListRecipe({ limit: 1, name: "Bands with door anchor" }),
					),
					executeRyotQLRecipe(
						otherUser.client,
						equipmentListRecipe({ limit: 1, name: `Workout mat ${suffix}` }),
					),
				]);
			expect(otherUserTargets.items).toEqual([]);
			expect(otherUserFascia.items).toEqual([]);
			expect(otherUserEquipment.items).toEqual([]);
			expect(otherUserMat.items).toEqual([]);

			const graphBeforeRejections = yield* Effect.all([
				executeRyotQLRecipe(
					owner.client,
					exerciseTargetsRecipe({ limit: 100, exerciseId: exercise.id }),
				),
				executeRyotQLRecipe(
					owner.client,
					exerciseEquipmentRecipe({ limit: 100, exerciseId: exercise.id }),
				),
			]);
			expect(graphBeforeRejections.map(({ items }) => items.length)).toEqual([2, 2]);
			const listedExercise = requirePresent(
				(yield* executeRyotQLRecipe(
					owner.client,
					exerciseListRecipe({ limit: 1, entityId: exercise.id }),
				)).items[0],
				"Expected the exercise with its equipment links",
			);
			expect(listedExercise.equipment).toHaveLength(2);
			expect(listedExercise.equipment.map(({ id }) => id)).toEqual(
				expect.arrayContaining([anchoredBands.id, workoutMat.id]),
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
							relationshipSchemaSlug: targetRelationshipSchemaSlug,
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
							relationshipSchemaSlug: targetRelationshipSchemaSlug,
						},
					}),
				),
			);
			assertTaggedError(invalidRoleError, "RelationshipBadRequest");
			expect(invalidRoleError.reason).toMatchObject({ code: "invalid-properties" });

			const graphAfterRejections = yield* Effect.all([
				executeRyotQLRecipe(
					owner.client,
					exerciseTargetsRecipe({ limit: 100, exerciseId: exercise.id }),
				),
				executeRyotQLRecipe(
					owner.client,
					exerciseEquipmentRecipe({ limit: 100, exerciseId: exercise.id }),
				),
			]);
			expect(graphAfterRejections).toEqual(graphBeforeRejections);
		}),
	);

	it.live("populates Free Exercise DB taxonomy and preserves user links", () =>
		Effect.gen(function* () {
			const provider = yield* installFitnessTaxonomyProviderFixture;
			yield* Effect.addFinalizer(() => uninstallTestPlugin(provider.installed));
			const auth = yield* createAuthenticatedClient();
			const { client } = auth;
			const [
				{ schema: exerciseSchema },
				{ schema: targetSchema },
				{ schema: equipmentSchema },
				targetRelationshipSchemaSlug,
				equipmentRelationshipSchemaSlug,
			] = yield* Effect.all([
				findBuiltinSchemaBySlug(client, "exercise"),
				findBuiltinSchemaBySlug(client, "exercise-target"),
				findBuiltinSchemaBySlug(client, "exercise-equipment"),
				findBuiltinRelationshipSchemaSlug(client, "exercise-targets"),
				findBuiltinRelationshipSchemaSlug(client, "exercise-uses-equipment"),
			]);
			const seeded = yield* getApiClient().call(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							populatedAt: null,
							name: provider.exerciseName,
							providerId: provider.providerId,
							externalId: provider.exerciseName,
							entitySchemaSlug: exerciseSchema.id,
							properties: { images: [], kind: "reps", instructions: [] },
						},
					}),
				adminHeaders(),
			);
			const root = yield* getEntity(client, seeded.id);
			expect(root.id).toBe(seeded.id);
			expect(root.populatedAt).toBeNull();

			const suffix = crypto.randomUUID();
			const privateTargetName = `Private provider target ${suffix}`;
			const privateEquipmentName = `Private provider equipment ${suffix}`;
			const privateTarget = yield* createEntity(client, {
				name: privateTargetName,
				properties: { kind: "region" },
				entitySchemaSlug: targetSchema.id,
			});
			const privateEquipment = yield* createEntity(client, {
				properties: {},
				name: privateEquipmentName,
				entitySchemaSlug: equipmentSchema.id,
			});
			yield* createRelationship(client, {
				sourceEntityId: root.id,
				targetEntityId: privateTarget.id,
				properties: { role: "stabilizer" },
				relationshipSchemaSlug: targetRelationshipSchemaSlug,
			});
			yield* createRelationship(client, {
				sourceEntityId: root.id,
				targetEntityId: privateEquipment.id,
				relationshipSchemaSlug: equipmentRelationshipSchemaSlug,
			});

			const socket = yield* openInterestWebSocketScoped(auth);
			expect(yield* socket.replaceInterest([root.id])).toMatchObject({ type: "applied" });
			expect(
				yield* socket.waitForEntityUpdated(root.id, "populated", { timeoutMs: 90_000 }),
			).toMatchObject({ entityId: root.id, reason: "populated" });

			const populated = yield* getEntity(client, root.id);
			expect(populated.id).toBe(root.id);
			expect(populated.populatedAt).not.toBeNull();
			expect(populated.properties).toMatchObject({
				kind: "reps",
				force: "push",
				level: "beginner",
				mechanic: "compound",
				instructions: ["Press the bar with control."],
			});
			expect(populated.properties.images).toEqual([
				{ type: "remote", url: expect.stringContaining("e2e-taxonomy.jpg") },
			]);

			const ownerTargets = yield* executeRyotQLRecipe(
				client,
				exerciseTargetsRecipe({ limit: 100, exerciseId: root.id }),
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
				relationshipSchemaSlug: targetRelationshipSchemaSlug,
			});
			expect(
				(yield* executeRyotQLRecipe(
					client,
					exerciseTargetsRecipe({ limit: 100, exerciseId: root.id }),
				)).items.filter(({ id }) => id === chest.id),
			).toEqual([chest]);

			const ownerEquipment = yield* executeRyotQLRecipe(
				client,
				exerciseEquipmentRecipe({ limit: 100, exerciseId: root.id }),
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

			const otherUser = yield* createAuthenticatedClient();
			const otherUserTargets = yield* executeRyotQLRecipe(
				otherUser.client,
				exerciseTargetsRecipe({ limit: 100, exerciseId: root.id }),
			);
			const otherUserEquipment = yield* executeRyotQLRecipe(
				otherUser.client,
				exerciseEquipmentRecipe({ limit: 100, exerciseId: root.id }),
			);
			expect(otherUserTargets.items.map(({ name }) => name)).toEqual(
				expect.arrayContaining(["Chest", "Triceps"]),
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
			expect((yield* getEntity(client, root.id)).properties.kind).toBe("reps");

			const reimportedTargets = yield* executeRyotQLRecipe(
				client,
				exerciseTargetsRecipe({ limit: 100, exerciseId: root.id }),
			);
			const reimportedEquipment = yield* executeRyotQLRecipe(
				client,
				exerciseEquipmentRecipe({ limit: 100, exerciseId: root.id }),
			);
			expect(reimportedTargets).toEqual(ownerTargets);
			expect(reimportedEquipment).toEqual(ownerEquipment);
		}),
	);
});
