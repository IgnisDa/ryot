/* oxlint-disable max-lines-per-function, perfectionist/sort-objects, typescript/no-explicit-any -- One linear source-edit scenario keeps restoration and evidence explicit; the local retry accepts Effect Playwright operations with varying typed failures. */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import { Clock, Effect } from "effect";
import { chromium, Playwright, PlaywrightSpawner } from "effect-playwright";

import { createTestUser } from "~/fixtures/kernel";
import { signInThroughHostedOAuth } from "~/support/browser";
import { beforeAll, describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

const enabled = process.env.RUN_STYLEX_TRACER_HMR_E2E === "1";
const repositoryRoot = process.env.STYLEX_TRACER_HMR_ROOT;
const evidencePath = process.env.STYLEX_TRACER_HMR_EVIDENCE;
const assetMode = process.env.E2E_FRONTEND_ASSET_MODE;
const backendProcessId = process.env.E2E_BACKEND_PROCESS_ID;
const viteProcessId = process.env.E2E_VITE_PROCESS_ID;
const browserLayer = PlaywrightSpawner.layer(chromium);
let credentials: { readonly email: string; readonly password: string };

const replaceRequired = (source: string, before: string, after: string) => {
	const changed = source.replace(before, after);
	if (changed === source) {
		throw new Error(`HMR edit target was not found: ${before}`);
	}
	return changed;
};

const waitForValue = (read: () => Effect.Effect<string, any, any>, expected: string) =>
	Effect.gen(function* () {
		let actual = "";
		for (let attempt = 0; attempt < 80; attempt += 1) {
			actual = yield* read();
			if (actual === expected) {
				return;
			}
			yield* Effect.sleep("50 millis");
		}
		expect(actual).toBe(expected);
	});

describe.skipIf(!enabled)("StyleX tracer Vite editing", () => {
	beforeAll(async () => {
		expect(repositoryRoot).toBeTruthy();
		expect(assetMode).toBe("vite-development");
		credentials = await Effect.runPromise(createTestUser(getApiUrl()));
	});

	it.live("updates shared declarations and tokens without reload and recovers after an error", () =>
		Effect.gen(function* () {
			if (repositoryRoot === undefined) {
				return yield* Effect.die("STYLEX_TRACER_HMR_ROOT is required");
			}
			const controlsPath = `${repositoryRoot}/packages/client-ui-sdk/src/stylex-tracer/controls.tsx`;
			const tokensPath = `${repositoryRoot}/packages/client-ui-sdk/src/stylex-tracer/tokens.stylex.ts`;
			const controls = yield* Effect.promise(() => readFile(controlsPath, "utf8"));
			const tokens = yield* Effect.promise(() => readFile(tokensPath, "utf8"));
			const browser = yield* Playwright.Browser;
			const page = yield* browser.newPage({
				colorScheme: "light",
				viewport: { width: 1280, height: 900 },
			});
			yield* page.addInitScript(() => {
				const reloads = Number.parseInt(sessionStorage.getItem("stylex-hmr-loads") ?? "0", 10);
				sessionStorage.setItem("stylex-hmr-loads", String(reloads + 1));
			});
			const observations: Record<string, unknown> = {};

			yield* Effect.gen(function* () {
				yield* signInThroughHostedOAuth(page, credentials.email, credentials.password, {
					entryPath: "/stylex-tracer-kernel",
				});
				const panel = page.getByTestId("stylex-tracer-panel");
				const field = page.getByLabel("Name");
				const progress = page.getByRole("progressbar", { name: "Tracer progress" });
				yield* panel.waitFor({ state: "visible" });
				yield* field.fill("HMR state");
				yield* page.getByRole("button", { name: "Advance progress" }).click();
				yield* page.getByRole("button", { name: "Details" }).click();
				const details = page.getByRole("dialog", { name: "Tracer details" });
				yield* details.waitFor({ state: "visible" });
				yield* panel.evaluate((element) => {
					element.dataset.hmrIdentity = "retained";
				});
				const loadsBeforeEdits = Number(
					yield* page.evaluate(() => sessionStorage.getItem("stylex-hmr-loads")),
				);

				const changedControl = replaceRequired(
					controls,
					'borderRadius: tracerTokens.radiusControl,\n\t\tborderStyle: "solid",\n\t\tborderWidth: "1px",\n\t\tcolor: tracerTokens.foreground,',
					'borderRadius: tracerTokens.radiusControl,\n\t\tborderStyle: "solid",\n\t\tborderWidth: "5px",\n\t\tcolor: tracerTokens.foreground,',
				);
				yield* Effect.promise(() => writeFile(controlsPath, changedControl));
				yield* waitForValue(
					() => field.evaluate((element) => getComputedStyle(element).borderTopWidth),
					"5px",
				);
				observations.controlDeclaration = "5px";

				const changedTokens = replaceRequired(
					tokens,
					'export const lightTracerTheme = stylex.createTheme(tracerTokens, {\n\terror: "#b42318",\n\tfocus: "#2563eb",\n\taccent: "#d97706",\n\tborder: "#d6d0c4",',
					'export const lightTracerTheme = stylex.createTheme(tracerTokens, {\n\terror: "#b42318",\n\tfocus: "#2563eb",\n\taccent: "#d97706",\n\tborder: "#00aa44",',
				);
				yield* Effect.promise(() => writeFile(tokensPath, changedTokens));
				for (const locator of [panel, details]) {
					yield* waitForValue(
						() => locator.evaluate((element) => getComputedStyle(element).borderColor),
						"rgb(0, 170, 68)",
					);
				}
				observations.sharedToken = "rgb(0, 170, 68)";

				const removedDeclaration = replaceRequired(
					changedControl,
					'\t\tborderRadius: tracerTokens.radiusControl,\n\t\tborderStyle: "solid",\n\t\tborderWidth: "5px",\n\t\tcolor: tracerTokens.foreground,',
					'\t\tborderStyle: "solid",\n\t\tborderWidth: "5px",\n\t\tcolor: tracerTokens.foreground,',
				);
				yield* Effect.promise(() => writeFile(controlsPath, removedDeclaration));
				yield* waitForValue(
					() => field.evaluate((element) => getComputedStyle(element).borderRadius),
					"0px",
				);
				observations.removedDeclarationFallback = "0px";

				const invalidControl = replaceRequired(
					removedDeclaration,
					'\tinput: {\n\t\tappearance: "none",',
					'\tinput: {\n\t\tcolour: "red",\n\t\tbackgroundColor: globalThis.crypto.randomUUID(),\n\t\tappearance: "none",',
				);
				yield* Effect.promise(() => writeFile(controlsPath, invalidControl));
				const viteOverlay = page.locator("vite-error-overlay");
				yield* viteOverlay.waitFor({ state: "visible" });
				const viteDiagnostic = yield* viteOverlay.evaluate(
					// oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright and lib.dom disagree about shadowRoot nullability here.
					(element) => element.shadowRoot?.textContent ?? element.textContent ?? "",
				);
				expect(viteDiagnostic.length).toBeGreaterThan(0);
				expect(yield* field.inputValue()).toBe("HMR state");
				expect(yield* progress.getAttribute("aria-valuenow")).toBe("42");
				expect(yield* details.isVisible()).toBe(true);
				expect(yield* panel.getAttribute("data-hmr-identity")).toBe("retained");
				observations.viteInvalidEdit = {
					signal: "vite-error-overlay",
					diagnostic: viteDiagnostic.replace(/\s+/g, " ").trim().slice(0, 500),
					input: "unsupported non-static StyleX value",
					plainColourHandledBy: "scoped TypeScript checker, not Vite",
					priorUiRetained: true,
				};
				const checker = spawnSync("bun", ["run", "tsc", "--noEmit"], {
					cwd: `${repositoryRoot}/packages/client-ui-sdk`,
					encoding: "utf8",
				});
				const checkerOutput = `${checker.stdout}\n${checker.stderr}`;
				expect(checker.status).not.toBe(0);
				expect(checkerOutput).toContain("TS2561");
				observations.invalidChecker = {
					status: checker.status,
					diagnostic: checkerOutput.split("\n").find((line) => line.includes("TS2561")),
				};

				yield* Effect.promise(() => writeFile(controlsPath, controls));
				yield* Effect.promise(() => writeFile(tokensPath, tokens));
				yield* viteOverlay.waitFor({ state: "detached" });
				yield* waitForValue(
					() => field.evaluate((element) => getComputedStyle(element).borderTopWidth),
					"1px",
				);
				yield* waitForValue(
					() => field.evaluate((element) => getComputedStyle(element).borderRadius),
					"10px",
				);
				yield* waitForValue(
					() => panel.evaluate((element) => getComputedStyle(element).borderColor),
					"rgb(214, 208, 196)",
				);
				expect(yield* field.inputValue()).toBe("HMR state");
				expect(yield* progress.getAttribute("aria-valuenow")).toBe("42");
				expect(yield* details.isVisible()).toBe(true);
				expect(yield* panel.getAttribute("data-hmr-identity")).toBe("retained");
				const loadsAfterEdits = Number(
					yield* page.evaluate(() => sessionStorage.getItem("stylex-hmr-loads")),
				);
				expect(loadsAfterEdits).toBe(loadsBeforeEdits);
				observations.recovery = {
					viteAcceptedRestoredModule: true,
					dialogOpen: true,
					input: "HMR state",
					progress: 42,
					documentLoadsDuringEdits: loadsAfterEdits - loadsBeforeEdits,
					markerRetained: true,
				};
			}).pipe(
				Effect.ensuring(
					Effect.all([
						Effect.promise(() => writeFile(controlsPath, controls)),
						Effect.promise(() => writeFile(tokensPath, tokens)),
					]).pipe(Effect.orDie),
				),
			);

			if (evidencePath !== undefined) {
				const generatedAtMs = yield* Clock.currentTimeMillis;
				yield* Effect.promise(() =>
					Bun.write(
						evidencePath,
						`${JSON.stringify(
							{
								generatedAtMs,
								assetMode,
								backendProcessId,
								viteProcessId,
								repositoryRoot,
								classification: "state-preserving-hmr",
								observations,
							},
							null,
							2,
						)}\n`,
					),
				);
			}
			return yield* Effect.void;
		}).pipe(PlaywrightSpawner.withBrowser, Effect.provide(browserLayer)),
	);
});
