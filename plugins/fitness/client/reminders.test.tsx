import { expect, it } from "@effect/vitest";
import { type RyotClientAdapter, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { getByRole, waitFor } from "@testing-library/dom";
import { Deferred } from "effect";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { FitnessRemindersButton } from "./reminders";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mount = (adapter: Partial<RyotClientAdapter>, children: ReactNode) => {
	const { runtime, dispose } = createTestRyotClock(adapter);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => root.render(<RyotProvider runtime={runtime}>{children}</RyotProvider>));
	return {
		container,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
			void dispose();
		},
	};
};

it.live("opens reminders for the exercise and disables the button while pending", () =>
	Effect.gen(function* () {
		const release = yield* Deferred.make<void>();
		const requests: unknown[] = [];
		const mounted = mount(
			{
				manageReminders: (request) =>
					Effect.gen(function* () {
						requests.push(request);
						yield* Deferred.await(release);
						return { kind: "cancelled" };
					}),
			},
			<FitnessRemindersButton entityId="exercise-1" />,
		);
		try {
			const button = getByRole(mounted.container, "button", { name: "Reminders" });
			act(() => button.click());
			yield* Effect.promise(() =>
				waitFor(() => expect(button.hasAttribute("disabled")).toBe(true)),
			);
			expect(requests).toEqual([{ entityId: "exercise-1" }]);
			yield* Deferred.succeed(release, undefined);
			yield* Effect.promise(() =>
				waitFor(() => expect(button.hasAttribute("disabled")).toBe(false)),
			);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("reports a reminder screen failure", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mount(
			{
				manageReminders: (request) =>
					Effect.sync(() => requests.push(request)).pipe(
						Effect.andThen(Effect.fail(new RyotClientError({ reason: "transport" }))),
					),
			},
			<FitnessRemindersButton entityId="workout-1" />,
		);
		try {
			act(() => getByRole(mounted.container, "button", { name: "Reminders" }).click());
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(mounted.container, "alert").textContent).toBe(
						"Unable to open reminders. Try again.",
					),
				),
			);
			expect(requests).toEqual([{ entityId: "workout-1" }]);
			expect(
				getByRole(mounted.container, "button", { name: "Reminders" }).hasAttribute("disabled"),
			).toBe(false);
		} finally {
			mounted.unmount();
		}
	}),
);
