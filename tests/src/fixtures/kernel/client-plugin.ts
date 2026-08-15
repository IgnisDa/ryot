import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import type { Client } from "./auth";
import { settledPrivateInstallation } from "./private-plugin";
import { uploadTemporaryArchive } from "./temporary-archive";

export const FIXTURE_CLIENT_PLUGIN_SLUG = PluginSlug.make("fixture");

const archiveUrl = new URL("../../../../plugins/fixture/dist/fixture.zip", import.meta.url);

export const installFixtureClientPlugin = (client: Client) =>
	Effect.gen(function* () {
		const archive = yield* Effect.promise(async () => {
			const file = Bun.file(archiveUrl);
			if (!(await file.exists())) {
				throw new Error(`Build @ryot/fixture-plugin before this suite: ${archiveUrl.pathname}`);
			}
			return file.bytes();
		});
		const uploadToken = yield* uploadTemporaryArchive(client, archive, {
			fileName: `${FIXTURE_CLIENT_PLUGIN_SLUG}.zip`,
		});
		yield* client.call((c) => c.plugins.install({ payload: { config: {}, uploadToken } }));
		return yield* settledPrivateInstallation(client, FIXTURE_CLIENT_PLUGIN_SLUG);
	});
