import { mediaPlugin } from "@ryot-app/media-plugin";
import { Effect } from "effect";

import { listAdminSystemPlugins } from "~/fixtures/kernel/admin-system-plugins";
import type { Client } from "~/fixtures/kernel/auth";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import { findPluginInstallationByPackage } from "~/fixtures/kernel/plugins";
import { requirePresent } from "~/support/assertions";

export const mediaFixtureInstallation = listAdminSystemPlugins.pipe(
	Effect.map((plugins) =>
		requirePresent(
			plugins.find(({ packageId }) => packageId === mediaPlugin.metadata.packageId),
			"System media fixture installation missing",
		),
	),
);

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
