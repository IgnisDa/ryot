import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
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
import { getFrontendUrl } from "~/support/harness-target";

const encodeString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

it.live("flushes large device drafts before navigation and restores scoped return shortcuts", () =>
	Effect.gen(function* () {
		const frontendUrl = getFrontendUrl();
		const { email, client, password } = yield* createAuthenticatedClient();
		const manifest = testPluginManifest({
			pluginSlug: `device-draft-${crypto.randomUUID()}`,
			clientDefinition: {
				entities: {},
				homeView: null,
				notFoundPage: "home",
				routes: { "/": "home" },
				apiVersion: CLIENT_API_VERSION,
				exports: {
					home: {
						kind: "page",
						entry: "client/home.tsx",
						settingsSchema: { fields: {} },
						automaticEntityPresentations: false,
					},
				},
			},
		});
		const { id } = yield* installPrivatePluginPackage({
			client,
			config: {},
			pluginPackage: {
				manifest,
				files: encodePluginSourceFiles({
					"client/home.tsx": `
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginPackageId } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { useEffect, useRef, useState } from "react";

const packageId = PluginPackageId.make(${encodeString(manifest.metadata.packageId)});
export default function Home() {
  const client = useRyot();
  const { pluginId } = client.pluginIdentity(packageId);
  const input = useRef("");
  const blocked = useRef(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Loading");
  useEffect(() => {
    const controller = new AbortController();
    Effect.runFork(client.storage.get(pluginId, "draft").pipe(Effect.match({
      onSuccess: (value) => { input.current = typeof value === "string" ? value : ""; setText(input.current); setStatus("Ready"); },
      onFailure: (error) => setStatus(error.reason),
    })), { signal: controller.signal });
    return () => controller.abort();
  }, [client, pluginId]);
  useEffect(() => client.persistence.registerFlush(() => Effect.gen(function* () {
    if (blocked.current) { setStatus("quota"); return yield* new RyotClientError("quota"); }
    yield* client.storage.set(pluginId, "draft", input.current);
    yield* client.device({ action: "return-shortcut", pluginId, shortcut: { label: "Resume draft", target: { kind: "plugin-route", packageId, path: "/", search: "" } } });
  })), [client, pluginId]);
  return <PluginScreenFrame title="Device draft">
    <label>Draft<textarea aria-label="Draft" value={text} onChange={(event) => { input.current = event.target.value; setText(input.current); }} /></label>
    <button onClick={() => { blocked.current = true; }}>Block persistence</button>
    <button onClick={() => { blocked.current = false; }}>Allow persistence</button>
    <button onClick={() => client.navigation.push({ kind: "kernel-page", page: "import-data" })}>Leave draft</button>
    <p role="status">{status}</p>
  </PluginScreenFrame>;
}
`,
				}),
			},
		});
		const installed = yield* settledPrivateInstallation(client, id);
		const page = yield* (yield* Playwright.Browser).newPage();
		const path = pluginPath(installed.packageId);
		yield* signInThroughHostedOAuth(page, email, password, { entryPath: path });
		const surface = pluginFrame(page);
		yield* surface.getByText("Ready", { exact: true }).waitFor({ state: "visible" });
		const value = "筋力💪".repeat(2000);
		yield* surface.getByRole("textbox", { name: "Draft" }).fill(value);
		yield* surface.getByRole("button", { name: "Block persistence" }).click();
		yield* surface.getByRole("button", { name: "Leave draft" }).click();
		yield* surface.getByText("quota", { exact: true }).waitFor({ state: "visible" });
		expect(new URL(page.url()).pathname).toBe(path);
		expect(yield* surface.getByRole("textbox", { name: "Draft" }).inputValue()).toBe(value);
		yield* surface.getByRole("button", { name: "Allow persistence" }).click();
		yield* surface.getByRole("button", { name: "Leave draft" }).click();
		yield* page.waitForURL(`${frontendUrl}/settings/import-data`);
		yield* page
			.getByRole("button", { exact: true, name: "Resume draft" })
			.waitFor({ state: "visible" });
		yield* page.reload;
		yield* page.getByRole("button", { exact: true, name: "Resume draft" }).click();
		yield* surface.getByText("Ready", { exact: true }).waitFor({ state: "visible" });
		expect(yield* surface.getByRole("textbox", { name: "Draft" }).inputValue()).toBe(value);
	}).pipe(PlaywrightSpawner.withBrowser),
);
