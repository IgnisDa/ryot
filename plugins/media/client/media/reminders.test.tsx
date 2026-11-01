import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { Deferred } from "effect";

import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../tests/client/flat-media/summary-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaUserDataControl } from "./user-data";

it.live("opens reminders from the menu and disables the item while the screen is pending", () =>
	Effect.gen(function* () {
		const release = yield* Deferred.make<void>();
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				manageReminders: (request) =>
					Effect.gen(function* () {
						requests.push(request);
						yield* Deferred.await(release);
						return { kind: "cancelled" };
					}),
			},
			<MediaUserDataControl
				media={decodeFlatSummary(fixtureSummaryRecipe, { id: "media-1", schemaSlug: "movie" })}
			/>,
		);
		try {
			expect(queryByRole(mounted.container, "button", { name: "Reminders" })).toBeNull();
			const trigger = getByRole(mounted.container, "button", { name: "Your data" });
			clickRyotElement(trigger);
			clickRyotElement(getByRole(document.body, "menuitem", { name: "Reminders" }));
			clickRyotElement(trigger);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						getByRole(document.body, "menuitem", { name: "Reminders" }).hasAttribute("disabled"),
					).toBe(true),
				),
			);
			expect(
				getByRole(document.body, "menuitem", { name: "Remove from library" }).hasAttribute(
					"disabled",
				),
			).toBe(false);
			expect(requests).toEqual([{ entityId: "media-1" }]);
			yield* Deferred.succeed(release, undefined);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						getByRole(document.body, "menuitem", { name: "Reminders" }).hasAttribute("disabled"),
					).toBe(false),
				),
			);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("keeps reminders available without library actions and reports a screen failure", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				manageReminders: (request) =>
					Effect.sync(() => requests.push(request)).pipe(
						Effect.andThen(Effect.fail(new RyotClientError({ reason: "transport" }))),
					),
			},
			<MediaUserDataControl
				media={decodeFlatSummary(fixtureSummaryRecipe, { id: "media-1", schemaSlug: "fixture" })}
			/>,
		);
		try {
			const trigger = getByRole(mounted.container, "button", { name: "Your data" });
			clickRyotElement(trigger);
			expect(queryByRole(document.body, "menuitem", { name: "Remove from library" })).toBeNull();
			expect(queryByRole(document.body, "menuitem", { name: "Merge my data into…" })).toBeNull();
			clickRyotElement(getByRole(document.body, "menuitem", { name: "Reminders" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(mounted.container, "alert").textContent).toBe(
						"Unable to open reminders. Try again.",
					),
				),
			);
			expect(requests).toEqual([{ entityId: "media-1" }]);
			clickRyotElement(trigger);
			expect(
				getByRole(document.body, "menuitem", { name: "Reminders" }).hasAttribute("disabled"),
			).toBe(false);
		} finally {
			mounted.unmount();
		}
	}),
);
