import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createPluginSavedView,
	createSavedView,
	findSavedViewById,
	getSavedView,
	prepareClientPage,
} from "~/fixtures/kernel";
import { adminHeaders } from "~/fixtures/kernel/admin";
import { listAdminSystemPlugins } from "~/fixtures/kernel/admin-system-plugins";
import { compilePluginPackage } from "~/fixtures/kernel/compiled-package";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { literalSandboxSource } from "~/fixtures/kernel/sandbox-source";
import {
	encodePluginSourceFiles,
	installTestSupportSystemPlugin,
	testPluginManifest,
	testPluginSavedView,
} from "~/fixtures/kernel/test-plugin";
import { assertTaggedError } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

it.live("rejects a system built-in slug already owned by another user's custom view", () =>
	Effect.gen(function* () {
		const owner = yield* createAuthenticatedClient();
		const view = yield* createSavedView(owner.client, { name: `Collision ${crypto.randomUUID()}` });
		const custom = yield* findSavedViewById(owner.client, view.id);
		const pluginSlug = PluginSlug.make(`e2e-collision-${crypto.randomUUID()}`);
		const error = yield* Effect.flip(
			installTestSupportSystemPlugin({
				files: {},
				manifest: testPluginManifest({
					pluginSlug,
					savedViews: [testPluginSavedView({ slug: custom.slug })],
				}),
			}),
		);
		assertTaggedError(error, "PluginRequestError");
		expect(error.reason.code).toBe("validation-failed");
		expect((yield* getSavedView(owner.client, custom.slug)).id).toBe(custom.id);
		expect((yield* listAdminSystemPlugins).some(({ slug }) => slug === pluginSlug)).toBe(false);
	}),
);

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
			let active = true;
			yield* Effect.addFinalizer(() =>
				active
					? getApiClient()
							.call(
								(c) =>
									c.testSupport.uninstallSystemPlugin({
										params: { pluginSlug: PluginSlug.make(pluginSlug) },
									}),
								adminHeaders(),
							)
							.pipe(Effect.ignore)
					: Effect.void,
			);
			expect(installed.scripts).toHaveLength(1);
			const artifactHash = pluginPackage.compiledClient?.hash;
			expect(artifactHash).toMatch(/^[a-f0-9]{64}$/);
			if (!artifactHash) {
				throw new Error("Compiled client artifact is missing");
			}
			const apiUrl = getApiUrl();
			const { client } = yield* createAuthenticatedClient(apiUrl);
			const view = yield* createPluginSavedView(
				client,
				{ kind: "plugin", exportName: "fixture-page", pluginId: installed.pluginId },
				{},
			);
			const page = yield* prepareClientPage(client, view.slug);
			const documentResponse = yield* Effect.promise(() =>
				fetch(new URL(page.composition.documentGrant.src, `${apiUrl}/`)),
			);
			expect(documentResponse.status).toBe(200);
			expect(documentResponse.headers.get("cache-control")).toBe("private, no-store");
			const document = yield* Effect.promise(() => documentResponse.text());
			const assetPath = document.match(
				new RegExp(`/api/client-assets/${artifactHash}/([A-Za-z0-9_-]{43})/module\\.js`),
			)?.[0];
			expect(assetPath).toBeDefined();
			if (!assetPath) {
				throw new Error("Installed system plugin asset URL is missing");
			}
			const assetResponse = yield* Effect.promise(() => fetch(new URL(assetPath, `${apiUrl}/`)));
			expect(assetResponse.status).toBe(200);
			expect(assetResponse.headers.get("cache-control")).toBe(
				"private, max-age=31536000, immutable",
			);
			const publicResponse = yield* Effect.promise(() =>
				fetch(new URL(`/api/client-assets/${artifactHash}/public/module.js`, `${apiUrl}/`)),
			);
			expect(publicResponse.status).toBe(404);
			const removed = yield* getApiClient().call(
				(c) =>
					c.testSupport.uninstallSystemPlugin({
						params: { pluginSlug: PluginSlug.make(pluginSlug) },
					}),
				adminHeaders(),
			);
			expect(removed.pluginId).toBe(installed.pluginId);
			active = false;
		}),
);
