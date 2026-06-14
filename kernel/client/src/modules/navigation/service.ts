import { navigationRecipe } from "@ryot-app/ryotql-recipes/navigation";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

export class NavigationLoadError extends Data.TaggedError("NavigationLoadError")<{
	readonly cause: unknown;
}> {}

export class NavigationService extends Context.Service<NavigationService>()("NavigationService", {
	make: Effect.sync(() => ({
		load: Effect.fn("NavigationService.load")((ryot: KernelRyotClient) =>
			Effect.tryPromise({
				catch: (cause) => new NavigationLoadError({ cause }),
				try: (signal) => ryot.data.query(navigationRecipe(), { signal }),
			}),
		),
	})),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
