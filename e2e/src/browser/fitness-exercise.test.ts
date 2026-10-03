import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { createExerciseEntityFixture, seedExerciseWorkout } from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const visible = (locator: Playwright.Locator) => locator.waitFor({ state: "visible" });

it.live("shows exercise history and manages private notes", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const id = crypto.randomUUID();
		const { exerciseId } = yield* createExerciseEntityFixture(client, {
			name: `Detail bench ${id}`,
		});
		yield* seedExerciseWorkout(client, {
			exerciseId,
			name: `Push day ${id}`,
			endedAt: "2026-06-30T14:00:00.000Z",
			startedAt: "2026-06-30T13:00:00.000Z",
			sets: [
				{ properties: { reps: 8, weight: 90 }, occurredAt: "2026-06-30T13:00:00.000Z" },
				{ properties: { reps: 5, weight: 100 }, occurredAt: "2026-06-30T13:05:00.000Z" },
			],
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${exerciseId}`);
		const detail = page.locator("iframe").contentFrame();

		yield* visible(
			detail.getByRole("heading", { level: 1, exact: true, name: `Detail bench ${id}` }),
		);
		yield* visible(detail.getByRole("heading", { level: 2, exact: true, name: "Your history" }));
		yield* visible(detail.getByText("Total reps", { exact: true }));
		yield* visible(detail.getByText("13", { exact: true }));
		yield* visible(detail.getByRole("link", { exact: true, name: `Push day ${id}` }));

		yield* detail.getByLabel("New note").fill(`  Keep elbows tucked ${id}  `);
		yield* detail.getByRole("radio", { exact: true, name: "4 stars" }).click();
		yield* detail.getByRole("button", { exact: true, name: "Save note" }).click();
		yield* visible(detail.getByText(`Keep elbows tucked ${id}`, { exact: true }));
		yield* visible(detail.getByRole("img", { name: "Rated 4 of 5" }));

		yield* detail.getByRole("button", { exact: true, name: "Edit note" }).click();
		yield* detail.getByLabel("Edit note", { exact: true }).fill(`Wrist neutral ${id}`);
		yield* detail.getByRole("button", { exact: true, name: "Save" }).click();
		yield* visible(detail.getByText(`Wrist neutral ${id}`, { exact: true }));
		expect(yield* detail.getByText(`Keep elbows tucked ${id}`, { exact: true }).count).toBe(0);

		yield* detail.getByRole("button", { exact: true, name: "Delete note" }).click();
		yield* detail.getByRole("button", { exact: true, name: "Delete note" }).last().click();
		yield* detail.getByText(`Wrist neutral ${id}`, { exact: true }).waitFor({ state: "detached" });
		expect(yield* detail.getByText(`Wrist neutral ${id}`, { exact: true }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
