import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, waitFor } from "@testing-library/dom";
import { Deferred } from "effect";

import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaRemindersControl } from "./reminders";

it.live("opens reminders for an entity and parent while the screen is pending", () =>
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
			<MediaRemindersControl entityId="episode-1" parentEntityId="media-1" />,
		);
		try {
			const button = getByRole(mounted.container, "button", { name: "Reminders" });
			clickRyotElement(button);
			yield* Effect.promise(() =>
				waitFor(() => expect(button.hasAttribute("disabled")).toBe(true)),
			);
			expect(requests).toEqual([{ entityId: "episode-1", parentEntityId: "media-1" }]);
			yield* Deferred.succeed(release, undefined);
			yield* Effect.promise(() =>
				waitFor(() => expect(button.hasAttribute("disabled")).toBe(false)),
			);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("omits the parent ID and reports a reminder screen failure", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				manageReminders: (request) =>
					Effect.sync(() => requests.push(request)).pipe(
						Effect.andThen(Effect.fail(new RyotClientError({ reason: "transport" }))),
					),
			},
			<MediaRemindersControl entityId="media-1" />,
		);
		try {
			const button = getByRole(mounted.container, "button", { name: "Reminders" });
			clickRyotElement(button);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(mounted.container, "alert").textContent).toBe(
						"Unable to open reminders. Try again.",
					),
				),
			);
			expect(requests).toEqual([{ entityId: "media-1" }]);
			expect(button.hasAttribute("disabled")).toBe(false);
		} finally {
			mounted.unmount();
		}
	}),
);
