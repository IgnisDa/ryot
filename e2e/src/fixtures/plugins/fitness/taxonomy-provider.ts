import { Effect, FileSystem, Path } from "effect";

import { listAdminSandboxScripts } from "~/fixtures/kernel/admin-sandbox-scripts";
import { installTestPluginBundle } from "~/fixtures/kernel/test-plugin";
import { requirePresent } from "~/support/assertions";

const detailsSource = (input: { exerciseName: string; slug: string }) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { getExerciseDetails } from "../free-exercise-db/shared";

export const manifest = defineManifest({
  kind: "provider",
  capabilities: [],
  name: "E2E Free Exercise DB details",
  slug: ${JSON.stringify(input.slug)},
});

const exerciseData = ${JSON.stringify([
	{
		force: "push",
		level: "beginner",
		category: "strength",
		equipment: "barbell",
		mechanic: "compound",
		name: input.exerciseName,
		primaryMuscles: ["chest"],
		images: ["e2e-taxonomy.jpg"],
		secondaryMuscles: ["triceps"],
		instructions: ["Press the bar with control."],
	},
])};
const host = {
  httpCall: () => Effect.succeed({
    status: 200,
    headers: {},
    body: JSON.stringify(exerciseData),
  }),
  getCachedValue: () => Effect.succeed(null),
  setCachedValue: () => Effect.succeed(null),
};

export default defineProvider({
  manifest,
  operation: "details",
  run: (input, _host, execution) => getExerciseDetails(input, host, execution),
});
`;

export const installFitnessTaxonomyProviderFixture = Effect.gen(function* () {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const fitnessRoot = yield* path.fromFileUrl(
		new URL("../../../../../plugins/fitness/", import.meta.url),
	);
	const [sharedSource, exerciseKindsSource, taxonomySource] = yield* Effect.all([
		fs.readFileString(
			path.join(fitnessRoot, "backend/providers/exercise/free-exercise-db/shared.ts"),
		),
		fs.readFileString(path.join(fitnessRoot, "shared/exercise-kinds.ts")),
		fs.readFileString(path.join(fitnessRoot, "shared/taxonomy.ts")),
	]);
	const suffix = crypto.randomUUID();
	const exerciseName = `E2E Taxonomy Exercise ${suffix}`;
	const pluginSlug = `e2e-fitness-taxonomy-${suffix}`;
	const providerSlug = `exercise.e2e-free-exercise-db-${suffix}`;
	const detailsScriptSlug = `${providerSlug}.details`;
	const detailsScriptIdPath = `backend/providers/exercise/e2e-free-exercise-db-${suffix}/details.sandbox.ts`;
	const installed = yield* installTestPluginBundle({
		pluginSlug,
		scope: "system",
		providers: [
			{
				slug: providerSlug,
				name: "E2E Free Exercise DB",
				information: { source: "e2e" },
				rootEntitySchemaSlug: "exercise",
				operations: { details: detailsScriptSlug },
			},
		],
		scripts: [
			{
				providerSlug,
				capabilities: [],
				kind: "provider",
				slug: detailsScriptSlug,
				entry: detailsScriptIdPath,
				providerOperation: "details",
				requiredPluginConfigKeys: [],
				name: "E2E Free Exercise DB details",
			},
		],
		files: {
			"shared/taxonomy.ts": taxonomySource,
			"shared/exercise-kinds.ts": exerciseKindsSource,
			"backend/providers/exercise/free-exercise-db/shared.ts": sharedSource,
			[detailsScriptIdPath]: detailsSource({ exerciseName, slug: detailsScriptSlug }),
		},
	});
	const detailsScriptId = requirePresent(
		installed.scriptIds[detailsScriptSlug],
		"Installed taxonomy provider details script was not returned",
	);
	const detailsScript = requirePresent(
		(yield* listAdminSandboxScripts(installed.activePluginRevisionId)).find(
			(script) => script.id === detailsScriptId,
		),
		"Installed taxonomy provider details script was not found",
	);
	const providerId = requirePresent(
		detailsScript.providerId,
		"Installed taxonomy provider ID was not returned by test support",
	);

	return { installed, providerId, exerciseName };
});
