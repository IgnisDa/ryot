import { Effect, Option } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createTestUser,
	createEntity,
	FIXTURE_CLIENT_REVISION_MARKERS,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	installFixtureClientPlugin,
	listEntitySchemas,
	makeSession,
	updateFixtureClientPlugin,
} from "~/fixtures/kernel";
import { seedGlobalShowEpisodeTree } from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { browserLayer, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getApiUrl, getFrontendUrl } from "~/support/harness-target";

type ArtifactSession = {
	readonly src: string;
	readonly credential: string;
};

type BridgeObservation = {
	readonly serialized: string;
	readonly bridgeSessionId: string | null;
};

const artifactSessionPath = /^\/api\/client-pages\/artifacts\/([A-Za-z0-9_-]{43})\/index\.html$/;

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
					void Promise.resolve(reporter({ bridgeSessionId, serialized })).catch(() => undefined);
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

const readArtifactSession = (frame: Playwright.Locator, selectedApiUrl: string) =>
	Effect.gen(function* () {
		const src = yield* frame.getAttribute("src");
		if (src === null) {
			return yield* Effect.die(
				new Error("Plugin artifact session URL is missing [credential redacted]"),
			);
		}
		if (!URL.canParse(src)) {
			return yield* Effect.die(
				new Error("Plugin artifact session URL is invalid [credential redacted]"),
			);
		}
		const url = new URL(src);
		const credential = artifactSessionPath.exec(url.pathname)?.[1];
		if (
			url.origin !== new URL(selectedApiUrl).origin ||
			url.username !== "" ||
			url.password !== "" ||
			url.search !== "" ||
			url.hash !== "" ||
			url.pathname.includes("/plugins/artifacts/") ||
			credential === undefined
		) {
			return yield* Effect.die(
				new Error(
					"Plugin artifact session URL must use the selected server and private index endpoint [credential redacted]",
				),
			);
		}
		return { credential, src };
	});

const expectSameArtifactSession = (current: ArtifactSession, expected: ArtifactSession) => {
	expect(current, "Plugin artifact session changed unexpectedly [credentials redacted]").toEqual(
		expected,
	);
};

const expectFreshArtifactSession = (current: ArtifactSession, previous: ArtifactSession) => {
	expect(current.src, "Plugin artifact session URL was reused [credentials redacted]").not.toBe(
		previous.src,
	);
	expect(
		current.credential,
		"Plugin artifact session credential was reused [credentials redacted]",
	).not.toBe(previous.credential);
};

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

const waitForArtifactSessionRevoked = (page: Playwright.Page, artifact: ArtifactSession) =>
	Effect.gen(function* () {
		let revoked = false;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const status = yield* page
				.use(async (nativePage) => {
					const response = await nativePage.context().request.get(artifact.src);
					const stat = response.status();
					await response.dispose();
					return stat;
				})
				.pipe(Effect.option);
			if (Option.getOrUndefined(status) === 404) {
				revoked = true;
				break;
			}
			yield* Effect.sleep("25 millis");
		}
		if (!revoked) {
			return yield* Effect.die(
				new Error("Replaced plugin artifact session did not return 404 [credential redacted]"),
			);
		}
		return undefined;
	});

const expectNoCredentialsInBridgeMessages = (
	observations: BridgeObservation[],
	artifacts: ArtifactSession[],
) => {
	if (
		observations.some(({ serialized }) =>
			artifacts.some(({ credential }) => serialized.includes(credential)),
		)
	) {
		expect.unreachable(
			"Plugin bridge message exposed an artifact credential [credential redacted]",
		);
	}
};

const expectVisibleText = (locator: Playwright.Locator, text: string) =>
	Effect.gen(function* () {
		const match = locator.getByText(text, { exact: true }).filter({ visible: true });
		yield* match.waitFor({ state: "visible" });
		expect(yield* match.isVisible()).toBe(true);
	});

it.live("runs the client plugin lifecycle in a real browser", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);
		const pokemonSchema = requirePresent(
			(yield* listEntitySchemas(client, {
				slugs: ["pokemon"],
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			}))[0],
			"Fixture Pokemon schema was not registered",
		);
		const pokemon = yield* createEntity(client, {
			name: "E2E deterministic Bulbasaur",
			entitySchemaSlug: pokemonSchema.id,
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
		const observedArtifacts: ArtifactSession[] = [];
		yield* observeBridgeMessages(page, bridgeObservations);
		const frame = page.locator('iframe[title="fixture plugin"]');
		const fixture = frame.contentFrame();
		const home = fixture.locator("body");

		const { historyLengthBeforeSubmit } = yield* signInThroughHostedOAuth(page, email, password, {
			captureHistory: true,
			entryPath: "/",
		});
		// Sign-in lands on the first enabled workspace by (sortOrder, slug), which earlier
		// suites change by installing system plugins into the shared database.
		yield* page.waitForURL((url) => /^\/[^/]+$/.test(url.pathname));
		const historyLength = requirePresent(
			historyLengthBeforeSubmit,
			"Sign-in history capture was not enabled",
		);
		expect(yield* page.evaluate(() => history.length)).toBe(historyLength + 1);

		yield* page.getByRole("button", { name: /workspace,/ }).click();
		yield* page.getByRole("menuitemradio", { name: "Switch to Fixture workspace" }).click();
		yield* page.waitForURL(`${frontendUrl}/fixture`);
		yield* frame.waitFor({ state: "visible" });

		yield* frame.waitFor({ state: "visible" });
		expect(yield* frame.getAttribute("title")).toBe("fixture plugin");
		expect(yield* frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(yield* frame.getAttribute("referrerpolicy")).toBe("no-referrer");
		const initialArtifact = yield* readArtifactSession(frame, apiUrl);
		observedArtifacts.push(initialArtifact);
		yield* expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
		const typography = yield* home.evaluate(async (element) => {
			const heading = element.querySelector("h1");
			const uiFaces = await document.fonts.load('16px "Outfit Variable"', "Fixture");
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
		expect(typography.uiFamily).toContain("Outfit Variable");
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
		expectSameArtifactSession(yield* readArtifactSession(frame, apiUrl), initialArtifact);
		expectCurrentBridgeSession(bridgeObservations, initialBridgeSession);

		yield* page.setViewportSize({ width: 390, height: 844 });
		expect(yield* sameFrame()).toBe(true);

		const menuTrigger = fixture.getByRole("button", { name: "Open navigation" });
		const drawer = page.getByRole("dialog", { name: "Navigation" });
		yield* menuTrigger.click();
		yield* drawer.waitFor({ state: "visible" });
		yield* page.getByTestId("drawer-scrim").click();
		yield* drawer.waitFor({ state: "hidden" });
		expect(yield* sameFrame()).toBe(true);
		expect(yield* frame.evaluate((element) => element === document.activeElement)).toBe(true);

		yield* page.setViewportSize({ width: 1280, height: 800 });
		expect(yield* sameFrame()).toBe(true);
		expectSameArtifactSession(yield* readArtifactSession(frame, apiUrl), initialArtifact);
		expectCurrentBridgeSession(bridgeObservations, initialBridgeSession);

		yield* expectVisibleText(home, "Installed client plugins: fitness, fixture, media");
		yield* fixture.getByRole("button", { name: "Refresh catalog" }).click();
		yield* expectVisibleText(home, "Installed client plugins: fitness, fixture, media");
		yield* fixture.getByRole("button", { name: "Fetch greeting" }).click();
		yield* expectVisibleText(home, "Hello, Ryot");
		yield* fixture.getByRole("button", { name: "Fetch with invalid payload" }).click();
		yield* expectVisibleText(home, "Greetings are unavailable right now.");

		yield* fixture.getByLabel("Choose a file to upload").setInputFiles({
			mimeType: "text/csv",
			name: "fixture-upload.csv",
			buffer: Buffer.from("id,title\n1,Fixture\n", "utf8"),
		});
		const uploaded = home
			.getByText(/^Uploaded fixture-upload\.csv as token .+/)
			.filter({ visible: true });
		yield* uploaded.waitFor({ state: "visible" });
		expect(yield* uploaded.isVisible()).toBe(true);

		const html = page.locator("html");
		const openSettings = Effect.gen(function* () {
			yield* page.getByRole("link", { name: "Open settings" }).click();
			yield* page.waitForURL(`${frontendUrl}/settings/preferences`);
		});
		const returnToFixture = (resolvedMode: string) =>
			Effect.gen(function* () {
				yield* page.getByRole("link", { name: "Home" }).click();
				yield* page.waitForURL(`${frontendUrl}/fixture`);
				yield* frame.waitFor({ state: "visible" });
				yield* expectVisibleText(home, `Resolved mode: ${resolvedMode}`);
				observedArtifacts.push(yield* readArtifactSession(frame, apiUrl));
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

		const navigationFrame = Option.getOrThrow(yield* frame.elementHandle());
		const navigationArtifact = yield* readArtifactSession(frame, apiUrl);
		const navigationBridgeSession = yield* waitForFreshBridgeSession(
			bridgeObservations,
			initialBridgeSession,
		);

		yield* fixture.getByRole("link", { name: "Item 1 details" }).click();
		yield* page.waitForURL(`${frontendUrl}/fixture/details/item-1?tab=stats`);
		yield* expectVisibleText(fixture.locator("body"), "Item item-1, tab stats.");
		expect(yield* frame.evaluate((current, initial) => current === initial, navigationFrame)).toBe(
			true,
		);
		expectSameArtifactSession(yield* readArtifactSession(frame, apiUrl), navigationArtifact);
		expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);

		yield* page.goBack();
		yield* page.waitForURL(`${frontendUrl}/fixture`);
		yield* expectVisibleText(home, "Greeted 0 times.");
		expect(yield* frame.evaluate((current, initial) => current === initial, navigationFrame)).toBe(
			true,
		);
		expectSameArtifactSession(yield* readArtifactSession(frame, apiUrl), navigationArtifact);
		expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);

		yield* page.goForward();
		yield* page.waitForURL(`${frontendUrl}/fixture/details/item-1?tab=stats`);
		yield* expectVisibleText(fixture.locator("body"), "Item item-1, tab stats.");
		expect(yield* frame.evaluate((current, initial) => current === initial, navigationFrame)).toBe(
			true,
		);
		expectSameArtifactSession(yield* readArtifactSession(frame, apiUrl), navigationArtifact);
		expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);

		yield* fixture.getByRole("button", { name: "Back" }).click();
		yield* page.waitForURL(`${frontendUrl}/fixture`);
		yield* expectVisibleText(home, "Greeted 0 times.");
		expect(yield* frame.evaluate((current, initial) => current === initial, navigationFrame)).toBe(
			true,
		);
		expectSameArtifactSession(yield* readArtifactSession(frame, apiUrl), navigationArtifact);
		expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);

		yield* fixture.getByRole("button", { name: "Crash during render" }).click();
		yield* expectVisibleText(page.locator("body"), "This plugin stopped working.");
		const reload = page.getByRole("button", { name: "Reload plugin" });
		yield* reload.waitFor({ state: "visible" });
		yield* reload.click();
		yield* frame.waitFor({ state: "visible" });
		yield* expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
		yield* expectVisibleText(home, "Greeted 0 times.");
		expect(yield* frame.evaluate((current, initial) => current === initial, navigationFrame)).toBe(
			false,
		);
		const crashRecoveryArtifact = yield* readArtifactSession(frame, apiUrl);
		expectFreshArtifactSession(crashRecoveryArtifact, navigationArtifact);
		observedArtifacts.push(crashRecoveryArtifact);
		yield* waitForFreshBridgeSession(bridgeObservations, navigationBridgeSession);
		yield* waitForArtifactSessionRevoked(page, navigationArtifact);

		yield* fixture.getByRole("button", { name: "Greet", exact: true }).click();
		yield* expectVisibleText(home, "Greeted 1 times.");
		const revisionAArtifact = yield* readArtifactSession(frame, apiUrl);
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
		expectSameArtifactSession(yield* readArtifactSession(frame, apiUrl), revisionAArtifact);
		expectCurrentBridgeSession(bridgeObservations, revisionABridgeSession);
		expect(yield* frame.getAttribute("data-e2e-revision")).toBe("A");
		expect(page.url()).toBe(outerUrl);

		yield* page.getByRole("button", { name: "Reload updated page" }).click();
		yield* expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.B);
		yield* expectVisibleText(home, "Revision B is active.");
		expect(yield* frame.evaluate((current, initial) => current === initial, revisionAFrame)).toBe(
			false,
		);
		const revisionBArtifact = yield* readArtifactSession(frame, apiUrl);
		expectFreshArtifactSession(revisionBArtifact, revisionAArtifact);
		observedArtifacts.push(revisionBArtifact);
		yield* waitForFreshBridgeSession(bridgeObservations, revisionABridgeSession);
		yield* waitForArtifactSessionRevoked(page, revisionAArtifact);
		expect(yield* frame.getAttribute("data-e2e-revision")).toBeNull();
		expect(page.url()).toBe(outerUrl);
		yield* expectVisibleText(home, "Greeted 0 times.");

		expectNoCredentialsInBridgeMessages(bridgeObservations, observedArtifacts);

		yield* page.goto(`${frontendUrl}/e/${pokemon.id}`);
		yield* frame.waitFor({ state: "visible" });
		yield* expectVisibleText(fixture.locator("body"), "E2E deterministic Bulbasaur");
		expect((yield* readArtifactSession(frame, apiUrl)).src).toContain(
			"/api/client-pages/artifacts/",
		);

		yield* page.goto(`${frontendUrl}/e/${showId}`);
		const mediaFrame = page.locator('iframe[title="media plugin"]');
		yield* mediaFrame.waitFor({ state: "visible" });
		const media = mediaFrame.contentFrame();
		yield* media
			.getByRole("heading", { level: 1, name: "E2E deterministic show", exact: true })
			.waitFor({ state: "visible" });
		expect((yield* readArtifactSession(mediaFrame, apiUrl)).src).toContain(
			"/api/client-pages/artifacts/",
		);
	}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
);
