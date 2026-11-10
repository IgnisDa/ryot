import { afterEach, describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, getByLabelText, getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { act, createRef } from "react";

import { activityLogQuery, contextTarget } from "../../tests/client/activity-log/fixtures";
import {
	decodeFlatActivity,
	flatCompletionEventRow,
	flatReviewEventRow,
} from "../../tests/client/flat-media/activity-fixture";
import { fixtureSchema } from "../../tests/client/flat-media/schema-fixture";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaReviewForm } from "./review";
import type { ReviewCompletion } from "./review-about";

afterEach(() => {
	document.body.innerHTML = "";
});

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const occurrence = (
	id: string,
	eventSchemaSlug: string,
	occurredAt: string,
	createdAt = occurredAt,
) => ({
	id,
	createdAt,
	occurredAt,
	position: null,
	eventSchemaSlug,
	dateUnknown: null,
	calendarDate: null,
});

const eventually = <A,>(check: () => A) => Effect.promise(() => waitFor(check));

const input = (element: HTMLElement, value: string) =>
	act(() => {
		fireEvent.change(element, { target: { value } });
	});

const chooseAbout = (dialog: HTMLElement, label: string) => {
	clickRyotElement(getByRole(dialog, "button", { name: /^About: / }));
	clickRyotElement(
		getByRole(getByRole(document.body, "dialog", { name: "About" }), "radio", { name: label }),
	);
};

const reviewForm = (completion?: ReviewCompletion) => (
	<MediaReviewForm
		entityId="media-1"
		completion={completion}
		triggerRef={createRef()}
		onClose={() => undefined}
	/>
);

describe("review links", () => {
	it.live(
		"saves the chosen occurrence as what a new review is about",
		() =>
			Effect.gen(function* () {
				const background = createTestBackgroundSubmissions();
				const mounted = mountRyotClient(
					{
						...background.adapter,
						query: () =>
							Effect.succeed({
								data: {
									events: rows([
										occurrence("finished", "complete", "2026-11-03T20:00:00.000Z"),
										occurrence("paused", "on_hold", "2026-10-01T20:00:00.000Z"),
									]),
								},
							}),
					},
					reviewForm(),
				);
				try {
					const dialog = yield* eventually(() =>
						getByRole(document.body, "dialog", { name: "Rate or review" }),
					);
					yield* eventually(() =>
						expect(
							getByRole(dialog, "button", { name: "About: Not a specific time" }).hasAttribute(
								"disabled",
							),
						).toBe(false),
					);
					chooseAbout(dialog, "Finished · Nov 3, 2026");
					expect(
						getByRole(dialog, "button", { name: "About: Finished · Nov 3, 2026" }),
					).toBeDefined();
					input(getByLabelText(dialog, "Rating (out of 100, optional)"), "75");
					clickRyotElement(getByRole(dialog, "button", { name: "Save review" }));
					yield* eventually(() => expect(background.requests).toHaveLength(1));
					expect(background.requests[0]).toMatchObject({
						slug: "media-review-create",
						input: { rating: 75, entityId: "media-1", consumptionEventId: "finished" },
					});
				} finally {
					mounted.unmount();
				}
			}),
		testTimeout,
	);

	it.live(
		"chooses the completion a just-logged activity created once it settles",
		() =>
			Effect.gen(function* () {
				let settled = false;
				const mounted = mountRyotClient(
					{
						query: () =>
							Effect.succeed({
								data: {
									events: rows([
										...(settled
											? [
													occurrence(
														"just-finished",
														"complete",
														"2026-01-01T00:00:00.000Z",
														"2026-11-10T09:00:00.000Z",
													),
												]
											: []),
										occurrence("older", "complete", "2026-02-01T00:00:00.000Z"),
									]),
								},
							}),
					},
					reviewForm("pending"),
				);
				try {
					const dialog = yield* eventually(() =>
						getByRole(document.body, "dialog", { name: "Rate or review" }),
					);
					yield* eventually(() => expect(dialog.textContent).toContain("Saving your activity…"));
					expect(getByRole(dialog, "button", { name: "About: Not a specific time" })).toBeDefined();
					settled = true;
					mounted.rerender(reviewForm("saved"));
					yield* eventually(() =>
						expect(
							getByRole(dialog, "button", { name: "About: Finished · Jan 1, 2026" }),
						).toBeDefined(),
					);
					expect(dialog.textContent).not.toContain("Saving your activity…");
				} finally {
					mounted.unmount();
				}
			}),
		testTimeout,
	);

	it.live(
		"marks a reviewed record, opens its review and says what each review is about",
		() =>
			Effect.gen(function* () {
				const base = activityLogQuery({ target: contextTarget({ id: "entity-1" }) });
				const review = {
					...flatReviewEventRow,
					properties: { rating: 91, consumptionEventId: flatCompletionEventRow.id },
				};
				const mounted = mountRyotClient(
					{
						readUserSettings: () => Effect.succeed({}),
						watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
						query: (document) =>
							"reviews" in document.queries
								? Effect.succeed({
										data: {
											reviews: rows([
												{
													...review,
													position: null,
													consumptionEventId: flatCompletionEventRow.id,
												},
											]),
											occurrences: rows([
												occurrence(
													flatCompletionEventRow.id,
													"complete",
													flatCompletionEventRow.occurredAt,
												),
											]),
										},
									})
								: base(document),
					},
					<fixtureSchema.Activity
						compact
						entityId="entity-1"
						refresh={() => undefined}
						state={fixtureSchema.mapActivity(
							readyQueryResult(
								decodeFlatActivity({
									collectionEvents: [],
									events: [flatCompletionEventRow, review],
								}),
							),
						)}
					/>,
				);
				try {
					yield* eventually(() =>
						expect(mounted.container.textContent).toContain("About your pass on Nov 4, 2025"),
					);
					clickRyotElement(getByRole(mounted.container, "button", { name: "Reviewed" }));
					const dialog = yield* eventually(() =>
						getByRole(document.body, "dialog", { name: "Edit review" }),
					);
					expect(getByLabelText(dialog, "Review (optional)")).toHaveProperty(
						"value",
						"The twist still lands.",
					);
					clickRyotElement(getByRole(dialog, "button", { name: "Cancel" }));
					expect(queryByRole(document.body, "dialog")).toBeNull();
				} finally {
					mounted.unmount();
				}
			}),
		testTimeout,
	);
});
