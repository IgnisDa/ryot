import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	openFitnessPage,
	updateExerciseOverrides,
} from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

for (const reducedMotion of ["reduce", "no-preference"] as const) {
	it.live(
		`progresses, collapses and scrolls above the floating timer with motion ${reducedMotion}`,
		() =>
			Effect.gen(function* () {
				const { email, client, password } = yield* createAuthenticatedClient();
				const names = [`First ${crypto.randomUUID()}`, `Next ${crypto.randomUUID()}`];
				for (const name of names) {
					const { exerciseId } = yield* createExerciseEntityFixture(client, { name });
					yield* updateExerciseOverrides(client, {
						exerciseId,
						remove: [],
						set: { normalRestTime: 0 },
					});
				}
				const page = yield* (yield* Playwright.Browser).newPage();
				yield* page.setViewportSize({ width: 390, height: 844 });
				yield* page.use((raw) => raw.emulateMedia({ reducedMotion }));
				yield* signInThroughHostedOAuth(page, email, password);
				const frame = yield* openFitnessPage(page, "/p/ryot/fitness/workouts/new");
				yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
				const picker = frame.getByRole("dialog", { exact: true, name: "Add exercises" });
				for (const name of names) {
					yield* picker.getByRole("searchbox", { name: "Search exercises" }).fill(name);
					yield* picker.getByRole("checkbox", { name, exact: true }).check();
				}
				yield* picker.getByRole("button", { exact: true, name: "Add 2 exercises" }).click();
				const first = frame.getByRole("region", { exact: true, name: names[0] });
				const next = frame.getByRole("region", { exact: true, name: names[1] });
				yield* next.getByRole("button", { exact: true, name: `Collapse ${names[1]}` }).click();
				for (let index = 1; index < 6; index += 1) {
					yield* first.getByRole("button", { exact: true, name: "Add set" }).click();
				}
				for (let index = 1; index <= 6; index += 1) {
					yield* first.getByRole("textbox", { exact: true, name: `Set ${index} reps` }).fill("8");
					yield* first
						.getByRole("textbox", { exact: true, name: `Set ${index} weight (kg)` })
						.fill("20");
					yield* first.getByRole("button", { exact: true, name: `Complete set ${index}` }).click();
				}
				expect(
					yield* first
						.getByRole("button", { exact: true, name: `Expand ${names[0]}` })
						.getAttribute("aria-expanded"),
				).toBe("false");
				yield* next.getByRole("group", { exact: true, name: "Set 1" }).waitForFunction((set) => {
					const root = set.closest("[data-motion-scroll-root]");
					if (root === null) {
						return false;
					}
					const bounds = set.getBoundingClientRect();
					const header = root
						.querySelector('[data-scroll-obstruction="top"]')
						?.getBoundingClientRect();
					const dock = root.parentElement
						?.querySelector('[data-scroll-obstruction="bottom"]')
						?.getBoundingClientRect();
					return (
						header !== undefined &&
						dock !== undefined &&
						bounds.top >= header.bottom &&
						bounds.bottom <= dock.top
					);
				});
				yield* first.getByRole("button", { exact: true, name: `Expand ${names[0]}` }).click();
				yield* first
					.getByRole("button", { exact: true, name: "Set 1, Normal. Set options" })
					.click();
				yield* frame
					.getByRole("dialog", { exact: true, name: "Set 1" })
					.getByRole("button", { exact: true, name: "Delete set" })
					.click();
				const confirmation = frame.getByRole("dialog", {
					exact: true,
					name: "Delete completed set?",
				});
				yield* confirmation.getByRole("button", { exact: true, name: "Cancel" }).click();
				yield* confirmation.waitFor({ state: "hidden" });
				yield* frame
					.getByRole("dialog", { exact: true, name: "Set 1" })
					.getByRole("button", { exact: true, name: "Done" })
					.click();
				expect(
					yield* first
						.getByRole("button", { exact: true, name: "Complete set 1" })
						.getAttribute("aria-pressed"),
				).toBe("true");
			}).pipe(PlaywrightSpawner.withBrowser),
	);
}
