import { entityRouteProvenanceRecipe } from "@ryot-app/ryotql-recipes/entities";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

type EntityRouteClient = Pick<KernelRyotClient, "data">;

export class EntityRouteLoadError extends Data.TaggedError("EntityRouteLoadError")<{
	readonly cause: unknown;
}> {}

export class EntitiesService extends Context.Service<EntitiesService>()("EntitiesService", {
	make: Effect.sync(() => ({
		loadRouteProvenance: Effect.fn("EntitiesService.loadRouteProvenance")(
			(client: EntityRouteClient, entityId: string) =>
				Effect.tryPromise({
					catch: (cause) => new EntityRouteLoadError({ cause }),
					try: (signal) => client.data.query(entityRouteProvenanceRecipe({ entityId }), { signal }),
				}),
		),
	})),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
