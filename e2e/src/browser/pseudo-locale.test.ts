import { Effect } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { createAuthenticatedClient, updateUserSettingsPreferences } from "~/fixtures/kernel";
import { listAdminSystemPlugins } from "~/fixtures/kernel/admin-system-plugins";
import { pluginFrame, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const PSEUDO_LOCALE = "en-XA";

const kernelScreens = [
	"/settings/preferences",
	"/settings/account",
	"/settings/access",
	"/settings/plugins",
	"/settings/notification-channels",
	"/settings/reminders",
	"/settings/publications",
	"/settings/import-data",
	"/settings/backups",
];

const pluginScreens = ["/p/ryot/fitness", "/p/ryot/media"];

const brandNames = ["Ryot", "Ryo"];
const packageIds = ["ryot/fitness", "ryot/media"];
const keyCaps = ["J", "K"];

/**
 * Visible text nodes and text-bearing attributes (`aria-label`, `title`, `placeholder`, `alt`) with
 * Latin letters but no pseudo-locale accents, except allowed data and month, weekday and language
 * names that `Intl` formats from locale data.
 */
const untranslatedText = (root: Playwright.Locator, allowed: ReadonlyArray<string>) =>
	root.evaluate(
		(body, input) => {
			const styles: ReadonlyArray<"long" | "short"> = ["long", "short"];
			const formatUtc = (options: Intl.DateTimeFormatOptions, date: number) =>
				new Intl.DateTimeFormat(input.locale, { ...options, timeZone: "UTC" }).format(date);
			const localeNames = styles.flatMap((style) =>
				Array.from({ length: 12 }, (_, month) =>
					formatUtc({ month: style }, Date.UTC(2024, month, 1)),
				).concat(
					Array.from({ length: 7 }, (_, day) =>
						formatUtc({ weekday: style }, Date.UTC(2024, 0, day + 1)),
					),
				),
			);
			const formatted = new RegExp(`\\b(?:${localeNames.join("|")})\\b`, "giu");
			const allowedText = new Set([
				...input.allowed,
				new Intl.DisplayNames([input.locale], { type: "language" }).of(input.locale),
			]);
			const isTranslated = (text: string) =>
				/[À-ɏḀ-ỿ]/.test(text) ||
				!/[A-Za-z]/.test(text.replaceAll(formatted, "")) ||
				allowedText.has(text.replace(/^\[(.*)\]$/, "$1"));
			const visibility = { checkOpacity: true, checkVisibilityCSS: true };
			const found: string[] = [];
			const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
				const text = node.textContent?.trim() ?? "";
				if (node.parentElement?.checkVisibility(visibility) === true && !isTranslated(text)) {
					found.push(text);
				}
			}
			const attributes = ["aria-label", "title", "placeholder", "alt"];
			for (const element of body.querySelectorAll(
				attributes.map((attribute) => `[${attribute}]`).join(","),
			)) {
				if (!element.checkVisibility(visibility)) {
					continue;
				}
				for (const attribute of attributes) {
					const text = element.getAttribute(attribute)?.trim() ?? "";
					if (!isTranslated(text)) {
						found.push(`${attribute}="${text}"`);
					}
				}
			}
			return found;
		},
		{ allowed, locale: PSEUDO_LOCALE },
	);

it.live("renders every visible interface text through the pseudo-locale", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		yield* updateUserSettingsPreferences(client, { interfaceLocale: PSEUDO_LOCALE });
		const page = yield* (yield* Playwright.Browser).newPage({
			viewport: { width: 1280, height: 900 },
		});
		yield* signInThroughHostedOAuth(page, email, password);
		yield* page.locator(`html[lang="${PSEUDO_LOCALE}"]`).waitFor({ state: "attached" });
		const workspaceIdentities = (yield* listAdminSystemPlugins(client.target)).flatMap(
			({ id, packageId }) => (packageIds.includes(packageId) ? [`${packageId} · ${id}`] : []),
		);
		const allowed = [
			...brandNames,
			...packageIds,
			...workspaceIdentities,
			...keyCaps,
			"Test User",
			email,
		];

		const findings: Array<{ readonly text: string; readonly screen: string }> = [];
		for (const screen of kernelScreens) {
			yield* page.goto(`${getFrontendUrl()}${screen}`);
			yield* page.getByRole("navigation").first().waitFor();
			yield* page.locator("main").getByRole("heading").first().waitFor();
			for (const text of yield* untranslatedText(page.locator("body"), allowed)) {
				findings.push({ text, screen });
			}
		}
		for (const screen of pluginScreens) {
			yield* page.goto(`${getFrontendUrl()}${screen}`);
			yield* page.getByRole("navigation").first().waitFor();
			const frame = pluginFrame(page);
			yield* frame.getByRole("heading").first().waitFor();
			for (const text of [
				...(yield* untranslatedText(page.locator("body"), allowed)),
				...(yield* untranslatedText(frame.locator("body"), allowed)),
			]) {
				findings.push({ text, screen });
			}
		}
		expect(findings).toEqual([]);
	}).pipe(PlaywrightSpawner.withBrowser),
);
