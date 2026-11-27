import { fireEvent, screen } from "@testing-library/react";
import { Effect } from "effect";

export const openMenu = Effect.fn(function* (trigger: string) {
	fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: trigger })));
});

export const chooseMenuItem = Effect.fn(function* (trigger: string, item: string) {
	yield* openMenu(trigger);
	fireEvent.click(yield* Effect.promise(() => screen.findByRole("menuitem", { name: item })));
});
