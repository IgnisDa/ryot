import { PluginSlug } from "@ryot/contract/schema/brands";
import { readPluginArchive } from "@ryot/plugin-archive";
import { Effect } from "effect";

import type { Client } from "./auth";
import {
	installPrivatePluginPackage,
	settledPrivateInstallation,
	updatePrivatePlugin,
} from "./private-plugin";

export const FIXTURE_CLIENT_PLUGIN_SLUG = PluginSlug.make("fixture");
export const FIXTURE_CLIENT_REVISION_MARKERS = {
	A: "Fixture plugin revision A",
	B: "Fixture plugin revision B",
} as const;

const archiveUrl = new URL("../../../../plugins/fixture/dist/fixture.zip", import.meta.url);
const homeEntry = "client/home.tsx";
const clientEntry = "client/index.tsx";

type FixtureClientPluginRevision = keyof typeof FIXTURE_CLIENT_REVISION_MARKERS;

export const fixtureClientPluginPackage = (revision: FixtureClientPluginRevision, variant = "") =>
	Effect.gen(function* () {
		const archive = yield* Effect.promise(async () => {
			const file = Bun.file(archiveUrl);
			if (!(await file.exists())) {
				throw new Error(`Build @ryot/fixture-plugin before this suite: ${archiveUrl.pathname}`);
			}
			return file.bytes();
		});
		const pluginPackage = yield* readPluginArchive(archive);
		const home = pluginPackage.files[homeEntry];
		if (!home?.includes("Fixture plugin")) {
			throw new Error(`Fixture client source '${homeEntry}' has no revision marker target`);
		}
		return {
			files: {
				...pluginPackage.files,
				[homeEntry]: home.replace(
					"Fixture plugin",
					`${FIXTURE_CLIENT_REVISION_MARKERS[revision]}${variant}`,
				),
			},
			manifest: {
				...pluginPackage.manifest,
				metadata: {
					...pluginPackage.manifest.metadata,
					version: revision === "A" ? "1.0.0" : "2.0.0",
				},
			},
		};
	});

export const installFixtureClientPlugin = (
	client: Client,
	revision: FixtureClientPluginRevision = "A",
	variant = "",
	baseUrl?: string,
) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage(revision, variant);
		yield* installPrivatePluginPackage({ client, config: {}, pluginPackage, baseUrl });
		return yield* settledPrivateInstallation(client, FIXTURE_CLIENT_PLUGIN_SLUG);
	});

export const updateFixtureClientPlugin = (
	client: Client,
	revision: FixtureClientPluginRevision,
	variant = "",
	baseUrl?: string,
) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage(revision, variant);
		return yield* updatePrivatePlugin({
			client,
			baseUrl,
			payload: pluginPackage,
			pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
		});
	});

export const updateFixtureClientPluginWithCompileFailure = (client: Client, baseUrl?: string) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage("B");
		return yield* updatePrivatePlugin({
			client,
			baseUrl,
			pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			payload: {
				...pluginPackage,
				files: { ...pluginPackage.files, [clientEntry]: "export default <;" },
			},
		});
	});
