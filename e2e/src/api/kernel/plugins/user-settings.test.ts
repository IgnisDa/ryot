import type { PluginSlug } from "@ryot-app/contract/schema/brands";
import { writePluginArchive } from "@ryot-app/plugin-archive";
import { Effect, Schema } from "effect";
import { unzipSync, zipSync } from "fflate";

import type { Client } from "~/fixtures/kernel/auth";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { compilePluginPackage } from "~/fixtures/kernel/compiled-package";
import {
	installPreferencePrivatePlugin,
	listPluginUserSettings,
	type PreferencePluginUserSettingsSchema,
	preferencePluginUserSettingsSchema,
	preferencePrivatePluginPackage,
	resetPluginUserSettings,
	savePluginUserSettings,
} from "~/fixtures/kernel/plugin-user-settings";
import { updatePrivatePlugin } from "~/fixtures/kernel/private-plugin";
import { uploadTemporaryArchive } from "~/fixtures/kernel/temporary-archive";
import { getUserSettings, setUserLanguage } from "~/fixtures/kernel/user-settings";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const mediaSetting = (client: Client) =>
	Effect.gen(function* () {
		const settings = yield* listPluginUserSettings(client);
		return requirePresent(
			settings.find(({ name }) => name === "Media"),
			"Media settings not found",
		);
	});

const invokeSettingsOperation = (client: Client, pluginSlug: PluginSlug, operationSlug: string) =>
	client.call((contract) =>
		contract.plugins.invoke({ payload: { payload: {} }, params: { pluginSlug, operationSlug } }),
	);

describe("plugin user settings", () => {
	it.live("validates Media settings, resets raw values, and preserves kernel language", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* setUserLanguage(client, "es");

			const initial = yield* mediaSetting(client);
			const allowNsfw = requirePresent(
				initial.settingsSchema.fields.allowNsfw,
				"Media plugin has no allowNsfw setting",
			);
			expect(initial.settings).toEqual({});
			expect(allowNsfw.defaultValue).toBe(false);

			yield* savePluginUserSettings(client, initial.id, { allowNsfw: true });
			expect((yield* mediaSetting(client)).settings).toEqual({ allowNsfw: true });

			const invalidType = yield* Effect.flip(
				savePluginUserSettings(client, initial.id, { allowNsfw: "true" }),
			);
			assertTaggedError(invalidType, "PluginRequestError");
			expect(invalidType.reason.code).toBe("validation-failed");
			expect((yield* mediaSetting(client)).settings).toEqual({ allowNsfw: true });

			const unknownField = yield* Effect.flip(
				savePluginUserSettings(client, initial.id, { unknown: true, allowNsfw: false }),
			);
			assertTaggedError(unknownField, "PluginRequestError");
			expect(unknownField.reason.code).toBe("validation-failed");
			expect((yield* mediaSetting(client)).settings).toEqual({ allowNsfw: true });

			yield* resetPluginUserSettings(client, initial.id);
			expect((yield* mediaSetting(client)).settings).toEqual({});
			expect((yield* getUserSettings(client)).preferences.language).toBe("es");
		}),
	);

	it.live("returns default, saved, and reset settings to a private plugin operation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installPreferencePrivatePlugin({ client });
			const { setting } = plugin;
			const readSettings = () =>
				invokeSettingsOperation(
					client,
					plugin.pluginPackage.pluginSlug,
					plugin.pluginPackage.operationSlug,
				);

			expect(setting.settings).toEqual({});
			expect(setting.settingsSchema).toEqual(preferencePluginUserSettingsSchema);
			expect((yield* readSettings()).result).toEqual({ limit: 5, enabled: false });

			yield* savePluginUserSettings(client, setting.id, { limit: 3, enabled: true });
			expect((yield* readSettings()).result).toEqual({ limit: 3, enabled: true });

			yield* resetPluginUserSettings(client, setting.id);
			expect(
				(yield* listPluginUserSettings(client)).find(({ id }) => id === setting.id)?.settings,
			).toEqual({});
			expect((yield* readSettings()).result).toEqual({ limit: 5, enabled: false });
		}),
	);

	it.live("isolates same-slug installations and blocks foreign settings writes", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const pluginSlug = `e2e-user-settings-${crypto.randomUUID()}`;
			const firstPlugin = yield* installPreferencePrivatePlugin({
				pluginSlug,
				client: owner.client,
			});
			const secondPlugin = yield* installPreferencePrivatePlugin({
				pluginSlug,
				client: second.client,
			});
			expect(firstPlugin.setting.id).not.toBe(secondPlugin.setting.id);
			expect(firstPlugin.installation.sourceHash).not.toBe(secondPlugin.installation.sourceHash);

			const firstSetting = firstPlugin.setting;
			const secondSetting = secondPlugin.setting;
			const readFirstSettings = () =>
				invokeSettingsOperation(
					owner.client,
					firstPlugin.pluginPackage.pluginSlug,
					firstPlugin.pluginPackage.operationSlug,
				);
			const readSecondSettings = () =>
				invokeSettingsOperation(
					second.client,
					secondPlugin.pluginPackage.pluginSlug,
					secondPlugin.pluginPackage.operationSlug,
				);

			yield* savePluginUserSettings(owner.client, firstSetting.id, { limit: 3, enabled: true });
			yield* savePluginUserSettings(second.client, secondSetting.id, { limit: 7, enabled: false });
			expect((yield* readFirstSettings()).result).toEqual({ limit: 3, enabled: true });
			expect((yield* readSecondSettings()).result).toEqual({ limit: 7, enabled: false });

			const foreignSave = yield* Effect.flip(
				savePluginUserSettings(outsider.client, firstSetting.id, { enabled: false }),
			);
			assertTaggedError(foreignSave, "PluginNotFoundError");

			const foreignReset = yield* Effect.flip(
				resetPluginUserSettings(outsider.client, firstSetting.id),
			);
			assertTaggedError(foreignReset, "PluginNotFoundError");
			const persistedSettings = (yield* listPluginUserSettings(owner.client)).find(
				({ id }) => id === firstSetting.id,
			)?.settings;
			expect(persistedSettings).toEqual({ limit: 3, enabled: true });
		}),
	);

	it.live("rejects incompatible settings schemas without changing saved values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installPreferencePrivatePlugin({ client });
			const { setting } = plugin;
			yield* savePluginUserSettings(client, setting.id, { limit: 3, enabled: true });

			const incompatibleSettingsSchema = {
				unknownKeys: "strict",
				fields: {
					limit: preferencePluginUserSettingsSchema.fields.limit,
					enabled: {
						type: "string",
						defaultValue: "no",
						label: "Enable reminders",
						description: "Enable reminders",
					},
				},
			} satisfies PreferencePluginUserSettingsSchema;
			const updatedPackage = {
				files: plugin.pluginPackage.files,
				manifest: {
					...plugin.pluginPackage.manifest,
					userSettingsSchema: incompatibleSettingsSchema,
				},
			};
			const failure = yield* Effect.flip(
				updatePrivatePlugin({
					client,
					payload: updatedPackage,
					pluginSlug: plugin.pluginPackage.pluginSlug,
				}),
			);
			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason.code).toBe("schema-evolution-failed");
			const persistedSettings = (yield* listPluginUserSettings(client)).find(
				({ id }) => id === setting.id,
			)?.settings;
			expect(persistedSettings).toEqual({ limit: 3, enabled: true });
		}),
	);

	it.live("rejects a private user-settings schema with a secret field", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const pluginPackage = preferencePrivatePluginPackage();
			const settingsSchema = requirePresent(
				pluginPackage.manifest.userSettingsSchema,
				"Private plugin package has no user settings schema",
			);
			const enabled = requirePresent(settingsSchema.fields.enabled, "Enabled setting not found");
			const secretManifest = {
				...pluginPackage.manifest,
				userSettingsSchema: {
					...settingsSchema,
					fields: { ...settingsSchema.fields, enabled: { ...enabled, secret: true } },
				} satisfies PreferencePluginUserSettingsSchema,
			};
			const compiledPackage = yield* compilePluginPackage(pluginPackage);
			const archiveEntries = unzipSync(writePluginArchive(compiledPackage));
			const secretManifestJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
				secretManifest,
			);
			archiveEntries["manifest.json"] = new TextEncoder().encode(secretManifestJson);
			const uploadToken = yield* uploadTemporaryArchive(client, zipSync(archiveEntries), {
				fileName: `${pluginPackage.manifest.metadata.slug}.zip`,
			});
			const failure = yield* Effect.flip(
				client.call((contract) =>
					contract.plugins.install({ payload: { config: {}, uploadToken } }),
				),
			);
			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason.code).toBe("package-archive-invalid");
		}),
	);
});
