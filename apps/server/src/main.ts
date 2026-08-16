import { BunServices, BunRuntime } from "@effect/platform-bun";
import { renderConfigReference } from "@ryot/config";
import {
	MigrationInfrastructureLive,
	ObservabilityProvidedLive,
	RuntimeServerLive,
	SchemaMigrationLive,
	SystemPluginIngestionLive,
} from "@ryot/kernel-backend/boot/layers";
import { appConfigDefinition } from "@ryot/kernel-backend/lib/infrastructure/config/definition";
import { AppConfig } from "@ryot/kernel-backend/lib/infrastructure/config/service";
import { discoverSystemPlugins } from "@ryot/kernel-backend/modules/plugins/system";
import { LegacyDataMigrationLive, LegacyTableRenameLive } from "@ryot/v10-rust-migration/layers";
import { Config, ConfigProvider, Effect, Layer, FileSystem, Path } from "effect";

const MigrationSequenceLive = LegacyTableRenameLive.pipe(
	Layer.flatMap(() => SchemaMigrationLive),
	Layer.flatMap(() => SystemPluginIngestionLive),
	Layer.flatMap(() => LegacyDataMigrationLive),
);

const MigrationOnlyLive = MigrationSequenceLive.pipe(
	Layer.provide(MigrationInfrastructureLive),
	Layer.provide(ObservabilityProvidedLive),
);

const AppLive = MigrationSequenceLive.pipe(
	Layer.flatMap(() => RuntimeServerLive),
	Layer.provide(MigrationInfrastructureLive),
	Layer.provide(ObservabilityProvidedLive),
);

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
			const config = yield* AppConfig;
			const outputPath = yield* path.fromFileUrl(
				new URL("../../../apps/docs/src/includes/app-backend-config-schema.md", import.meta.url),
			);
			const sources = yield* discoverSystemPlugins(config.server.pluginsSystemDir);
			const plugins = sources.map(({ manifest }) => ({
				name: manifest.metadata.name,
				slug: manifest.metadata.slug,
				schema: manifest.configSchema,
			}));
			yield* fs.writeFileString(outputPath, renderConfigReference(appConfigDefinition, plugins));
		}).pipe(Effect.provide(Layer.mergeAll(AppConfig.layer, BunServices.layer))),
	);
}

BunRuntime.runMain(Layer.launch(AppLive));
