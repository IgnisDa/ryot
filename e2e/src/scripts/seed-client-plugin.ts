/* oxlint-disable */
// TODO: delete this file eventually

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { managedAssetItemSchema } from "@ryot-app/contract/schema/core";
import { mediaPlugin } from "@ryot-app/media-plugin";
import dotenv from "dotenv";

import { runPromise } from "~/support/e2e-runtime";
import { getFrontendUrl } from "~/support/harness-target";

import { createAuthenticatedClient } from "../fixtures/kernel/auth";
import {
	installFixtureClientPlugin,
	updateFixtureClientPlugin,
} from "../fixtures/kernel/client-plugin";
import { createPluginSchema } from "../fixtures/kernel/entity-schemas";
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
	const allFieldsSchema = await runPromise(
		createPluginSchema(client, {
			slug: "all-field-controls",
			name: "All field controls",
			icon: "list",
			propertiesSchema: {
				fields: {
					text: { label: "Text", description: "Enter a text value.", type: "string", position: 0 },
					secretText: {
						label: "Secret text",
						description: "Enter a private text value.",
						type: "string",
						secret: true,
						position: 1,
					},
					website: {
						label: "Website",
						description: "Enter a website URL.",
						type: "string",
						format: { kind: "url" },
						position: 2,
					},
					email: {
						label: "Email",
						description: "Enter an email address.",
						type: "string",
						format: { kind: "email" },
						position: 3,
					},
					timezone: {
						label: "Timezone",
						description: "Choose a timezone.",
						type: "string",
						format: { kind: "timezone" },
						position: 4,
					},
					decimal: {
						label: "Decimal",
						description: "Enter a decimal number.",
						type: "number",
						position: 5,
					},
					integer: {
						label: "Integer",
						description: "Enter a whole number.",
						type: "integer",
						position: 6,
					},
					enabled: {
						label: "Enabled",
						description: "Turn this option on or off.",
						type: "boolean",
						position: 7,
					},
					date: {
						label: "Date",
						description: "Choose a calendar date.",
						type: "date",
						position: 8,
					},
					datetime: {
						label: "Date and time",
						description: "Choose a date and time.",
						type: "datetime",
						position: 9,
					},
					choice: {
						label: "Choice",
						description: "Choose one option.",
						type: "enum",
						choices: {
							kind: "static",
							values: [
								{ value: "first", label: "First option" },
								{ value: "second", label: "Second option" },
							],
						},
						position: 10,
					},
					choices: {
						label: "Choices",
						description: "Choose one or more options.",
						type: "enum-array",
						choices: {
							kind: "static",
							values: [
								{ value: "first", label: "First option" },
								{ value: "second", label: "Second option" },
							],
						},
						position: 11,
					},
					tags: {
						label: "Tags",
						description: "Add a list of text tags.",
						type: "array",
						items: { label: "Tag", description: "A text list item", type: "string" },
						position: 12,
					},
					details: {
						label: "Details",
						description: "Enter structured details.",
						type: "object",
						properties: {
							note: { label: "Note", description: "Enter a detail note.", type: "string" },
							quantity: {
								label: "Quantity",
								description: "Enter a whole-number quantity.",
								type: "integer",
							},
						},
						position: 13,
					},
					entries: {
						label: "Entries",
						description: "Add a list of structured entries.",
						type: "array",
						items: {
							label: "Entry",
							description: "A structured list item.",
							type: "object",
							properties: {
								label: { label: "Label", description: "Enter an entry label.", type: "string" },
								checked: {
									label: "Checked",
									description: "Mark this entry as checked or unchecked.",
									type: "boolean",
								},
							},
						},
						position: 14,
					},
					chipChoice: {
						label: "Chip choice",
						description: "Choose one option from a chip group.",
						type: "enum",
						choices: {
							kind: "static",
							values: [
								{ value: "north", label: "North" },
								{ value: "south", label: "South" },
								{ value: "east", label: "East" },
								{ value: "west", label: "West" },
							],
						},
						position: 15,
					},
					asset: {
						...managedAssetItemSchema,
						label: "Asset",
						description: "Upload a single image or video.",
						position: 16,
					},
					assets: {
						label: "Assets",
						description: "Upload and reorder images or videos.",
						type: "array",
						items: managedAssetItemSchema,
						position: 17,
					},
				},
			},
		}),
	);
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
	console.log(`Entity schema: ${allFieldsSchema.data.name} (${allFieldsSchema.slug})`);
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
