import { afterEach, describe, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getAllByRole, getByRole, queryByRole, waitFor } from "@testing-library/dom";

import {
	flatCollectionAddedEventRow,
	flatProgressEventRow,
	flatReviewEventRow,
} from "../../tests/client/flat-media/activity-fixture";
import { fixtureSchema } from "../../tests/client/flat-media/schema-fixture";
import { rowsResult } from "../../tests/client/query-result-fixture";
import {
	clickRyotElement,
	flushRyotClient,
	mountRyotClient,
} from "../../tests/client/test-support";

const rows = (items: readonly unknown[], hasMore = false) =>
	rowsResult(items, { hasMore, limit: 60, nextCursor: hasMore ? "source-cursor" : null });
const activity = (hasMore: boolean) => ({
	data: {
		collectionEvents: rows([]),
		events: rows([flatReviewEventRow], hasMore),
		totals: rows([{ completionCount: 0, consumedAmount: null, unknownAmountCount: 0 }]),
	},
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("complete activity history", () => {
	it.live("hides the button and footer when all activities are already shown", () =>
		Effect.gen(function* () {
			const view = mountRyotClient(
				{
					watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
					query: (document) =>
						Effect.succeed(
							"work" in document.queries
								? { data: { work: rows([]), active: rows([]), checkpoint: rows([]) } }
								: activity(false),
						),
				},
				<fixtureSchema.ActivityTab compact safeAreaTop={12} entityId="media-1" />,
			);
			yield* Effect.promise(() => flushRyotClient());
			yield* Effect.promise(() =>
				waitFor(() => expect(view.container.textContent).toContain("The twist still lands.")),
			);
			expect(queryByRole(view.container, "button", { name: "View complete history" })).toBeNull();
			expect(view.container.textContent).not.toContain("Only your most recent activity");
			view.unmount();
		}),
	);

	it.live(
		"loads only on open, appends older activities, retries failures, and restores focus",
		() =>
			Effect.gen(function* () {
				const documents: unknown[] = [];
				let appendAttempts = 0;
				const view = mountRyotClient(
					{
						watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
						query: (document) => {
							if ("work" in document.queries) {
								return Effect.succeed({
									data: { work: rows([]), active: rows([]), checkpoint: rows([]) },
								});
							}
							documents.push(document);
							if ("totals" in document.queries) {
								return Effect.succeed(activity(true));
							}
							const appending = JSON.stringify(document).includes('"operator":"lt"');
							if (appending && appendAttempts++ === 0) {
								return Effect.fail(new RyotClientError("transport"));
							}
							return Effect.succeed({
								data: {
									collectionEvents: rows(appending ? [flatCollectionAddedEventRow] : []),
									events: rows(
										appending
											? [{ ...flatProgressEventRow, progressPercent: 12 }]
											: [flatReviewEventRow],
										!appending,
									),
								},
							});
						},
					},
					<fixtureSchema.ActivityTab compact safeAreaTop={12} entityId="media-1" />,
				);
				yield* Effect.promise(() => flushRyotClient());
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							getByRole(view.container, "button", { name: "View complete history" }),
						).toBeDefined(),
					),
				);
				expect(documents).toHaveLength(1);
				const trigger = getByRole(view.container, "button", { name: "View complete history" });
				clickRyotElement(trigger);
				yield* Effect.promise(() => flushRyotClient());
				const dialog = getByRole(document.body, "dialog", { name: "Complete activity history" });
				yield* Effect.promise(() =>
					waitFor(() => expect(dialog.textContent).toContain("The twist still lands.")),
				);
				expect(documents).toHaveLength(2);
				clickRyotElement(getByRole(dialog, "button", { name: "Load more" }));
				yield* Effect.promise(() => flushRyotClient());
				yield* Effect.promise(() =>
					waitFor(() => expect(dialog.textContent).toContain("Unable to load these activities")),
				);
				expect(dialog.textContent).toContain("The twist still lands.");
				clickRyotElement(getByRole(dialog, "button", { name: "Try again" }));
				yield* Effect.promise(() => flushRyotClient());
				yield* Effect.promise(() =>
					waitFor(() => expect(dialog.textContent).toContain("12% through the item")),
				);
				expect(dialog.textContent).toContain("The twist still lands.");
				expect(dialog.textContent).toContain("Watchlist");
				expect(getAllByRole(dialog, "button", { name: "Record actions" })).toHaveLength(2);
				expect(queryByRole(dialog, "button", { name: "Load more" })).toBeNull();
				expect(appendAttempts).toBe(2);
				clickRyotElement(getByRole(dialog, "button", { name: "Close activity history" }));
				expect(queryByRole(document.body, "dialog")).toBeNull();
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
				view.unmount();
			}),
	);
});
