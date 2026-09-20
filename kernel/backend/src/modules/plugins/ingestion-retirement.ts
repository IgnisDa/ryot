import type { DbError } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

export class PluginIngestionRetirement extends Context.Service<
	PluginIngestionRetirement,
	{
		retire: (input: {
			userId: UserId;
			pluginInstallationId: string;
		}) => Effect.Effect<void, DbError>;
	}
>()("PluginIngestionRetirement") {}
