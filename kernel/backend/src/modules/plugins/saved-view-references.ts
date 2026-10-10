import type { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect } from "effect";

export class PluginSavedViewReferences extends Context.Service<PluginSavedViewReferences>()(
	"PluginSavedViewReferences",
	{
		make: Effect.succeed({
			hasCustomSavedViewReferences: (
				_userId: UserId,
				_pluginInstallationId: string,
			): Effect.Effect<boolean, DbError> => Effect.succeed(false),
		}),
	},
) {}
