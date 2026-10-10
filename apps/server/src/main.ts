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

const MigrationOnlyLive = MigrationSequenceLive.pipe(
	Layer.provide(MigrationInfrastructureLive),
	Layer.provide(ObservabilityProvidedLive),
);

const AppLive = MigrationSequenceLive.pipe(
	Layer.flatMap(() => RuntimeServerLive),
	Layer.provide(MigrationInfrastructureLive),
	Layer.provide(ObservabilityProvidedLive),
);

const RoleLive = RuntimeServerLive.pipe(
	Layer.provide(MigrationInfrastructureLive),
	Layer.provide(ObservabilityProvidedLive),
);

const environment = Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv());

const runMigrationOnly = await Effect.runPromise(
	Config.Boolean("RUN_MIGRATION_ONLY").pipe(Config.withDefault(false), environment),
);

if (runMigrationOnly) {
	await Effect.runPromise(Effect.scoped(Layer.build(MigrationOnlyLive)));
	process.exit(0);
}

const config = await Effect.runPromise(AppConfig.make.pipe(environment));

if (config.server.lanes === "split") {
	const SupervisorLive = Layer.effectDiscard(
		runSplitSupervisor({
			effectiveMemory: process.constrainedMemory(),
			entry: { args: process.argv.slice(1), executable: process.execPath },
		}).pipe(Effect.provideService(AppConfig, config)),
	).pipe(Layer.provide(BunServices.layer));
	BunRuntime.runMain(Effect.scoped(Layer.build(SupervisorLive)));
} else {
	BunRuntime.runMain(
		Effect.scoped(Layer.launch(config.server.lanes === "all" ? AppLive : RoleLive)),
	);
}
