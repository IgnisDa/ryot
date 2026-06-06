import type { ContractPathParams, ContractPayload } from "@ryot/contract/client";
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
const archivedClientEntry = "client/unreachable.ts";
const decoder = new TextDecoder("utf-8", { fatal: true });
const semanticFailureSource = new TextEncoder().encode("export const semanticValue: string = 1;\n");

type FixtureClientPluginRevision = keyof typeof FIXTURE_CLIENT_REVISION_MARKERS;
type CreateArtifactSessionPayload = ContractPayload<"plugins", "createArtifactSession">;
type RenewArtifactSessionParams = ContractPathParams<"plugins", "renewArtifactSession">;
type CreateArtifactSessionParams = ContractPathParams<"plugins", "createArtifactSession">;
type RevokeArtifactSessionParams = ContractPathParams<"plugins", "revokeArtifactSession">;

export const createClientArtifactSession = (
	client: Client,
	params: CreateArtifactSessionParams,
	payload: CreateArtifactSessionPayload,
) => client.call((contract) => contract.plugins.createArtifactSession({ params, payload }));

export const renewClientArtifactSession = (client: Client, params: RenewArtifactSessionParams) =>
	client.call((contract) => contract.plugins.renewArtifactSession({ params }));

export const revokeClientArtifactSession = (client: Client, params: RevokeArtifactSessionParams) =>
	client.call((contract) => contract.plugins.revokeArtifactSession({ params }));

export const fixtureClientPluginPackage = (
	revision: FixtureClientPluginRevision,
	variant = "",
	pluginSlug = FIXTURE_CLIENT_PLUGIN_SLUG,
) =>
	Effect.gen(function* () {
		const archive = yield* Effect.promise(async () => {
			const file = Bun.file(archiveUrl);
			if (!(await file.exists())) {
				throw new Error(`Build @ryot/fixture-plugin before this suite: ${archiveUrl.pathname}`);
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
						.replace("bg-bg p-8 text-text", "bg-accent-soft p-8 text-text")
						.replace(
							'<img alt="" src={logo} className="plugin-logo" />',
							'<StatusMessage tone="success">Revision B is active.</StatusMessage>\n\t\t\t<img alt="" src={logo} className="plugin-logo" />',
						)
				: revisedHome;
		return {
			files: { ...pluginPackage.files, [homeEntry]: new TextEncoder().encode(revisionHome) },
			manifest: {
				...pluginPackage.manifest,
				metadata: {
					...pluginPackage.manifest.metadata,
					slug: pluginSlug,
					version: revision === "A" ? "1.0.0" : "2.0.0",
				},
			},
		};
	});

export const fixtureClientPluginPackageWithSemanticFailure = (pluginSlug: PluginSlug) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage("A", "", pluginSlug);
		return {
			...pluginPackage,
			files: { ...pluginPackage.files, [clientEntry]: semanticFailureSource },
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
				files: {
					...pluginPackage.files,
					[clientEntry]: new TextEncoder().encode("export default <;"),
				},
			},
		});
	});

export const updateFixtureClientPluginWithArchivedSemanticFailure = (
	client: Client,
	baseUrl?: string,
) =>
	Effect.gen(function* () {
		const pluginPackage = yield* fixtureClientPluginPackage("B");
		return yield* updatePrivatePlugin({
			client,
			baseUrl,
			pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			payload: {
				...pluginPackage,
				files: { ...pluginPackage.files, [archivedClientEntry]: semanticFailureSource },
			},
		});
	});
