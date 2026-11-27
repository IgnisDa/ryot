import type { Playwright } from "effect-playwright";

export const mediaPluginFrame = (page: Playwright.Page, options?: { readonly visible?: boolean }) =>
	page.locator(
		options?.visible ? 'iframe[title="Media plugin"]:visible' : 'iframe[title="Media plugin"]',
	);
