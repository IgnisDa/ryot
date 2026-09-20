import { expect, layer } from "@effect/vitest";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import { pluginConfigEnvironmentKeySql } from "./catalog";

const cases = [
	["ryot/media", "tmdbAccessToken"],
	["acme-labs/movie-db", "api.key"],
	["a1/b-2-c", "OAuthClientID"],
	["x/y", "--leading and trailing--"],
] as const;

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

layer(isolatedDatabaseLayer("plugin_config_environment_test"))((test) => {
	test.effect("derives the same plugin config environment keys in SQL and TypeScript", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			for (const [packageId, key] of cases) {
				const rows = yield* session.run((db) =>
					db.execute<{ key: string }>(
						sql.raw(`select ${pluginConfigEnvironmentKeySql(quote(packageId), quote(key))} as key`),
						"objects",
					),
				);
				expect(rows[0]?.key).toBe(pluginConfigEnvironmentKey(PluginPackageId.make(packageId), key));
			}
		}),
	);
});
