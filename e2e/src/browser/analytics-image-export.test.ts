import { Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { analyticsSearch, analyticsSection } from "~/fixtures/kernel/analytics-location";
import { createFitnessAnalyticsFixture } from "~/fixtures/plugins/fitness/analytics";
import { createMediaAnalyticsFixture } from "~/fixtures/plugins/media/analytics";
import { activePluginIframe, signInThroughHostedOAuth } from "~/support/browser";
import { assert, expect, it } from "~/support/effect-test";

for (const domain of ["media", "fitness"] as const) {
	it.live(
		`saves the selected ${domain} Analytics report as a PNG across themes and viewports`,
		() =>
			Effect.gen(function* () {
				const fixture = yield* domain === "media"
					? createMediaAnalyticsFixture()
					: createFitnessAnalyticsFixture();
				const browser = yield* Playwright.Browser;
				const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });
				const section = analyticsSection(fixture.reference.pluginId, domain);
				yield* signInThroughHostedOAuth(page, fixture.account.email, fixture.account.password, {
					entryPath: `/v/k/analytics?${analyticsSearch(fixture.reportingSelection, { section })}`,
				});
				const frame = activePluginIframe(page).contentFrame();
				const save = frame.getByRole("button", { exact: true, name: "Save image" });
				yield* save.waitFor();
				const fs = yield* FileSystem.FileSystem;
				for (const mode of [
					{ width: 1280, height: 800, colorScheme: "light" },
					{ width: 390, height: 844, colorScheme: "dark" },
				] as const) {
					yield* page.setViewportSize({ width: mode.width, height: mode.height });
					yield* page.use((native) =>
						native.emulateMedia({ reducedMotion: "reduce", colorScheme: mode.colorScheme }),
					);
					const pending = yield* page
						.eventStream("download")
						.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
					yield* save.click();
					const failed = frame.getByRole("button", { exact: true, name: "Retry image export" });
					const result = yield* Effect.raceFirst(
						Fiber.join(pending),
						failed.waitFor().pipe(
							Effect.andThen(failed.locator("..").innerText()),
							Effect.flatMap((message) => Effect.die(new Error(message))),
						),
					);
					const download = Option.getOrThrow(result);
					expect(download.suggestedFilename()).toBe(`ryot-${domain}-analytics.png`);
					const path = Option.getOrThrow(yield* download.path);
					assert(path !== null);
					const bytes = yield* fs.readFile(path);
					expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
					expect(bytes.length).toBeGreaterThan(10_000);
					// oxlint-disable-next-line effecttsgo/async-function -- Playwright executes this browser image-decoding boundary.
					const image = yield* page.evaluate(async (pngBytes) => {
						const bitmap = await createImageBitmap(
							new Blob([new Uint8Array(pngBytes)], { type: "image/png" }),
						);
						const canvas = document.createElement("canvas");
						canvas.width = bitmap.width;
						canvas.height = bitmap.height;
						const context = canvas.getContext("2d");
						if (context === null) {
							throw new Error("Canvas unavailable");
						}
						context.drawImage(bitmap, 0, 0);
						const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
						const colors = new Set<number>();
						for (let index = 0; index < pixels.length; index += 4) {
							colors.add(
								((pixels[index] ?? 0) << 16) |
									((pixels[index + 1] ?? 0) << 8) |
									(pixels[index + 2] ?? 0),
							);
						}
						bitmap.close();
						return {
							opaque: pixels[3],
							width: canvas.width,
							colors: colors.size,
							height: canvas.height,
						};
					}, Array.from(bytes));
					expect(image.width).toBe(1200);
					expect(image.height).toBeGreaterThan(1000);
					expect(image.height).toBeLessThanOrEqual(6020);
					expect(image.colors).toBeGreaterThan(100);
					expect(image.opaque).toBe(255);
					yield* save.waitFor();
				}
			}).pipe(PlaywrightSpawner.withBrowser),
	);
}
