import { expect, it } from "@effect/vitest";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { type RyotClientAdapter, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Schema } from "effect";

import { AddToCollection } from "./add-to-collection";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const rows = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 30, hasMore: false, nextCursor: null },
});

const mountManager = (
	options: {
		readonly collectionId?: string;
		readonly failFirstSave?: boolean;
		readonly membershipFields?: readonly unknown[];
	} = {},
) => {
	let properties: unknown;
	let attempts = 0;
	const requests: unknown[] = [];
	const outcomes: string[] = [];
	const adapter: Partial<RyotClientAdapter> = {
		mutateCollection: (request) =>
			Effect.suspend(() => {
				requests.push(request);
				if (options.failFirstSave && attempts++ === 0) {
					return Effect.fail(new RyotClientError("transport"));
				}
				if (request.action === "upsert-membership") {
					properties = request.input.properties;
				} else if (request.action === "remove-membership") {
					properties = undefined;
				}
				return Effect.succeed({
					warnings: [],
					memberOf: {
						id: "membership-1",
						sourceEntityId: "entity-1",
						properties: properties ?? {},
						targetEntityId: "collection-1",
						relationshipSchemaPluginId: null,
						createdAt: "2026-10-22T00:00:00Z",
						relationshipSchemaSlug: "member-of",
					},
				});
			}),
		query: (document) =>
			Effect.sync(() => {
				if ("target" in document.queries) {
					return { data: { target: rows([{ name: "Example item" }]) } };
				}
				if ("collections" in document.queries) {
					const searching = encodeJson(document).includes('"value":"Missing"');
					return {
						data: {
							collections: rows(
								searching
									? []
									: [{ id: "collection-1", name: "Favourites", added: properties !== undefined }],
							),
						},
					};
				}
				if ("collection" in document.queries) {
					return {
						data: {
							collection: rows([
								{
									name: "Favourites",
									entityId: "collection-1",
									properties: {
										membershipFields: options.membershipFields ?? [
											{ key: "notes", type: "text", label: "Notes", required: true },
										],
									},
								},
							]),
						},
					};
				}
				return { data: { membership: rows(properties === undefined ? [] : [{ properties }]) } };
			}),
	};
	const ryot = createTestRyotClock(adapter);
	const view = render(
		<RyotProvider runtime={ryot.runtime}>
			<AddToCollection
				entityId={EntityId.make("entity-1")}
				onSaved={() => outcomes.push("saved")}
				onClose={() => outcomes.push("cancelled")}
				onRemoved={() => outcomes.push("removed")}
				collectionId={
					options.collectionId === undefined ? undefined : EntityId.make(options.collectionId)
				}
			/>
		</RyotProvider>,
	);
	return {
		requests,
		outcomes,
		disposeView: () => {
			view.unmount();
			return ryot.dispose();
		},
	};
};

it.live("adds, edits, and removes membership details without closing the manager", () =>
	Effect.gen(function* () {
		const view = mountManager();
		try {
			yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Collections for Example item" }),
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Favourites" })),
			);
			const notes = yield* Effect.promise(() => screen.findByRole("textbox", { name: /Notes/ }));
			fireEvent.change(notes, { target: { value: "First note" } });
			fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
			yield* Effect.promise(() => screen.findByRole("button", { name: /Favourites\s*Added/ }));
			expect(view.outcomes).toEqual([]);
			expect(view.requests).toEqual([
				{
					action: "upsert-membership",
					input: {
						entityId: "entity-1",
						mode: "add-if-absent",
						collectionId: "collection-1",
						properties: { notes: "First note" },
					},
				},
			]);
			fireEvent.click(screen.getByRole("button", { name: /Favourites\s*Added/ }));
			const editNotes = yield* Effect.promise(() =>
				screen.findByRole("textbox", { name: /Notes/ }),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(editNotes).toHaveProperty("value", "First note")),
			);
			fireEvent.change(editNotes, { target: { value: "Updated note" } });
			fireEvent.click(screen.getByRole("button", { name: "Save details" }));
			yield* Effect.promise(() => screen.findByRole("button", { name: /Favourites\s*Added/ }));
			expect(view.outcomes).toEqual([]);
			fireEvent.click(screen.getByRole("button", { name: /Favourites\s*Added/ }));
			const remove = yield* Effect.promise(() =>
				screen.findByRole("button", { name: "Remove from collection" }),
			);
			fireEvent.click(remove);
			const confirmation = screen.getByRole("dialog", { name: "Remove from Favourites?" });
			expect(confirmation.textContent).toContain("The item stays in your library");
			fireEvent.click(within(confirmation).getByRole("button", { name: "Remove from collection" }));
			yield* Effect.promise(() => screen.findByRole("button", { name: "Favourites" }));
			expect(view.outcomes).toEqual([]);
			expect(view.requests.slice(1)).toEqual([
				{
					action: "upsert-membership",
					input: {
						entityId: "entity-1",
						collectionId: "collection-1",
						properties: { notes: "Updated note" },
					},
				},
				{
					action: "remove-membership",
					input: { entityId: "entity-1", collectionId: "collection-1" },
				},
			]);
			fireEvent.click(screen.getByRole("button", { name: "Done" }));
			expect(view.outcomes).toEqual(["removed"]);
		} finally {
			yield* Effect.promise(view.disposeView);
		}
	}),
);

it.live(
	"returns from a targeted membership, searches collections, and closes without changes",
	() =>
		Effect.gen(function* () {
			const view = mountManager({ collectionId: "collection-1" });
			try {
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Back to collections" })),
				);
				const search = screen.getByRole("textbox", { name: "Search collections" });
				fireEvent.change(search, { target: { value: "Missing" } });
				yield* Effect.promise(() => screen.findByText("No matching collections."));
				expect(screen.getByRole("button", { name: "Create “Missing” and add" })).toBeDefined();
				fireEvent.click(
					within(screen.getByRole("dialog")).getByRole("button", { name: "Close collections" }),
				);
				expect(view.outcomes).toEqual(["cancelled"]);
				expect(view.requests).toEqual([]);
			} finally {
				yield* Effect.promise(view.disposeView);
			}
		}),
);

it.live("keeps membership inputs after a failed save and reports the change only on Done", () =>
	Effect.gen(function* () {
		const view = mountManager({ failFirstSave: true });
		try {
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Favourites" })),
			);
			const notes = yield* Effect.promise(() => screen.findByRole("textbox", { name: /Notes/ }));
			fireEvent.change(notes, { target: { value: "Keep this note" } });
			fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
			yield* Effect.promise(() => screen.findByText("The item could not be added. Try again."));
			expect(notes.getAttribute("value")).toBe("Keep this note");
			expect(view.outcomes).toEqual([]);
			fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
			yield* Effect.promise(() => screen.findByRole("button", { name: /Favourites\s*Added/ }));
			fireEvent.click(screen.getByRole("button", { name: "Done" }));
			expect(view.outcomes).toEqual(["saved"]);
		} finally {
			yield* Effect.promise(view.disposeView);
		}
	}),
);

it.live("adds and removes members of a collection without member fields", () =>
	Effect.gen(function* () {
		const view = mountManager({ membershipFields: [] });
		try {
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Favourites" })),
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Add to collection" })),
			);
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: /Favourites\s*Added/ })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Favourites" }),
			);
			expect(dialog.textContent).toContain("This item is in this collection.");
			expect(within(dialog).queryByRole("button", { name: "Save details" })).toBeNull();
			fireEvent.click(within(dialog).getByRole("button", { name: "Remove from collection" }));
			fireEvent.click(
				within(screen.getByRole("dialog", { name: "Remove from Favourites?" })).getByRole(
					"button",
					{ name: "Remove from collection" },
				),
			);
			yield* Effect.promise(() => screen.findByRole("button", { name: "Favourites" }));
			expect(view.requests).toEqual([
				{
					action: "upsert-membership",
					input: {
						properties: {},
						entityId: "entity-1",
						mode: "add-if-absent",
						collectionId: "collection-1",
					},
				},
				{
					action: "remove-membership",
					input: { entityId: "entity-1", collectionId: "collection-1" },
				},
			]);
		} finally {
			yield* Effect.promise(view.disposeView);
		}
	}),
);
