import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
	InternalOAuthProvisioningLive,
	MigrationInfrastructureLive,
	ObservabilityProvidedLive,
	RuntimeServerLive,
	SchemaMigrationLive,
	SystemPluginIngestionLive,
} from "@ryot-app/kernel-backend/boot/layers";
import { Config, ConfigProvider, Effect, Layer } from "effect";

import { LegacyDataMigrationLive, LegacyTableRenameLive } from "./migrations/layers";

const MigrationSequenceLive = LegacyTableRenameLive.pipe(
	Layer.flatMap(() => SchemaMigrationLive),
	Layer.flatMap(() => InternalOAuthProvisioningLive),
	Layer.flatMap(() => SystemPluginIngestionLive),
	Layer.flatMap(() => LegacyDataMigrationLive),
);

const AppLive = MigrationSequenceLive.pipe(Layer.flatMap(() => RuntimeServerLive));

const StartupLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const migrationOnly = yield* Config.Boolean("RUN_MIGRATION_ONLY").pipe(
			Config.withDefault(false),
		);
		const layer = (migrationOnly ? MigrationSequenceLive : AppLive).pipe(
			Layer.provide(MigrationInfrastructureLive),
			Layer.provide(ObservabilityProvidedLive),
		);
		if (migrationOnly) {
			return yield* Layer.build(layer).pipe(Effect.asVoid);
		}
		return yield* Layer.launch(layer);
	}),
).pipe(Layer.provide(BunServices.layer));

BunRuntime.runMain(
	Effect.scoped(Layer.build(StartupLive)).pipe(
		Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
	),
);
