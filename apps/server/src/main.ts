import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
	InternalOAuthProvisioningLive,
	MigrationInfrastructureLive,
	ObservabilityProvidedLive,
	RuntimeServerLive,
	SchemaMigrationLive,
	SystemPluginIngestionLive,
} from "@ryot-app/kernel-backend/boot/layers";
import { AppConfig } from "@ryot-app/kernel-backend/lib/infrastructure/config/service";
import { runSplitSupervisor } from "@ryot-app/kernel-backend/lib/infrastructure/split-supervisor";
import { Config, ConfigProvider, Effect, Layer } from "effect";

import { LegacyDataMigrationLive, LegacyTableRenameLive } from "./migrations/layers";

const MigrationSequenceLive = LegacyTableRenameLive.pipe(
	Layer.flatMap(() => SchemaMigrationLive),
	Layer.flatMap(() => InternalOAuthProvisioningLive),
	Layer.flatMap(() => SystemPluginIngestionLive),
	Layer.flatMap(() => LegacyDataMigrationLive),
);

const AppLive = MigrationSequenceLive.pipe(
	Layer.flatMap(() => RuntimeServerLive),
);

BunRuntime.runMain(
	Effect.scoped(
		Effect.gen(function* () {
			const config = yield* AppConfig.make;
			const migrationOnly = yield* Config.Boolean("RUN_MIGRATION_ONLY").pipe(
				Config.withDefault(false),
			);
			if (!migrationOnly && config.server.lanes === "split") {
				return yield* runSplitSupervisor({
					effectiveMemory: process.constrainedMemory(),
					entry: { args: process.argv.slice(1), executable: process.execPath },
				}).pipe(Effect.provideService(AppConfig, config));
			}
			const startup = migrationOnly
				? MigrationSequenceLive
				: config.server.processRole === "all"
					? AppLive
					: RuntimeServerLive;
			const layer = startup.pipe(
				Layer.provide(MigrationInfrastructureLive),
				Layer.provide(ObservabilityProvidedLive),
			);
			if (migrationOnly) {
				yield* Layer.build(layer);
			} else {
				yield* Layer.launch(layer);
			}
		}),
	).pipe(
		Effect.provide(BunServices.layer),
		Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
	),
);
