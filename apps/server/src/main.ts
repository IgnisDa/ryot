import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
	MigrationDatabaseLive,
	MigrationInfrastructureLive,
	ObservabilityProvidedLive,
	RuntimeServerLive,
	SchemaMigrationLive,
} from "@ryot-app/kernel-backend/boot/layers";
import { InternalOAuthProvisioningLive } from "@ryot-app/kernel-backend/modules/accounts/auth/layer";
import { SystemPluginIngestionLive } from "@ryot-app/kernel-backend/modules/plugins/layer";
import { RYOT_VERSION } from "@ryot-app/kernel-backend/platform/build-info";
import { DatabaseOwner } from "@ryot-app/kernel-backend/platform/db/ownership";
import { Config, ConfigProvider, Effect, Layer } from "effect";

import { LegacyDataMigrationLive, LegacyTableRenameLive } from "./migrations/layers";

const SchemaReadyLive = LegacyTableRenameLive.pipe(
	Layer.flatMap(() => SchemaMigrationLive),
	Layer.provide(MigrationDatabaseLive),
);

const MigrationSequenceLive = InternalOAuthProvisioningLive.pipe(
	Layer.flatMap(() => SystemPluginIngestionLive),
	Layer.flatMap(() => LegacyDataMigrationLive),
);

const AppLive = MigrationSequenceLive.pipe(Layer.flatMap(() => RuntimeServerLive));

const StartupLive = Layer.effectDiscard(
	Effect.gen(function* () {
		yield* Effect.logInfo(`starting server ${RYOT_VERSION}`);
		const migrationOnly = yield* Config.Boolean("RUN_MIGRATION_ONLY").pipe(
			Config.withDefault(false),
		);
		const layer = SchemaReadyLive.pipe(
			Layer.flatMap(() =>
				(migrationOnly ? MigrationSequenceLive : AppLive).pipe(
					Layer.provide(MigrationInfrastructureLive),
				),
			),
			Layer.provide(ObservabilityProvidedLive),
		);
		const owner = yield* DatabaseOwner;
		const work = migrationOnly ? Layer.build(layer).pipe(Effect.asVoid) : Layer.launch(layer);
		return yield* owner.run(Effect.scoped(work));
	}),
).pipe(
	Layer.provide(DatabaseOwner.layer.pipe(Layer.provide(MigrationDatabaseLive))),
	Layer.provide(BunServices.layer),
);

BunRuntime.runMain(
	Effect.scoped(Layer.build(StartupLive)).pipe(
		Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
	),
);
