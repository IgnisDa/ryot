import { fitnessPlugin } from "@ryot-app/fitness-plugin";
import type { ExerciseKind } from "@ryot-app/fitness-plugin/exercise-kinds";
import { Effect } from "effect";

import { listAdminSystemPlugins } from "~/fixtures/kernel/admin-system-plugins";
import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import { findPluginInstallationByPackage } from "~/fixtures/kernel/plugins";
import { requirePresent } from "~/support/assertions";
import { getSharedHarnessTarget } from "~/support/harness-target";

export const fitnessFixtureInstallation = (target = getSharedHarnessTarget()) =>
	listAdminSystemPlugins(target).pipe(
		Effect.map((plugins) =>
			requirePresent(
				plugins.find(({ packageId }) => packageId === fitnessPlugin.metadata.packageId),
				"System fitness fixture installation missing",
			),
		),
	);

export const findFitnessEntitySchema = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const installation = yield* findPluginInstallationByPackage(client, {
			scope: "system",
			packageId: fitnessPlugin.metadata.packageId,
		});
		const selected = yield* findBuiltinSchemaBySlug(client, slug, {
			kind: "plugin",
			pluginId: installation.pluginId,
		});
		return { ...selected, pluginId: installation.pluginId };
	});

export const createExerciseEntityFixture = (
	client: Client,
	options: { name?: string; level?: string; kind?: ExerciseKind } = {},
) =>
	Effect.gen(function* () {
		const { schema: exerciseSchema } = yield* findFitnessEntitySchema(client, "exercise");
		const exercise = yield* createEntity(client, {
			entitySchema: exerciseSchema.reference,
			name: options.name ?? `Exercise ${crypto.randomUUID()}`,
			properties: {
				level: options.level ?? "beginner",
				kind: options.kind ?? "reps_and_weight",
				images: [{ type: "remote", url: "https://example.com/exercise.jpg" }],
			},
		});

		return { exercise, exerciseId: exercise.id };
	});
