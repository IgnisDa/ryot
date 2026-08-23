import {
	disposePluginBridges,
	entityLocation,
	kernelEntityPageContext,
	mountPluginPage,
} from "@ryot-app/client-sdk/testing";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import CollectionDetailPage from "./collection-detail";

const openCollection = (collectionId = "col-1", search = "") =>
	mountPluginPage(CollectionDetailPage, {
		location: entityLocation(collectionId, "collection", search),
		page: kernelEntityPageContext({
			entityId: collectionId,
			entitySchemaSlug: "collection",
			rendererName: "Collection detail",
		}),
	});

const request = async (page: ReturnType<typeof mountPluginPage>, name: string) => {
	await waitFor(() => expect(page.queryRequests(name).length).toBeGreaterThan(0));
	const found = page.queryRequests(name)[0];
	if (!found) {
		throw new Error(`${name} request was not issued`);
	}
	return found;
};

const answerCollection = async (
	page: ReturnType<typeof mountPluginPage>,
	input: {
		readonly groups?: readonly Record<string, JsonValue>[];
		readonly members?: readonly Record<string, JsonValue>[];
		readonly name: string;
		readonly hasMore?: boolean | undefined;
		readonly groupsHaveMore?: boolean | undefined;
		readonly membershipPropertiesSchema?: Record<string, unknown> | undefined;
		readonly total?: number | undefined;
	},
) => {
	const header = await request(page, "collection");
	page.replyQuery(header.requestId, {
		outcome: "success",
		response: {
			data: {
				collection: {
					type: "rows",
					pageInfo: { limit: 2, hasMore: false, nextCursor: null },
					items: [
						{
							name: input.name,
							entityId: "col-1",
							properties: input.membershipPropertiesSchema
								? { membershipPropertiesSchema: input.membershipPropertiesSchema }
								: {},
						},
					],
				},
			},
		},
	});
	const [aggregate, count, members] = await Promise.all([
		request(page, "aggregate"),
		request(page, "count"),
		request(page, "members"),
	]);
	page.replyQuery(aggregate.requestId, {
		outcome: "success",
		response: {
			data: {
				aggregate: {
					type: "aggregate",
					items: input.groups ?? [],
					...(input.groupsHaveMore ? { pageInfo: { limit: 100, hasMore: true } } : {}),
				},
			},
		},
	});
	page.replyQuery(count.requestId, {
		outcome: "success",
		response: {
			data: {
				count: {
					type: "aggregate",
					items: [
						{
							total:
								input.total ??
								(input.groups ?? []).reduce((sum, group) => sum + Number(group.count), 0),
						},
					],
				},
			},
		},
	});
	page.replyQuery(members.requestId, {
		outcome: "success",
		response: {
			data: {
				members: {
					type: "rows",
					items: input.members ?? [],
					pageInfo: {
						limit: 20,
						hasMore: input.hasMore ?? false,
						nextCursor: input.hasMore ? "next" : null,
					},
				},
			},
		},
	});
};

describe("collection detail", () => {
	afterEach(disposePluginBridges);

	it("renders heterogeneous members and recipe-supplied template cells in the shared table", async () => {
		const page = openCollection();
		await answerCollection(page, {
			total: 5,
			name: "Road Trips",
			groupsHaveMore: true,
			membershipPropertiesSchema: {
				fields: {
					template: {
						position: 0,
						type: "boolean",
						label: "Template",
						description: "Uses the collection template",
					},
				},
			},
			groups: [
				{ count: 1, ownerPluginId: "media", ownerPluginName: "Media", entitySchemaSlug: "book" },
				{ count: 1, ownerPluginId: null, ownerPluginName: null, entitySchemaSlug: "collection" },
			],
			members: [
				{
					name: "Dune",
					entityId: "book-1",
					ownerPluginId: "media",
					ownerPluginName: "Media",
					entitySchemaSlug: "book",
					populationStatus: "ready",
					translationStatus: "ready",
					properties: { template: true },
				},
				{
					name: "Favorites",
					entityId: "col-2",
					ownerPluginId: null,
					ownerPluginName: null,
					populationStatus: "ready",
					translationStatus: "none",
					entitySchemaSlug: "collection",
					properties: { template: false },
				},
			],
		});

		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 1, name: "Road Trips" })).toBeTruthy(),
		);
		expect(page.container?.textContent).toContain("5 total");
		expect(page.container?.textContent).toContain("1 Media / book");
		expect(page.container?.textContent).toContain("1 Collections");
		expect(page.container?.textContent).toContain("More types not shown");
		expect(screen.queryByRole("button", { name: "Add" })).toBeNull();

		fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
		await waitFor(() =>
			expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
				"Name",
				"Type",
				"Template",
			]),
		);
		expect(page.container?.textContent).toContain("Media / book");
		expect(page.container?.textContent).toContain("Collections");
	});

	it("keeps schema-driven table configuration when the collection has zero members", async () => {
		const page = openCollection("col-empty", "layout=table");
		await answerCollection(page, {
			name: "Empty",
			membershipPropertiesSchema: {
				fields: {
					notes: { position: 0, type: "string", label: "Notes", description: "Membership notes" },
				},
			},
		});
		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 1, name: "Empty" })).toBeTruthy(),
		);
		expect(page.container?.textContent).toContain("This collection is empty.");
		expect(screen.getByRole("radio", { name: "Table view" }).getAttribute("aria-checked")).toBe(
			"true",
		);
	});

	it("counts all collection search matches on demand", async () => {
		const page = openCollection("col-1", "search=dune");
		await answerCollection(page, {
			name: "Books",
			hasMore: true,
			members: [
				{
					name: "Dune",
					properties: {},
					entityId: "book-1",
					ownerPluginId: "media",
					ownerPluginName: "Media",
					entitySchemaSlug: "book",
					populationStatus: "ready",
					translationStatus: "ready",
				},
			],
		});
		await waitFor(() => expect(screen.getByRole("button", { name: "Count all" })).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: "Count all" }));
		const count = await waitFor(() => {
			const found = page
				.queryRequests("count")
				.find((candidate) => JSON.stringify(candidate.document).includes("dune"));
			expect(found).toBeDefined();
			return found;
		});
		if (!count) {
			throw new Error("Filtered count request was not issued");
		}
		page.replyQuery(count.requestId, {
			outcome: "success",
			response: { data: { count: { type: "aggregate", items: [{ total: 12 }] } } },
		});
		await waitFor(() => expect(page.container?.textContent).toContain("1 of 12 results"));
		expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
	});

	it("uses shared mobile search and options without exposing Add", async () => {
		const page = openCollection();
		page.navigate(entityLocation("col-1", "collection"), { compact: true });
		await answerCollection(page, { name: "Mixed" });
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "View options, 0 active filters" })).toBeTruthy(),
		);
		expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Search this view" }));
		await waitFor(() =>
			expect(screen.getByRole("searchbox", { name: "Search Mixed" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Exit search" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "View options, 0 active filters" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: "View options, 0 active filters" }));
		const dialog = await waitFor(() => screen.getByRole("dialog", { name: "View options" }));
		expect(dialog.textContent).toContain("Collection order");
		fireEvent.click(screen.getByRole("button", { name: "Sort results: Collection order" }));
		await waitFor(() => expect(screen.getByRole("radio", { name: "Recently added" })).toBeTruthy());
		expect(dialog.textContent).toContain("Filters are not available yet.");
	});
});
