import type { DbError } from "@ryot-app/contract/errors";
import { Context, type Effect } from "effect";

export class PluginRevisionActivation extends Context.Service<
	PluginRevisionActivation,
	{ readonly activated: (pluginId: string) => Effect.Effect<void, DbError> }
>()("PluginRevisionActivation") {}
