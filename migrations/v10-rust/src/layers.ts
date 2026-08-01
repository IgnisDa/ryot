import { Effect, Layer } from "effect";

import { dropLegacyTables } from "./drop-tables";
import { migrateLegacyTables } from "./migrate-data";
import { renameLegacyTables } from "./rename-tables";

export const LegacyTableRenameLive = Layer.effectDiscard(renameLegacyTables);

export const LegacyDataMigrationLive = Layer.effectDiscard(
	migrateLegacyTables.pipe(Effect.andThen(dropLegacyTables)),
);
