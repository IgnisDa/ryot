import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import type { KeyedCollectionField } from "@ryot-app/contract/modules/collections/fields";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	disposePluginBridges,
	entityLocation,
	kernelEntityPageContext,
	mountPluginPage,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { Effect, Schema } from "effect";

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

const request = (page: ReturnType<typeof mountPluginPage>, name: string, index = 0) =>
	Effect.gen(function* () {
		yield* Effect.promise(() =>
			waitFor(() => expect(page.queryRequests(name).length).toBeGreaterThan(index)),
		);
		const found = page.queryRequests(name)[index];
		if (!found) {
			return yield* Effect.die(new Error(`${name} request ${index} was not issued`));
		}
		return found;
	});

type CollectionAnswer = {
	readonly groups?: readonly Record<string, JsonValue>[];
	readonly members?: readonly Record<string, JsonValue>[];
	readonly name: string;
	readonly hasMore?: boolean | undefined;
	readonly groupsHaveMore?: boolean | undefined;
	readonly membershipFields?: ReadonlyArray<KeyedCollectionField> | undefined;
	readonly description?: string | undefined;
	readonly total?: number | undefined;
};

const replyMembers = (
	page: ReturnType<typeof mountPluginPage>,
	requestId: string,
	input: Pick<CollectionAnswer, "members" | "hasMore">,
) =>
	page.replyQuery(requestId, {
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

const headerResponse = (input: CollectionAnswer) => ({
	data: {
		collection: {
			type: "rows" as const,
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
			items: [
				{
					name: input.name,
					entityId: "col-1",
					properties: {
						...(input.description === undefined ? {} : { description: input.description }),
						...(input.membershipFields === undefined
							? {}
							: { membershipFields: input.membershipFields }),
					},
				},
			],
		},
	},
});

const answerChrome = (
	page: ReturnType<typeof mountPluginPage>,
	input: CollectionAnswer,
	index = 0,
) =>
	Effect.gen(function* () {
		const [header, aggregate, count] = yield* Effect.all(
			[
				request(page, "collection", index),
				request(page, "aggregate", index),
				request(page, "count", index),
			],
			{ concurrency: "unbounded" },
		);
		page.replyQuery(header.requestId, { outcome: "success", response: headerResponse(input) });
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
	});

const answerCollection = (page: ReturnType<typeof mountPluginPage>, input: CollectionAnswer) =>
	Effect.gen(function* () {
		yield* answerChrome(page, input);
		const members = yield* request(page, "members");
		replyMembers(page, members.requestId, input);
	});

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const filtersParam = (filter: unknown) =>
	`filters=${Buffer.from(JSON.stringify(filter)).toString("base64url")}`;

const itemGroup = {
	count: 2,
	ownerPluginId: "fixture",
	entitySchemaSlug: "item",
	ownerPluginName: "Fixture",
};

const notesFields = [
	{ key: "notes", type: "text", label: "Notes", required: false, description: "Membership notes" },
] as const;

const hostScreenRequest = (
	page: ReturnType<typeof mountPluginPage>,
	type: "edit-collection-screen" | "add-to-collection-screen",
) =>
	Effect.promise(() =>
		waitFor(() => {
			const found = page.clientMessages().find((message) => message.type === type);
			assert(found?.type === type);
			return found;
		}),
	);

const itemMember = {
	name: "Sample",
	properties: {},
	entityId: "item-1",
	ownerPluginId: null,
	ownerPluginName: null,
	entitySchemaSlug: "item",
	populationStatus: "ready",
	translationStatus: "ready",
};

describe("collection detail", () => {
	afterEach(disposePluginBridges);

	it.live("shows the description and opens the kernel editor for the collection", () =>
		Effect.gen(function* () {
			const page = openCollection();
			yield* answerCollection(page, { name: "Road Trips", description: "Long drives" });
			yield* Effect.promise(() => waitFor(() => screen.getByText("Long drives")));

			fireEvent.click(screen.getByRole("button", { name: "Edit collection" }));
			const edit = yield* hostScreenRequest(page, "edit-collection-screen");
			expect(edit.collectionId).toBe("col-1");
			page.send({
				outcome: "success",
				requestId: edit.requestId,
				value: { kind: "deleted" },
				type: "edit-collection-screen-result",
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual(
						expect.objectContaining({
							mode: "replace",
							type: "navigate",
							target: { kind: "saved-view", reference: { kind: "kernel", slug: "collections" } },
						}),
					),
				),
			);
		}),
	);

	it.live("opens a member's collection details in the kernel screen", () =>
		Effect.gen(function* () {
			const page = openCollection();
			yield* answerCollection(page, { name: "Road Trips", members: [itemMember] });

			const details = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Collection details for Sample" }),
			);
			fireEvent.click(details);
			const add = yield* hostScreenRequest(page, "add-to-collection-screen");
			assert(add.type === "add-to-collection-screen");
			expect({ entityId: add.entityId, collectionId: add.collectionId }).toEqual({
				entityId: "item-1",
				collectionId: "col-1",
			});
		}),
	);

	it.live(
		"renders heterogeneous members and recipe-supplied template cells in the shared table",
		() =>
			Effect.gen(function* () {
				const page = openCollection();
				yield* answerCollection(page, {
					total: 5,
					name: "Road Trips",
					groupsHaveMore: true,
					membershipFields: [
						{
							key: "template",
							type: "boolean",
							required: false,
							label: "Template",
							description: "Uses the collection template",
						},
					],
					groups: [
						{
							count: 1,
							ownerPluginId: "fixture",
							entitySchemaSlug: "item",
							ownerPluginName: "Fixture",
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
							name: "Sample",
							entityId: "item-1",
							ownerPluginId: "fixture",
							entitySchemaSlug: "item",
							populationStatus: "ready",
							ownerPluginName: "Fixture",
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

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { level: 1, name: "Road Trips" })).toBeTruthy(),
					),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("5 total")),
				);
				expect(page.container?.textContent).toContain("1 Fixture / item");
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
							"Actions",
						]),
					),
				);
				expect(page.container?.textContent).toContain("Fixture / item");
				expect(page.container?.textContent).toContain("Collections");
			}),
	);

	it.live("keeps schema-driven table configuration when the collection has zero members", () =>
		Effect.gen(function* () {
			const page = openCollection("col-empty", "layout=table");
			yield* answerCollection(page, { name: "Empty", membershipFields: notesFields });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("heading", { level: 1, name: "Empty" })).toBeTruthy(),
				),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("This collection is empty.")),
			);
			expect(screen.getByRole("radio", { name: "Table view" }).getAttribute("aria-checked")).toBe(
				"true",
			);
		}),
	);

	it.live("counts all collection search matches on demand", () =>
		Effect.gen(function* () {
			const page = openCollection("col-1", "search=sample");
			yield* answerCollection(page, {
				name: "Items",
				hasMore: true,
				members: [
					{
						name: "Sample",
						properties: {},
						entityId: "item-1",
						ownerPluginId: "fixture",
						entitySchemaSlug: "item",
						populationStatus: "ready",
						ownerPluginName: "Fixture",
						translationStatus: "ready",
					},
				],
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("button", { name: "Count all" })).toBeTruthy()),
			);
			fireEvent.click(screen.getByRole("button", { name: "Count all" }));
			const count = yield* Effect.promise(() =>
				waitFor(() => {
					const found = page
						.queryRequests("count")
						.find((candidate) => JSON.stringify(candidate.document).includes("sample"));
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
			yield* answerCollection(page, { name: "Mixed" });
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
			expect(dialog.textContent).toContain("Add filter");
		}),
	);

	it.live(
		"keeps the desktop toolbar aligned with saved views and sorts from the Filters dialog",
		() =>
			Effect.gen(function* () {
				const page = openCollection();
				yield* answerCollection(page, {
					name: "Mixed",
					members: [
						{
							name: "Sample",
							properties: {},
							entityId: "item-1",
							ownerPluginId: "fixture",
							entitySchemaSlug: "item",
							populationStatus: "ready",
							ownerPluginName: "Fixture",
							translationStatus: "ready",
						},
					],
				});
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
				expect(dialog.textContent).toContain("Add filter");
				expect(dialog.textContent).not.toContain("View as");
				fireEvent.click(screen.getByRole("button", { name: "Sort results: Collection order" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("radio", { name: "Recently added" })).toBeTruthy()),
				);
			}),
	);

	it.live("requests only members when loading the next page", () =>
		Effect.gen(function* () {
			const page = openCollection();
			yield* answerCollection(page, {
				name: "Items",
				hasMore: true,
				groups: [itemGroup],
				members: [itemMember],
			});
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Load more results" })),
			);
			const second = yield* request(page, "members", 1);
			replyMembers(page, second.requestId, { members: [{ ...itemMember, entityId: "item-2" }] });
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("End of Items")),
			);
			expect(page.queryRequests("collection")).toHaveLength(1);
			expect(page.queryRequests("aggregate")).toHaveLength(1);
			expect(page.queryRequests("count")).toHaveLength(1);
			expect(page.queryRequests("members")).toHaveLength(2);
		}),
	);

	it.live("shows the known total without Count all until a filter is applied", () =>
		Effect.gen(function* () {
			const page = openCollection(
				"col-1",
				filtersParam({ field: "type", operator: "anyOf", values: ["fixture/item"] }),
			);
			yield* answerCollection(page, {
				total: 5,
				name: "Items",
				hasMore: true,
				groups: [itemGroup],
				members: [itemMember],
			});
			yield* Effect.promise(() => screen.findByRole("button", { name: "Count all" }));
			fireEvent.click(screen.getByRole("button", { name: "Count all" }));
			const count = yield* request(page, "count", 1);
			const document = yield* encodeJson(count.document);
			expect(document).toContain("fixture/item");
			expect(document).toContain("concat");
			page.replyQuery(count.requestId, {
				outcome: "success",
				response: { data: { count: { type: "aggregate", items: [{ total: 2 }] } } },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("1 of 2 results")),
			);
		}),
	);

	it.live("hides Count all and shows the loaded total when nothing narrows the members", () =>
		Effect.gen(function* () {
			const page = openCollection();
			yield* answerCollection(page, {
				total: 5,
				name: "Items",
				hasMore: true,
				groups: [itemGroup],
				members: [itemMember],
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("1 of 5 results")),
			);
			expect(screen.queryByRole("button", { name: "Count all" })).toBeNull();
			expect(page.queryRequests("count")).toHaveLength(1);
		}),
	);

	it.live("sends a membership property filter from the URL with the first members request", () =>
		Effect.gen(function* () {
			const page = openCollection(
				"col-1",
				filtersParam({ value: "road", operator: "contains", field: "membership.notes" }),
			);
			yield* answerChrome(page, { name: "Trips", membershipFields: notesFields });
			const first = yield* request(page, "members");
			const document = yield* encodeJson(first.document);
			expect(document).toContain('"road"');
			expect(document).toContain("membership.notes");
			replyMembers(page, first.requestId, { members: [itemMember] });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("group", { name: "Active filters" }).textContent).toContain(
						"Notes contains road",
					),
				),
			);
			expect(screen.getByRole("button", { name: "Filters, 1 active filter" })).toBeTruthy();
			expect(page.queryRequests("members")).toHaveLength(1);
		}),
	);

	it.live("offers type, also-in-collection and membership fields in the filters panel", () =>
		Effect.gen(function* () {
			const page = openCollection();
			yield* answerCollection(page, {
				name: "Items",
				groups: [itemGroup],
				members: [itemMember],
				membershipFields: notesFields,
			});
			yield* Effect.promise(() => screen.findByRole("button", { name: /^Filters/ }));
			fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: /^Add filter/ })),
			);
			for (const label of ["Type", "Also in collection", "Notes"]) {
				yield* Effect.promise(() => screen.findByRole("radio", { name: label }));
			}
		}),
	);

	it.live("recovers from a failed header load with Try again", () =>
		Effect.gen(function* () {
			const page = openCollection();
			const header = yield* request(page, "collection");
			page.replyQuery(header.requestId, { outcome: "failure", reason: "query-failed" });
			yield* Effect.promise(() => screen.findByText("Collection unavailable"));
			expect(page.container?.textContent).toContain("The collection could not be loaded.");

			fireEvent.click(screen.getByRole("button", { name: "Try again" }));
			const retry = yield* request(page, "collection", 1);
			page.replyQuery(retry.requestId, {
				outcome: "success",
				response: headerResponse({ name: "Back" }),
			});
			const aggregate = yield* request(page, "aggregate");
			const count = yield* request(page, "count");
			page.replyQuery(aggregate.requestId, {
				outcome: "success",
				response: { data: { aggregate: { items: [], type: "aggregate" } } },
			});
			page.replyQuery(count.requestId, {
				outcome: "success",
				response: { data: { count: { type: "aggregate", items: [{ total: 0 }] } } },
			});
			const members = yield* request(page, "members");
			replyMembers(page, members.requestId, {});
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Back" })).toBeTruthy()),
			);
		}),
	);

	it.live("filters on a membership field added after a refresh", () =>
		Effect.gen(function* () {
			const page = openCollection("col-1", "layout=table");
			const scored = { ...itemMember, properties: { score: 7 } };
			yield* answerCollection(page, {
				name: "Trips",
				groups: [itemGroup],
				members: [itemMember],
				membershipFields: notesFields,
			});
			const answered = new Set(page.queryRequests("members").map(({ requestId }) => requestId));
			const answerPending = () => {
				for (const pending of page.queryRequests("members")) {
					if (!answered.has(pending.requestId)) {
						answered.add(pending.requestId);
						replyMembers(page, pending.requestId, { members: [scored] });
					}
				}
			};
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0)),
			);

			const grown = [
				...notesFields,
				{ key: "score", type: "number", label: "Score", required: false },
			] as const;
			page.send({ type: "page-refresh" });
			yield* answerChrome(page, { name: "Trips", groups: [itemGroup], membershipFields: grown }, 1);
			yield* Effect.promise(() =>
				waitFor(() => {
					answerPending();
					expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toContain(
						"Score",
					);
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("7")),
			);

			fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: /^Add filter/ })),
			);
			fireEvent.click(yield* Effect.promise(() => screen.findByRole("radio", { name: "Score" })));
			const before = page.queryRequests("members").length;
			fireEvent.change(
				yield* Effect.promise(() => screen.findByRole("spinbutton", { name: "Score value" })),
				{ target: { value: "3" } },
			);
			const filtered = yield* Effect.promise(() =>
				waitFor(() => {
					const found = page.queryRequests("members")[before];
					assert(found !== undefined);
					return found;
				}),
			);
			const document = yield* encodeJson(filtered.document);
			expect(document).toContain("membership.score");
			expect(document).toContain('"gte"');
			answerPending();
			fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Filters, 1 active filter" })).toBeTruthy(),
				),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("7")),
			);
		}),
	);
});
