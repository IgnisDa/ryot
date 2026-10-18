import { describe, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { getByRole, getByText, queryByRole, waitFor } from "@testing-library/dom";

import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaHistoryCorrectionStatus } from "./history-correction-status";

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 2, hasMore: false, nextCursor: null });

const response = (
	work: readonly unknown[],
	checkpoint: readonly unknown[],
	active: readonly unknown[] = [],
) => ({ data: { work: rows(work), active: rows(active), checkpoint: rows(checkpoint) } });

describe("media history correction status", () => {
	it.live("shows pending history and refreshes activity after correction settles", () =>
		Effect.gen(function* () {
			let phase: "pending" | "settled" = "pending";
			let queries = 0;
			let refreshes = 0;
			const background = createTestBackgroundSubmissions();
			const mounted = mountRyotClient(
				{
					...background.adapter,
					query: () => {
						queries += 1;
						return Effect.succeed(
							phase === "pending"
								? response(
										[{ status: "succeeded" }],
										[{ phase: "progress" }],
										[{ id: "older-running-work" }],
									)
								: response([{ status: "succeeded" }], [{ phase: "done" }]),
						);
					},
				},
				<MediaHistoryCorrectionStatus
					entityId="media-1"
					refreshActivity={() => (refreshes += 1)}
				/>,
			);
			try {
				yield* Effect.promise(() => mounted.advance(0));
				expect(mounted.container.textContent).toContain("Updating history…");
				expect(mounted.container.textContent).toContain("Large corrections can appear in stages.");
				expect(queries).toBe(1);

				phase = "settled";
				yield* Effect.promise(() => mounted.advance(1000));
				expect(queries).toBe(2);
				expect(refreshes).toBe(1);
				expect(queryByRole(mounted.container, "status")).toBeNull();
			} finally {
				mounted.unmount();
			}
		}),
	);

	it.live(
		"offers retry for an incomplete checkpoint without work and reports retry failure generically",
		() =>
			Effect.gen(function* () {
				const background = createTestBackgroundSubmissions();
				const mounted = mountRyotClient(
					{
						...background.adapter,
						query: () => Effect.succeed(response([], [{ phase: "progress" }])),
					},
					<MediaHistoryCorrectionStatus entityId="media-1" refreshActivity={() => undefined} />,
				);
				try {
					yield* Effect.promise(() => mounted.advance(0));
					expect(mounted.container.textContent).toContain("Could not finish updating history.");
					const button = getByRole(mounted.container, "button", { name: "Try again" });
					clickRyotElement(button);
					yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(1)));
					expect(background.requests[0]).toMatchObject({
						packageId: "ryot/media",
						label: "Retry history update",
						input: { entityId: "media-1" },
						slug: "media-history-correction-retry",
					});
					expect(background.requests[0]?.input).toMatchObject({
						submissionId: background.requests[0]?.idempotencyKey,
					});

					yield* Effect.sync(() =>
						background.settle("submission-1", {
							status: "failed",
							reason: "operation-rejected",
							message: "Internal reason is not shown",
						}),
					);
					expect(
						getByText(mounted.container, "Could not start the retry. Try again."),
					).toBeTruthy();
					expect(mounted.container.textContent).not.toContain("Internal reason is not shown");
				} finally {
					mounted.unmount();
				}
			}),
	);

	it.live("does not claim settled when the status read fails and offers refresh", () =>
		Effect.gen(function* () {
			const background = createTestBackgroundSubmissions();
			let shouldFail = true;
			const mounted = mountRyotClient(
				{
					...background.adapter,
					query: () =>
						shouldFail
							? Effect.fail(new RyotClientError("transport"))
							: Effect.succeed(response([{ status: "succeeded" }], [{ phase: "done" }])),
				},
				<MediaHistoryCorrectionStatus entityId="media-1" refreshActivity={() => undefined} />,
			);
			try {
				yield* Effect.promise(() => mounted.advance(0));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(mounted.container.textContent).toContain("Could not check history status."),
					),
				);
				expect(mounted.container.textContent).not.toContain("Updating history…");
				expect(mounted.container.textContent).not.toContain("Could not finish updating history.");
				const refresh = getByRole(mounted.container, "button", { name: "Try again" });
				shouldFail = false;
				clickRyotElement(refresh);
				yield* Effect.promise(() =>
					waitFor(() => expect(queryByRole(mounted.container, "status")).toBeNull()),
				);
			} finally {
				mounted.unmount();
			}
		}),
	);
});
