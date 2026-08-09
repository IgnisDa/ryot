import type { DbError } from "@ryot/contract/errors";
import type { UserId } from "@ryot/contract/schema/brands";
import { Context, Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";

export class PluginDefinitionMaterializer extends Context.Service<PluginDefinitionMaterializer>()(
	"PluginDefinitionMaterializer",
	{
		make: Effect.succeed({
			materialize: (_userId: UserId): Effect.Effect<void, DbError, Database> => Effect.void,
			removeGenerated: (_pluginInstallationId: string): Effect.Effect<void, DbError, Database> =>
				Effect.void,
		}),
	},
) {}
