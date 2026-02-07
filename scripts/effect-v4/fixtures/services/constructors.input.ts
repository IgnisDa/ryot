/** Type-only import stays separate. */
import type { Context, Layer, Scope } from "effect";

/** Existing Effect import comment. */
import {
	Effect,
} from "effect";

const makeDefinitionRegistry = () => ({ definitions: [] as string[] });

/** Effect service comment. */
export class AppConfig extends Effect.Service<AppConfig>()(
	"AppConfig",
	{
		// Constructor option comment.
		effect: Effect.succeed({ name: "app" }),
	},
) {}

export class RedisService extends Effect.Service<RedisService>()("RedisService", {
	scoped: Effect.gen(function* () {
		return { close: Effect.void };
	}),
}) {}

export class DefinitionRegistry extends Effect.Service<DefinitionRegistry>()(
	"DefinitionRegistry",
	{
		sync: makeDefinitionRegistry,
	},
) {}

export type LocalAppConfigFactory = (config: AppConfig) => AppConfig;

export type ScopeType = Scope.Scope;
