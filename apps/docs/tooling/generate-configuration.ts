import { renderConfigReference } from "@ryot-app/config";
import { appConfigDefinition } from "@ryot-app/kernel-backend/platform/config/definition";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect } from "effect";

import { readShippedPlugins } from "../../server/tooling/shipped-plugins";

await Effect.runPromise(
	Effect.gen(function* () {
		const shipped = yield* readShippedPlugins;
		const manifests = yield* Effect.forEach(
			shipped,
			({ archive }) =>
				Effect.tryPromise(() => Bun.file(archive).bytes()).pipe(
					Effect.flatMap(readPluginArchive),
					Effect.map(({ manifest }) => manifest),
				),
			{ concurrency: "unbounded" },
		);
		const plugins = manifests.map((manifest) => ({
			name: manifest.metadata.name,
			schema: manifest.configSchema,
			packageId: manifest.metadata.packageId,
		}));
		yield* Effect.tryPromise(() =>
			Bun.write(
				new URL("../src/includes/app-backend-config-schema.md", import.meta.url),
				renderConfigReference(appConfigDefinition, plugins),
			),
		);
	}),
);
