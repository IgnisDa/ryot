import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
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
	"opens from the header, saves one review, blocks duplicate writes and closes on success",
	() =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const requests: unknown[] = [];
			const mounted = mountRyotClient(
				{
					invokeOperation: (request) =>
						Effect.gen(function* () {
							requests.push(request);
							yield* Deferred.await(release);
							return { count: 1 };
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
						rail: { logActivity: true },
					}}
				/>,
			);
			try {
				const trigger = getByRole(mounted.container, "button", { name: "Write review" });
				clickRyotElement(trigger);
				const dialog = getByRole(document.body, "dialog", { name: "Write review" });
				const save = within(dialog).getByRole("button", { name: "Save review" });
				expect(save.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "Review"), "   ");
				expect(save.hasAttribute("disabled")).toBe(true);
				input(getByLabelText(dialog, "Review"), "  Great ending  ");
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
						packageId: "ryot/media",
						slug: "media-review-create",
						input: { rating: 82.5, isSpoiler: true, entityId: "media-1", text: "Great ending" },
					},
				]);
				yield* Deferred.succeed(release, undefined);
				yield* Effect.promise(() =>
					waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
				);
				clickRyotElement(trigger);
				const reopened = getByRole(document.body, "dialog");
				expect(getByLabelText(reopened, "Review")).toHaveProperty("value", "");
			} finally {
				mounted.unmount();
			}
		}),
);

it.live("opens from empty activity and cancels without saving", () =>
	Effect.sync(() => {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				invokeOperation: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return { count: 1 };
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
			clickRyotElement(getByRole(mounted.container, "button", { name: "Write review" }));
			const dialog = getByRole(document.body, "dialog");
			input(getByLabelText(dialog, "Review"), "Draft");
			clickRyotElement(within(dialog).getByRole("button", { name: "Cancel" }));
			expect(queryByRole(document.body, "dialog")).toBeNull();
			expect(requests).toEqual([]);
		} finally {
			mounted.unmount();
		}
	}),
);

for (const failure of ["transport", "zero-count"] as const) {
	it.live(`keeps the draft and allows retry after ${failure}`, () =>
		Effect.gen(function* () {
			const requests: unknown[] = [];
			const mounted = mountRyotClient(
				{
					invokeOperation: (request) =>
						Effect.gen(function* () {
							requests.push(request);
							if (requests.length === 1) {
								if (failure === "transport") {
									return yield* new RyotClientError("operation-failed");
								}
								return { count: 0 };
							}
							return { count: 1 };
						}),
				},
				<MediaReviewButton link entityId="creator-1" />,
			);
			try {
				clickRyotElement(getByRole(mounted.container, "button", { name: "Write review" }));
				const dialog = getByRole(document.body, "dialog");
				input(getByLabelText(dialog, "Review"), "Thoughts");
				clickRyotElement(within(dialog).getByRole("button", { name: "Save review" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(getByRole(dialog, "alert").textContent).toContain("Unable to save")),
				);
				expect(getByLabelText(dialog, "Review")).toHaveProperty("value", "Thoughts");
				clickRyotElement(within(dialog).getByRole("button", { name: "Save review" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
				);
				expect(requests).toEqual(
					[1, 2].map(() => ({
						packageId: "ryot/media",
						slug: "media-review-create",
						input: { text: "Thoughts", isSpoiler: false, entityId: "creator-1" },
					})),
				);
			} finally {
				mounted.unmount();
			}
		}),
	);
}
