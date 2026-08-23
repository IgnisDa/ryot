import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect } from "effect";

import type { Client } from "../../kernel/auth";
import {
	installPrivatePluginPackage,
	settledPrivateInstallation,
} from "../../kernel/private-plugin";

export const STYLEX_TRACER_PLUGIN_SLUG = PluginSlug.make("stylex-tracer");

const archiveUrl = new URL(
	"../../../../../plugins/stylex-tracer/dist/stylex-tracer.zip",
	import.meta.url,
);

export const installStylexTracerPlugin = (client: Client, baseUrl?: string) =>
	Effect.gen(function* () {
		const archive = yield* Effect.promise(async () => {
			const file = Bun.file(archiveUrl);
			if (!(await file.exists())) {
				throw new Error(
					`Build the StyleX tracer archive before this suite: ${archiveUrl.pathname}`,
				);
			}
			return file.bytes();
		});
		const pluginPackage = yield* readPluginArchive(archive);
		yield* installPrivatePluginPackage({ client, baseUrl, config: {}, pluginPackage });
		return yield* settledPrivateInstallation(client, STYLEX_TRACER_PLUGIN_SLUG);
	});
