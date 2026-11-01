import { expect, it } from "@effect/vitest";
import { type RyotClientAdapter, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { Deferred } from "effect";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { HeaderActionsMenu } from "./header-actions-menu";

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

it.live("opens reminders from the menu and disables only that item while pending", () =>
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
			<HeaderActionsMenu
				entityId="exercise-1"
				label="More exercise actions"
				items={[{ key: "other", label: "Other action", onSelect: () => undefined }]}
			/>,
		);
		try {
			expect(queryByRole(mounted.container, "button", { name: "Reminders" })).toBeNull();
			const trigger = getByRole(mounted.container, "button", { name: "More exercise actions" });
			act(() => trigger.click());
			act(() => getByRole(document.body, "menuitem", { name: "Reminders" }).click());
			act(() => trigger.click());
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						getByRole(document.body, "menuitem", { name: "Reminders" }).hasAttribute("disabled"),
					).toBe(true),
				),
			);
			expect(
				getByRole(document.body, "menuitem", { name: "Other action" }).hasAttribute("disabled"),
			).toBe(false);
			expect(requests).toEqual([{ entityId: "exercise-1" }]);
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
			<HeaderActionsMenu items={[]} entityId="workout-1" label="More workout actions" />,
		);
		try {
			act(() => getByRole(mounted.container, "button", { name: "More workout actions" }).click());
			act(() => getByRole(document.body, "menuitem", { name: "Reminders" }).click());
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(mounted.container, "alert").textContent).toBe(
						"Unable to open reminders. Try again.",
					),
				),
			);
			expect(requests).toEqual([{ entityId: "workout-1" }]);
			act(() => getByRole(mounted.container, "button", { name: "More workout actions" }).click());
			expect(
				getByRole(document.body, "menuitem", { name: "Reminders" }).hasAttribute("disabled"),
			).toBe(false);
		} finally {
			mounted.unmount();
		}
	}),
);
