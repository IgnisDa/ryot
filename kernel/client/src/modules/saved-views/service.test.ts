import { createRyotClient } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { SavedViewsService } from "#/modules/saved-views/service";

const rowsResult = (items: readonly unknown[]) => ({
	type: "rows" as const,
	items,
	pageInfo: { limit: 1, hasMore: false, nextCursor: null },
});

describe("SavedViewsService", () => {
	it("loads a renderer-backed saved-view record", async () => {
		const record = {
			id: "view-1",
			icon: "book",
			sortOrder: 0,
			slug: "books",
			name: "Books",
			settings: {},
			isBuiltin: true,
			pluginSlug: null,
			dataSources: null,
			isDisabled: false,
			renderer: { kind: "kernel", name: "results-table" },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({ data: { savedView: rowsResult([record]) } }),
			}),
		);
		const runtime = ManagedRuntime.make(SavedViewsService.layer);
		try {
			await expect(
				runtime.runPromise(
					Effect.flatMap(SavedViewsService, (service) => service.loadRecord(client, "books")),
				),
			).resolves.toMatchObject({ name: "Books", renderer: record.renderer });
		} finally {
			await runtime.dispose();
		}
	});

	it("returns undefined when the record does not exist", async () => {
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({ data: { savedView: rowsResult([]) } }),
			}),
		);
		const runtime = ManagedRuntime.make(SavedViewsService.layer);
		try {
			await expect(
				runtime.runPromise(
					Effect.flatMap(SavedViewsService, (service) => service.loadRecord(client, "missing")),
				),
			).resolves.toBeUndefined();
		} finally {
			await runtime.dispose();
		}
	});
});
