import { Effect } from "effect";
import type { APIRequestContext, BrowserContext, Locator } from "playwright";

import {
	createTestUser,
	FIXTURE_CLIENT_REVISION_MARKERS,
	installFixtureClientPlugin,
	makeSession,
	updateFixtureClientPlugin,
} from "~/fixtures/kernel";
import { getApiUrl } from "~/support/api";
import { browserStep, signInThroughHostedOAuth, withBrowserContext } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/frontend";

type ArtifactSession = {
	readonly src: string;
	readonly credential: string;
};

type BridgeObservation = {
	readonly serialized: string;
	readonly bridgeSessionId: string | null;
};

const artifactSessionPath = /^\/api\/plugin-artifact-sessions\/([A-Za-z0-9_-]{43})\/index\.html$/;

const observeBridgeMessages = async (
	context: BrowserContext,
	observations: BridgeObservation[],
) => {
	await context.exposeBinding("recordE2ePluginBridgeMessage", (_source, value: unknown) => {
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
	});
	await context.addInitScript(() => {
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
};

const readArtifactSession = async (
	frame: Locator,
	selectedApiUrl: string,
): Promise<ArtifactSession> => {
	const src = await frame.getAttribute("src");
	if (src === null) {
		throw new Error("Plugin artifact session URL is missing [credential redacted]");
	}
	if (!URL.canParse(src)) {
		throw new Error("Plugin artifact session URL is invalid [credential redacted]");
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
		throw new Error(
			"Plugin artifact session URL must use the selected server and private index endpoint [credential redacted]",
		);
	}
	return { credential, src };
};

const expectSameArtifactSession = (current: ArtifactSession, expected: ArtifactSession) => {
	if (current.src !== expected.src || current.credential !== expected.credential) {
		throw new Error("Plugin artifact session changed unexpectedly [credentials redacted]");
	}
};

const expectFreshArtifactSession = (current: ArtifactSession, previous: ArtifactSession) => {
	if (current.src === previous.src || current.credential === previous.credential) {
		throw new Error("Plugin artifact session credential was reused [credentials redacted]");
	}
};

const waitForFreshBridgeSession = async (observations: BridgeObservation[], previous?: string) => {
	const poll = async (attempt: number): Promise<string> => {
		const current = observations.findLast(
			({ bridgeSessionId }) => bridgeSessionId !== null,
		)?.bridgeSessionId;
		if (current !== undefined && current !== null && current !== previous) {
			return current;
		}
		if (attempt === 99) {
			throw new Error("Plugin bridge did not establish a fresh session");
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
		return poll(attempt + 1);
	};
	return poll(0);
};

const expectCurrentBridgeSession = (observations: BridgeObservation[], expected: string) => {
	const current = observations.findLast(
		({ bridgeSessionId }) => bridgeSessionId !== null,
	)?.bridgeSessionId;
	if (current !== expected) {
		throw new Error("Plugin bridge session changed unexpectedly");
	}
};

const waitForArtifactSessionRevoked = async (
	request: APIRequestContext,
	artifact: ArtifactSession,
) => {
	const poll = async (attempt: number): Promise<void> => {
		try {
			const response = await request.get(artifact.src);
			const status = response.status();
			await response.dispose();
			if (status === 404) {
				return;
			}
		} catch {
			// Retry without exposing the credential-bearing request URL.
		}
		if (attempt === 99) {
			throw new Error("Replaced plugin artifact session did not return 404 [credential redacted]");
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
		return poll(attempt + 1);
	};
	return poll(0);
};

const expectNoCredentialsInBridgeMessages = (
	observations: BridgeObservation[],
	artifacts: ArtifactSession[],
) => {
	if (
		observations.some(({ serialized }) =>
			artifacts.some(({ credential }) => serialized.includes(credential)),
		)
	) {
		throw new Error("Plugin bridge message exposed an artifact credential [credential redacted]");
	}
};

const expectVisibleText = async (locator: Locator, text: string) => {
	const match = locator.getByText(text, { exact: true }).filter({ visible: true });
	await match.waitFor({ state: "visible" });
	expect(await match.isVisible()).toBe(true);
};

it.live("runs the client plugin lifecycle in a real browser", () =>
	Effect.gen(function* () {
		const apiUrl = getApiUrl();
		const frontendUrl = getFrontendUrl();
		const { token, email, password } = yield* createTestUser(apiUrl);
		const client = makeSession(apiUrl, { Authorization: `Bearer ${token}` });
		const effectContext = yield* Effect.context();
		yield* installFixtureClientPlugin(client, "A", "", apiUrl);

		yield* withBrowserContext(undefined, ({ context }) =>
			Effect.gen(function* () {
				const bridgeObservations: BridgeObservation[] = [];
				const observedArtifacts: ArtifactSession[] = [];
				yield* Effect.promise(() => observeBridgeMessages(context, bridgeObservations));
				const page = yield* Effect.promise(() => context.newPage());
				const frame = page.locator('iframe[title="fixture plugin"]');
				const fixture = page.frameLocator('iframe[title="fixture plugin"]');
				const home = fixture.locator("main");

				const { historyLengthBeforeSubmit } = yield* signInThroughHostedOAuth(
					page,
					email,
					password,
					{ captureHistory: true, entryPath: "/" },
				);
				yield* browserStep("verify sign-in workspace redirect", async () => {
					// Sign-in lands on the first enabled workspace by (sortOrder, slug), which earlier
					// suites change by installing system plugins into the shared database.
					await page.waitForURL((url) => /^\/[^/]+$/.test(url.pathname));
					expect(await page.evaluate(() => history.length)).toBe(historyLengthBeforeSubmit! + 1);
				});

				yield* browserStep("enter Fixture through the workspace switcher", async () => {
					await page.getByRole("button", { name: /workspace,/ }).click();
					await page.getByRole("menuitemradio", { name: "Switch to Fixture workspace" }).click();
					await page.waitForURL(`${frontendUrl}/fixture`);
					await frame.waitFor({ state: "visible" });
				});

				const initialArtifact = yield* browserStep(
					"verify the isolated revision A frame",
					async () => {
						await frame.waitFor({ state: "visible" });
						expect(await frame.getAttribute("title")).toBe("fixture plugin");
						expect(await frame.getAttribute("sandbox")).toBe("allow-scripts");
						expect(await frame.getAttribute("referrerpolicy")).toBe("no-referrer");
						const artifact = await readArtifactSession(frame, apiUrl);
						observedArtifacts.push(artifact);
						await expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
						const typography = await home.evaluate(async (element) => {
							const heading = element.querySelector("h1");
							const uiFaces = await document.fonts.load('16px "Outfit Variable"', "Fixture");
							const displayFaces = await document.fonts.load('16px "Lora Variable"', "Fixture");
							return {
								hasHeading: heading !== null,
								uiFamily: getComputedStyle(element).fontFamily,
								displayFamily: heading ? getComputedStyle(heading).fontFamily : "",
								uiLoaded: uiFaces.length > 0 && uiFaces.every(({ status }) => status === "loaded"),
								displayLoaded:
									displayFaces.length > 0 &&
									displayFaces.every(({ status }) => status === "loaded"),
							};
						});
						expect(typography.hasHeading).toBe(true);
						expect(typography.uiFamily).toContain("Outfit Variable");
						expect(typography.displayFamily).toContain("Lora Variable");
						expect(typography.uiLoaded).toBe(true);
						expect(typography.displayLoaded).toBe(true);
						expect(
							await fixture.getByRole("region", { name: "Theme snapshot" }).getAttribute("class"),
						).toBe("w-full max-w-md rounded-lg border border-border bg-surface p-4");
						return artifact;
					},
				);
				const initialBridgeSession = yield* browserStep(
					"establish the initial bridge session",
					() => waitForFreshBridgeSession(bridgeObservations),
				);

				yield* browserStep(
					"preserve the iframe and bridge across shell-only interactions",
					async () => {
						const shellFrame = await frame.elementHandle();
						expect(shellFrame).not.toBeNull();
						const sameFrame = () =>
							frame.evaluate((current, initial) => current === initial, shellFrame);

						const switcherTrigger = page.getByRole("button", { name: /workspace,/ });
						const switcherMenu = page.getByRole("menu", { name: "Workspaces" });
						await switcherTrigger.click();
						await switcherMenu.waitFor({ state: "visible" });
						await switcherTrigger.click();
						await switcherMenu.waitFor({ state: "hidden" });
						expect(await sameFrame()).toBe(true);
						expectSameArtifactSession(await readArtifactSession(frame, apiUrl), initialArtifact);
						expectCurrentBridgeSession(bridgeObservations, initialBridgeSession);

						await page.setViewportSize({ width: 390, height: 844 });
						expect(await sameFrame()).toBe(true);

						const menuTrigger = page.getByRole("button", { name: "Open navigation" });
						const drawer = page.getByRole("dialog", { name: "Navigation" });
						await menuTrigger.click();
						await drawer.waitFor({ state: "visible" });
						await page.getByRole("button", { name: "Close navigation" }).click();
						await drawer.waitFor({ state: "hidden" });
						expect(await sameFrame()).toBe(true);
						expect(
							await menuTrigger.evaluate((element) => element === document.activeElement),
						).toBe(true);

						await page.setViewportSize({ width: 1280, height: 800 });
						expect(await sameFrame()).toBe(true);
						expectSameArtifactSession(await readArtifactSession(frame, apiUrl), initialArtifact);
						expectCurrentBridgeSession(bridgeObservations, initialBridgeSession);
					},
				);

				yield* browserStep("use catalog and operation bridges", async () => {
					await expectVisibleText(home, "Installed client plugins: fixture");
					await fixture.getByRole("button", { name: "Refresh catalog" }).click();
					await expectVisibleText(home, "Installed client plugins: fixture");
					await fixture.getByRole("button", { name: "Fetch greeting" }).click();
					await expectVisibleText(home, "Hello, Ryot");
					await fixture.getByRole("button", { name: "Fetch with invalid payload" }).click();
					await expectVisibleText(home, "Greetings are unavailable right now.");
				});

				yield* browserStep("synchronize theme through settings/preferences", async () => {
					const html = page.locator("html");
					const openSettings = async () => {
						await page.getByRole("link", { name: "Open settings" }).click();
						await page.waitForURL(`${frontendUrl}/settings/preferences`);
					};
					const returnToFixture = async (resolvedMode: string) => {
						await page.getByRole("link", { name: "Home" }).click();
						await page.waitForURL(`${frontendUrl}/fixture`);
						await frame.waitFor({ state: "visible" });
						await expectVisibleText(home, `Resolved mode: ${resolvedMode}`);
						observedArtifacts.push(await readArtifactSession(frame, apiUrl));
					};

					await openSettings();
					await page.getByRole("radio", { name: "Use Light theme" }).click();
					expect(await html.getAttribute("data-theme")).toBe("light");
					await returnToFixture("light");

					await openSettings();
					await page.getByRole("radio", { name: "Use Dark theme" }).click();
					expect(await html.getAttribute("data-theme")).toBe("dark");
					await returnToFixture("dark");

					await openSettings();
					await page.emulateMedia({ colorScheme: "dark" });
					await page.getByRole("radio", { name: "Use System theme" }).click();
					expect(await html.getAttribute("data-theme")).toBeNull();
					await returnToFixture("dark");
				});

				const navigationFrame = yield* browserStep("capture the navigation frame", () =>
					frame.elementHandle(),
				);
				const navigationArtifact = yield* browserStep("capture the navigation artifact", () =>
					readArtifactSession(frame, apiUrl),
				);
				const navigationBridgeSession = yield* browserStep(
					"establish the navigation bridge session",
					() => waitForFreshBridgeSession(bridgeObservations, initialBridgeSession),
				);
				expect(navigationFrame).not.toBeNull();
				yield* browserStep("navigate while preserving the iframe", async () => {
					await fixture.getByRole("link", { name: "Item 1 details" }).click();
					await page.waitForURL(`${frontendUrl}/fixture/details/item-1?tab=stats`);
					await expectVisibleText(fixture.locator("main"), "Item item-1, tab stats.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);
					expectSameArtifactSession(await readArtifactSession(frame, apiUrl), navigationArtifact);
					expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);

					await page.goBack();
					await page.waitForURL(`${frontendUrl}/fixture`);
					await expectVisibleText(home, "Greeted 0 times.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);
					expectSameArtifactSession(await readArtifactSession(frame, apiUrl), navigationArtifact);
					expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);

					await page.goForward();
					await page.waitForURL(`${frontendUrl}/fixture/details/item-1?tab=stats`);
					await expectVisibleText(fixture.locator("main"), "Item item-1, tab stats.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);
					expectSameArtifactSession(await readArtifactSession(frame, apiUrl), navigationArtifact);
					expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);

					await fixture.getByRole("button", { name: "Back" }).click();
					await page.waitForURL(`${frontendUrl}/fixture`);
					await expectVisibleText(home, "Greeted 0 times.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(true);
					expectSameArtifactSession(await readArtifactSession(frame, apiUrl), navigationArtifact);
					expectCurrentBridgeSession(bridgeObservations, navigationBridgeSession);
				});

				yield* browserStep("recover from a plugin crash", async () => {
					await fixture.getByRole("button", { name: "Crash during render" }).click();
					await expectVisibleText(page.locator("body"), "This plugin stopped working.");
					const reload = page.getByRole("button", { name: "Reload plugin" });
					await reload.waitFor({ state: "visible" });
					await reload.click();
					await frame.waitFor({ state: "visible" });
					await expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.A);
					await expectVisibleText(home, "Greeted 0 times.");
					expect(
						await frame.evaluate((current, initial) => current === initial, navigationFrame),
					).toBe(false);
					const crashRecoveryArtifact = await readArtifactSession(frame, apiUrl);
					expectFreshArtifactSession(crashRecoveryArtifact, navigationArtifact);
					observedArtifacts.push(crashRecoveryArtifact);
					await waitForFreshBridgeSession(bridgeObservations, navigationBridgeSession);
					await waitForArtifactSessionRevoked(context.request, navigationArtifact);
				});

				yield* browserStep("replace the frame from the live revision event", async () => {
					await fixture.getByRole("button", { name: "Greet", exact: true }).click();
					await expectVisibleText(home, "Greeted 1 times.");
					const revisionAArtifact = await readArtifactSession(frame, apiUrl);
					const revisionABridgeSession = await waitForFreshBridgeSession(
						bridgeObservations,
						navigationBridgeSession,
					);
					const outerUrl = page.url();
					await frame.evaluate((element) => element.setAttribute("data-e2e-revision", "A"));

					await Effect.runPromiseWith(effectContext)(
						updateFixtureClientPlugin(client, "B", "", apiUrl),
					);
					await expectVisibleText(home, FIXTURE_CLIENT_REVISION_MARKERS.B);
					await expectVisibleText(home, "Revision B is active.");
					const revisionBArtifact = await readArtifactSession(frame, apiUrl);
					expectFreshArtifactSession(revisionBArtifact, revisionAArtifact);
					observedArtifacts.push(revisionBArtifact);
					await waitForFreshBridgeSession(bridgeObservations, revisionABridgeSession);
					await waitForArtifactSessionRevoked(context.request, revisionAArtifact);
					expect(await frame.getAttribute("data-e2e-revision")).toBeNull();
					expect(page.url()).toBe(outerUrl);
					await expectVisibleText(home, "Greeted 0 times.");
				});

				expectNoCredentialsInBridgeMessages(bridgeObservations, observedArtifacts);
			}),
		);
	}),
);
