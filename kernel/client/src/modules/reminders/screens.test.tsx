import { expect } from "bun:test";

import { EntityId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { mountReminderTestScreen } from "./reminder-screen.test-support";
import { useReminderScreen } from "./screens";

function Harness(props: { readonly outcomes: Array<unknown> }) {
	const host = useReminderScreen();
	return (
		<>
			<button
				type="button"
				onClick={() =>
					Effect.runFork(
						host
							.onManageReminders({ entityId: EntityId.make("target-1") })
							.pipe(Effect.tap((outcome) => Effect.sync(() => props.outcomes.push(outcome)))),
					)
				}
			>
				Open reminder manager
			</button>
			{host.screen}
		</>
	);
}

it.live(
	"Back closes the reminder editor before the manager and returns cancelled",
	() =>
		Effect.gen(function* () {
			const outcomes: Array<unknown> = [];
			const view = mountReminderTestScreen(<Harness outcomes={outcomes} />);
			const { backInterceptors } = view;
			yield* Effect.addFinalizer(() => Effect.promise(view.dispose));

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Open reminder manager" })),
			);
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Reminders" }));
			fireEvent.click(screen.getByRole("button", { name: "New reminder" }));
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Schedule reminder" }));

			act(() => expect(backInterceptors.run()).toBe(true));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByRole("dialog", { name: "Schedule reminder" })).toBeNull(),
				),
			);
			expect(screen.getByRole("dialog", { name: "Reminders" })).toBeTruthy();

			act(() => expect(backInterceptors.run()).toBe(true));
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(screen.queryByRole("dialog", { name: "Reminders" })).toBeNull();
					expect(outcomes).toEqual([{ kind: "cancelled" }]);
				}),
			);
			expect(view.router.state.location.pathname).toBe("/");
			expect(backInterceptors.run()).toBe(false);
		}),
	testTimeout,
);
