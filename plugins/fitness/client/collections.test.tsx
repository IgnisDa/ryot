import { afterEach, assert, expect, it } from "@effect/vitest";
import { EntityId, RelationshipId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act } from "react";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { AddEntityToCollection } from "./collections";

afterEach(disposePluginBridges);

const mountCollectionPicker = (onClose: () => void) => {
	const pluginId = PluginId.make("fitness");
	return mountPluginPage(
		() => (
			<PluginScreenFrame title="Workout">
				<AddEntityToCollection onClose={onClose} entityId="workout" />
			</PluginScreenFrame>
		),
		{
			location: routeLocation("/"),
			page: {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { pluginId, kind: "plugin", exportName: "workout-detail" },
				target: { path: "/", search: "", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
				contributors: [
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				],
			},
		},
	);
};

const rows = (
	items: readonly Record<string, unknown>[],
	pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: string | null;
	} = { limit: 30, hasMore: false, nextCursor: null },
) => ({ items, pageInfo, type: "rows" as const });

const collectionRequests = (page: ReturnType<typeof mountPluginPage>) =>
	page.clientMessages().filter((message) => message.type === "collection-request");

it.live("searches collection options and retries the same membership properties", () =>
	Effect.gen(function* () {
		let closed = 0;
		const page = mountCollectionPicker(() => {
			closed += 1;
		});
		const firstQuery = yield* Effect.promise(() =>
			waitFor(() => {
				const request = page.queryRequests("collections")[0];
				assert(request);
				return request;
			}),
		);
		expect(firstQuery.document.queries.collections?.from.alias).toBe("collectionOption");
		page.replyQuery(firstQuery.requestId, {
			outcome: "success",
			response: {
				data: {
					collections: rows([
						{ added: true, id: "already-added", name: "Already in workout" },
						{ added: false, name: "Favorites", id: "collection-1" },
					]),
				},
			},
		});
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(screen.getByRole("button", { name: /Already in workout/ })).toBeTruthy(),
			),
		);
		expect(screen.getByRole("button", { name: /Already in workout/ }).textContent).toContain(
			"Already added",
		);
		expect(
			screen.getByRole("button", { name: /Already in workout/ }).hasAttribute("disabled"),
		).toBe(true);

		act(() => {
			fireEvent.change(screen.getByRole("textbox", { name: "Search collections" }), {
				target: { value: "Train" },
			});
		});
		const searchQuery = yield* Effect.promise(() =>
			waitFor(() => {
				const request = page.queryRequests("collections")[1];
				assert(request);
				return request;
			}),
		);
		expect(searchQuery.document.queries.collections?.from.alias).toBe("collectionOption");
		expect(searchQuery.document.queries.collections?.where).toMatchObject({
			predicates: expect.arrayContaining([
				expect.objectContaining({ type: "contains", right: { value: "Train", type: "literal" } }),
			]),
		});
		page.replyQuery(searchQuery.requestId, {
			outcome: "success",
			response: {
				data: { collections: rows([{ added: false, id: "collection-1", name: "Training log" }]) },
			},
		});
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.getByRole("button", { name: "Training log" })).toBeTruthy()),
		);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Training log" }));
		});
		const headerQuery = yield* Effect.promise(() =>
			waitFor(() => {
				const request = page.queryRequests("collection")[0];
				assert(request);
				return request;
			}),
		);
		page.replyQuery(headerQuery.requestId, {
			outcome: "success",
			response: {
				data: {
					collection: rows([
						{
							name: "Training log",
							entityId: "collection-1",
							properties: {
								membershipPropertiesSchema: {
									fields: {
										note: {
											label: "Note",
											type: "string",
											description: "Workout note",
											validation: { required: true },
										},
									},
								},
							},
						},
					]),
				},
			},
		});
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(screen.getByRole("dialog", { name: "Add to Training log" })).toBeTruthy(),
			),
		);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
		});
		expect(collectionRequests(page)).toHaveLength(0);
		act(() => {
			fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
				target: { value: "After the run" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
		});
		const first = yield* Effect.promise(() =>
			waitFor(() => {
				const request = collectionRequests(page)[0];
				assert(request?.type === "collection-request");
				return request;
			}),
		);
		expect(first.action).toBe("upsert-membership");
		expect(first.input).toEqual({
			entityId: "workout",
			mode: "add-if-absent",
			collectionId: "collection-1",
			properties: { note: "After the run" },
		});
		page.send({
			outcome: "failure",
			reason: "transport",
			type: "collection-result",
			requestId: first.requestId,
		});
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.getByRole("button", { name: "Retry adding" })).toBeTruthy()),
		);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Retry adding" }));
		});
		const retry = yield* Effect.promise(() =>
			waitFor(() => {
				const request = collectionRequests(page)[1];
				assert(request?.type === "collection-request");
				return request;
			}),
		);
		expect(retry.input).toEqual(first.input);
		page.send({
			outcome: "success",
			type: "collection-result",
			requestId: retry.requestId,
			response: {
				warnings: [],
				memberOf: {
					relationshipSchemaPluginId: null,
					properties: { note: "After the run" },
					createdAt: "2026-10-16T12:00:00.000Z",
					id: RelationshipId.make("membership-1"),
					sourceEntityId: EntityId.make("workout"),
					targetEntityId: EntityId.make("collection-1"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
				},
			},
		});
		yield* Effect.promise(() => waitFor(() => expect(closed).toBe(1)));
	}),
);

it.live("keeps the first option page when showing more and disables added options", () =>
	Effect.gen(function* () {
		const page = mountCollectionPicker(() => {});
		const firstQuery = yield* Effect.promise(() =>
			waitFor(() => {
				const request = page.queryRequests("collections")[0];
				assert(request);
				return request;
			}),
		);
		page.replyQuery(firstQuery.requestId, {
			outcome: "success",
			response: {
				data: {
					collections: rows([{ added: false, id: "collection-first", name: "First collection" }], {
						limit: 30,
						hasMore: true,
						nextCursor: "cursor-2",
					}),
				},
			},
		});
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.getByRole("button", { name: "First collection" })).toBeTruthy()),
		);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Show more collections" }));
		});
		const secondQuery = yield* Effect.promise(() =>
			waitFor(() => {
				const request = page.queryRequests("collections")[1];
				assert(request);
				return request;
			}),
		);
		const secondPage = secondQuery.document.queries.collections?.output;
		assert(secondPage?.type === "rows");
		expect(secondPage.pagination.after).toBe("cursor-2");
		page.replyQuery(secondQuery.requestId, {
			outcome: "success",
			response: {
				data: {
					collections: rows([
						{ added: true, id: "collection-second", name: "Already added collection" },
					]),
				},
			},
		});
		yield* Effect.promise(() =>
			waitFor(() =>
				expect(
					screen.getByRole("button", { name: /Already added collection/ }).hasAttribute("disabled"),
				).toBe(true),
			),
		);
		expect(screen.getByRole("button", { name: /Already added collection/ }).textContent).toContain(
			"Already added",
		);
		expect(screen.getByRole("button", { name: "First collection" })).toBeTruthy();
	}),
);
