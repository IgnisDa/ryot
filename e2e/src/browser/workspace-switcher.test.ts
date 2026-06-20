import { Effect } from "effect";

import { createTestUser } from "~/fixtures/kernel";
import { signInThroughHostedOAuth, withBrowser } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

it.live("opens the desktop workspace switcher with its keyboard shortcut", () =>
	Effect.gen(function* () {
		const { email, password } = yield* createTestUser();
		yield* withBrowser({ viewport: { width: 1280, height: 900 } }, ({ page }) =>
			Effect.gen(function* () {
				yield* signInThroughHostedOAuth(page, email, password);
				yield* Effect.promise(async () => {
					const sidebar = page.getByTestId("desktop-sidebar");
					const shortcut = "Mod+Shift+Space";
					const trigger = sidebar.getByRole("button", { name: /workspace,/ });
					expect(await trigger.getAttribute("aria-keyshortcuts")).toBe(shortcut);
					expect(await sidebar.getByText(shortcut, { exact: true }).isVisible()).toBe(true);

					const primaryModifier = await page.evaluate(() =>
						/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
					);
					await page.keyboard.press(`${primaryModifier}+Shift+Space`);

					const menu = sidebar.getByRole("menu", { name: "Workspaces" });
					await menu.waitFor({ state: "visible" });
					const currentWorkspace = menu.getByRole("menuitemradio", { checked: true });
					expect(
						await currentWorkspace.evaluate((element) => document.activeElement === element),
					).toBe(true);

					await page.keyboard.press(`${primaryModifier}+Shift+Space`);
					expect(await menu.isVisible()).toBe(true);

					await page.keyboard.press("Escape");
					await menu.waitFor({ state: "hidden" });
				});
			}),
		);
	}),
);
