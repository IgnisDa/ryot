import { UserBootstrap } from "@ryot-app/kernel-backend/modules/user-bootstrap/bootstrap";
import { PluginUserBootstrapDispatcher } from "@ryot-app/kernel-backend/modules/user-bootstrap/plugin-dispatch";
import { Effect, Layer } from "effect";

import { dropLegacyTables } from "./drop-tables";
import { migrateLegacyTables } from "./migrate-data";
import { renameLegacyTables } from "./rename-tables";

export const LegacyTableRenameLive = Layer.effectDiscard(renameLegacyTables);

const LegacyUserBootstrapLive = Layer.effect(UserBootstrap, UserBootstrap.make).pipe(
	Layer.provide(Layer.succeed(PluginUserBootstrapDispatcher, { dispatchAll: () => Effect.void })),
);

export const LegacyDataMigrationLive = Layer.effectDiscard(
	migrateLegacyTables.pipe(Effect.andThen(dropLegacyTables)),
).pipe(Layer.provide(LegacyUserBootstrapLive));
