import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { Deferred, Effect, Option, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	createEntity,
	FIXTURE_CLIENT_REVISION_MARKERS,
	installFixtureClientPlugin,
	installPrivatePluginPackage,
	encodePluginSourceFiles,
	testPluginManifest,
	settledPrivateInstallation,
	listEntitySchemas,
	updateFixtureClientPlugin,
} from "~/fixtures/kernel";
import { seedGlobalShowEpisodeTree } from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

type BridgeObservation = { readonly serialized: string; readonly bridgeSessionId: string | null };

const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const privateAccessKey = /\/api\/page-bundles\/[a-f0-9]{64}\/([A-Za-z0-9_-]{43})\//g;

const observeBridgeMessages = (page: Playwright.Page, observations: BridgeObservation[]) =>
	Effect.gen(function* () {
		yield* page.exposeFunction(
			"recordE2ePluginBridgeMessage",
			(value: unknown): Effect.Effect<void> =>
				Effect.sync(() => {
					if (
						typeof value === "object" &&
						value !== null &&
						"serialized" in value &&
						typeof value.serialized === "string" &&
						"bridgeSessionId" in value &&
						(typeof value.bridgeSessionId === "string" || value.bridgeSessionId === null)
					) {
						observations.push({
							serialized: value.serialized,
							bridgeSessionId: value.bridgeSessionId,
						});
					}
				}),
		);
		yield* page.addInitScript(() => {
			const reporter: unknown = Reflect.get(globalThis, "recordE2ePluginBridgeMessage");
			const report = (message: unknown, bridgeInit: boolean) => {
				let serialized = "[unserializable]";
				try {
					serialized = JSON.stringify({ message });
				} catch {
					// Only the presence of a credential is inspected by the test.
				}
				const bridgeSessionId =
					bridgeInit &&
					typeof message === "object" &&
					message !== null &&
					"sessionId" in message &&
					typeof message.sessionId === "string"
						? message.sessionId
						: null;
				if (typeof reporter === "function") {
					void Promise.allSettled([reporter({ serialized, bridgeSessionId })]);
				}
			};

			window.addEventListener("message", (event) => report(event.data, event.ports.length === 1));
			const originalPostMessage: unknown = Object.getOwnPropertyDescriptor(
				MessagePort.prototype,
				"postMessage",
			)?.value;
			if (typeof originalPostMessage !== "function") {
				throw new Error("MessagePort.postMessage is unavailable");
			}
			MessagePort.prototype.postMessage = function (
				this: MessagePort,
				message: unknown,
				transferOrOptions?: StructuredSerializeOptions | Transferable[],
			) {
				report(message, false);
				return Reflect.apply(
					originalPostMessage,
					this,
					transferOrOptions === undefined ? [message] : [message, transferOrOptions],
				);
			} as MessagePort["postMessage"];
		});
	});

const readSrcDoc = (frame: Playwright.Locator) =>
	Effect.gen(function* () {
		expect(
			yield* frame.getAttribute("src"),
			"Plugin frame must not have a document URL",
		).toBeNull();
		return requirePresent(yield* frame.getAttribute("srcdoc"), "Plugin frame srcdoc is missing");
	});

const expectIsolatedFrame = (frame: Playwright.Locator, selectedApiUrl: string) =>
	Effect.gen(function* () {
		expect(yield* frame.getAttribute("sandbox")).toBe("allow-scripts");
		yield* readSrcDoc(frame);
		const realm = yield* frame
			.contentFrame()
			.locator("html")
			.evaluate(() => {
				let parentReadable = true;
				try {
					parent.document.querySelector("html");
				} catch {
					parentReadable = false;
				}
				return {
					parentReadable,
					origin: self.origin,
					base: document.querySelector("base")?.href ?? null,
				};
			});
		expect(realm).toEqual({
			origin: "null",
			parentReadable: false,
			base: `${new URL(selectedApiUrl).origin}/`,
		});
	});

const waitForFreshBridgeSession = (observations: BridgeObservation[], previous?: string) =>
	Effect.gen(function* () {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const current = observations.findLast(
				({ bridgeSessionId }) => bridgeSessionId !== null,
			)?.bridgeSessionId;
			if (current !== undefined && current !== null && current !== previous) {
				return current;
			}
			yield* Effect.sleep("25 millis");
		}
		return yield* Effect.die(new Error("Plugin bridge did not establish a fresh session"));
	});

const expectCurrentBridgeSession = (observations: BridgeObservation[], expected: string) => {
	const current = observations.findLast(
		({ bridgeSessionId }) => bridgeSessionId !== null,
	)?.bridgeSessionId;
	expect(current, "Plugin bridge session changed unexpectedly").toBe(expected);
};

const expectNoPrivateAccessKeysInBridgeMessages = (
	observations: BridgeObservation[],
	srcDocs: string[],
) => {
	const keys = new Set(
		srcDocs.flatMap((srcDoc) => [...srcDoc.matchAll(privateAccessKey)].map(([, key]) => key)),
	);
	expect(keys.size, "Plugin documents carried no private artifact access key").toBeGreaterThan(0);
	if (
		observations.some(({ serialized }) =>
			[...keys].some((key) => key !== undefined && serialized.includes(key)),
		)
	) {
		expect.unreachable(
			"Plugin bridge message exposed a private artifact access key [credential redacted]",
		);
	}
};

const expectVisibleText = (locator: Playwright.Locator, text: string) =>
	Effect.gen(function* () {
		const match = locator.getByText(text, { exact: true }).filter({ visible: true });
		yield* match.waitFor({ state: "visible" });
		expect(yield* match.isVisible()).toBe(true);
	});

it.live("shows the minimal interstitial while loading a plugin on desktop and mobile", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const installed = yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const fixtureUrl = `${getFrontendUrl()}${pluginPath(installed.packageId)}`;
		const runPromise = Effect.runPromiseWith(yield* Effect.context());
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password, { entryPath: "/" });
		yield* page.waitForURL((url) => /^\/p\/[^/]+\/[^/]+$/.test(url.pathname));

		for (const compact of [false, true]) {
			yield* page.setViewportSize(
				compact ? { width: 390, height: 844 } : { width: 1280, height: 800 },
			);
			yield* page.use((native) =>
				native.emulateMedia({
					colorScheme: compact ? "light" : "dark",
					reducedMotion: compact ? "reduce" : "no-preference",
				}),
			);
			const loadingDocument = yield* Deferred.make<void>();
			const releaseDocument = yield* Deferred.make<void>();
			yield* Effect.addFinalizer(() => Deferred.succeed(releaseDocument, undefined));
			yield* page.use((native) =>
				native.route("**/api/pages/document", (route) =>
					runPromise(
						Effect.gen(function* () {
							yield* Deferred.succeed(loadingDocument, undefined);
							yield* Deferred.await(releaseDocument);
							yield* Effect.tryPromise(() => route.continue());
						}),
					),
				),
			);

			yield* page.goto(fixtureUrl);
			yield* Deferred.await(loadingDocument);
			yield* page
				.getByRole("heading", { level: 1, exact: true, name: "Opening Fixture" })
				.waitFor({ state: "visible" });
			const status = page.getByRole("status").filter({ hasText: "Getting your view ready" });
			expect(yield* page.getByRole("main").count).toBe(1);
			expect(yield* status.locator('[data-app-icon="puzzle"]').count).toBe(1);
			expect(yield* page.getByRole("heading", { level: 1 }).count).toBe(1);
			const layout = yield* status.evaluate((element) => {
				const main = element.closest("main");
				const title = element.querySelector("h1");
				if (main === null || title === null) {
					throw new Error("Loading screen is incomplete");
				}
				const panel = element.getBoundingClientRect();
				const canvas = main.getBoundingClientRect();
				return {
					titleSize: Number.parseFloat(getComputedStyle(title).fontSize),
					horizontalOffset: panel.x + panel.width / 2 - canvas.x - canvas.width / 2,
					verticalOffset: panel.y + panel.height / 2 - canvas.y - canvas.height / 2,
				};
			});
			expect(Math.abs(layout.horizontalOffset)).toBeLessThan(2);
			expect(Math.abs(layout.verticalOffset)).toBeLessThan(50);
			expect(layout.titleSize).toBe(16);
			const animations = yield* status
				.locator('[aria-hidden="true"] span')
				.evaluateAll((elements) =>
					elements.map((element) => getComputedStyle(element).animationName),
				);
			expect(animations.every((animation) => animation === "none")).toBe(compact);
			if (compact) {
				yield* page.getByRole("button", { name: "Open navigation" }).click();
				yield* page.getByRole("dialog", { name: "Navigation" }).waitFor({ state: "visible" });
				yield* page.getByTestId("drawer-scrim").click({ position: { x: 380, y: 400 } });
				yield* page.getByRole("dialog", { name: "Navigation" }).waitFor({ state: "hidden" });
			}

			yield* Deferred.succeed(releaseDocument, undefined);
			const frame = page.locator(
				'main > div:not([aria-hidden="true"]) iframe[title="Fixture plugin"]',
			);
			yield* frame.waitFor({ state: "visible" });
			yield* frame
				.contentFrame()
				.getByRole("heading", { level: 1, exact: true, name: FIXTURE_CLIENT_REVISION_MARKERS.A })
				.waitFor({ state: "visible" });
			expect(yield* status.count).toBe(0);
			yield* page.use((native) => native.unroute("**/api/pages/document"));
		}
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("runs the client plugin lifecycle in a real browser", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const installed = yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const fixtureUrl = `${frontendUrl}${pluginPath(installed.packageId)}`;
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, { slugs: ["pokemon"], pluginId: installed.pluginId }))[0],
			"Fixture Pokemon schema was not registered",
		);
		const pokemon = yield* createEntity(client, {
			name: "E2E deterministic Bulbasaur",
			entitySchema: pokemonSchema.reference,
			properties: {
				height: 7,
				weight: 69,
				pokedexNumber: 1,
				abilities: ["overgrow"],
				types: ["grass", "poison"],
				sourceUrl: "https://example.invalid/pokemon/bulbasaur",
			},
		});
		const { showId } = yield* seedGlobalShowEpisodeTree(client, {
			showName: "E2E deterministic show",
			showProperties: { description: "A deterministic client-page provenance show." },
		});
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		const bridgeObservations: BridgeObservation[] = [];
		const observedSrcDocs: string[] = [];
		yield* observeBridgeMessages(page, bridgeObservations);
		const frame = page.locator(
			'main > div:not([aria-hidden="true"]) iframe[title="Fixture plugin"]',
		);
		const fixture = frame.contentFrame();
		const home = fixture.locator("body");

		const { historyLengthBeforeSubmit } = yield* signInThroughHostedOAuth(page, email, password, {
			entryPath: "/",
			captureHistory: true,
		});
		// Sign-in lands on the first enabled workspace by (sortOrder, slug), which earlier
		// suites change by installing system plugins into the shared database.
		yield* page.waitForURL((url) => /^\/p\/[^/]+\/[^/]+$/.test(url.pathname));
		const historyLength = requirePresent(
			historyLengthBeforeSubmit,
			"Sign-in history capture was not enabled",
		);
		expect(yield* page.evaluate(() => history.length)).toBe(historyLength + 1);

		yield* page.getByRole("button", { name: /workspace,/ }).click();
		yield* page
			.getByRole("menuitemradio", { name: "Switch to Fixture workspace" })
			.and(page.getByTitle(`${installed.packageId} · `))
			.click();
		yield* page.waitForURL(fixtureUrl);
		yield* frame.waitFor({ state: "visible" });

		expect(yield* frame.getAttribute("title")).toBe("Fixture plugin");
		yield* expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
		yield* expectIsolatedFrame(frame, apiUrl);
		const initialSrcDoc = yield* readSrcDoc(frame);
		observedSrcDocs.push(initialSrcDoc);
		// oxlint-disable-next-line effecttsgo/async-function -- Runs in the browser realm via Playwright evaluate; Effect is unavailable there.
		const typography = yield* home.evaluate(async (element) => {
			const heading = element.querySelector("h1");
			const uiFaces = await document.fonts.load('16px "Geist Variable"', "Fixture");
			const displayFaces = await document.fonts.load('16px "Lora Variable"', "Fixture");
			return {
				hasHeading: heading !== null,
				uiFamily: getComputedStyle(element).fontFamily,
				displayFamily: heading ? getComputedStyle(heading).fontFamily : "",
				uiLoaded: uiFaces.length > 0 && uiFaces.every(({ status }) => status === "loaded"),
				displayLoaded:
					displayFaces.length > 0 && displayFaces.every(({ status }) => status === "loaded"),
			};
		});
		expect(typography.hasHeading).toBe(true);
		expect(typography.uiFamily).toContain("Geist Variable");
		expect(typography.displayFamily).toContain("Lora Variable");
		expect(typography.uiLoaded).toBe(true);
		expect(typography.displayLoaded).toBe(true);
		expect(
			yield* fixture.getByRole("region", { name: "Theme snapshot" }).getAttribute("class"),
		).toBe("w-full max-w-md rounded-lg border border-border bg-surface p-4");
		const initialBridgeSession = yield* waitForFreshBridgeSession(bridgeObservations);

		const shellFrame = Option.getOrThrow(yield* frame.elementHandle());
		const sameFrame = () => frame.evaluate((current, initial) => current === initial, shellFrame);

		const switcherTrigger = page.getByRole("button", { name: /workspace,/ });
		const switcherMenu = page.getByRole("menu", { name: "Workspaces" });
		yield* switcherTrigger.click();
		yield* switcherMenu.waitFor({ state: "visible" });
		yield* switcherTrigger.click();
		yield* switcherMenu.waitFor({ state: "hidden" });
		expect(yield* sameFrame()).toBe(true);
		expect(yield* readSrcDoc(frame)).toBe(initialSrcDoc);
		expectCurrentBridgeSession(bridgeObservations, initialBridgeSession);

		yield* page.setViewportSize({ width: 390, height: 844 });
		expect(yield* sameFrame()).toBe(true);

		const menuTrigger = fixture.getByRole("button", { name: "Open navigation" });
		const drawer = page.getByRole("dialog", { name: "Navigation" });
		yield* menuTrigger.click();
		yield* drawer.waitFor({ state: "visible" });
		yield* page.getByTestId("drawer-scrim").click({ position: { x: 380, y: 400 } });
		yield* drawer.waitFor({ state: "hidden" });
		expect(yield* sameFrame()).toBe(true);
		expect(yield* frame.evaluate((element) => element === document.activeElement)).toBe(true);

		yield* page.setViewportSize({ width: 1280, height: 800 });
		expect(yield* sameFrame()).toBe(true);
		expect(yield* readSrcDoc(frame)).toBe(initialSrcDoc);
		expectCurrentBridgeSession(bridgeObservations, initialBridgeSession);

		yield* fixture.getByRole("button", { name: "Refresh catalog" }).click();
		const installedPlugins = home
			.getByText(/^Installed client plugins: /)
			.filter({ visible: true });
		yield* installedPlugins.waitFor({ state: "visible" });
		expect(
			(yield* installedPlugins.innerText()).replace("Installed client plugins: ", "").split(", "),
		).toEqual(expect.arrayContaining(["ryot/fitness", "ryot/media", installed.packageId]));
		yield* fixture.getByRole("button", { name: "Fetch greeting" }).click();
		yield* expectVisibleText(home, "Hello, Ryot");
		yield* fixture.getByRole("button", { name: "Fetch with invalid payload" }).click();
		yield* expectVisibleText(home, "Greetings are unavailable right now.");

		yield* fixture
			.getByLabel("Choose a file to upload")
			.setInputFiles({
				mimeType: "text/csv",
				name: "fixture-upload.csv",
				buffer: Buffer.from("id,title\n1,Fixture\n", "utf8"),
			});
		const uploaded = home
			.getByText(/^Uploaded fixture-upload\.csv as token .+/)
			.filter({ visible: true });
		yield* uploaded.waitFor({ state: "visible" });
		expect(yield* uploaded.isVisible()).toBe(true);

		yield* fixture
			.getByLabel("Choose a permanent file to upload")
			.setInputFiles({
				mimeType: "image/png",
				name: "fixture-permanent.png",
				buffer: Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=",
					"base64",
				),
			});
		const permanentImage = home.getByRole("img", { name: "Permanent fixture upload" });
		yield* permanentImage.waitFor({ state: "visible" });
		yield* permanentImage.waitForFunction(
			(image) => image instanceof HTMLImageElement && image.naturalWidth > 0,
		);
		expect(
			yield* permanentImage.evaluate((image) =>
				image instanceof HTMLImageElement ? image.naturalWidth : -1,
			),
		).toBeGreaterThan(0);
		yield* home.getByRole("button", { name: "Remove permanent upload" }).click();
		yield* expectVisibleText(home, "Permanent upload cleanup: deleted");

		const html = page.locator("html");
		const openSettings = Effect.gen(function* () {
			yield* page.getByRole("link", { name: "Open settings" }).click();
			yield* page.waitForURL(`${frontendUrl}/settings/preferences`);
		});
		const returnToFixture = (resolvedMode: string) =>
			Effect.gen(function* () {
				yield* page.getByRole("link", { name: "Home" }).click();
				yield* page.waitForURL(fixtureUrl);
				yield* frame.waitFor({ state: "visible" });
				yield* expectVisibleText(home, `Resolved mode: ${resolvedMode}`);
				observedSrcDocs.push(yield* readSrcDoc(frame));
			});

		yield* openSettings;
		yield* page.getByRole("radio", { name: "Use Light theme" }).click();
		expect(yield* html.getAttribute("data-theme")).toBe("light");
		yield* returnToFixture("light");

		yield* openSettings;
		yield* page.getByRole("radio", { name: "Use Dark theme" }).click();
		expect(yield* html.getAttribute("data-theme")).toBe("dark");
		yield* returnToFixture("dark");

		yield* openSettings;
		yield* page.emulateMedia({ colorScheme: "dark" });
		yield* page.getByRole("radio", { name: "Use System theme" }).click();
		expect(yield* html.getAttribute("data-theme")).toBeNull();
		yield* returnToFixture("dark");

		// Earlier fixture homes remain mounted; the active link is below the iframe viewport.
		const detailsLink = fixture
			.locator('[tabindex="-1"]:not([aria-hidden="true"])')
			.getByRole("link", { name: "Item 1 details" });
		yield* detailsLink.scrollIntoViewIfNeeded();
		yield* detailsLink.click();
		yield* page.waitForURL(`${fixtureUrl}/details/item-1?tab=stats`);
		yield* expectVisibleText(fixture.locator("body"), "Item item-1, tab stats.");

		yield* page.goBack();
		yield* page.waitForURL(fixtureUrl);
		yield* expectVisibleText(home, "Greeted 0 times.");

		yield* page.goForward();
		yield* page.waitForURL(`${fixtureUrl}/details/item-1?tab=stats`);
		yield* expectVisibleText(fixture.locator("body"), "Item item-1, tab stats.");

		yield* fixture.getByRole("button", { name: "Back" }).click();
		yield* page.waitForURL(fixtureUrl);
		yield* expectVisibleText(home, "Greeted 0 times.");
		const navigationFrame = Option.getOrThrow(yield* frame.elementHandle());
		const navigationBridgeSession = yield* waitForFreshBridgeSession(bridgeObservations);

		yield* fixture.getByRole("button", { name: "Crash during render" }).click();
		yield* expectVisibleText(page.locator("body"), "This plugin stopped working.");
		const reload = page.getByRole("button", { name: "Retry" });
		yield* reload.waitFor({ state: "visible" });
		yield* reload.click();
		yield* frame.waitFor({ state: "visible" });
		yield* expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
		yield* expectVisibleText(home, "Greeted 0 times.");
		expect(yield* frame.evaluate((current, initial) => current === initial, navigationFrame)).toBe(
			false,
		);
		yield* expectIsolatedFrame(frame, apiUrl);
		observedSrcDocs.push(yield* readSrcDoc(frame));
		yield* waitForFreshBridgeSession(bridgeObservations, navigationBridgeSession);

		yield* fixture.getByRole("button", { exact: true, name: "Greet" }).click();
		yield* expectVisibleText(home, "Greeted 1 times.");
		const revisionASrcDoc = yield* readSrcDoc(frame);
		const revisionABridgeSession = yield* waitForFreshBridgeSession(
			bridgeObservations,
			navigationBridgeSession,
		);
		const outerUrl = page.url();
		yield* frame.evaluate((element) => element.setAttribute("data-e2e-revision", "A"));
		const revisionAFrame = Option.getOrThrow(yield* frame.elementHandle());

		yield* updateFixtureClientPlugin(client, "B", "", apiUrl);
		yield* expectVisibleText(
			page.locator("body"),
			"An update is available. Reloading will discard unsaved local state.",
		);
		yield* expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
		yield* expectVisibleText(home, "Greeted 1 times.");
		expect(yield* frame.evaluate((current, initial) => current === initial, navigationFrame)).toBe(
			false,
		);
		expect(yield* frame.evaluate((current, initial) => current === initial, revisionAFrame)).toBe(
			true,
		);
		expect(yield* readSrcDoc(frame)).toBe(revisionASrcDoc);
		expectCurrentBridgeSession(bridgeObservations, revisionABridgeSession);
		expect(yield* frame.getAttribute("data-e2e-revision")).toBe("A");
		expect(page.url()).toBe(outerUrl);

		yield* page.getByRole("button", { name: "Reload updated page" }).click();
		yield* expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.B);
		yield* expectVisibleText(home, "Revision B is active.");
		expect(yield* frame.evaluate((current, initial) => current === initial, revisionAFrame)).toBe(
			false,
		);
		const revisionBSrcDoc = yield* readSrcDoc(frame);
		expect(revisionBSrcDoc).not.toBe(revisionASrcDoc);
		observedSrcDocs.push(revisionBSrcDoc);
		yield* waitForFreshBridgeSession(bridgeObservations, revisionABridgeSession);
		expect(yield* frame.getAttribute("data-e2e-revision")).toBeNull();
		expect(page.url()).toBe(outerUrl);
		yield* expectVisibleText(home, "Greeted 0 times.");

		expectNoPrivateAccessKeysInBridgeMessages(bridgeObservations, observedSrcDocs);

		yield* page.goto(`${frontendUrl}/e/${pokemon.id}`);
		yield* frame.waitFor({ state: "visible" });
		yield* expectVisibleText(fixture.locator("body"), "E2E deterministic Bulbasaur");
		yield* expectIsolatedFrame(frame, apiUrl);

		yield* page.goto(`${frontendUrl}/e/${showId}`);
		const mediaFrame = page.locator('iframe[title="Media plugin"]');
		yield* mediaFrame.waitFor({ state: "visible" });
		const media = mediaFrame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, exact: true, name: "E2E deterministic show" })
			.waitFor({ state: "visible" });
		yield* expectIsolatedFrame(mediaFrame, apiUrl);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("opens an external link from a sandbox click through host authority", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient(apiUrl);
		const pluginSlug = `external-link-${crypto.randomUUID()}`;
		const destination = `${frontendUrl}/e2e-external-link-${crypto.randomUUID()}`;
		const { id: installationId } = yield* installPrivatePluginPackage({
			client,
			config: {},
			baseUrl: apiUrl,
			pluginPackage: {
				manifest: testPluginManifest({
					pluginSlug,
					clientDefinition: {
						entities: {},
						homeView: null,
						notFoundPage: "home",
						routes: { "/": "home" },
						apiVersion: CLIENT_API_VERSION,
						exports: {
							home: {
								kind: "page",
								entry: "client/home.tsx",
								settingsSchema: { fields: {} },
								automaticEntityPresentations: false,
							},
						},
					},
				}),
				files: encodePluginSourceFiles({
					"client/home.tsx": `
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { useState } from "react";

export default function Home() {
  const client = useRyot();
  const [outcome, setOutcome] = useState("idle");
  return <PluginScreenFrame title="External links">
    <button onClick={() => {
      void Effect.runPromise(client.links.open({ url: ${encodeJsonString(destination)} }).pipe(
        Effect.match({ onSuccess: (value) => setOutcome(value.outcome), onFailure: (error) => setOutcome(error.reason) }),
      ));
    }}>Open external link</button>
    <p>{outcome}</p>
  </PluginScreenFrame>;
}
`,
				}),
			},
		});
		const installed = yield* settledPrivateInstallation(client, installationId);
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage();
		yield* signInThroughHostedOAuth(page, email, password, {
			entryPath: pluginPath(installed.packageId),
		});
		yield* page.goto(`${frontendUrl}${pluginPath(installed.packageId)}`);
		const frame = page.locator('main > div:not([aria-hidden="true"]) iframe');
		yield* frame
			.contentFrame()
			.getByRole("button", { name: "Open external link" })
			.waitFor({ state: "visible" });
		yield* expectIsolatedFrame(frame, apiUrl);
		const referrers: (string | undefined)[] = [];
		yield* page.use((nativePage) =>
			nativePage.context().route(destination, (route) => {
				referrers.push(route.request().headers()["referer"]);
				return route.fulfill({
					contentType: "text/html",
					body: "<title>External destination</title>",
				});
			}),
		);
		// oxlint-disable-next-line effecttsgo/async-function -- Playwright requires a Promise callback at this browser boundary.
		yield* page.use(async (nativePage) => {
			const opened = nativePage.waitForEvent("popup");
			await nativePage
				.locator('main > div:not([aria-hidden="true"]) iframe')
				.contentFrame()
				.getByRole("button", { name: "Open external link" })
				.click();
			const popup = await opened;
			await popup.waitForURL(destination);
			await popup.waitForLoadState("domcontentloaded");
			expect(await popup.evaluate(() => window.opener)).toBeNull();
			expect(await popup.evaluate(() => document.referrer)).toBe("");
			expect(referrers).toEqual([undefined]);
			await popup.close();
		});
		yield* expectVisibleText(frame.contentFrame().locator("body"), "success");
	}).pipe(PlaywrightSpawner.withBrowser),
);
