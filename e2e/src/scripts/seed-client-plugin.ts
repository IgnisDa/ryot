/* oxlint-disable */
// TODO: delete this file eventually

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { mediaPlugin } from "@ryot-app/media-plugin";
import dotenv from "dotenv";

import { runPromise } from "~/support/e2e-runtime";
import { getFrontendUrl } from "~/support/harness-target";

import { createAuthenticatedClient } from "../fixtures/kernel/auth";
import {
	installFixtureClientPlugin,
	updateFixtureClientPlugin,
} from "../fixtures/kernel/client-plugin";
import { createPluginSavedView } from "../fixtures/kernel/pages";
import {
	findBuiltinPluginByPackage,
	findPluginInstallationById,
	setPluginHomeView,
} from "../fixtures/kernel/plugins";
import { findSavedViewById, savedViewRecordPath } from "../fixtures/kernel/saved-views";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

dotenv.config({ path: `${repositoryRoot}apps/server/.env`, quiet: true });

process.env.E2E_API_URL ??= `https://ryot-testing.ignisda.me/api`;
process.env.E2E_ADMIN_ACCESS_TOKEN ??= process.env.SERVER_ADMIN_ACCESS_TOKEN;
process.env.E2E_FRONTEND_URL ??= new URL(process.env.E2E_API_URL).origin;

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
	const { client, email, password } = await runPromise(createAuthenticatedClient());
	const installation = await runPromise(installFixtureClientPlugin(client, "A"));

	if (installation.health !== "ready") {
		throw new Error(
			`Fixture client plugin installation finished with health '${installation.health}'`,
		);
	}
	const primaryView = await runPromise(
		createPluginSavedView(
			client,
			{ kind: "plugin", pluginId: installation.pluginId, exportName: "fixture-home" },
			{},
			{ name: "Task 10 primary plugin page", workspaceInstallationId: installation.installationId },
		),
	);
	const secondaryView = await runPromise(
		createPluginSavedView(
			client,
			{ kind: "plugin", pluginId: installation.pluginId, exportName: "fixture-home" },
			{},
			{
				name: "Task 10 secondary plugin page",
				workspaceInstallationId: installation.installationId,
			},
		),
	);
	const media = await runPromise(
		findBuiltinPluginByPackage(client, {
			packageId: mediaPlugin.metadata.packageId,
			scope: "system",
		}),
	);
	const primaryViewRecord = await runPromise(findSavedViewById(client, primaryView.id));
	await runPromise(setPluginHomeView(client, media.installationId, primaryViewRecord.reference));

	const appBaseUrl = getFrontendUrl();

	console.log(`Email: ${email}`);
	console.log(`Password: ${password}`);
	console.log(`Plugin URL: ${appBaseUrl}${pluginPath(installation.packageId)}`);
	console.log(`Home URL: ${appBaseUrl}${pluginPath(media.packageId)}`);
	const primaryRecord = await runPromise(findSavedViewById(client, primaryView.id));
	const secondaryRecord = await runPromise(findSavedViewById(client, secondaryView.id));
	console.log(`Primary URL: ${appBaseUrl}${savedViewRecordPath(primaryRecord)}`);
	console.log(`Secondary URL: ${appBaseUrl}${savedViewRecordPath(secondaryRecord)}`);
	console.log("Saved-view renderer: fixture/fixture-home");

	const input = createInterface({ input: process.stdin, output: process.stdout });
	try {
		await input.question("Press Enter to update the fixture plugin to revision B...");
	} finally {
		input.close();
	}

	await runPromise(updateFixtureClientPlugin(client, "B"));
	const updatedInstallation = await runPromise(
		findPluginInstallationById(client, installation.installationId),
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
