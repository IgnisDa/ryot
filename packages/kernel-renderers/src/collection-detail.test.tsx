import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	disposePluginBridges,
	entityLocation,
	kernelEntityPageContext,
	mountPluginPage,
} from "@ryot-app/client-sdk/testing";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { Effect } from "effect";

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

const request = (page: ReturnType<typeof mountPluginPage>, name: string) =>
	waitFor(() => expect(page.queryRequests(name).length).toBeGreaterThan(0)).then(() => {
		const found = page.queryRequests(name)[0];
		if (!found) {
			throw new Error(`${name} request was not issued`);
		}
		return found;
	});

const answerCollection = (
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
) =>
	request(page, "collection")
		.then((header) => {
			expect(page.queryRequests()).toHaveLength(1);
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
			return Promise.all([
				request(page, "aggregate"),
				request(page, "count"),
				request(page, "members"),
			]);
		})
		.then(([aggregate, count, members]) => {
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
			return undefined;
		});

describe("collection detail", () => {
	afterEach(disposePluginBridges);

	it.live(
		"renders heterogeneous members and recipe-supplied template cells in the shared table",
		() =>
			Effect.gen(function* () {
				const page = openCollection();
				yield* Effect.promise(() =>
					answerCollection(page, {
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
							{
								count: 1,
								ownerPluginId: "media",
								ownerPluginName: "Media",
								entitySchemaSlug: "book",
							},
							{
								count: 1,
								ownerPluginId: null,
								ownerPluginName: null,
								entitySchemaSlug: "collection",
							},
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
					}),
				);

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { level: 1, name: "Road Trips" })).toBeTruthy(),
					),
				);
				expect(page.container?.textContent).toContain("5 total");
				expect(page.container?.textContent).toContain("1 Media / book");
				expect(page.container?.textContent).toContain("1 Collections");
				expect(page.container?.textContent).toContain("More types not shown");
				expect(screen.queryByRole("button", { name: "Add" })).toBeNull();

				fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
							"Name",
							"Type",
							"Template",
						]),
					),
				);
				expect(page.container?.textContent).toContain("Media / book");
				expect(page.container?.textContent).toContain("Collections");
			}),
	);

	it.live("keeps schema-driven table configuration when the collection has zero members", () =>
		Effect.gen(function* () {
			const page = openCollection("col-empty", "layout=table");
			yield* Effect.promise(() =>
				answerCollection(page, {
					name: "Empty",
					membershipPropertiesSchema: {
						fields: {
							notes: {
								position: 0,
								type: "string",
								label: "Notes",
								description: "Membership notes",
							},
						},
					},
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("heading", { level: 1, name: "Empty" })).toBeTruthy(),
				),
			);
			expect(page.container?.textContent).toContain("This collection is empty.");
			expect(screen.getByRole("radio", { name: "Table view" }).getAttribute("aria-checked")).toBe(
				"true",
			);
		}),
	);

	it.live("counts all collection search matches on demand", () =>
		Effect.gen(function* () {
			const page = openCollection("col-1", "search=dune");
			yield* Effect.promise(() =>
				answerCollection(page, {
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
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("button", { name: "Count all" })).toBeTruthy()),
			);
			fireEvent.click(screen.getByRole("button", { name: "Count all" }));
			const count = yield* Effect.promise(() =>
				waitFor(() => {
					const found = page
						.queryRequests("count")
						.find((candidate) => JSON.stringify(candidate.document).includes("dune"));
					expect(found).toBeDefined();
					return found;
				}),
			);
			if (!count) {
				throw new Error("Filtered count request was not issued");
			}
			page.replyQuery(count.requestId, {
				outcome: "success",
				response: { data: { count: { type: "aggregate", items: [{ total: 12 }] } } },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("1 of 12 results")),
			);
			expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
		}),
	);

	it.live("uses shared mobile search and options without exposing Add", () =>
		Effect.gen(function* () {
			const page = openCollection();
			page.navigate(entityLocation("col-1", "collection"), { compact: true });
			yield* Effect.promise(() => answerCollection(page, { name: "Mixed" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByRole("button", { name: "View options, 0 active filters" }),
					).toBeTruthy(),
				),
			);
			expect(screen.queryByRole("button", { name: /Add/ })).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Search this view" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("searchbox", { name: "Search Mixed" })).toBeTruthy()),
			);
			fireEvent.click(screen.getByRole("button", { name: "Exit search" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByRole("button", { name: "View options, 0 active filters" }),
					).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "View options, 0 active filters" }));
			const dialog = yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("dialog", { name: "View options" })),
			);
			expect(dialog.textContent).toContain("Collection order");
			fireEvent.click(screen.getByRole("button", { name: "Sort results: Collection order" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("radio", { name: "Recently added" })).toBeTruthy()),
			);
			expect(dialog.textContent).toContain("Filters are not available yet.");
		}),
	);

	it.live(
		"keeps the desktop toolbar aligned with saved views and sorts from the Filters dialog",
		() =>
			Effect.gen(function* () {
				const page = openCollection();
				yield* Effect.promise(() =>
					answerCollection(page, {
						name: "Mixed",
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
					}),
				);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { level: 1, name: "Mixed" })).toBeTruthy(),
					),
				);
				expect(screen.queryByRole("button", { name: /^Sort results/ })).toBeNull();
				fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
				const dialog = yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("dialog", { name: "Filters" })),
				);
				expect(dialog.textContent).toContain("Collection order");
				expect(dialog.textContent).toContain("Filters are not available yet.");
				expect(dialog.textContent).not.toContain("View as");
				fireEvent.click(screen.getByRole("button", { name: "Sort results: Collection order" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("radio", { name: "Recently added" })).toBeTruthy()),
				);
			}),
	);
});
