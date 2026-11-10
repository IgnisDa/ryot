import { expect } from "bun:test";

import { EntityId } from "@ryot-app/contract/schema/brands";
import type {
	ChangeCollectionMembersOutcome,
	ChangeCollectionMembersRequest,
} from "@ryot-app/plugin-client-contract";
import { type RyotClientAdapter, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { ChangeCollectionMembers } from "./change-members";

const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 30, hasMore: false, nextCursor: null },
});

const entityIds = (first: string, ...rest: readonly string[]) =>
	[EntityId.make(first), ...rest.map((id) => EntityId.make(id))] as const;

type MembershipRequest = { readonly action: string; readonly input: { readonly entityId: string } };

const mountMembers = (
	request: ChangeCollectionMembersRequest,
	options: {
		readonly hangingEntityId?: string;
		readonly failOnceEntityIds?: readonly string[];
		readonly membershipFields?: readonly unknown[];
	} = {},
) => {
	const failed = new Set<string>();
	const interrupted: string[] = [];
	const requests: MembershipRequest[] = [];
	const outcomes: ChangeCollectionMembersOutcome[] = [];
	const adapter: Partial<RyotClientAdapter> = {
		query: (document) =>
			Effect.succeed(
				"collections" in document.queries
					? {
							data: {
								collections: rows([{ added: false, id: "collection-1", name: "Favourites" }]),
							},
						}
					: {
							data: {
								collection: rows([
									{
										name: "Favourites",
										entityId: "collection-1",
										properties: { membershipFields: options.membershipFields ?? [] },
									},
								]),
							},
						},
			),
		mutateCollection: (mutation) =>
			Effect.suspend(() => {
				if (mutation.action !== "upsert-membership" && mutation.action !== "remove-membership") {
					return Effect.fail(new RyotClientError({ reason: "invalid-request" }));
				}
				const { entityId } = mutation.input;
				if (entityId === options.hangingEntityId) {
					return Effect.never.pipe(
						Effect.onInterrupt(() => Effect.sync(() => interrupted.push(entityId))),
					);
				}
				requests.push(mutation);
				if (options.failOnceEntityIds?.includes(entityId) && !failed.has(entityId)) {
					failed.add(entityId);
					return Effect.fail(new RyotClientError({ reason: "transport" }));
				}
				return Effect.succeed({
					warnings: [],
					memberOf: {
						properties: {},
						sourceEntityId: entityId,
						id: `membership-${entityId}`,
						targetEntityId: "collection-1",
						relationshipSchemaPluginId: null,
						createdAt: "2026-10-22T00:00:00Z",
						relationshipSchemaSlug: "member-of",
					},
				});
			}),
	};
	const ryot = createTestRyotClock(adapter);
	const view = render(
		<RyotProvider runtime={ryot.runtime}>
			<ChangeCollectionMembers request={request} complete={(outcome) => outcomes.push(outcome)} />
		</RyotProvider>,
	);
	return {
		outcomes,
		interrupted,
		disposeView: () => {
			view.unmount();
			return ryot.dispose();
		},
		sortedRequests: () =>
			[...requests].sort((left, right) => left.input.entityId.localeCompare(right.input.entityId)),
	};
};

const chooseFavourites = Effect.promise(() =>
	screen.findByRole("button", { name: "Favourites" }),
).pipe(Effect.map((button) => fireEvent.click(button)));

it.live(
	"applies required membership details to every selected item",
	() =>
		Effect.gen(function* () {
			const view = mountMembers(
				{ kind: "add", entityIds: entityIds("entity-1", "entity-2", "entity-3") },
				{ membershipFields: [{ key: "notes", type: "text", label: "Notes", required: true }] },
			);
			try {
				yield* Effect.promise(() =>
					screen.findByRole("dialog", { name: "Add 3 items to a collection" }),
				);
				expect(screen.queryByText("Added")).toBeNull();
				yield* chooseFavourites;
				const dialog = yield* Effect.promise(() =>
					screen.findByRole("dialog", { name: "Add 3 items to Favourites" }),
				);
				expect(dialog.textContent).toContain("The details below will be applied to all 3 items.");
				fireEvent.click(within(dialog).getByRole("button", { name: "Add to collection" }));
				yield* Effect.promise(() => screen.findByText("Notes is required"));
				expect(view.sortedRequests()).toEqual([]);
				fireEvent.change(within(dialog).getByRole("textbox", { name: /Notes/ }), {
					target: { value: "Shared note" },
				});
				fireEvent.click(within(dialog).getByRole("button", { name: "Add to collection" }));
				yield* Effect.promise(() => screen.findByText("Added 3 items."));
				expect(view.sortedRequests()).toEqual(
					["entity-1", "entity-2", "entity-3"].map((entityId) => ({
						action: "upsert-membership",
						input: {
							entityId,
							mode: "add-if-absent",
							collectionId: "collection-1",
							properties: { notes: "Shared note" },
						},
					})),
				);
				expect(view.outcomes).toEqual([]);
				fireEvent.click(screen.getByRole("button", { name: "Done" }));
				expect(view.outcomes).toEqual([{ kind: "changed" }]);
			} finally {
				yield* Effect.promise(view.disposeView);
			}
		}),
	testTimeout,
);

it.live(
	"reports partial failures and retries only the failed items",
	() =>
		Effect.gen(function* () {
			const view = mountMembers(
				{ kind: "add", entityIds: entityIds("entity-1", "entity-2", "entity-3") },
				{ failOnceEntityIds: ["entity-2"] },
			);
			try {
				yield* chooseFavourites;
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Add to collection" })),
				);
				yield* Effect.promise(() => screen.findByText("Added 2 items."));
				expect(screen.getByRole("alert").textContent).toContain("1 item could not be added.");
				fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
				yield* Effect.promise(() => screen.findByText("Added 1 item."));
				expect(screen.queryByRole("alert")).toBeNull();
				expect(view.sortedRequests().map(({ input }) => input.entityId)).toEqual([
					"entity-1",
					"entity-2",
					"entity-2",
					"entity-3",
				]);
				fireEvent.click(screen.getByRole("button", { name: "Done" }));
				expect(view.outcomes).toEqual([{ kind: "changed" }]);
			} finally {
				yield* Effect.promise(view.disposeView);
			}
		}),
	testTimeout,
);

it.live(
	"confirms and removes the selected memberships",
	() =>
		Effect.gen(function* () {
			const view = mountMembers({
				kind: "remove",
				collectionId: EntityId.make("collection-1"),
				entityIds: entityIds("entity-1", "entity-2"),
			});
			try {
				const confirmation = yield* Effect.promise(() =>
					screen.findByRole("dialog", { name: "Remove 2 items from Favourites?" }),
				);
				expect(confirmation.textContent).toContain("The items stay in your library");
				fireEvent.click(
					within(confirmation).getByRole("button", { name: "Remove from collection" }),
				);
				yield* Effect.promise(() => screen.findByText("Removed 2 items."));
				expect(view.sortedRequests()).toEqual(
					["entity-1", "entity-2"].map((entityId) => ({
						action: "remove-membership",
						input: { entityId, collectionId: "collection-1" },
					})),
				);
				fireEvent.click(screen.getByRole("button", { name: "Done" }));
				expect(view.outcomes).toEqual([{ kind: "changed" }]);
			} finally {
				yield* Effect.promise(view.disposeView);
			}
		}),
	testTimeout,
);

it.live(
	"cancels without changing memberships",
	() =>
		Effect.gen(function* () {
			const adding = mountMembers({ kind: "add", entityIds: entityIds("entity-1") });
			try {
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Cancel" })),
				);
				expect(adding.outcomes).toEqual([{ kind: "cancelled" }]);
			} finally {
				yield* Effect.promise(adding.disposeView);
			}
			const removing = mountMembers({
				kind: "remove",
				entityIds: entityIds("entity-1"),
				collectionId: EntityId.make("collection-1"),
			});
			try {
				const confirmation = yield* Effect.promise(() =>
					screen.findByRole("dialog", { name: "Remove 1 item from Favourites?" }),
				);
				fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
				expect(removing.outcomes).toEqual([{ kind: "cancelled" }]);
				expect(removing.sortedRequests()).toEqual([]);
			} finally {
				yield* Effect.promise(removing.disposeView);
			}
		}),
	testTimeout,
);

it.live(
	"stops a running change and reports completed memberships",
	() =>
		Effect.gen(function* () {
			const view = mountMembers(
				{ kind: "add", entityIds: entityIds("entity-1", "entity-2") },
				{ hangingEntityId: "entity-2" },
			);
			try {
				yield* chooseFavourites;
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Add to collection" })),
				);
				yield* Effect.promise(() => screen.findByText("Adding 1 of 2 items…"));
				fireEvent.click(screen.getByRole("button", { name: "Stop" }));
				expect(view.outcomes).toEqual([{ kind: "changed" }]);
				yield* Effect.promise(() => waitFor(() => expect(view.interrupted).toEqual(["entity-2"])));
			} finally {
				yield* Effect.promise(view.disposeView);
			}
		}),
	testTimeout,
);
