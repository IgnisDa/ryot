import { writePluginArchive } from "@ryot-app/plugin-archive";
import { Effect, Fiber, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	invokePrivatePluginOperation,
	listNamespaceInstallations,
	pollUntil,
	privatePluginPackage,
} from "~/fixtures/kernel";
import { compilePluginPackage, type PluginPackageInput } from "~/fixtures/kernel/compiled-package";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const wizard = (page: Playwright.Page) => page.getByRole("dialog");

const chooseArchive = (page: Playwright.Page, pluginPackage: PluginPackageInput) =>
	Effect.gen(function* () {
		const archive = writePluginArchive(yield* compilePluginPackage(pluginPackage));
		const chooser = yield* page
			.eventStream("filechooser")
			.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
		yield* wizard(page).getByRole("button", { name: "Choose a file for Plugin archive" }).click();
		const picked = Option.getOrThrow(yield* Fiber.join(chooser));
		yield* picked.setFiles({
			name: "plugin.zip",
			mimeType: "application/zip",
			buffer: Buffer.from(archive),
		});
		yield* wizard(page).getByText("Ready to review").waitFor({ state: "visible" });
		yield* wizard(page).getByRole("button", { name: "Continue" }).click();
		yield* wizard(page).getByText("Only install plugins you trust").waitFor();
		yield* wizard(page).getByText("It can contact any server on the internet.").waitFor();
		yield* wizard(page).getByText("Fixture operation").waitFor();
		expect(yield* wizard(page).getByRole("button", { name: "Continue" }).isDisabled()).toBe(true);
		yield* wizard(page)
			.getByLabel("I understand these risks and trust this plugin's publisher.")
			.check();
		yield* wizard(page).getByRole("button", { name: "Continue" }).click();
	});

it.live(
	"installs a private plugin archive with initial configuration, then updates and removes it",
	() =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
			yield* signInThroughHostedOAuth(page, owner.email, owner.password);
			yield* page.goto(`${getFrontendUrl()}/settings/plugins`);
			yield* page.getByRole("heading", { level: 1, name: "Plugins" }).waitFor();

			const plugin = privatePluginPackage();
			const packageId = plugin.manifest.metadata.packageId;
			yield* page.getByRole("button", { name: "Install plugin" }).click();
			yield* chooseArchive(page, plugin);
			yield* wizard(page).getByRole("button", { name: "Install plugin" }).click();
			yield* wizard(page).getByText("Greeting is required").waitFor();
			yield* wizard(page).getByLabel("Greeting").fill("hello");
			yield* wizard(page).getByLabel("API token").fill("token-alpha");
			yield* wizard(page).getByRole("button", { name: "Install plugin" }).click();
			yield* page
				.getByText("Plugin installed. It finishes setting up in the background.")
				.waitFor();
			yield* wizard(page).waitFor({ state: "hidden" });

			const installed = yield* pollUntil(
				`private plugin ${packageId} ready`,
				listNamespaceInstallations(owner.client).pipe(
					Effect.map(
						(items) =>
							items.find((item) => item.packageId === packageId && item.health === "ready") ?? null,
					),
				),
			);
			const operation = {
				packageId,
				prefix: "run",
				client: owner.client,
				operationSlug: plugin.operationSlug,
			};
			expect((yield* invokePrivatePluginOperation(operation)).result).toEqual({
				label: "run:hello",
			});

			yield* page.getByRole("button", { name: "Refresh" }).click();
			yield* page.locator("summary").filter({ hasText: packageId }).click();
			yield* page.getByText("Leave blank to keep the current value.").waitFor();
			yield* page.getByLabel("Greeting").fill("bonjour");
			yield* page.getByRole("button", { name: "Save configuration" }).click();
			yield* page.getByText("Configuration saved.").waitFor();
			expect((yield* invokePrivatePluginOperation(operation)).result).toEqual({
				label: "run:bonjour",
			});

			yield* page.getByRole("button", { name: "Update package" }).click();
			yield* chooseArchive(
				page,
				privatePluginPackage({ packageId, transform: "value.toUpperCase()" }),
			);
			yield* wizard(page).getByRole("button", { name: "Update plugin" }).click();
			yield* page.getByText("Package updated.").waitFor();
			yield* pollUntil(
				"updated private plugin operation",
				invokePrivatePluginOperation(operation).pipe(
					Effect.map(({ result }) =>
						JSON.stringify(result) === JSON.stringify({ label: "run:BONJOUR" }) ? true : null,
					),
					Effect.orElseSucceed(() => null),
				),
			);

			yield* page.getByRole("button", { name: "Uninstall" }).click();
			yield* page.getByRole("button", { name: "Uninstall plugin" }).click();
			yield* page.getByText("Plugin uninstalled.").waitFor();
			yield* page.locator("summary").filter({ hasText: packageId }).waitFor({ state: "detached" });
			expect(
				(yield* listNamespaceInstallations(owner.client)).some(({ id }) => id === installed.id),
			).toBe(false);
		}).pipe(PlaywrightSpawner.withBrowser),
);
