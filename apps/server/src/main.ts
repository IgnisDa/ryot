import { BunRuntime } from "@effect/platform-bun";
import {
	InternalOAuthProvisioningLive,
	MigrationInfrastructureLive,
	ObservabilityProvidedLive,
	RuntimeServerLive,
	SchemaMigrationLive,
	SystemPluginIngestionLive,
} from "@ryot/kernel-backend/boot/layers";
import { LegacyDataMigrationLive, LegacyTableRenameLive } from "@ryot/v10-rust-migration/layers";
import { Config, ConfigProvider, Effect, Layer } from "effect";

const MigrationSequenceLive = LegacyTableRenameLive.pipe(
	Layer.flatMap(() => SchemaMigrationLive),
	Layer.flatMap(() => InternalOAuthProvisioningLive),
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

const runMigrationOnly = await Effect.runPromise(
	Config.boolean("RUN_MIGRATION_ONLY").pipe(
		Config.withDefault(false),
		Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
	),
);

if (runMigrationOnly) {
	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

BunRuntime.runMain(Layer.launch(AppLive));
