import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, waitForEventWithSchema } from "~/fixtures/kernel";
import {
	createBuiltinMediaLifecycleFixture,
	insertLibraryMembership,
	logMediaActivity,
} from "~/fixtures/plugins/media";
import { mediaPluginFrame } from "~/fixtures/plugins/media/frame";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";
import { nowIso } from "~/support/time";

it.live("suggests the next volume of a volume-only Manga and completes at its volume total", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
			entitySchemaSlug: "manga",
			properties: { volumes: 10, chapters: 120 },
		});
		yield* insertLibraryMembership(client, { mediaEntityId: entityId });
		yield* logMediaActivity(client, {
			submittedAt: nowIso(),
			submissionId: yield* randomUuid,
			entry: { entityId, kind: "progress", position: { position: 3, unit: "volumes" } },
		});

		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 900 } });
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.goto(`${frontendUrl}/e/${entityId}`);
		const media = mediaPluginFrame(page).contentFrame();
		yield* media
			.getByRole("button", { exact: true, name: "Mark volume 4 read" })
			.waitFor({ state: "visible", timeout: 150_000 });

		yield* media.getByRole("button", { exact: true, name: "More logging options" }).click();
		const dialog = media.getByRole("dialog", { name: "Log activity" });
		yield* dialog.waitFor({ state: "visible" });
		expect(
			yield* dialog
				.getByRole("radio", { exact: true, name: "Volume" })
				.getAttribute("aria-checked"),
		).toBe("true");
		const stepper = dialog.getByRole("textbox", { exact: true, name: "Read through volume" });
		expect(yield* stepper.inputValue()).toBe("4");
		expect(yield* stepper.getAttribute("inputmode")).toBe("decimal");
		yield* dialog.getByText("of 10", { exact: true }).waitFor({ state: "visible" });
		yield* stepper.fill("10");
		yield* dialog.getByRole("button", { exact: true, name: "Save progress" }).click();
		yield* dialog.waitFor({ state: "hidden" });
		yield* page
			.getByRole("region", { name: "Background activity" })
			.getByText("Now read through volume 10.", { exact: true })
			.waitFor({ state: "visible" });

		const completion = yield* waitForEventWithSchema(client, entityId, "complete");
		expect(completion.properties).toMatchObject({
			consumptionBasis: { total: 10, unit: "volumes", property: "volumes" },
		});
		yield* media
			.getByRole("group", { name: "Your library" })
			.getByText("Status: Complete", { exact: true })
			.waitFor({ state: "visible" });
	}).pipe(PlaywrightSpawner.withBrowser),
);
