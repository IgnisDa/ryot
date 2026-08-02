import { pluginClientCatalogRecipe } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	executeRyotQLRecipe,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	FIXTURE_CLIENT_REVISION_MARKERS,
	installFixtureClientPlugin,
	updateFixtureClientPlugin,
	updateFixtureClientPluginWithCompileFailure,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

const fetchArtifact = (artifactHash: string, fileName: string) =>
	Effect.promise(() => fetch(`${getBackendUrl()}/plugins/artifacts/${artifactHash}/${fileName}`));

const fetchArtifactBytes = (artifactHash: string, fileName: string) =>
	Effect.gen(function* () {
		const response = yield* fetchArtifact(artifactHash, fileName);
		expect(response.status).toBe(200);
		return new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
	});

const fixtureCatalogEntry = (client: Client) =>
	Effect.gen(function* () {
		const catalog = yield* executeRyotQLRecipe(client, pluginClientCatalogRecipe());
		return requirePresent(
			catalog.find((entry) => entry.slug === FIXTURE_CLIENT_PLUGIN_SLUG),
			"Fixture client plugin was not listed in the client catalog",
		);
	});

describe("client plugin artifacts", () => {
	it.live("compiles an installed client plugin into a catalog-visible artifact", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const installation = yield* installFixtureClientPlugin(client);

			expect(installation).toMatchObject({ health: "ready", isDisabled: false });

			const entry = yield* fixtureCatalogEntry(client);

			expect(entry).toMatchObject({
				health: "ready",
				isDisabled: false,
				clientApiVersion: 1,
				clientCapabilities: [],
				slug: FIXTURE_CLIENT_PLUGIN_SLUG,
				sourceHash: installation.sourceHash,
			});
			expect(entry.clientArtifactHash).toMatch(/^[0-9a-f]{64}$/);
			expect(entry.clientArtifactHash).not.toBe(entry.sourceHash);
		}),
	);

	it.live("serves artifact files immutably and rejects unknown requests", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(client);
			const entry = yield* fixtureCatalogEntry(client);
			const artifactHash = requirePresent(
				entry.clientArtifactHash,
				"Fixture client plugin has no compiled artifact",
			);

			const document = yield* fetchArtifact(artifactHash, "index.html");
			const script = yield* fetchArtifact(artifactHash, "plugin.js");
			const stylesheet = yield* fetchArtifact(artifactHash, "plugin.css");

			expect(document.status).toBe(200);
			expect(document.headers.get("etag")).toBe(`"${artifactHash}"`);
			expect(document.headers.get("x-content-type-options")).toBe("nosniff");
			expect(document.headers.get("content-type")).toContain("text/html");
			expect(document.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
			expect(document.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
			expect(script.headers.get("content-type")).toContain("text/javascript");
			expect(stylesheet.headers.get("content-type")).toContain("text/css");

			const markup = yield* Effect.promise(() => document.text());
			expect(markup).toContain(`"hash":"${artifactHash}"`);
			expect(markup).toContain('src="./plugin.js"');
			expect(markup).toContain('href="./plugin.css"');
			expect(yield* Effect.promise(() => stylesheet.text())).toContain(".plugin-logo");

			const unknownFile = yield* fetchArtifact(artifactHash, "secrets.json");
			const unknownArtifact = yield* fetchArtifact("0".repeat(64), "index.html");

			expect(unknownFile.status).toBe(404);
			expect(unknownArtifact.status).toBe(404);
		}),
	);

	it.live(
		"updates a client artifact atomically while retaining plugin identities and A bytes",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const variant = crypto.randomUUID();
				const revisionA = yield* installFixtureClientPlugin(client, "A", variant);
				const before = yield* fixtureCatalogEntry(client);
				const artifactA = requirePresent(
					before.clientArtifactHash,
					"Fixture client plugin revision A has no compiled artifact",
				);
				const bytesA = yield* fetchArtifactBytes(artifactA, "plugin.js");
				expect(new TextDecoder().decode(bytesA)).toContain(FIXTURE_CLIENT_REVISION_MARKERS.A);

				const revisionB = yield* updateFixtureClientPlugin(client, "B", variant);
				const after = yield* fixtureCatalogEntry(client);
				const artifactB = requirePresent(
					after.clientArtifactHash,
					"Fixture client plugin revision B has no compiled artifact",
				);

				expect(after).toMatchObject({
					slug: before.slug,
					pluginId: before.pluginId,
					sourceHash: revisionB.sourceHash,
					installationId: before.installationId,
				});
				expect(revisionB.sourceHash).not.toBe(revisionA.sourceHash);
				expect(after.sourceHash).not.toBe(before.sourceHash);
				expect(artifactB).not.toBe(artifactA);
				expect(
					new TextDecoder().decode(yield* fetchArtifactBytes(artifactB, "plugin.js")),
				).toContain(FIXTURE_CLIENT_REVISION_MARKERS.B);
				expect(yield* fetchArtifactBytes(artifactA, "plugin.js")).toEqual(bytesA);
			}),
	);

	it.live("preserves revision A when revision B client compilation fails", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(client, "A");
			const before = yield* fixtureCatalogEntry(client);
			const artifactA = requirePresent(
				before.clientArtifactHash,
				"Fixture client plugin revision A has no compiled artifact",
			);
			const bytesA = yield* fetchArtifactBytes(artifactA, "plugin.js");

			const failure = yield* Effect.flip(updateFixtureClientPluginWithCompileFailure(client));
			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason.code).toBe("compilation-failed");

			expect(yield* fixtureCatalogEntry(client)).toEqual(before);
			expect(yield* fetchArtifactBytes(artifactA, "plugin.js")).toEqual(bytesA);
			expect(new TextDecoder().decode(bytesA)).toContain(FIXTURE_CLIENT_REVISION_MARKERS.A);
		}),
	);
});
