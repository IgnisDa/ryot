import { BunServices, BunRuntime } from "@effect/platform-bun";
import { renderConfigReference } from "@ryot/config";
import { AppLive, MigrationOnlyLive } from "@ryot/kernel-backend/boot/layers";
import { appConfigDefinition } from "@ryot/kernel-backend/lib/infrastructure/config/definition";
import { bootPluginSources } from "@ryot/kernel-backend/modules/plugins/boot-sources";
import { Config, ConfigProvider, Effect, Layer, FileSystem, Path } from "effect";

// TODO(kernel-assembly): `src/drizzle` is a committed symlink to the kernel migrations so this
// package can be the working directory. Task 03 replaces it with the ignored `assemble` output.

const { nodeEnv, runMigrationOnly } = await Effect.runPromise(
	Config.all({
		nodeEnv: Config.string("NODE_ENV").pipe(Config.withDefault("development")),
		runMigrationOnly: Config.boolean("RUN_MIGRATION_ONLY").pipe(Config.withDefault(false)),
	}).pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())),
);

if (runMigrationOnly) {
	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

if (nodeEnv !== "production") {
	await Effect.runPromise(
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const outputPath = yield* path.fromFileUrl(
				new URL("../../../apps/docs/src/includes/app-backend-config-schema.md", import.meta.url),
			);
			const plugins = bootPluginSources.map(({ manifest }) => ({
				name: manifest.metadata.name,
				slug: manifest.metadata.slug,
				schema: manifest.configSchema,
			}));
			yield* fs.writeFileString(outputPath, renderConfigReference(appConfigDefinition, plugins));
		}).pipe(Effect.provide(BunServices.layer)),
	);
}

BunRuntime.runMain(Layer.launch(AppLive));
