// @vitest-environment jsdom
import { disposePluginBridges, mountPluginPage, routeLocation } from "@ryot-app/client-sdk/testing";
import { EntityId, RelationshipId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { PokemonPicker } from "./pokemon-picker";

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const replyChoices = async (page: ReturnType<typeof mountPluginPage>) => {
	await waitFor(() => expect(page.queryRequests()).toHaveLength(2));
	for (const request of page.queryRequests()) {
		if ("collections" in request.document.queries) {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: { data: { collections: rows([{ name: "Favorites", id: "collection-1" }]) } },
			});
		} else {
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: { data: { pokemon: rows([{ id: "pokemon-2", name: "Charmander" }]) } },
			});
		}
	}
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Add Charmander to collection" })).toBeTruthy(),
	);
};

const collectionRequests = (page: ReturnType<typeof mountPluginPage>) =>
	page.clientMessages().filter((message) => message.type === "collection-request");

describe("PokemonPicker", () => {
	afterEach(disposePluginBridges);

	it("cancels a locally pushed choice without writing and pops host history", async () => {
		const page = mountPluginPage(PokemonPicker, { location: routeLocation("/", "keep=1") });
		await replyChoices(page);

		fireEvent.click(screen.getByRole("button", { name: "Add Charmander to collection" }));
		await waitFor(() =>
			expect(page.clientMessages()).toContainEqual({
				mode: "push",
				type: "page-search",
				update: { entityId: "pokemon-2", dialog: "add-to-collection" },
			}),
		);
		page.navigate(routeLocation("/", "keep=1&dialog=add-to-collection&entityId=pokemon-2"), {
			index: 1,
			key: "k1",
		});
		await waitFor(() =>
			expect(screen.getByRole("dialog", { name: "Choose a collection" })).toBeTruthy(),
		);
		expect(
			page.clientMessages().filter((message) => message.type === "overlay-state"),
		).toHaveLength(0);
		fireEvent.click(screen.getByRole("radio", { name: "Favorites" }));
		await waitFor(() =>
			expect(screen.getByRole("radio", { name: "Favorites" }).getAttribute("aria-checked")).toBe(
				"true",
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Review" }));
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Review collection change" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		await waitFor(() =>
			expect(
				page.clientMessages().filter((message) => message.type === "navigate-back"),
			).toHaveLength(1),
		);
		expect(collectionRequests(page)).toHaveLength(0);
	});

	it("keeps a direct-entry selection for the same idempotent retry and closes by replace", async () => {
		const page = mountPluginPage(PokemonPicker, {
			location: routeLocation("/", "keep=1&dialog=add-to-collection&entityId=pokemon-2"),
		});
		await replyChoices(page);
		await waitFor(() =>
			expect(screen.getByRole("dialog", { name: "Choose a collection" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("radio", { name: "Favorites" }));
		await waitFor(() =>
			expect(screen.getByRole("radio", { name: "Favorites" }).getAttribute("aria-checked")).toBe(
				"true",
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Review" }));
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Review collection change" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
		await waitFor(() => expect(collectionRequests(page)).toHaveLength(1));
		const first = collectionRequests(page)[0];
		if (!first) {
			throw new Error("Expected the first collection request");
		}
		page.send({
			outcome: "failure",
			reason: "transport",
			type: "collection-result",
			requestId: first.requestId,
		});
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain("selection is preserved"),
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(collectionRequests(page)).toHaveLength(2));
		const second = collectionRequests(page)[1];
		if (!second) {
			throw new Error("Expected the retry collection request");
		}
		expect(second.input).toEqual(first.input);
		page.send({
			outcome: "success",
			type: "collection-result",
			requestId: second.requestId,
			response: {
				memberOf: {
					properties: {},
					createdAt: "2026-09-08T00:00:00.000Z",
					id: RelationshipId.make("membership-1"),
					sourceEntityId: EntityId.make("pokemon-2"),
					targetEntityId: EntityId.make("collection-1"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
				},
			},
		});
		await waitFor(() =>
			expect(page.clientMessages()).toContainEqual({
				mode: "replace",
				type: "page-search",
				update: { dialog: null, entityId: null },
			}),
		);
		expect(
			page.clientMessages().filter((message) => message.type === "navigate-back"),
		).toHaveLength(0);
	});
});
