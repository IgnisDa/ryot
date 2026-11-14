import { expect } from "bun:test";

import { EventStale } from "@ryot-app/contract/modules/events/schemas";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { EventsApi } from "#/api/events";
import { makeEventsApi } from "#/api/ports.test-layer";
import { mountHostedTestScreen } from "#/host-screen.test-support";

import { CollectionReviewScreen } from "./review-screen";
import type { CollectionReview } from "./review-service";

const collectionId = EntityId.make("collection-1");
const migrated: CollectionReview = {
	sessionEntityId: null,
	entityId: collectionId,
	id: EventId.make("legacy-review"),
	occurredAt: "2025-01-02T03:04:05.000Z",
	properties: { rating: 0, isSpoiler: true, text: "Original thoughts" },
};

const pageInfo = { limit: 2, hasMore: false, nextCursor: null };
const account = {
	image: null,
	id: "user-1",
	name: "Reader",
	email: "reader@example.com",
	preferences: {
		language: null,
		ratingScale: "ten",
		reportingTimeZone: "UTC",
		disableIntegrations: false,
	},
};

const mountReviews = (overrides: Partial<EventsApi["Service"]> = {}) => {
	const requests: unknown[] = [];
	const outcomes: unknown[] = [];
	let rows: readonly CollectionReview[] = [migrated];
	const view = mountHostedTestScreen(
		<CollectionReviewScreen
			collectionId={collectionId}
			complete={(outcome) => outcomes.push(outcome)}
		/>,
		{
			query: (document) => {
				if (Object.hasOwn(bindTestRequest(document).queries, "user")) {
					return Effect.succeed({ data: { user: { pageInfo, type: "rows", items: [account] } } });
				}
				return Effect.succeed({
					data: Object.hasOwn(bindTestRequest(document).queries, "collection")
						? {
								collection: {
									pageInfo,
									type: "rows",
									items: [{ properties: {}, name: "Favourites", entityId: collectionId }],
								},
							}
						: {
								reviews: {
									items: rows,
									type: "rows",
									pageInfo: { limit: 20, hasMore: false, nextCursor: null },
								},
							},
				});
			},
			layer: makeEventsApi({
				update: (_scope, request) =>
					Effect.sync(() => {
						requests.push(request.payload);
						return { warnings: [], eventId: migrated.id };
					}),
				delete: (_scope, request) =>
					Effect.sync(() => {
						requests.push(request.params);
						rows = [];
						return { warnings: [], eventId: migrated.id };
					}),
				create: (_scope, request) =>
					Effect.sync(() => {
						requests.push(request.payload);
						return {
							count: 0,
							warnings: [],
							failure: null,
							outcomes: [{ index: 0, reason: "policy", status: "skipped_by_policy" }],
						};
					}),
				...overrides,
			}),
		},
	);
	return { ...view, requests, outcomes };
};

it.live(
	"shows dated migrated reviews, reveals spoilers, and deletes only after confirmation",
	() =>
		Effect.gen(function* () {
			const view = mountReviews();
			yield* Effect.addFinalizer(() => Effect.promise(view.dispose));
			yield* Effect.promise(() => screen.findByRole("img", { name: "0.0 out of 10" }));
			expect(screen.queryByText("Original thoughts")).toBeNull();
			expect(document.querySelector("time")?.dateTime).toBe(migrated.occurredAt);
			fireEvent.click(screen.getByRole("button", { name: "Show spoiler" }));
			expect(screen.getByText("Original thoughts")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Edit review" }));
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Edit review" }));
			fireEvent.click(screen.getByRole("button", { name: "Delete review" }));
			const confirmation = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Delete this review?" }),
			);
			expect(view.requests).toEqual([]);
			fireEvent.click(within(confirmation).getByRole("button", { name: "Delete review" }));
			yield* Effect.promise(() => screen.findByText("No reviews yet."));
			expect(view.requests).toEqual([{ eventId: migrated.id }]);
			fireEvent.click(
				within(screen.getByRole("dialog", { name: "Reviews of Favourites" })).getByRole("button", {
					name: "Close reviews",
				}),
			);
			expect(view.outcomes).toEqual([{ kind: "changed" }]);
		}),
	testTimeout,
);

it.live(
	"rejects invalid ratings and keeps the draft when creation is skipped",
	() =>
		Effect.gen(function* () {
			const view = mountReviews();
			yield* Effect.addFinalizer(() => Effect.promise(view.dispose));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Post a review" })),
			);
			const editor = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Post a review" }),
			);
			const save = within(editor).getByRole("button", { name: "Save review" });
			expect(save.hasAttribute("disabled")).toBe(true);
			fireEvent.change(
				within(editor).getByRole("textbox", { name: "Rating (out of 10, optional)" }),
				{ target: { value: "11" } },
			);
			expect(save.hasAttribute("disabled")).toBe(true);
			fireEvent.change(within(editor).getByRole("textbox", { name: /Rating/ }), {
				target: { value: "7.5" },
			});
			fireEvent.change(within(editor).getByRole("textbox", { name: /Review/ }), {
				target: { value: " New thoughts " },
			});
			fireEvent.click(save);
			yield* Effect.promise(() =>
				screen.findByText("The review was not saved. Check your review and try again."),
			);
			expect(view.requests).toEqual([
				[
					{
						entityId: collectionId,
						eventSchemaSlug: "review",
						properties: { rating: 75, isSpoiler: false, text: "New thoughts" },
					},
				],
			]);
			expect(
				within(editor).getByDisplayValue(" New thoughts ", { normalizer: (value) => value }),
			).toBeTruthy();
			expect(view.outcomes).toEqual([]);
		}),
	testTimeout,
);

it.live(
	"submits the original review precondition and retains edits on conflict",
	() =>
		Effect.gen(function* () {
			const requests: unknown[] = [];
			const view = mountReviews({
				update: (_scope, request) =>
					Effect.sync(() => requests.push(request.payload)).pipe(
						Effect.andThen(
							Effect.fail(
								new AuthenticatedApiError({
									cause: new EventStale({ reason: { code: "event-stale", eventId: migrated.id } }),
								}),
							),
						),
					),
			});
			yield* Effect.addFinalizer(() => Effect.promise(view.dispose));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Edit review" })),
			);
			const editor = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Edit review" }),
			);
			fireEvent.change(within(editor).getByRole("textbox", { name: /Rating/ }), {
				target: { value: "" },
			});
			fireEvent.change(within(editor).getByRole("textbox", { name: /Review/ }), {
				target: { value: "Changed thoughts" },
			});
			fireEvent.click(within(editor).getByRole("button", { name: "Save review" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(requests).toEqual([
						{
							properties: {
								remove: ["rating"],
								set: { isSpoiler: true, text: "Changed thoughts" },
							},
							expected: {
								kind: "fields",
								absentProperties: [],
								sessionEntityId: null,
								entityId: collectionId,
								occurredAt: migrated.occurredAt,
								properties: migrated.properties,
							},
						},
					]),
				),
			);
			yield* Effect.promise(() =>
				screen.findByText("This review changed elsewhere. Close and reopen it before saving."),
			);
			expect(within(editor).getByDisplayValue("Changed thoughts")).toBeTruthy();
		}),
	testTimeout,
);
