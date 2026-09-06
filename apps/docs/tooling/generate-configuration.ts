import { renderConfigReference } from "@ryot-app/config";
import { appConfigDefinition } from "@ryot-app/kernel-backend/lib/infrastructure/config/definition";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect, Schema } from "effect";

await Effect.runPromise(
	Effect.gen(function* () {
		const slugs = yield* Effect.tryPromise(() =>
			Bun.file(new URL("../../server/shipped-plugins.json", import.meta.url)).json(),
		).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String))));
		const manifests = yield* Effect.forEach(
			slugs,
			(slug) =>
				Effect.gen(function* () {
					const archive = yield* Effect.tryPromise(() =>
						Bun.file(new URL(`../../../plugins/${slug}/dist/${slug}.zip`, import.meta.url)).bytes(),
					);
					return (yield* readPluginArchive(archive)).manifest;
				}),
			{ concurrency: "unbounded" },
		);
		const plugins = manifests.map((manifest) => ({
			name: manifest.metadata.name,
			slug: manifest.metadata.slug,
			schema: manifest.configSchema,
		}));
		yield* Effect.tryPromise(() =>
			Bun.write(
				new URL("../src/includes/app-backend-config-schema.md", import.meta.url),
				renderConfigReference(appConfigDefinition, plugins),
			),
		);
	}),
);
