import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewLayoutName } from "@ryot-app/contract/modules/saved-views/schemas";
import { savedViewRecordRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";
import { savedViewCountRecipe, savedViewRecipe } from "@ryot-app/ryotql-recipes/saved-views";
import { Context, Data, Effect, Layer, Result } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";
import { appendSavedViewPage, type SavedViewData } from "#/modules/saved-views/controller";
import { withSavedViewCursor } from "#/modules/saved-views/query";

type SavedViewClient = Pick<KernelRyotClient, "data">;

export class SavedViewLoadError extends Data.TaggedError("SavedViewLoadError")<{
	readonly cause: unknown;
	readonly stage: "count" | "record" | "page";
}> {}

type LayoutDefinition = SavedViewRecord["layouts"][SavedViewLayoutName];

export class SavedViewsService extends Context.Service<SavedViewsService>()("SavedViewsService", {
	make: Effect.sync(() => {
		const loadRecord = Effect.fn("SavedViewsService.loadRecord")(function* (
			client: SavedViewClient,
			slug: string,
		) {
			return yield* Effect.tryPromise({
				try: (signal) => client.data.query(savedViewRecordRecipe({ slug }), { signal }),
				catch: (cause) => new SavedViewLoadError({ cause, stage: "record" }),
			});
		});
		const loadPage = Effect.fn("SavedViewsService.loadPage")(function* (
			client: SavedViewClient,
			layout: SavedViewLayoutName,
			definition: LayoutDefinition,
			queryDocument: RyotQLDocument,
		) {
			const { queryDocument: _, ...mapping } = definition;
			if (layout === "table" && "columns" in mapping) {
				return yield* Effect.tryPromise({
					catch: (cause) => new SavedViewLoadError({ cause, stage: "page" }),
					try: (signal) =>
						client.data.query(
							savedViewRecipe({
								layout: { type: "table", mapping },
								source: { type: "persisted", queryDocument },
							}),
							{ signal },
						),
				});
			}
			if ("columns" in mapping) {
				return yield* new SavedViewLoadError({
					stage: "page",
					cause: new TypeError("Card saved-view layout requires a card mapping"),
				});
			}
			return yield* Effect.tryPromise({
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
		});
		const refresh = Effect.fn("SavedViewsService.refresh")(function* (
			client: SavedViewClient,
			layout: SavedViewLayoutName,
			definition: LayoutDefinition,
			current: SavedViewData,
		) {
			const queryDocument = withSavedViewCursor(current.queryDocument, undefined);
			const first = yield* loadPage(client, layout, definition, queryDocument);
			let refreshed = appendSavedViewPage(undefined, first, queryDocument, current.managedUrls);
			while (refreshed.pageInfo.hasMore && refreshed.pages < current.pages) {
				if (refreshed.pageInfo.nextCursor === null) {
					return yield* new SavedViewLoadError({
						stage: "page",
						cause: new TypeError("Saved-view page has more results without a cursor"),
					});
				}
				const requestDocument = withSavedViewCursor(queryDocument, refreshed.pageInfo.nextCursor);
				const page = yield* loadPage(client, layout, definition, requestDocument);
				refreshed = appendSavedViewPage(refreshed, page, queryDocument, current.managedUrls);
			}
			return refreshed;
		});
		const count = Effect.fn("SavedViewsService.count")(function* (
			client: SavedViewClient,
			queryDocument: RyotQLDocument,
			entityIdField: string,
		) {
			const prepared = savedViewCountRecipe(queryDocument, entityIdField);
			if (Result.isFailure(prepared)) {
				return yield* new SavedViewLoadError({ cause: prepared.failure, stage: "count" });
			}
			return yield* Effect.tryPromise({
				try: (signal) => client.data.query(prepared.success, { signal }),
				catch: (cause) => new SavedViewLoadError({ cause, stage: "count" }),
			});
		});

		return { count, refresh, loadPage, loadRecord };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
