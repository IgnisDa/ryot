import { gunzipSync } from "node:zlib";

import { Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";
import { unzipSync } from "fflate";

import { seedServerLog } from "~/fixtures/kernel";
import { assert, expect, it } from "~/support/effect-test";
import { getAdminAccessToken, getFrontendUrl } from "~/support/harness-target";

const WRONG_TOKEN = "wrong-token";

const isExcludedLogName = (name: string) =>
	name.endsWith(".stdout") || name.endsWith(".stderr") || name.endsWith(".txt");

it.live("downloads retained server logs from God Mode", () =>
	Effect.gen(function* () {
		const seeded = yield* seedServerLog();
		const fs = yield* FileSystem.FileSystem;
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });

		yield* page.goto(`${getFrontendUrl()}/god-mode/users`);
		yield* page.getByLabel("Admin access token").fill(getAdminAccessToken());
		yield* page.getByRole("button", { name: "Unlock God Mode" }).click();

		const sidebar = page.getByTestId("god-mode-sidebar");
		yield* sidebar.waitFor({ state: "visible" });
		yield* sidebar.getByRole("link", { name: "Server logs" }).click();
		yield* page.waitForURL((url) => url.pathname === "/god-mode/logs");
		yield* page.getByRole("heading", { level: 1, name: "Server logs" }).waitFor();

		yield* page.getByText(seeded.activeName, { exact: true }).waitFor({ state: "visible" });
		yield* page.getByText(seeded.name, { exact: true }).waitFor({ state: "visible" });
		yield* page.getByRole("button", { name: "Download all logs" }).waitFor({ state: "visible" });

		const retainedDownloadFiber = yield* page
			.eventStream("download")
			.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
		yield* page.getByRole("button", { name: `Download ${seeded.name}` }).click();
		const retainedDownload = Option.getOrThrow(yield* Fiber.join(retainedDownloadFiber));
		expect(retainedDownload.suggestedFilename()).toBe(seeded.name);
		const retainedPath = Option.getOrThrow(yield* retainedDownload.path);
		assert.isNotNull(retainedPath);
		const retainedBytes = yield* fs.readFile(retainedPath);
		expect(Buffer.from(retainedBytes)).toEqual(seeded.bytes);
		expect(gunzipSync(retainedBytes).toString("utf8")).toBe(seeded.text);

		const archiveDownloadFiber = yield* page
			.eventStream("download")
			.pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }));
		yield* page.getByRole("button", { name: "Download all logs" }).click();
		const archiveDownload = Option.getOrThrow(yield* Fiber.join(archiveDownloadFiber));
		const archivePath = Option.getOrThrow(yield* archiveDownload.path);
		assert.isNotNull(archivePath);
		expect(archiveDownload.suggestedFilename()).toMatch(/^ryot-server-logs-.+\.zip$/);
		const archiveBytes = yield* fs.readFile(archivePath);
		const archive = unzipSync(archiveBytes);
		const archivedActive = archive[seeded.activeName];
		const archivedRetained = archive[seeded.name];
		assert(archivedActive);
		assert(archivedRetained);
		expect(Buffer.from(archivedRetained)).toEqual(seeded.bytes);
		expect(gunzipSync(archivedRetained).toString("utf8")).toBe(seeded.text);
		expect(Object.keys(archive).some(isExcludedLogName)).toBe(false);
	}).pipe(PlaywrightSpawner.withBrowser),
);

it.live("keeps the God Mode token gate through invalid tokens and locking", () =>
	Effect.gen(function* () {
		const browser = yield* Playwright.Browser;
		const page = yield* browser.newPage({ viewport: { width: 1280, height: 800 } });

		yield* page.goto(`${getFrontendUrl()}/god-mode/logs`);
		const tokenInput = page.getByLabel("Admin access token");
		yield* tokenInput.waitFor({ state: "visible" });
		yield* tokenInput.fill(WRONG_TOKEN);
		yield* page.getByRole("button", { name: "Unlock God Mode" }).click();

		const alert = page.getByRole("alert");
		yield* alert.waitFor({ state: "visible" });
		expect(yield* alert.innerText()).toBe("The admin access token is invalid or expired.");
		expect(yield* tokenInput.count).toBe(1);
		expect(yield* page.getByRole("heading", { name: "Server logs" }).count).toBe(0);

		yield* tokenInput.fill(getAdminAccessToken());
		yield* page.getByRole("button", { name: "Unlock God Mode" }).click();
		yield* page.getByRole("heading", { level: 1, name: "Server logs" }).waitFor();
		yield* page.getByRole("button", { name: "Lock" }).click();
		yield* page.getByLabel("Admin access token").waitFor({ state: "visible" });
		expect(yield* page.getByRole("heading", { name: "Server logs" }).count).toBe(0);
	}).pipe(PlaywrightSpawner.withBrowser),
);
