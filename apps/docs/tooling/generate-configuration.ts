import { renderConfigReference } from "@ryot-app/config";
import { fitnessPlugin } from "@ryot-app/fitness-plugin";
import { appConfigDefinition } from "@ryot-app/kernel-backend/lib/infrastructure/config/definition";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect, Schema } from "effect";

class UnknownShippedPluginDirectory extends Schema.TaggedError<UnknownShippedPluginDirectory>()(
	"UnknownShippedPluginDirectory",
	{ directory: Schema.String },
) {}

const authoredPlugins = new Map<string, typeof fitnessPlugin | typeof mediaPlugin>([
	["fitness", fitnessPlugin],
	["media", mediaPlugin],
]);

await Effect.runPromise(
	Effect.gen(function* () {
		const directories = yield* Effect.tryPromise(() =>
			Bun.file(new URL("../../server/shipped-plugins.json", import.meta.url)).json(),
		).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String))));
		const manifests = yield* Effect.forEach(
			directories,
			(directory) =>
				Effect.gen(function* () {
					const authored = authoredPlugins.get(directory);
					if (authored === undefined) {
						return yield* new UnknownShippedPluginDirectory({ directory });
					}
					const archive = yield* Effect.tryPromise(() =>
						Bun.file(
							new URL(
								`../../../plugins/${directory}/dist/${authored.metadata.packageId}.zip`,
								import.meta.url,
							),
						).bytes(),
					);
					return (yield* readPluginArchive(archive)).manifest;
				}),
			{ concurrency: "unbounded" },
		);
		const plugins = manifests.map((manifest) => ({
			name: manifest.metadata.name,
			slug: manifest.metadata.slug,
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
