import { savedViewRecordRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { savedViewRecipe } from "@ryot-app/ryotql-recipes/saved-views";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

type SavedViewClient = Pick<KernelRyotClient, "data">;

export class SavedViewLoadError extends Data.TaggedError("SavedViewLoadError")<{
	readonly cause: unknown;
	readonly stage: "record" | "page";
}> {}

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.sync(() => {
		const loadGrid = Effect.fn("SavedViewsService.loadGrid")(function* (
			client: SavedViewClient,
			slug: string,
		) {
			const record = yield* Effect.tryPromise({
				try: (signal) => client.data.query(savedViewRecordRecipe({ slug }), { signal }),
				catch: (cause) => new SavedViewLoadError({ cause, stage: "record" }),
			});
			if (record === undefined) {
				return null;
			}

			const { queryDocument, ...mapping } = record.layouts.grid;
			const page = yield* Effect.tryPromise({
				catch: (cause) => new SavedViewLoadError({ cause, stage: "page" }),
				try: (signal) =>
					client.data.query(
						savedViewRecipe({
							layout: { type: "card", mapping },
							source: { type: "persisted", queryDocument },
						}),
						{ signal },
					),
			});
			return { page, record };
		});

		return { loadGrid };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
