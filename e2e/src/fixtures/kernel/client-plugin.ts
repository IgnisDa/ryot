import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { fixturePlugin } from "@ryot-app/fixture-plugin";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { isPluginSourceFile } from "@ryot-app/plugin-client-contract";
import { CATALOG_MESSAGES_MODULE } from "@ryot-app/plugin-kit/messages-module";
import { Effect, Schema } from "effect";

import type { Client } from "./auth";
import { compilePluginPackage } from "./compiled-package";
import { findPluginInstallationByPackage } from "./plugins";
import {
	installPrivatePluginPackage,
	settledPrivateInstallation,
	updatePrivatePlugin,
} from "./private-plugin";
import { testPluginPackageId } from "./test-plugin";

const fixturePackageIds = new Map<string, PluginPackageId>();

const FIXTURE_CLIENT_REVISION_MARKERS = { A: "revision-a", B: "revision-b" } as const;

/** Selects the fixture home's root element as rendered by one client revision. */
export const fixtureClientRevisionSelector = (revision: FixtureClientPluginRevision) =>
	`[data-fixture-revision="${FIXTURE_CLIENT_REVISION_MARKERS[revision]}"]`;

const archiveUrl = new URL(
	`../../../../plugins/fixture/dist/${fixturePlugin.metadata.packageId}.zip`,
	import.meta.url,
);
const authoringUrl = new URL("../../../../plugins/fixture/", import.meta.url);
const homeEntry = "client/home.tsx";
const homeRoot = '<div className="flex w-full flex-col items-center gap-4 text-text">';
const pokemonPresentationEntry = "client/pokemon-presentation.tsx";
const decoder = new TextDecoder("utf-8", { fatal: true });

type FixtureClientPluginRevision = keyof typeof FIXTURE_CLIENT_REVISION_MARKERS;
export const fixtureClientPluginPackage = (
	revision: FixtureClientPluginRevision,
	variant = "",
	pluginSlug = "fixture",
	presentationEvaluationSignal = false,
) =>
	Effect.gen(function* () {
		const file = Bun.file(archiveUrl);
		if (!(yield* Effect.promise(() => file.exists()))) {
			return yield* Effect.die(
				new Error(`Build @ryot-app/fixture-plugin before this suite: ${archiveUrl.pathname}`),
			);
		}
		const archive = yield* Effect.promise(() => file.bytes());
		const pluginPackage = yield* readPluginArchive(archive);
		let packageId = fixturePackageIds.get(pluginSlug);
		if (!packageId) {
			packageId = testPluginPackageId();
			fixturePackageIds.set(pluginSlug, packageId);
		}
		const files = Object.fromEntries(
			yield* Effect.forEach(
				[
					...new Bun.Glob("{client,shared}/**/*").scanSync({
						onlyFiles: true,
						cwd: authoringUrl.pathname,
					}),
				].filter((path) => isPluginSourceFile(path) && path !== CATALOG_MESSAGES_MODULE),
				(path) =>
					Effect.promise(() => Bun.file(new URL(path, authoringUrl)).bytes()).pipe(
						Effect.map((contents) => [path, contents] as const),
					),
			),
		);
		const homeBytes = files[homeEntry];
		const home = homeBytes ? decoder.decode(homeBytes) : undefined;
		if (!home?.includes(homeRoot)) {
			throw new Error(`Fixture client source '${homeEntry}' has no revision marker target`);
		}
		const marker = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.String))(
			`${FIXTURE_CLIENT_REVISION_MARKERS[revision]}${variant}`,
		);
		const revisedHome = home.replace(
			homeRoot,
			homeRoot.replace("<div ", `<div data-fixture-revision={${marker}} `),
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
		const presentationBytes = files[pokemonPresentationEntry];
		if (presentationEvaluationSignal && !presentationBytes) {
			throw new Error(`Fixture client source '${pokemonPresentationEntry}' is missing`);
		}
		return yield* compilePluginPackage({
			catalogs: pluginPackage.catalogs,
			compiledScripts: pluginPackage.compiledScripts,
			manifest: {
				...pluginPackage.manifest,
				metadata: {
					...pluginPackage.manifest.metadata,
					packageId,
					version: revision === "A" ? "1.0.0" : "2.0.0",
				},
			},
			files: {
				...files,
				[homeEntry]: new TextEncoder().encode(revisionHome),
				"shared/plugin-identity.ts": new TextEncoder().encode(
					`import { PluginPackageId } from "@ryot-app/plugin-kit/schema";\nexport const PLUGIN_PACKAGE_ID = PluginPackageId.make(${yield* Schema.encodeEffect(Schema.fromJsonString(Schema.String))(packageId)});`,
				),
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
	presentationEvaluationSignal = false,
) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage(
			revision,
			variant,
			"fixture",
			presentationEvaluationSignal,
		);
		const installed = yield* installPrivatePluginPackage({ client, config: {}, pluginPackage });
		return yield* settledPrivateInstallation(client, installed.id);
	});

export const updateFixtureClientPlugin = (
	client: Client,
	revision: FixtureClientPluginRevision,
	variant = "",
) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage(revision, variant);
		const current = yield* findPluginInstallationByPackage(client, {
			scope: "user",
			packageId: pluginPackage.manifest.metadata.packageId,
		});
		return yield* updatePrivatePlugin({
			client,
			payload: pluginPackage,
			installationId: current.installationId,
			expectedContentHash: current.contentHash,
		});
	});
