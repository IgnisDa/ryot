/** Type-only import stays separate. */
import type { Scope } from "effect";

/** Existing Effect import comment. */
import { Context, Effect, Layer } from "effect";

const makeDefinitionRegistry = () => ({ definitions: [] as string[] });

/** Effect service comment. */
export class AppConfig extends Context.Service<AppConfig>()(
	"AppConfig",
	{
		// Constructor option comment.
		make: Effect.succeed({ name: "app" }),
	},
) {
    static readonly layer = Layer.effect(this, this.make);
}

export class RedisService extends Context.Service<RedisService>()("RedisService", {
	make: Effect.gen(function* () {
		return { close: Effect.void };
	}),
}) {
    static readonly layer = Layer.effect(this, this.make);
}

export class DefinitionRegistry extends Context.Service<DefinitionRegistry>()(
	"DefinitionRegistry",
	{
		make: Effect.sync(makeDefinitionRegistry),
	},
) {
    static readonly layer = Layer.effect(this, this.make);
}

export type LocalAppConfigFactory = (config: AppConfig["Service"]) => AppConfig["Service"];

export type ScopeType = Scope.Scope;
