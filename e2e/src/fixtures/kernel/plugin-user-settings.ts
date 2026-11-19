import type { ContractPathParams, ContractPayload } from "@ryot-app/contract/client";
import { pluginUserSettingsRecipe } from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { Effect } from "effect";

import type { Client } from "./auth";
import { manifestText } from "./manifest-text";
import {
	installPrivatePluginPackage,
	privatePluginPackage,
	settledPrivateInstallation,
} from "./private-plugin";
import { collectRyotQLRecipeItems } from "./ryotql";

export type PreferencePluginUserSettingsSchema = NonNullable<PluginManifest["userSettingsSchema"]>;
type PluginManifest = ContractPayload<"testSupport", "installSystemPlugin">["manifest"];

type PrivatePluginFactoryInput = NonNullable<Parameters<typeof privatePluginPackage>[0]>;

export const preferencePluginUserSettingsSchema = {
	unknownKeys: "strict",
	fields: {
		enabled: {
			type: "boolean",
			defaultValue: false,
			description: "Enable reminders",
			label: manifestText("Enable reminders"),
		},
		limit: {
			type: "integer",
			defaultValue: 5,
			description: "Maximum reminders",
			label: manifestText("Reminder limit"),
			validation: { minimum: 0, maximum: 10 },
		},
	},
} satisfies PreferencePluginUserSettingsSchema;

const encoder = new TextEncoder();

const userSettingsOperationSource = (input: { readonly name: string; readonly slug: string }) => `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "operation",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ patch: Schema.optional(Schema.Record(Schema.String, jsonValueSchema)) }),
  output: Schema.Record(Schema.String, jsonValueSchema),
  run: (input, host) =>
    host.getUserSettings().pipe(
      Effect.map((output) => ({ output, ...(input.patch ? { changes: { settings: input.patch } } : {}) })),
    ),
});
`;

export const preferencePrivatePluginPackage = (
	input: Pick<PrivatePluginFactoryInput, "packageId" | "pluginSlug"> = {},
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
			metadata: {
				...pluginPackage.manifest.metadata,
				name: manifestText("Preference test plugin"),
			},
			scripts: [
				{ ...script, requiredPluginConfigKeys: [], capabilities: ["getUserSettings"] as const },
			],
		},
	};
};

export const listPluginUserSettings = (client: Client) =>
	collectRyotQLRecipeItems(client, pluginUserSettingsRecipe, {}, "installations");

export const installPreferencePrivatePlugin = (input: {
	readonly client: Client;
	readonly pluginSlug?: PrivatePluginFactoryInput["pluginSlug"];
}) =>
	Effect.gen(function* () {
		const pluginPackage = preferencePrivatePluginPackage({ pluginSlug: input.pluginSlug });
		const installed = yield* installPrivatePluginPackage({
			config: {},
			pluginPackage,
			client: input.client,
		});
		const installation = yield* settledPrivateInstallation(input.client, installed.id);
		const setting = yield* Effect.map(listPluginUserSettings(input.client), (settings) =>
			settings.find(({ id }) => id === installation.installationId),
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
