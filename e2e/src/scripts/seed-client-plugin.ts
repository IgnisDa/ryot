/* oxlint-disable */
// TODO: delete this file eventually

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { createTestUser } from "../fixtures/kernel/auth";
import {
	buildCollectionWorkflowRendererDefinition,
	createClientRenderer,
	createRendererSavedView,
	publishClientRenderer,
} from "../fixtures/kernel/client-pages";
import {
	installFixtureClientPlugin,
	updateFixtureClientPlugin,
} from "../fixtures/kernel/client-plugin";
import { createCollection } from "../fixtures/kernel/collections";
import { type ContractSession, makeSession } from "../fixtures/kernel/contract-client";
import { findBuiltinPluginBySlug, setPluginHomeView } from "../fixtures/kernel/plugins";
import { createWorkoutEntityFixture } from "../fixtures/plugins/fitness";
import { createPokemonEntityFixture } from "../fixtures/plugins/fixture";
import { seedGlobalShowEpisodeTree } from "../fixtures/plugins/media";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000/api";
const APP_BASE_URL = process.env.APP_BASE_URL ?? new URL(API_BASE_URL).origin;
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

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
	const { token, email, password } = await Effect.runPromise(createTestUser(API_BASE_URL));
	const client: ContractSession = makeSession(API_BASE_URL, { Authorization: `Bearer ${token}` });
	const installation = await Effect.runPromise(
		installFixtureClientPlugin(client, "A", "", API_BASE_URL),
	);

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
	await Effect.runPromise(publishClientRenderer(client, renderer.id, renderer.draftRevision));
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

	console.log(`Email: ${email}`);
	console.log(`Password: ${password}`);
	console.log(`Plugin URL: ${APP_BASE_URL}/fixture`);
	console.log(`Home URL: ${APP_BASE_URL}/media`);
	console.log(`Primary URL: ${APP_BASE_URL}/v/${primaryView.slug}`);
	console.log(`Secondary URL: ${APP_BASE_URL}/v/${secondaryView.slug}`);
	console.log(`Outside Pokemon: ${pokemonB.name}`);

	const input = createInterface({ input: process.stdin, output: process.stdout });
	try {
		await input.question("Press Enter to update the fixture plugin to revision B...");
	} finally {
		input.close();
	}

	const updatedInstallation = await Effect.runPromise(
		updateFixtureClientPlugin(client, "B", "", API_BASE_URL),
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
