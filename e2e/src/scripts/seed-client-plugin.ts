/* oxlint-disable */
// TODO: delete this file eventually

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Effect, Option } from "effect";

import { getFrontendUrl } from "~/support/harness-target";

import { createAuthenticatedClient } from "../fixtures/kernel/auth";
import {
	buildCollectionWorkflowRendererDefinition,
	createClientRenderer,
	createRendererSavedView,
	getClientRenderer,
	publishClientRenderer,
} from "../fixtures/kernel/client-pages";
import {
	installFixtureClientPlugin,
	updateFixtureClientPlugin,
} from "../fixtures/kernel/client-plugin";
import { createCollection } from "../fixtures/kernel/collections";
import {
	findBuiltinPluginBySlug,
	findPluginInstallationBySlug,
	setPluginHomeView,
} from "../fixtures/kernel/plugins";
import { findSavedViewById } from "../fixtures/kernel/saved-views";
import { createWorkoutEntityFixture } from "../fixtures/plugins/fitness";
import { createPokemonEntityFixture } from "../fixtures/plugins/fixture";
import { seedGlobalShowEpisodeTree } from "../fixtures/plugins/media";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

dotenv.config({ path: `${repositoryRoot}apps/server/.env`, quiet: true });

process.env.E2E_API_URL ??= `http://localhost:${process.env.PORT ?? 3000}/api`;
process.env.E2E_FRONTEND_URL ??= new URL(process.env.E2E_API_URL).origin;
process.env.E2E_ADMIN_ACCESS_TOKEN ??= process.env.SERVER_ADMIN_ACCESS_TOKEN;

async function buildFixturePlugin() {
	const build = Bun.spawn(["bun", "turbo", "--filter=@ryot-app/fixture-plugin", "build"], {
		stderr: "inherit",
		stdout: "inherit",
		cwd: repositoryRoot,
	});
	const exitCode = await build.exited;
	if (exitCode !== 0) {
		throw new Error(`Fixture plugin build failed with exit code ${exitCode}`);
	}
}

async function main() {
	await buildFixturePlugin();
	const { client, email, password } = await Effect.runPromise(createAuthenticatedClient());
	const installation = await Effect.runPromise(installFixtureClientPlugin(client, "A"));

	if (installation.health !== "ready") {
		throw new Error(
			`Fixture client plugin installation finished with health '${installation.health}'`,
		);
	}
	const { showId } = await Effect.runPromise(
		seedGlobalShowEpisodeTree(client, { showName: "01 Task 10 Show" }),
	);
	const { workoutId } = await Effect.runPromise(
		createWorkoutEntityFixture(client, { name: "02 Task 10 Workout" }),
	);
	const [pokemonA, pokemonB] = await Effect.runPromise(
		Effect.all([
			createPokemonEntityFixture(client, { name: "03 Task 10 Pokemon A", types: ["Grass"] }),
			createPokemonEntityFixture(client, { name: "04 Task 10 Pokemon B", types: ["Fire"] }),
		]),
	);
	const collection = await Effect.runPromise(
		createCollection(client, { name: "Task 10 collection" }),
	);
	await Effect.runPromise(
		Effect.forEach([showId, workoutId, pokemonA.id], (entityId) =>
			client.call((contract) =>
				contract.collections.createMembership({
					payload: { entityId, collectionId: collection.id },
				}),
			),
		),
	);
	const renderer = await Effect.runPromise(
		createClientRenderer(client, { draftDefinition: buildCollectionWorkflowRendererDefinition() }),
	);
	const rendererRecord = Option.getOrThrow(
		await Effect.runPromise(getClientRenderer(client, renderer.id)),
	);
	await Effect.runPromise(publishClientRenderer(client, renderer.id, rendererRecord.draftRevision));
	const primaryView = await Effect.runPromise(
		createRendererSavedView(
			client,
			renderer.id,
			{ collectionId: collection.id, pageSize: 2 },
			{ name: "Task 10 primary dashboard" },
		),
	);
	const secondaryView = await Effect.runPromise(
		createRendererSavedView(
			client,
			renderer.id,
			{ collectionId: collection.id, pageSize: 3 },
			{ name: "Task 10 secondary dashboard" },
		),
	);
	const media = await Effect.runPromise(findBuiltinPluginBySlug(client, "media"));
	await Effect.runPromise(setPluginHomeView(client, media.slug, primaryView.id));

	const appBaseUrl = getFrontendUrl();

	console.log(`Email: ${email}`);
	console.log(`Password: ${password}`);
	console.log(`Plugin URL: ${appBaseUrl}/fixture`);
	console.log(`Home URL: ${appBaseUrl}/media`);
	const primaryRecord = await Effect.runPromise(findSavedViewById(client, primaryView.id));
	const secondaryRecord = await Effect.runPromise(findSavedViewById(client, secondaryView.id));
	console.log(`Primary URL: ${appBaseUrl}/v/${primaryRecord.slug}`);
	console.log(`Secondary URL: ${appBaseUrl}/v/${secondaryRecord.slug}`);
	console.log(`Outside Pokemon: ${pokemonB.name}`);

	const input = createInterface({ input: process.stdin, output: process.stdout });
	try {
		await input.question("Press Enter to update the fixture plugin to revision B...");
	} finally {
		input.close();
	}

	await Effect.runPromise(updateFixtureClientPlugin(client, "B"));
	const updatedInstallation = await Effect.runPromise(
		findPluginInstallationBySlug(client, "fixture"),
	);
	if (updatedInstallation.health !== "ready") {
		throw new Error(
			`Fixture client plugin update finished with health '${updatedInstallation.health}'`,
		);
	}

	console.log("Updated fixture plugin to revision B.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
