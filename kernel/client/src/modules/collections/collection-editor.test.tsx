import { expect, it } from "@effect/vitest";
import {
	CollectionBadRequest,
	CollectionNotFound,
	type CollectionResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Deferred, Effect, ManagedRuntime } from "effect";
import { StrictMode } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { CollectionsApi } from "#/api/collections";
import { decodeServerOrigin } from "#/api/origin";
import { makeCollectionsApi } from "#/api/ports.test-layer";
import { CollectionEditor } from "#/modules/collections/collection-editor";

const collectionId = EntityId.make("collection-1");
const response: CollectionResponse = {
	warnings: [],
	properties: {},
	id: collectionId,
	externalId: null,
	providerId: null,
	name: "Favourites",
	entitySchemaPluginId: null,
	createdAt: "2026-10-24T00:00:00Z",
	updatedAt: "2026-10-24T00:00:00Z",
	entitySchemaSlug: EntitySchemaSlug.make("collection"),
};

const mountEditor = (
	options: { readonly existing?: boolean; readonly api?: Partial<CollectionsApi["Service"]> } = {},
) => {
	const requests: unknown[] = [];
	const outcomes: unknown[] = [];
	let refreshes = 0;
	const runtime = ManagedRuntime.make(
		makeCollectionsApi({
			create: (_scope, request) =>
				Effect.sync(() => {
					requests.push(request.payload);
					return response;
				}),
			update: (_scope, request) =>
				Effect.sync(() => {
					requests.push(request.payload);
					return response;
				}),
			delete: (_scope, request) =>
				Effect.sync(() => {
					requests.push(request.payload);
					return { warnings: [], id: collectionId };
				}),
			...options.api,
		}),
	);
	const clock = createTestRyotClock({
		query: () =>
			Effect.succeed({
				data: {
					collection: {
						type: "rows",
						pageInfo: { limit: 30, hasMore: false, nextCursor: null },
						items: [
							{
								name: "Favourites",
								entityId: collectionId,
								description: "Old description",
								properties: {
									membershipFields: [
										{
											key: "notes",
											type: "text",
											label: "Notes",
											required: false,
											defaultValue: "Keep",
										},
									],
								},
							},
						],
					},
				},
			}),
	});
	const root = createRootRoute({
		component: Outlet,
		loader: () => {
			refreshes++;
		},
	});
	const editor = createRoute({
		path: "/",
		getParentRoute: () => root,
		component: () => (
			<CollectionEditor
				initialName="Draft"
				onClose={() => outcomes.push("closed")}
				onDeleted={() => outcomes.push("deleted")}
				onSaved={(id) => outcomes.push({ saved: id })}
				collectionId={options.existing ? collectionId : undefined}
			/>
		),
	});
	const away = createRoute({
		path: "/auth",
		getParentRoute: () => root,
		component: () => <p>Away</p>,
	});
	const router = createRouter({
		routeTree: root.addChildren([editor, away]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const view = render(
		<StrictMode>
			<RyotProvider
				runtime={clock.runtime}
				hostServices={{
					runtime,
					scope: { userId: "user-1", serverUrl: decodeServerOrigin("https://example.test") },
				}}
			>
				<RouterProvider router={router} />
			</RyotProvider>
		</StrictMode>,
	);
	return {
		router,
		requests,
		outcomes,
		getRefreshes: () => refreshes,
		dispose: () => {
			view.unmount();
			return Effect.runPromise(Effect.all([runtime.disposeEffect, Effect.promise(clock.dispose)]));
		},
	};
};

it.live(
	"retains create drafts on failure, hides old errors during retry, and reports only the explicit outcome",
	() =>
		Effect.gen(function* () {
			const gate = yield* Deferred.make<CollectionResponse, AuthenticatedApiError>();
			const requests: unknown[] = [];
			const view = mountEditor({
				api: {
					create: (_scope, request) =>
						Effect.suspend(() => {
							requests.push(request.payload);
							return requests.length === 1
								? Effect.fail(
										new AuthenticatedApiError({
											cause: new CollectionBadRequest({
												reason: { field: "name", code: "name-taken" },
											}),
										}),
									)
								: Deferred.await(gate);
						}),
				},
			});
			try {
				const name = yield* Effect.promise(() => screen.findByRole("textbox", { name: "Name" }));
				fireEvent.change(name, { target: { value: " " } });
				fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
				expect(screen.getByText("Enter a name.")).toBeDefined();
				expect(requests).toEqual([]);
				fireEvent.change(name, { target: { value: " Reading " } });
				fireEvent.change(screen.getByRole("textbox", { name: /^Description/ }), {
					target: { value: " " },
				});
				fireEvent.click(screen.getByRole("button", { name: "Add field" }));
				fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
					target: { value: " Mood " },
				});
				fireEvent.change(screen.getByRole("textbox", { name: /^Default value/ }), {
					target: { value: " Happy " },
				});
				fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
				yield* Effect.promise(() =>
					screen.findByText("You already have a collection with this name."),
				);
				expect(name).toHaveProperty("value", " Reading ");
				expect(view.outcomes).toEqual([]);
				const before = view.getRefreshes();
				fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
				yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
				expect(screen.queryByText("You already have a collection with this name.")).toBeNull();
				expect(name.matches(":disabled")).toBe(true);
				expect(screen.getByRole("textbox", { name: "Label" }).matches(":disabled")).toBe(true);
				expect(screen.getByRole("button", { name: "Add field" }).matches(":disabled")).toBe(true);
				expect(screen.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);
				fireEvent.keyDown(document, { key: "Escape" });
				expect(view.outcomes).toEqual([]);
				yield* Deferred.succeed(gate, response);
				yield* Effect.promise(() =>
					waitFor(() => expect(view.outcomes).toEqual([{ saved: collectionId }])),
				);
				expect(view.getRefreshes()).toBe(before + 1);
				expect(requests).toEqual(
					Array.from({ length: 2 }, () => ({
						name: "Reading",
						fields: [{ type: "text", label: "Mood", required: false, defaultValue: "Happy" }],
					})),
				);
				expect(screen.getByRole("dialog", { name: "New collection" })).toBeDefined();
				fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
				expect(view.outcomes).toEqual([{ saved: collectionId }, "closed"]);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
);

it.live("creates with a trimmed description and closes without writing when cancelled", () =>
	Effect.gen(function* () {
		const view = mountEditor();
		try {
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "New collection" }));
			fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
			expect(view.outcomes).toEqual(["closed"]);
			expect(view.requests).toEqual([]);
			fireEvent.change(screen.getByRole("textbox", { name: /^Description/ }), {
				target: { value: " A description " },
			});
			fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.outcomes).toEqual(["closed", { saved: collectionId }])),
			);
			expect(view.requests).toEqual([{ fields: [], name: "Draft", description: "A description" }]);
		} finally {
			yield* Effect.promise(view.dispose);
		}
	}),
);

for (const description of ["", " Updated description "]) {
	it.live(
		`updates existing field keys and defaults with description ${JSON.stringify(description)}`,
		() =>
			Effect.gen(function* () {
				const view = mountEditor({ existing: true });
				try {
					yield* Effect.promise(() => screen.findByRole("dialog", { name: "Edit Favourites" }));
					const editor = within(screen.getByRole("dialog"));
					fireEvent.change(editor.getByLabelText(/^Description/, { selector: "textarea" }), {
						target: { value: description },
					});
					fireEvent.click(editor.getByRole("button", { name: "Save collection" }));
					yield* Effect.promise(() =>
						waitFor(() => expect(view.outcomes).toEqual([{ saved: collectionId }])),
					);
					expect(view.requests).toEqual([
						{
							collectionId,
							name: "Favourites",
							description: description.trim() || null,
							fields: [
								{
									key: "notes",
									type: "text",
									label: "Notes",
									required: false,
									defaultValue: "Keep",
								},
							],
						},
					]);
				} finally {
					yield* Effect.promise(view.dispose);
				}
			}),
	);
}

const errors = [
	{
		message: "Enter a name.",
		cause: new CollectionBadRequest({ reason: { field: "name", code: "name-required" } }),
	},
	{
		message: "This collection changed elsewhere. Close and reopen it.",
		cause: new CollectionBadRequest({ reason: { collectionId, code: "collection-stale" } }),
	},
	{
		message: "The default value doesn't fit this field.",
		cause: new CollectionBadRequest({
			reason: { code: "invalid-fields", paths: [["fields", "0", "defaultValue"]] },
		}),
	},
	{
		message: "This field can't be kept; remove it and add it again.",
		cause: new CollectionBadRequest({
			reason: { code: "reserved-field-key", paths: [["fields", "0", "key"]] },
		}),
	},
	{
		message: "This collection no longer exists.",
		cause: new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } }),
	},
	{ cause: "transport", message: "The collection could not be saved. Try again." },
];

for (const { cause, message } of errors) {
	it.live(`shows the detailed save error: ${message}`, () =>
		Effect.gen(function* () {
			const view = mountEditor({
				existing: true,
				api: { update: () => Effect.fail(new AuthenticatedApiError({ cause })) },
			});
			try {
				yield* Effect.promise(() => screen.findByRole("dialog", { name: "Edit Favourites" }));
				fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
				yield* Effect.promise(() => screen.findByText(message));
				expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Favourites");
				expect(screen.getByRole("button", { name: "Save collection" }).matches(":disabled")).toBe(
					false,
				);
				expect(view.outcomes).toEqual([]);
				fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
				expect(view.outcomes).toEqual(["closed"]);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	);
}

it.live(
	"keeps deletion confirmation after failure, clears errors on reopen and retry, and freezes pending deletion",
	() =>
		Effect.gen(function* () {
			const gate = yield* Deferred.make<CollectionResponse>();
			let attempts = 0;
			const view = mountEditor({
				existing: true,
				api: {
					delete: () =>
						Effect.suspend(() =>
							++attempts < 3
								? Effect.fail(new AuthenticatedApiError({ cause: "transport" }))
								: Deferred.await(gate),
						),
				},
			});
			try {
				yield* Effect.promise(() => screen.findByRole("dialog", { name: "Edit Favourites" }));
				fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
				expect(attempts).toBe(0);
				let confirmation = within(screen.getByRole("dialog", { name: "Delete Favourites?" }));
				fireEvent.click(confirmation.getByRole("button", { name: "Delete collection" }));
				yield* Effect.promise(() =>
					screen.findByText("The collection could not be deleted. Try again."),
				);
				expect(view.outcomes).toEqual([]);
				fireEvent.click(confirmation.getByRole("button", { name: "Cancel" }));
				fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
				confirmation = within(screen.getByRole("dialog", { name: "Delete Favourites?" }));
				expect(screen.queryByText("The collection could not be deleted. Try again.")).toBeNull();
				fireEvent.click(confirmation.getByRole("button", { name: "Delete collection" }));
				yield* Effect.promise(() =>
					screen.findByText("The collection could not be deleted. Try again."),
				);
				fireEvent.click(confirmation.getByRole("button", { name: "Delete collection" }));
				yield* Effect.promise(() => waitFor(() => expect(attempts).toBe(3)));
				expect(screen.queryByText("The collection could not be deleted. Try again.")).toBeNull();
				expect(confirmation.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(
					true,
				);
				expect(
					screen.getByRole("textbox", { name: "Name", hidden: true }).matches(":disabled"),
				).toBe(true);
				fireEvent.keyDown(document, { key: "Escape" });
				expect(view.outcomes).toEqual([]);
				yield* Deferred.succeed(gate, response);
				yield* Effect.promise(() => waitFor(() => expect(view.outcomes).toEqual(["deleted"])));
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
);

for (const action of ["create", "update", "delete"] as const) {
	for (const result of ["success", "failure"] as const) {
		it.live(
			`interrupts local ${action} waiting on departure and suppresses late ${result} effects`,
			() =>
				Effect.gen(function* () {
					const context = yield* Effect.context();
					const gate = yield* Deferred.make<CollectionResponse, AuthenticatedApiError>();
					let started = 0;
					let interrupted = 0;
					const request = Effect.gen(function* () {
						started++;
						return yield* Deferred.await(gate);
					}).pipe(
						Effect.onInterrupt(() =>
							Effect.sync(() => {
								interrupted++;
							}),
						),
					);
					const view = mountEditor({
						existing: action !== "create",
						api: { [action]: () => request },
					});
					try {
						yield* Effect.promise(() =>
							screen.findByRole("dialog", {
								name: action === "create" ? "New collection" : "Edit Favourites",
							}),
						);
						if (action === "delete") {
							fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
							fireEvent.click(
								within(screen.getByRole("dialog", { name: "Delete Favourites?" })).getByRole(
									"button",
									{ name: "Delete collection" },
								),
							);
						} else {
							fireEvent.click(
								screen.getByRole("button", {
									name: action === "create" ? "Create collection" : "Save collection",
								}),
							);
						}
						yield* Effect.promise(() => waitFor(() => expect(started).toBe(1)));
						yield* Effect.promise(() =>
							act(() => view.router.navigate({ to: "/auth", search: { redirect: undefined } })),
						);
						yield* Effect.promise(() => screen.findByText("Away"));
						yield* Effect.promise(() => waitFor(() => expect(interrupted).toBe(1)));
						const before = view.getRefreshes();
						yield* Effect.promise(() =>
							act(() =>
								Effect.runPromiseWith(context)(
									result === "success"
										? Deferred.succeed(gate, response)
										: Deferred.fail(gate, new AuthenticatedApiError({ cause: "late failure" })),
								),
							),
						);
						expect(view.outcomes).toEqual([]);
						expect(view.getRefreshes()).toBe(before);
						expect(screen.queryByRole("dialog")).toBeNull();
					} finally {
						yield* Effect.promise(view.dispose);
					}
				}),
		);
	}
}
