/* oxlint-disable */
// TODO: delete this file eventually

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";
import { getFrontendUrl } from "~/support/harness-target";

import { createAuthenticatedClient } from "../fixtures/kernel/auth";
import { createPluginSavedView, findPluginIdBySlug } from "../fixtures/kernel/client-pages";
import {
	FIXTURE_CLIENT_PLUGIN_SLUG,
	installFixtureClientPlugin,
	updateFixtureClientPlugin,
} from "../fixtures/kernel/client-plugin";
import {
	findBuiltinPluginBySlug,
	findPluginInstallationBySlug,
	setPluginHomeView,
} from "../fixtures/kernel/plugins";
import { findSavedViewById } from "../fixtures/kernel/saved-views";

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
	const pluginId = requirePresent(
		await Effect.runPromise(findPluginIdBySlug(client, FIXTURE_CLIENT_PLUGIN_SLUG)),
		"Installed fixture plugin was not found",
	);
	const primaryView = await Effect.runPromise(
		createPluginSavedView(
			client,
			{ kind: "plugin", pluginId, exportName: "fixture-home" },
			{},
			{ name: "Task 10 primary plugin page", workspacePluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG },
		),
	);
	const secondaryView = await Effect.runPromise(
		createPluginSavedView(
			client,
			{ kind: "plugin", pluginId, exportName: "fixture-home" },
			{},
			{ name: "Task 10 secondary plugin page", workspacePluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG },
		),
	);
	const media = await Effect.runPromise(findBuiltinPluginBySlug(client, "media"));
	const primaryViewRecord = await Effect.runPromise(findSavedViewById(client, primaryView.id));
	await Effect.runPromise(setPluginHomeView(client, media.slug, primaryViewRecord.slug));

	const appBaseUrl = getFrontendUrl();

	console.log(`Email: ${email}`);
	console.log(`Password: ${password}`);
	console.log(`Plugin URL: ${appBaseUrl}/fixture`);
	console.log(`Home URL: ${appBaseUrl}/media`);
	const primaryRecord = await Effect.runPromise(findSavedViewById(client, primaryView.id));
	const secondaryRecord = await Effect.runPromise(findSavedViewById(client, secondaryView.id));
	console.log(`Primary URL: ${appBaseUrl}/v/${primaryRecord.slug}`);
	console.log(`Secondary URL: ${appBaseUrl}/v/${secondaryRecord.slug}`);
	console.log("Saved-view renderer: fixture/fixture-home");

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
