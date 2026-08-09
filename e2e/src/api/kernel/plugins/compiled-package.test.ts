import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import { compilePluginPackage } from "~/fixtures/kernel/compiled-package";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { literalSandboxSource } from "~/fixtures/kernel/sandbox-source";
import {
	encodePluginSourceFiles,
	installTestSupportSystemPlugin,
	testPluginManifest,
} from "~/fixtures/kernel/test-plugin";
import { expect, it } from "~/support/effect-test";

it.live(
	"compiles and installs synthetic backend and client sources without server compilation",
	() =>
		Effect.gen(function* () {
			const pluginSlug = `e2e-compiled-package-${crypto.randomUUID()}`;
			const scriptSlug = `${pluginSlug}.fixture`;
			const entry = "backend/scripts/fixture.sandbox.ts";
			const manifest = testPluginManifest({
				pluginSlug: PluginSlug.make(pluginSlug),
				scripts: [
					{
						entry,
						kind: "script",
						capabilities: [],
						slug: scriptSlug,
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						name: "Compiled package fixture",
					},
				],
				clientDefinition: {
					apiVersion: 1,
					homeView: null,
					exports: {
						"fixture-page": {
							kind: "page",
							entry: "client/page.tsx",
							settingsSchema: { fields: {} },
							automaticEntityPresentations: false,
						},
					},
				},
			});
			const files = encodePluginSourceFiles({
				"client/page.tsx": "export default function Page() { return <h1>Offline page</h1>; }",
				[entry]: literalSandboxSource({
					value: "ready",
					slug: scriptSlug,
					name: "Compiled package fixture",
				}),
			});
			const pluginPackage = yield* compilePluginPackage({ files, manifest });

			expect(pluginPackage.compiledScripts).toHaveLength(1);
			expect(pluginPackage.compiledScripts[0]).toMatchObject({ entry, format: 1 });
			expect(pluginPackage.compiledScripts[0]?.javascript).toContain("ready");
			expect(pluginPackage.compiledClient?.files.map(({ name }) => name)).toContain("module.js");
			expect(pluginPackage.compiledClient?.files.map(({ name }) => name)).toContain("module.css");

			const installed = yield* installTestSupportSystemPlugin(pluginPackage);
			yield* Effect.addFinalizer(() =>
				getApiClient()
					.call(
						(c) =>
							c.testSupport.uninstallSystemPlugin({
								params: { pluginSlug: PluginSlug.make(pluginSlug) },
							}),
						adminHeaders(),
					)
					.pipe(Effect.ignore),
			);
			expect(installed.scripts).toHaveLength(1);
		}),
);
