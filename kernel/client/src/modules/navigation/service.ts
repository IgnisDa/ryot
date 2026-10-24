import { navigationRecipe } from "@ryot-app/ryotql-recipes/navigation";
import { Context, Effect, Layer, Schema } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

export class NavigationLoadError extends Schema.TaggedError<
	NavigationLoadError,
	{ readonly brand: unique symbol }
>()("NavigationLoadError", { cause: Schema.Unknown }) {}

export class NavigationService extends Context.Service<NavigationService>()("NavigationService", {
	make: Effect.sync(() => ({
		load: Effect.fn("NavigationService.load")((ryot: KernelRyotClient) =>
			ryot.data
				.query(navigationRecipe())
				.pipe(Effect.mapError((cause) => new NavigationLoadError({ cause }))),
		),
	})),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
