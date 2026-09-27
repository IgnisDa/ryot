import type { ContractPathParams, ContractPayload } from "@ryot-app/contract/client";
import { pluginUserSettingsRecipe } from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { Effect } from "effect";

import type { Client } from "./auth";
import {
	installPrivatePluginPackage,
	privatePluginPackage,
	settledPrivateInstallation,
} from "./private-plugin";
import { collectRyotQLRecipeItems } from "./ryotql";

type PluginManifest = ContractPayload<"testSupport", "installSystemPlugin">["manifest"];
export type PreferencePluginUserSettingsSchema = NonNullable<PluginManifest["userSettingsSchema"]>;

type PrivatePluginFactoryInput = NonNullable<Parameters<typeof privatePluginPackage>[0]>;

export const preferencePluginUserSettingsSchema = {
	unknownKeys: "strict",
	fields: {
		enabled: {
			type: "boolean",
			defaultValue: false,
			label: "Enable reminders",
			description: "Enable reminders",
		},
		limit: {
			type: "integer",
			defaultValue: 5,
			label: "Reminder limit",
			description: "Maximum reminders",
			validation: { minimum: 0, maximum: 10 },
		},
	},
} satisfies PreferencePluginUserSettingsSchema;

const encoder = new TextEncoder();

const userSettingsOperationSource = (input: { readonly name: string; readonly slug: string }) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  capabilities: ["getUserSettings"],
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Record(Schema.String, jsonValueSchema),
  run: (_input, host) => host.getUserSettings(),
});
`;

export const preferencePrivatePluginPackage = (
	input: Pick<PrivatePluginFactoryInput, "pluginSlug"> = {},
) => {
	const pluginPackage = privatePluginPackage(input);
	const script = pluginPackage.manifest.scripts[0];
	if (script?.kind !== "operation") {
		throw new Error("Private plugin package has no operation script");
	}
	return {
		...pluginPackage,
		files: {
			...pluginPackage.files,
			[script.entry]: encoder.encode(userSettingsOperationSource(script)),
		},
		manifest: {
			...pluginPackage.manifest,
			userSettingsSchema: preferencePluginUserSettingsSchema,
			configSchema: { ...pluginPackage.manifest.configSchema, fields: {} },
			metadata: { ...pluginPackage.manifest.metadata, name: "Preference test plugin" },
			scripts: [
				{ ...script, requiredPluginConfigKeys: [], capabilities: ["getUserSettings"] as const },
			],
		},
	};
};

export const listPluginUserSettings = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => pluginUserSettingsRecipe({ after, limit: 100 }));

export const installPreferencePrivatePlugin = (input: {
	readonly client: Client;
	readonly baseUrl?: string;
	readonly pluginSlug?: PrivatePluginFactoryInput["pluginSlug"];
}) =>
	Effect.gen(function* () {
		const pluginPackage = preferencePrivatePluginPackage({ pluginSlug: input.pluginSlug });
		yield* installPrivatePluginPackage({
			config: {},
			pluginPackage,
			client: input.client,
			...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
		});
		const installation = yield* settledPrivateInstallation(input.client, pluginPackage.pluginSlug);
		const setting = yield* Effect.map(listPluginUserSettings(input.client), (settings) =>
			settings.find(({ name }) => name === "Preference test plugin"),
		);
		if (!setting) {
			throw new Error("Private plugin settings were not listed after installation");
		}
		return { setting, installation, pluginPackage };
	});

export const savePluginUserSettings = (
	client: Client,
	installationId: ContractPathParams<"plugins", "saveUserSettings">["installationId"],
	payload: ContractPayload<"plugins", "saveUserSettings">,
) =>
	client.call((contract) =>
		contract.plugins.saveUserSettings({ payload, params: { installationId } }),
	);

export const resetPluginUserSettings = (
	client: Client,
	installationId: ContractPathParams<"plugins", "resetUserSettings">["installationId"],
) => client.call((contract) => contract.plugins.resetUserSettings({ params: { installationId } }));
