import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import {
	fireEvent,
	getByLabelText,
	getByRole,
	queryByRole,
	waitFor,
	within,
} from "@testing-library/dom";
import { Deferred } from "effect";
import { act } from "react";

import { creatorFixtureSchema } from "../../tests/client/creator/schema-fixture";
import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../tests/client/flat-media/summary-fixture";
import { clickRyotElement, mountRyotClient, pressRyotKey } from "../../tests/client/test-support";
import { MediaReviewButton } from "./review";
import { MediaSummaryHeader } from "./summary-header";

const input = (element: HTMLElement, value: string) =>
	act(() => {
		fireEvent.change(element, { target: { value } });
	});

it.live(
	"opens from the header, hands one review to the shell, blocks duplicates and closes on acceptance",
	() =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const requests: unknown[] = [];
			const mounted = mountRyotClient(
				{
					...createTestBackgroundSubmissions().adapter,
					submitBackground: (request) =>
						Effect.gen(function* () {
							requests.push(request);
							yield* Deferred.await(release);
							return "submission-1";
						}),
				},
				<MediaSummaryHeader
					compact
					settled={undefined}
					artwork={{ purpose: "cover", aspect: "poster" }}
					media={decodeFlatSummary(fixtureSummaryRecipe, { images: [] })}
					detail={{
						chips: [],
						facts: [],
						links: [],
						identityDetail: undefined,
						rail: {
							logActivity: {
								family: "flat",
								copy: { verb: "watch", noun: "movie", gerund: "watching", participle: "watched" },
							},
						},
					}}
				/>,
			);
			try {
				const trigger = getByRole(mounted.container, "button", { name: "Rate or review" });
				clickRyotElement(trigger);
				const dialog = getByRole(document.body, "dialog", { name: "Rate or review" });
				expect(within(dialog).getByRole("form", { name: "Rate or review" }).tagName).toBe("DIV");
				const save = within(dialog).getByRole("button", { name: "Save review" });
				expect(save.getAttribute("type")).toBe("button");
				expect(save.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "Review (optional)"), "   ");
				expect(save.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "Review (optional)"), "  Great ending  ");
				input(getByLabelText(dialog, "Rating (0–100, optional)"), "101");
				expect(save.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "Rating (0–100, optional)"), "82.5");
				clickRyotElement(within(dialog).getByRole("switch", { name: "Contains spoilers" }));
				clickRyotElement(save);
				yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(1)));
				expect(save.hasAttribute("disabled")).toBe(true);
				clickRyotElement(save);
				pressRyotKey("Escape");
				expect(queryByRole(document.body, "dialog")).not.toBeNull();
				expect(requests).toEqual([
					{
						label: "Review",
						packageId: "ryot/media",
						slug: "media-review-create",
						idempotencyKey: expect.any(String),
						input: { rating: 82.5, isSpoiler: true, entityId: "media-1", text: "Great ending" },
					},
				]);
				yield* Deferred.succeed(release, undefined);
				yield* Effect.promise(() =>
					waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
				);
				clickRyotElement(trigger);
				const reopened = getByRole(document.body, "dialog");
				expect(getByLabelText(reopened, "Review (optional)")).toHaveProperty("value", "");
			} finally {
				mounted.unmount();
			}
		}),
);

it.live("saves with Enter in the rating field without submitting a native form", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				...createTestBackgroundSubmissions().adapter,
				submitBackground: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return "submission-1";
					}),
			},
			<MediaReviewButton entityId="media-1" />,
		);
		try {
			clickRyotElement(getByRole(mounted.container, "button", { name: "Rate or review" }));
			const dialog = getByRole(document.body, "dialog");
			const text = getByLabelText(dialog, "Review (optional)");
			input(text, "Thoughts");
			act(() => {
				fireEvent.keyDown(text, { key: "Enter" });
			});
			expect(requests).toEqual([]);
			const rating = getByLabelText(dialog, "Rating (0–100, optional)");
			input(rating, "80");
			act(() => {
				fireEvent.keyDown(rating, { key: "Enter" });
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
			);
			expect(requests).toEqual([
				{
					label: "Review",
					packageId: "ryot/media",
					slug: "media-review-create",
					idempotencyKey: expect.any(String),
					input: { rating: 80, text: "Thoughts", isSpoiler: false, entityId: "media-1" },
				},
			]);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("saves a zero rating without text and keeps spoiler controls hidden", () =>
	Effect.gen(function* () {
		const background = createTestBackgroundSubmissions();
		const mounted = mountRyotClient(background.adapter, <MediaReviewButton entityId="media-1" />);
		try {
			clickRyotElement(getByRole(mounted.container, "button", { name: "Rate or review" }));
			const dialog = getByRole(document.body, "dialog");
			const rating = getByLabelText(dialog, "Rating (0–100, optional)");
			expect(document.activeElement).toBe(rating);
			expect(queryByRole(dialog, "switch", { name: "Contains spoilers" })).toBeNull();
			input(getByLabelText(dialog, "Review (optional)"), "   ");
			input(rating, "0");
			clickRyotElement(getByRole(dialog, "button", { name: "Save review" }));
			yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(1)));
			expect(background.requests[0]).toMatchObject({
				slug: "media-review-create",
				input: { rating: 0, text: null, isSpoiler: false, entityId: "media-1" },
			});
		} finally {
			mounted.unmount();
		}
	}),
);

for (const invalidRating of ["not a number", "1e", "-1", "101"]) {
	it.live(`shows an inline error and blocks saving the invalid rating ${invalidRating}`, () =>
		Effect.gen(function* () {
			const requests: unknown[] = [];
			const mounted = mountRyotClient(
				{
					...createTestBackgroundSubmissions().adapter,
					submitBackground: (request) =>
						Effect.sync(() => {
							requests.push(request);
							return "submission-1";
						}),
				},
				<MediaReviewButton entityId="media-1" />,
			);
			try {
				clickRyotElement(getByRole(mounted.container, "button", { name: "Rate or review" }));
				const dialog = getByRole(document.body, "dialog");
				input(getByLabelText(dialog, "Review (optional)"), "Thoughts");
				const rating = getByLabelText(dialog, "Rating (0–100, optional)");
				input(rating, invalidRating);
				expect(rating).toHaveProperty("value", invalidRating);
				expect(getByRole(dialog, "alert").textContent).toBe("Enter a number from 0 to 100.");
				expect(rating.getAttribute("aria-describedby")).toBe(getByRole(dialog, "alert").id);
				expect(rating.getAttribute("aria-invalid")).toBe("true");
				const save = within(dialog).getByRole("button", { name: "Save review" });
				expect(save.hasAttribute("disabled")).toBe(true);
				clickRyotElement(save);
				act(() => {
					fireEvent.keyDown(rating, { key: "Enter" });
				});
				expect(requests).toEqual([]);
				input(rating, "0");
				expect(queryByRole(dialog, "alert")).toBeNull();
				expect(rating.getAttribute("aria-invalid")).toBe("false");
				clickRyotElement(save);
				yield* Effect.promise(() =>
					waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
				);
				expect(requests).toEqual([
					{
						label: "Review",
						packageId: "ryot/media",
						slug: "media-review-create",
						idempotencyKey: expect.any(String),
						input: { rating: 0, text: "Thoughts", isSpoiler: false, entityId: "media-1" },
					},
				]);
			} finally {
				mounted.unmount();
			}
		}),
	);
}

it.live("opens from empty activity and cancels without saving", () =>
	Effect.sync(() => {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				...createTestBackgroundSubmissions().adapter,
				submitBackground: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return "submission-1";
					}),
			},
			<creatorFixtureSchema.Activity
				compact
				entityId="creator-1"
				refresh={() => undefined}
				state={{ status: "empty" }}
			/>,
		);
		try {
			clickRyotElement(getByRole(mounted.container, "button", { name: "Rate or review" }));
			const dialog = getByRole(document.body, "dialog");
			input(getByLabelText(dialog, "Review (optional)"), "Draft");
			clickRyotElement(within(dialog).getByRole("button", { name: "Cancel" }));
			expect(queryByRole(document.body, "dialog")).toBeNull();
			expect(requests).toEqual([]);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("keeps the draft and allows another try when the shell refuses the review", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				...createTestBackgroundSubmissions().adapter,
				submitBackground: (request) =>
					Effect.gen(function* () {
						requests.push(request);
						if (requests.length === 1) {
							return yield* new RyotClientError("operation-failed");
						}
						return "submission-2";
					}),
			},
			<MediaReviewButton link entityId="creator-1" />,
		);
		try {
			clickRyotElement(getByRole(mounted.container, "button", { name: "Rate or review" }));
			const dialog = getByRole(document.body, "dialog");
			input(getByLabelText(dialog, "Review (optional)"), "Thoughts");
			clickRyotElement(within(dialog).getByRole("button", { name: "Save review" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(dialog, "alert").textContent).toContain("Couldn't start saving"),
				),
			);
			expect(getByLabelText(dialog, "Review (optional)")).toHaveProperty("value", "Thoughts");
			clickRyotElement(within(dialog).getByRole("button", { name: "Save review" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
			);
			expect(requests).toEqual(
				[1, 2].map(() => ({
					label: "Review",
					packageId: "ryot/media",
					slug: "media-review-create",
					idempotencyKey: expect.any(String),
					input: { rating: null, text: "Thoughts", isSpoiler: false, entityId: "creator-1" },
				})),
			);
		} finally {
			mounted.unmount();
		}
	}),
);
