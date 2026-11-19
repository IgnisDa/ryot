import { Effect } from "effect";
import type { Playwright } from "effect-playwright";

import { requirePresent } from "~/support/assertions";
import { pluginFrame } from "~/support/browser";
import { expect } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

export const openFitnessPage = (page: Playwright.Page, path: string, frontendUrl?: string) =>
	page.goto(`${frontendUrl ?? getFrontendUrl()}${path}`).pipe(Effect.as(pluginFrame(page)));

export const overlay = (frame: Playwright.FrameLocator, name: string) =>
	frame.getByRole("dialog", { name, exact: true, includeHidden: true });

export const waitInScrollBand = (target: Playwright.Locator) =>
	target.waitForFunction((element) => {
		const root = element.closest("[data-scroll-root]");
		const header = root?.querySelector('[data-scroll-obstruction="top"]')?.getBoundingClientRect();
		const dock = root?.parentElement
			?.querySelector('[data-scroll-obstruction="bottom"]')
			?.getBoundingClientRect();
		const bounds = element.getBoundingClientRect();
		return dock !== undefined && bounds.top >= (header?.bottom ?? 0) && bounds.bottom <= dock.top;
	});

export const draftHeading = (frame: Playwright.FrameLocator, name: string) =>
	frame.getByRole("heading", { name, level: 1, exact: true });

export const renameDraft = (frame: Playwright.FrameLocator, dialogTitle: string, name: string) =>
	Effect.gen(function* () {
		yield* frame.getByRole("button", { exact: true, name: "Details" }).click();
		const details = overlay(frame, dialogTitle);
		yield* details.getByRole("textbox", { exact: true, name: "Name" }).fill(name);
		yield* details.getByRole("button", { exact: true, name: "Done" }).click();
		yield* details.waitFor({ state: "hidden" });
	});

export const discardDraft = (frame: Playwright.FrameLocator) =>
	Effect.gen(function* () {
		yield* frame.getByRole("button", { exact: true, name: "Discard workout" }).click();
		yield* frame
			.getByRole("dialog", { exact: true, name: "Discard workout?" })
			.getByRole("button", { exact: true, name: "Discard workout" })
			.click();
	});

export const submitDraft = (
	frame: Playwright.FrameLocator,
	input: {
		readonly review?: "Save" | "Finish";
		readonly confirm: "Save workout" | "Save template";
	},
) =>
	Effect.gen(function* () {
		yield* frame.getByRole("button", { exact: true, name: input.review ?? "Save" }).click();
		yield* frame.getByRole("button", { exact: true, name: input.confirm }).click();
	});

export const saveDraft = (
	page: Playwright.Page,
	frame: Playwright.FrameLocator,
	input: {
		readonly name: string;
		readonly review?: "Save" | "Finish";
		readonly confirm: "Save workout" | "Save template";
	},
) =>
	Effect.gen(function* () {
		const [response] = yield* Effect.all(
			[
				page.use((raw) =>
					raw.waitForResponse((result) =>
						new URL(result.url()).pathname.endsWith("/operations/workout-editor-save"),
					),
				),
				submitDraft(frame, input),
			],
			{ concurrency: "unbounded" },
		);
		expect(response.status(), yield* Effect.promise(() => response.text())).toBe(200);
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		yield* draftHeading(frame, input.name).waitFor({ state: "visible" });
		return requirePresent(new URL(page.url()).pathname.split("/").at(-1), "Expected a saved URL");
	});
