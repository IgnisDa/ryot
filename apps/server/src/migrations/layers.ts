import { AuthRepository } from "@ryot-app/kernel-backend/modules/accounts/auth/repository";
import { UserBootstrap } from "@ryot-app/kernel-backend/modules/accounts/provisioning/bootstrap";
import { PluginUserBootstrapDispatcher } from "@ryot-app/kernel-backend/modules/accounts/provisioning/plugin-dispatch";
import { Effect, Layer } from "effect";

import { dropLegacyTables } from "./drop-tables";
import { migrateLegacyTables } from "./migrate-data";
import { renameLegacyTables } from "./rename-tables";

export const LegacyTableRenameLive = Layer.effectDiscard(renameLegacyTables);

const LegacyUserBootstrapLive = Layer.effect(UserBootstrap, UserBootstrap.make).pipe(
	Layer.provide(Layer.succeed(PluginUserBootstrapDispatcher, { dispatchAll: () => Effect.void })),
	Layer.provide(AuthRepository.layer),
);

export const LegacyDataMigrationLive = Layer.effectDiscard(
	migrateLegacyTables.pipe(Effect.andThen(dropLegacyTables)),
).pipe(Layer.provide(LegacyUserBootstrapLive));
