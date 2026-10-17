import { PLUGIN_PACKAGE_ID } from "@ryot-app/fitness-plugin/shared/plugin-identity";
import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	shippedPluginTestProviders,
} from "~/fixtures/kernel";
import { createExerciseEntityFixture } from "~/fixtures/plugins/fitness";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

it.live(
	"returns provider additions to the picker without applying them until selection is accepted",
	() =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const libraryName = `Library exercise ${suffix}`;
			const addedName = `Provider exercise ${suffix}`;
			const providerName = `Offline exercises ${suffix}`;
			const providers = yield* shippedPluginTestProviders(PLUGIN_PACKAGE_ID);
			yield* providers.attachProvider({
				name: providerName,
				rootEntitySchemaSlug: "exercise",
				search: fakeProviderSearchResult([{ title: addedName, externalId: suffix }]),
				details: fakeProviderDetailsResult({
					name: addedName,
					properties: { images: [], instructions: [], kind: "reps_and_weight" },
				}),
			});
			yield* createExerciseEntityFixture(client, { name: libraryName });
			const page = yield* (yield* Playwright.Browser).newPage();
			yield* signInThroughHostedOAuth(page, email, password);
			yield* page.goto(`${getFrontendUrl()}/p/ryot/fitness/workouts/new`);
			const frame = page.locator("iframe:visible").contentFrame();
			yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
			const picker = frame.getByRole("dialog", { exact: true, name: "Choose exercises" });
			yield* picker.getByRole("checkbox", { exact: true, name: libraryName }).check();
			yield* picker.getByRole("button", { exact: true, name: "Add from provider" }).click();
			const provider = page.getByRole("dialog", { exact: true, name: "Add from a provider" });
			yield* provider.getByRole("button", { exact: true, name: "Close" }).click();
			expect(
				yield* picker.getByRole("checkbox", { exact: true, name: libraryName }).isChecked(),
			).toBe(true);
			yield* picker.getByRole("button", { exact: true, name: "Add from provider" }).click();
			yield* provider.getByRole("radio", { exact: true, name: providerName }).click();
			yield* provider.getByLabel("Search providers").fill(addedName);
			yield* provider.getByRole("button", { exact: false, name: `Add ${addedName}` }).click();
			yield* picker
				.getByRole("button", { exact: true, name: "Add 2 exercises" })
				.waitFor({ state: "visible" });
			expect(
				yield* picker.getByRole("checkbox", { exact: true, name: addedName }).isChecked(),
			).toBe(true);
			yield* picker.getByRole("button", { exact: true, name: "Cancel exercise selection" }).click();
			expect(yield* frame.getByRole("region", { exact: true, name: addedName }).count).toBe(0);
			yield* frame.getByRole("button", { exact: true, name: "Add exercises" }).click();
			yield* picker.getByRole("checkbox", { exact: true, name: addedName }).check();
			yield* picker.getByRole("button", { exact: true, name: "Add 1 exercise" }).click();
			yield* frame
				.getByRole("region", { exact: true, name: addedName })
				.waitFor({ state: "visible" });
			expect(yield* frame.getByRole("region", { exact: true, name: libraryName }).count).toBe(0);
		}).pipe(PlaywrightSpawner.withBrowser),
);
