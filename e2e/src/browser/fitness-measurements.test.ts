import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	findBuiltinSavedView,
	savedViewRecordPath,
} from "~/fixtures/kernel";
import { createMeasurementMetric, fitnessFixtureInstallation } from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live(
	"logs measurements through All Measurements and refreshes summaries, trends, and the log",
	() =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAuthenticatedClient();
			yield* createMeasurementMetric(client, { name: "Weight" });
			yield* createMeasurementMetric(client, { name: "Waist" });
			const view = yield* findBuiltinSavedView(client, {
				kind: "plugin",
				slug: "all-measurements",
				pluginId: (yield* fitnessFixtureInstallation(client.target)).id,
			});
			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage();
			yield* signInThroughHostedOAuth(page, email, password);
			yield* page.goto(`${getFrontendUrl()}${savedViewRecordPath(view)}`);
			const frame = page.locator("iframe").contentFrame();
			yield* frame.getByRole("heading", { level: 1, name: "All Measurements" }).waitFor();
			yield* frame.getByRole("button", { exact: true, name: "Log measurement" }).click();
			const dialog = frame.getByRole("dialog", { name: "Log measurement" });
			const fillReading = Effect.gen(function* () {
				yield* dialog.getByLabel("Weight (kg)", { exact: true }).fill("0");
				yield* dialog.getByLabel("Waist (cm)", { exact: true }).fill("80.5");
				yield* dialog.getByLabel("Comment (optional)").fill("Morning browser entry");
			});
			yield* fillReading;
			yield* dialog.getByRole("button", { exact: true, name: "Cancel" }).click();
			yield* frame.getByRole("button", { exact: true, name: "Log measurement" }).click();
			yield* fillReading;
			yield* dialog.getByRole("button", { exact: true, name: "Save" }).click();
			yield* dialog.waitFor({ state: "hidden" });
			const metrics = frame.getByRole("region", { exact: true, name: "All metrics" });
			yield* metrics.getByRole("cell", { exact: true, name: "0 kg" }).waitFor();
			yield* metrics.getByRole("cell", { exact: true, name: "80.5 cm" }).waitFor();
			yield* frame
				.getByRole("region", { exact: true, name: "Metric chart" })
				.getByText(/show grouped averages/)
				.waitFor();
			yield* frame
				.getByRole("region", { name: "Log", exact: true })
				.getByText("Morning browser entry", { exact: true })
				.waitFor();
			yield* page.reload;
			yield* frame
				.getByRole("region", { name: "Log", exact: true })
				.getByText("Morning browser entry", { exact: true })
				.waitFor();
			expect(yield* frame.getByRole("button", { name: /^Edit measurement from/ }).count).toBe(1);
		}).pipe(PlaywrightSpawner.withBrowser),
);
