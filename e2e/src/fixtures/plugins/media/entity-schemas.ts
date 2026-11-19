import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";

import { listAdminSystemPlugins } from "~/fixtures/kernel/admin-system-plugins";
import type { Client } from "~/fixtures/kernel/auth";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import { listPluginUserSettings } from "~/fixtures/kernel/plugin-user-settings";
import { findPluginInstallationByPackage } from "~/fixtures/kernel/plugins";
import { pluginRecipeExecutors } from "~/fixtures/kernel/ryotql";
import { requirePresent } from "~/support/assertions";
import { getSharedHarnessTarget } from "~/support/harness-target";

export const mediaFixtureInstallation = (target = getSharedHarnessTarget()) =>
	listAdminSystemPlugins(target).pipe(
		Effect.map((plugins) =>
			requirePresent(
				plugins.find(({ packageId }) => packageId === mediaPlugin.metadata.packageId),
				"System media fixture installation missing",
			),
		),
	);

export const mediaRecipes = pluginRecipeExecutors((target) =>
	mediaFixtureInstallation(target).pipe(Effect.map(({ id }) => id)),
);

export const findMediaPluginUserSettings = (client: Client) =>
	Effect.gen(function* () {
		const { id: pluginId } = yield* mediaFixtureInstallation(client.target);
		return requirePresent(
			(yield* listPluginUserSettings(client)).find(
				({ name }) => name.namespace === pluginId && name.key === "plugin.name",
			),
			"Media settings not found",
		);
	});

export const findMediaEntitySchema = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const installation = yield* findPluginInstallationByPackage(client, {
			scope: "system",
			packageId: mediaPlugin.metadata.packageId,
		});
		const selected = yield* findBuiltinSchemaBySlug(client, slug, {
			kind: "plugin",
			pluginId: installation.pluginId,
		});
		return { ...selected, pluginId: installation.pluginId };
	});

export const findBuiltinSchemaWithProviders = (client: Client) =>
	findMediaEntitySchema(client, "book");
