import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import {
	createExerciseEntityFixture,
	openFitnessPage,
	updateExerciseOverrides,
} from "~/fixtures/plugins/fitness";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

it.live(
	"snaps back a short sheet pull and dismisses a downward drag without leaving the workout",
	() =>
		Effect.gen(function* () {
			const { email, password } = yield* createAuthenticatedClient();
			const page = yield* (yield* Playwright.Browser).newPage();
			yield* page.setViewportSize({ width: 390, height: 844 });
			yield* signInThroughHostedOAuth(page, email, password);
			const frame = yield* openFitnessPage(page, "/p/ryot/fitness/workouts/new");
			yield* frame.getByRole("button", { exact: false, name: "Edit workout details" }).click();
			const details = frame.getByRole("dialog", { exact: true, name: "Workout details" });
			yield* details.getByRole("textbox", { exact: true, name: "Name" }).fill("Drag recovery");
			const heading = frame.getByRole("heading", { exact: true, name: "Workout details" });
			yield* heading.waitForFunction((element) => {
				const panel = element.closest('[role="dialog"]');
				return panel instanceof HTMLElement && getComputedStyle(panel).transform === "none";
			});
			const bounds = requirePresent(
				yield* page.use((raw) =>
					raw
						.locator("iframe:visible")
						.contentFrame()
						.getByRole("heading", { exact: true, name: "Workout details" })
						.boundingBox(),
				),
				"Expected sheet heading bounds",
			);
			const x = bounds.x + bounds.width / 2;
			const y = bounds.y + bounds.height / 2;
			yield* page.use((raw) => raw.mouse.move(x, y));
			yield* page.use((raw) => raw.mouse.down());
			yield* page.use((raw) => raw.mouse.move(x, y + 12, { steps: 6 }));
			yield* page.use((raw) => raw.mouse.up());
			yield* heading.waitForFunction((element) => {
				const panel = element.closest('[role="dialog"]');
				return panel instanceof HTMLElement && getComputedStyle(panel).transform === "none";
			});
			yield* page.use((raw) => raw.mouse.move(x, y));
			yield* page.use((raw) => raw.mouse.down());
			yield* page.use((raw) => raw.mouse.move(x, y + 180, { steps: 12 }));
			yield* page.use((raw) => raw.mouse.up());
			yield* details.waitFor({ state: "hidden" });
			yield* frame
				.getByRole("button", { exact: true, name: "Edit workout details, Drag recovery" })
				.waitFor({ state: "visible" });
		}).pipe(PlaywrightSpawner.withBrowser),
);

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
