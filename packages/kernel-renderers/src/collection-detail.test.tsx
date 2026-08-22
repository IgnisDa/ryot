import {
	disposePluginBridges,
	entityLocation,
	kernelEntityPageContext,
	mountPluginPage,
} from "@ryot-app/client-sdk/testing";
import { screen, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import CollectionDetailPage from "./collection-detail";

describe("collection detail", () => {
	afterEach(disposePluginBridges);

	it("titles the screen from the collection row and lists members", async () => {
		const page = mountPluginPage(CollectionDetailPage, {
			location: entityLocation("col-1", "collection"),
			page: kernelEntityPageContext({
				entityId: "col-1",
				entitySchemaSlug: "collection",
				rendererName: "Collection detail",
			}),
		});

		const answered = new Set<string>();
		await waitFor(() => {
			const pending = page
				.queryRequests("members")
				.filter(({ requestId }) => !answered.has(requestId));
			expect(pending.length).toBeGreaterThan(0);
			for (const request of pending) {
				answered.add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: {
						data: {
							collection: {
								type: "rows",
								items: [{ id: "col-1", name: "Road Trips" }],
								pageInfo: { limit: 1, hasMore: false, nextCursor: null },
							},
							grouped: {
								type: "aggregate",
								items: [
									{
										count: 1,
										schemaSlug: "book",
										ownerPluginId: "media",
										ownerPluginSlug: "media",
										ownerPluginName: "Media",
									},
								],
							},
							members: {
								type: "rows",
								pageInfo: { limit: 20, hasMore: false, nextCursor: null },
								items: [
									{
										name: "Dune",
										entityId: "book-1",
										ownerPluginId: "media",
										entitySchemaSlug: "book",
										populationStatus: "ready",
										translationStatus: "ready",
									},
								],
							},
						},
					},
				});
			}
		});

		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 1, name: "Road Trips" })).toBeTruthy(),
		);
		expect(page.container?.textContent).toContain("1 total");
		expect(page.container?.textContent).toContain("1 Media / book");
	});

	it("shows an empty state when the collection has no members", async () => {
		const page = mountPluginPage(CollectionDetailPage, {
			location: entityLocation("col-empty", "collection"),
			page: kernelEntityPageContext({
				entityId: "col-empty",
				entitySchemaSlug: "collection",
				rendererName: "Collection detail",
			}),
		});

		const answered = new Set<string>();
		await waitFor(() => {
			const pending = page
				.queryRequests("members")
				.filter(({ requestId }) => !answered.has(requestId));
			expect(pending.length).toBeGreaterThan(0);
			for (const request of pending) {
				answered.add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: {
						data: {
							grouped: { items: [], type: "aggregate" },
							members: {
								items: [],
								type: "rows",
								pageInfo: { limit: 20, hasMore: false, nextCursor: null },
							},
							collection: {
								type: "rows",
								items: [{ name: "Empty", id: "col-empty" }],
								pageInfo: { limit: 1, hasMore: false, nextCursor: null },
							},
						},
					},
				});
			}
		});

		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 1, name: "Empty" })).toBeTruthy(),
		);
		expect(page.container?.textContent).toContain("This collection is empty.");
	});
});
