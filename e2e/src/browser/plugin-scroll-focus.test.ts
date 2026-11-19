import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	createAuthenticatedClient,
	encodePluginSourceFiles,
	installPrivatePluginPackage,
	settledPrivateInstallation,
	testPluginManifest,
} from "~/fixtures/kernel";
import { pluginFrame, signInThroughHostedOAuth } from "~/support/browser";
import { expect, it } from "~/support/effect-test";

const encodeString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

const ACTIVE_SCREEN = 'div[tabindex="-1"]:not([aria-hidden])';

const pageExport = (entry: string) => ({
	entry,
	kind: "page" as const,
	settingsSchema: { fields: {} },
	automaticEntityPresentations: false,
});

it.live("opens new plugin content at the top with focus and restores the screen returned to", () =>
	Effect.gen(function* () {
		const { email, client, password } = yield* createAuthenticatedClient();
		const manifest = testPluginManifest({
			pluginSlug: `scroll-focus-${yield* randomUuid}`,
			clientDefinition: {
				entities: {},
				homeView: null,
				notFoundPage: "app",
				apiVersion: CLIENT_API_VERSION,
				routes: { "/": "app", "/detail": "app", "/other": "other" },
				exports: { app: pageExport("client/app.tsx"), other: pageExport("client/other.tsx") },
			},
		});
		const { id } = yield* installPrivatePluginPackage({
			client,
			config: {},
			pluginPackage: {
				manifest,
				files: encodePluginSourceFiles({
					"client/other.tsx": `
import { LongScreen } from "./long-screen";

export default function Other() {
  return <LongScreen title="Scroll other" />;
}
`,
					"client/app.tsx": `
import { usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import { LongScreen } from "./long-screen";

export default function App() {
  const location = usePluginLocation();
  return <LongScreen title={location.kind === "route" ? \`Scroll \${location.path}\` : "Scroll entity"} />;
}
`,
					"client/long-screen.tsx": `
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";

const packageId = ${yield* encodeString(manifest.metadata.packageId)};

export function LongScreen(props: { readonly title: string }) {
  const client = useRyot();
  return <PluginScreenFrame title={props.title}>
    {Array.from({ length: 150 }, (_, index) => <p key={index}>{props.title} row {index}</p>)}
    <button onClick={() => client.navigation.push({ packageId, kind: "plugin-route", path: "/detail" })}>Open detail</button>
    <button onClick={() => client.navigation.replace({ packageId, kind: "plugin-route", path: "/other" })}>Replace with other</button>
  </PluginScreenFrame>;
}
`,
				}),
			},
		});
		const installed = yield* settledPrivateInstallation(client, id);
		const page = yield* (yield* Playwright.Browser).newPage();
		yield* signInThroughHostedOAuth(page, email, password, {
			entryPath: pluginPath(installed.packageId),
		});
		const surface = pluginFrame(page);
		const scrollRoot = surface.locator(`${ACTIVE_SCREEN} > [data-scroll-root]`);
		const scrollToEnd = scrollRoot.evaluate((root) => {
			root.scrollTop = root.scrollHeight;
			return root.scrollTop;
		});
		const scrollTop = scrollRoot.evaluate((root) => root.scrollTop);
		const heading = (name: string) =>
			surface.getByRole("heading", { name, level: 1, exact: true }).waitFor({ state: "visible" });
		const button = (name: string) => surface.getByRole("button", { name, exact: true });

		yield* heading("Scroll /");
		const homeTop = yield* scrollToEnd;
		expect(homeTop).toBeGreaterThan(0);
		yield* button("Open detail").click();
		yield* heading("Scroll /detail");
		expect(yield* scrollTop).toBe(0);
		yield* surface.locator(`${ACTIVE_SCREEN}:focus`).waitFor();

		yield* page.goBack();
		yield* heading("Scroll /");
		expect(yield* scrollTop).toBe(homeTop);
		yield* button("Open detail").and(surface.locator(":focus")).waitFor();

		yield* button("Open detail").click();
		yield* heading("Scroll /detail");
		expect(yield* scrollToEnd).toBeGreaterThan(0);
		yield* button("Replace with other").click();
		yield* heading("Scroll other");
		expect(yield* scrollTop).toBe(0);
		yield* page.locator("#main-content:focus").waitFor();

		yield* page.goBack();
		yield* heading("Scroll /");
		expect(yield* scrollTop).toBe(homeTop);
	}).pipe(PlaywrightSpawner.withBrowser),
);
