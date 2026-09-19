import { describe, expect, it } from "@effect/vitest";
import { createRyotClient } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import { Effect, ManagedRuntime } from "effect";

import { SavedViewsService } from "#/modules/saved-views/service";

const rowsResult = (items: readonly unknown[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 1, hasMore: false, nextCursor: null },
});

describe("SavedViewsService", () => {
	it.live("loads a renderer-backed saved-view record", () => {
		const record = {
			id: "view-1",
			icon: "book",
			sortOrder: 0,
			settings: {},
			slug: "books",
			name: "Books",
			isBuiltin: true,
			pluginSlug: null,
			dataSources: null,
			isDisabled: false,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			renderer: { kind: "kernel", name: "results-table" },
		};
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Effect.succeed({ data: { savedView: rowsResult([record]) } }),
			}),
		);
		const runtime = ManagedRuntime.make(SavedViewsService.layer);
		return Effect.gen(function* () {
			expect(
				yield* Effect.promise(() =>
					runtime.runPromise(
						Effect.flatMap(SavedViewsService, (service) => service.loadRecord(client, "books")),
					),
				),
			).toMatchObject({ name: "Books", renderer: record.renderer });
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});

	it.live("returns undefined when the record does not exist", () => {
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Effect.succeed({ data: { savedView: rowsResult([]) } }),
			}),
		);
		const runtime = ManagedRuntime.make(SavedViewsService.layer);
		return Effect.gen(function* () {
			expect(
				yield* Effect.promise(() =>
					runtime.runPromise(
						Effect.flatMap(SavedViewsService, (service) => service.loadRecord(client, "missing")),
					),
				),
			).toBeUndefined();
		}).pipe(Effect.ensuring(Effect.promise(() => runtime.dispose())));
	});
});
