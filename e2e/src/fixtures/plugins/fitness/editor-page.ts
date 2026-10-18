import { Effect } from "effect";
import type { Playwright } from "effect-playwright";

import { requirePresent } from "~/support/assertions";
import { pluginFrame } from "~/support/browser";
import { getFrontendUrl } from "~/support/harness-target";

export const openFitnessPage = (page: Playwright.Page, path: string, frontendUrl?: string) =>
	page.goto(`${frontendUrl ?? getFrontendUrl()}${path}`).pipe(Effect.as(pluginFrame(page)));

export const draftHeading = (frame: Playwright.FrameLocator, name: string) =>
	frame.getByRole("heading", { name, level: 1, exact: true });

export const renameDraft = (frame: Playwright.FrameLocator, dialogTitle: string, name: string) =>
	Effect.gen(function* () {
		yield* frame.getByRole("button", { exact: true, name: "Details" }).click();
		const details = frame.getByRole("dialog", { exact: true, name: dialogTitle });
		yield* details.getByRole("textbox", { exact: true, name: "Name" }).fill(name);
		yield* details.getByRole("button", { exact: true, name: "Done" }).click();
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
		readonly confirm: "Save template" | "Save workout";
		readonly review?: "Finish" | "Save";
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
		readonly review?: "Finish" | "Save";
		readonly confirm: "Save template" | "Save workout";
	},
) =>
	Effect.gen(function* () {
		yield* submitDraft(frame, input);
		yield* page.waitForURL((url) => url.pathname.startsWith("/e/"));
		yield* draftHeading(frame, input.name).waitFor({ state: "visible" });
		return requirePresent(new URL(page.url()).pathname.split("/").at(-1), "Expected a saved URL");
	});
