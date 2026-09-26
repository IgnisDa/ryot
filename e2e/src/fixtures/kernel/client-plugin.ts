import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect } from "effect";

import type { Client } from "./auth";
import { compilePluginPackage } from "./compiled-package";
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
const pokemonPresentationEntry = "client/pokemon-presentation.tsx";
const decoder = new TextDecoder("utf-8", { fatal: true });

type FixtureClientPluginRevision = keyof typeof FIXTURE_CLIENT_REVISION_MARKERS;
export const fixtureClientPluginPackage = (
	revision: FixtureClientPluginRevision,
	variant = "",
	pluginSlug = FIXTURE_CLIENT_PLUGIN_SLUG,
	presentationEvaluationSignal = false,
) =>
	Effect.gen(function* () {
		const archive = yield* Effect.promise(async () => {
			const file = Bun.file(archiveUrl);
			if (!(await file.exists())) {
				throw new Error(`Build @ryot-app/fixture-plugin before this suite: ${archiveUrl.pathname}`);
			}
			return file.bytes();
		});
		const pluginPackage = yield* readPluginArchive(archive);
		const homeBytes = pluginPackage.files[homeEntry];
		const home = homeBytes ? decoder.decode(homeBytes) : undefined;
		if (!home?.includes("Fixture plugin")) {
			throw new Error(`Fixture client source '${homeEntry}' has no revision marker target`);
		}
		const revisedHome = home.replace(
			"Fixture plugin",
			`${FIXTURE_CLIENT_REVISION_MARKERS[revision]}${variant}`,
		);
		const revisionHome =
			revision === "B"
				? revisedHome
						.replace("gap-4 text-text", "gap-4 bg-accent-soft text-text")
						.replace(
							'<img alt="" src={logo} className="plugin-logo" />',
							'<StatusMessage tone="success">Revision B is active.</StatusMessage>\n\t\t\t<img alt="" src={logo} className="plugin-logo" />',
						)
				: revisedHome;
		const presentationBytes = pluginPackage.files[pokemonPresentationEntry];
		if (presentationEvaluationSignal && !presentationBytes) {
			throw new Error(`Fixture client source '${pokemonPresentationEntry}' is missing`);
		}
		return yield* compilePluginPackage({
			compiledScripts: pluginPackage.compiledScripts,
			manifest: {
				...pluginPackage.manifest,
				metadata: {
					...pluginPackage.manifest.metadata,
					slug: pluginSlug,
					version: revision === "A" ? "1.0.0" : "2.0.0",
				},
			},
			files: {
				...pluginPackage.files,
				[homeEntry]: new TextEncoder().encode(revisionHome),
				...(presentationEvaluationSignal && presentationBytes
					? {
							[pokemonPresentationEntry]: new TextEncoder().encode(
								`${decoder.decode(presentationBytes)}\ndocument.documentElement.dataset.e2ePokemonPresentationEvaluated = "true";\n`,
							),
						}
					: {}),
			},
		});
	});

export const installFixtureClientPlugin = (
	client: Client,
	revision: FixtureClientPluginRevision = "A",
	variant = "",
	baseUrl?: string,
	presentationEvaluationSignal = false,
) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage(
			revision,
			variant,
			FIXTURE_CLIENT_PLUGIN_SLUG,
			presentationEvaluationSignal,
		);
		yield* installPrivatePluginPackage({ client, baseUrl, config: {}, pluginPackage });
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
