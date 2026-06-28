import { savedViewRecordRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

type SavedViewClient = Pick<KernelRyotClient, "data">;

export class SavedViewLoadError extends Data.TaggedError("SavedViewLoadError")<{
	readonly cause: unknown;
	readonly stage: "record";
}> {}

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.sync(() => ({
		loadRecord: Effect.fn("SavedViewsService.loadRecord")(function* (
			client: SavedViewClient,
			slug: string,
		) {
			return yield* Effect.tryPromise({
				catch: (cause) => new SavedViewLoadError({ cause, stage: "record" }),
				try: (signal) => client.data.query(savedViewRecordRecipe({ slug }), { signal }),
			});
		}),
	})),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
