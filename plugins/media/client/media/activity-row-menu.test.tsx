import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import {
	fireEvent,
	getAllByRole,
	getByLabelText,
	getByRole,
	queryByRole,
	waitFor,
} from "@testing-library/dom";
import { act } from "react";

import { mediaActivityPatchableKeys } from "../../shared/media-activity-fields";
import { activityLogQuery, contextTarget } from "../../tests/client/activity-log/fixtures";
import {
	decodeFlatActivity,
	flatBacklogEventRow,
	flatCollectionAddedEventRow,
	flatCompletionEventRow,
	flatLibraryEventRow,
	flatProgressEventRow,
	flatReviewEventRow,
} from "../../tests/client/flat-media/activity-fixture";
import { fixtureSchema } from "../../tests/client/flat-media/schema-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";

afterEach(() => {
	document.body.innerHTML = "";
});

const watchEntities = () => ({ update: () => undefined, dispose: () => undefined });

const sameDayProgress = (id: string, hour: number) => ({
	...flatProgressEventRow,
	id,
	createdAt: `2025-11-04T${hour}:00:05.000Z`,
	occurredAt: `2025-11-04T${hour}:00:00.000Z`,
});

const mount = (events: readonly Record<string, unknown>[]) => {
	const background = createTestBackgroundSubmissions();
	const view = mountRyotClient(
		{
			...background.adapter,
			watchEntities,
			readUserSettings: () => Effect.succeed({}),
			query: activityLogQuery({ target: contextTarget({ id: "entity-1" }) }),
		},
		<fixtureSchema.Activity
			compact
			entityId="entity-1"
			refresh={() => undefined}
			state={fixtureSchema.mapActivity(
				readyQueryResult(
					decodeFlatActivity({ events, collectionEvents: [flatCollectionAddedEventRow] }),
				),
			)}
		/>,
	);
	return { view, background };
};

const eventually = (check: () => void) => Effect.promise(() => waitFor(check));

const menus = (container: HTMLElement) =>
	getAllByRole(container, "button", { name: "Record actions" });

const choose = (menu: HTMLElement, item: string) => {
	clickRyotElement(menu);
	clickRyotElement(getByRole(document.body, "menuitem", { name: item }));
};

const menuItems = (menu: HTMLElement) => {
	clickRyotElement(menu);
	const items = getAllByRole(document.body, "menuitem").map((element) => element.textContent);
	act(() => {
		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
	});
	return items;
};

const snapshot = (row: { readonly occurredAt: string }, properties: Record<string, unknown>) => ({
	properties,
	entityId: "entity-1",
	sessionEntityId: null,
	occurredAt: row.occurredAt,
	absentProperties: mediaActivityPatchableKeys.filter((key) => !(key in properties)),
});

describe("activity row menu", () => {
	it.live("offers a menu only on rows that map to stored activity records", () =>
		Effect.gen(function* () {
			const { view } = mount([
				flatLibraryEventRow,
				flatBacklogEventRow,
				flatCompletionEventRow,
				flatReviewEventRow,
			]);
			expect(menus(view.container)).toHaveLength(3);
			yield* Effect.void;
		}),
	);

	it.live("deletes every record a folded row stands for under one idempotency key", () =>
		Effect.gen(function* () {
			const { view, background } = mount([
				sameDayProgress("progress-early", 10),
				sameDayProgress("progress-late", 11),
				flatCompletionEventRow,
			]);
			const [menu] = menus(view.container);
			if (menu === undefined) {
				throw new Error("Expected a completion row menu");
			}
			expect(menuItems(menu)).toEqual(["Delete"]);
			choose(menu, "Delete");
			const dialog = getByRole(document.body, "dialog", { name: "Delete 3 records?" });
			clickRyotElement(getByRole(dialog, "button", { name: "Delete 3 records" }));
			yield* eventually(() => expect(background.requests).toHaveLength(1));
			const [request] = background.requests;
			expect(request).toMatchObject({
				packageId: "ryot/media",
				label: "Delete 3 records",
				slug: "media-activity-delete",
				input: { eventIds: ["media-complete", "progress-late", "progress-early"] },
			});
			expect(request?.input).not.toHaveProperty("expected");
			expect(request?.input).toMatchObject({ submissionId: request?.idempotencyKey });
			yield* eventually(() =>
				expect(queryByRole(document.body, "dialog", { name: "Delete 3 records?" })).toBeNull(),
			);
			background.settle("submission-1", { status: "incomplete" });
			expect(queryByRole(document.body, "dialog")).toBeNull();
		}),
	);

	it.live("deletes a single record under its snapshot precondition", () =>
		Effect.gen(function* () {
			const { view, background } = mount([flatBacklogEventRow]);
			const [menu] = menus(view.container);
			if (menu === undefined) {
				throw new Error("Expected a backlog row menu");
			}
			expect(menuItems(menu)).toEqual(["Delete"]);
			choose(menu, "Delete");
			clickRyotElement(
				getByRole(getByRole(document.body, "dialog", { name: "Delete this record?" }), "button", {
					name: "Delete record",
				}),
			);
			yield* eventually(() => expect(background.requests).toHaveLength(1));
			expect(background.requests[0]?.input).toMatchObject({
				eventIds: ["media-backlog"],
				expected: snapshot(flatBacklogEventRow, {}),
			});
		}),
	);

	it.live("edits one completion with the Log activity fields and sends only the change", () =>
		Effect.gen(function* () {
			const properties = { timeSpent: 169 };
			const { view, background } = mount([{ ...flatCompletionEventRow, properties }]);
			yield* Effect.promise(() => view.setTime(Date.parse("2026-10-20T09:00:00.000Z")));
			const [menu] = menus(view.container);
			if (menu === undefined) {
				throw new Error("Expected a completion row menu");
			}
			choose(menu, "Edit");
			yield* eventually(() =>
				expect(queryByRole(document.body, "dialog", { name: "Edit activity" })).not.toBeNull(),
			);
			const dialog = getByRole(document.body, "dialog", { name: "Edit activity" });
			const save = getByRole(dialog, "button", { name: "Save changes" });
			expect(save.hasAttribute("disabled")).toBe(true);
			expect(getByLabelText(dialog, "Hours")).toHaveProperty("value", "2");
			expect(getByLabelText(dialog, "Minutes")).toHaveProperty("value", "49");
			act(() => {
				fireEvent.change(getByLabelText(dialog, /Where did you use it\?/), {
					target: { value: " Plex " },
				});
			});
			clickRyotElement(save);
			yield* eventually(() => expect(background.requests).toHaveLength(1));
			expect(background.requests[0]).toMatchObject({
				label: "Edit activity",
				slug: "media-activity-update",
				input: {
					eventId: "media-complete",
					patch: { consumedOn: "Plex" },
					expected: snapshot(flatCompletionEventRow, properties),
				},
			});
			expect(background.requests[0]?.input).toMatchObject({
				submissionId: background.requests[0]?.idempotencyKey,
			});
		}),
	);

	it.live("edits a review in the review composer under its snapshot precondition", () =>
		Effect.gen(function* () {
			const properties = { rating: 91, isSpoiler: false, text: "The twist still lands." };
			const { view, background } = mount([{ ...flatReviewEventRow, properties }]);
			const [menu] = menus(view.container);
			if (menu === undefined) {
				throw new Error("Expected a review row menu");
			}
			choose(menu, "Edit");
			const dialog = getByRole(document.body, "dialog", { name: "Edit review" });
			const text = getByLabelText(dialog, "Review");
			expect(text).toHaveProperty("value", "The twist still lands.");
			act(() => {
				fireEvent.change(text, { target: { value: "Even better twice." } });
			});
			clickRyotElement(getByRole(dialog, "button", { name: "Save review" }));
			yield* eventually(() => expect(background.requests).toHaveLength(1));
			expect(background.requests[0]).toMatchObject({
				slug: "media-review-update",
				input: {
					rating: 91,
					isSpoiler: false,
					eventId: "media-review",
					text: "Even better twice.",
					expected: {
						properties,
						entityId: "entity-1",
						absentProperties: [],
						sessionEntityId: null,
						occurredAt: flatReviewEventRow.occurredAt,
					},
				},
			});
		}),
	);

	it.live("deletes a review after confirmation", () =>
		Effect.gen(function* () {
			const { view, background } = mount([flatReviewEventRow]);
			const [menu] = menus(view.container);
			if (menu === undefined) {
				throw new Error("Expected a review row menu");
			}
			choose(menu, "Delete");
			clickRyotElement(
				getByRole(getByRole(document.body, "dialog", { name: "Delete this review?" }), "button", {
					name: "Delete review",
				}),
			);
			yield* eventually(() => expect(background.requests).toHaveLength(1));
			expect(background.requests[0]).toMatchObject({
				slug: "media-review-delete",
				input: { eventId: "media-review" },
			});
		}),
	);
});
