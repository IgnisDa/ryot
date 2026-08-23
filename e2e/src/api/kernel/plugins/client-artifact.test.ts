import { pluginClientCatalogRecipe } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Clock, Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createClientArtifactSession,
	executeRyotQLRecipe,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	installFixtureClientPlugin,
	makeSession,
	pollUntil,
	renewClientArtifactSession,
	revokeClientArtifactSession,
	updateFixtureClientPlugin,
	updateFixtureClientPluginWithArchivedSemanticFailure,
	updateFixtureClientPluginWithCompileFailure,
} from "~/fixtures/kernel";
import { getApiLogFile, getApiUrl } from "~/support/api";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const tokenFileUrl = (token: string, fileName: string) =>
	`${getApiUrl()}/plugin-artifact-sessions/${encodeURIComponent(token)}/${fileName}`;

const fetchTokenFile = (token: string, fileName: string) =>
	Effect.promise(() => fetch(tokenFileUrl(token, fileName)));

const fetchTokenFileBytes = (token: string, fileName: string) =>
	Effect.gen(function* () {
		const response = yield* fetchTokenFile(token, fileName);
		expect(response.status).toBe(200);
		return new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
	});

const fixtureCatalogEntry = (client: Client) =>
	Effect.gen(function* () {
		const catalog = yield* executeRyotQLRecipe(client, pluginClientCatalogRecipe());
		return requirePresent(
			catalog.items.find((entry) => entry.slug === FIXTURE_CLIENT_PLUGIN_SLUG),
			"Fixture client plugin was not listed in the client catalog",
		);
	});

const createSession = (
	client: Client,
	entry: Effect.Success<ReturnType<typeof fixtureCatalogEntry>>,
) =>
	createClientArtifactSession(
		client,
		{ pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG, installationId: entry.installationId },
		{
			sourceHash: entry.sourceHash,
			artifactHash: requirePresent(entry.clientArtifactHash, "Client plugin has no artifact"),
		},
	);

const expectNotFound = (effect: Effect.Effect<unknown, { readonly _tag: string }>) =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(effect);
		assertTaggedError(error, "PluginArtifactSessionNotFoundError");
		expect(error).toMatchObject({ reason: { code: "artifact-session-not-found" } });
	});

const assertArtifactHeaders = (response: Response, contentType: string, hasCsp = false) => {
	expect(response.headers.get("content-type")).toBe(contentType);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	expect(response.headers.get("access-control-allow-origin")).toBe("*");
	expect(response.headers.get("access-control-allow-credentials")).toBeNull();
	expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	expect(response.headers.get("content-security-policy")).toBe(
		hasCsp ? "sandbox allow-scripts" : null,
	);
	expect(response.headers.get("etag")).toBeNull();
	expect(response.headers.get("set-cookie")).toBeNull();
};

describe("client plugin artifacts", () => {
	it.live("compiles an installed client plugin into a catalog-visible artifact", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const now = yield* Clock.currentTimeMillis;
			const installation = yield* installFixtureClientPlugin(client);

			expect(installation).toMatchObject({ health: "ready", isDisabled: false });

			const entry = yield* fixtureCatalogEntry(client);

			expect(entry).toMatchObject({
				icon: "puzzle",
				name: "Fixture",
				health: "ready",
				isDisabled: false,
				clientApiVersion: 1,
				slug: FIXTURE_CLIENT_PLUGIN_SLUG,
				sortOrder: installation.sortOrder,
				sourceHash: installation.sourceHash,
			});
			expect(entry.clientArtifactHash).toMatch(/^[0-9a-f]{64}$/);
			expect(entry.clientArtifactHash).not.toBe(entry.sourceHash);
			const session = yield* createSession(client, entry);
			expect(session.sessionId).toMatch(/^[0-9a-f]{64}$/);
			expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(Date.parse(session.expiresAt)).toBeGreaterThan(now);
		}),
	);

	it.live("authorizes exact owner artifact identity and session lifecycle", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const client = owner.client;
			yield* installFixtureClientPlugin(client);
			const entry = yield* fixtureCatalogEntry(client);
			const artifactHash = requirePresent(
				entry.clientArtifactHash,
				"Fixture client plugin has no compiled artifact",
			);
			const params = {
				installationId: entry.installationId,
				pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
			};
			const payload = { sourceHash: entry.sourceHash, artifactHash };

			const anonymous = yield* makeSession().call((contract) =>
				contract.plugins.createArtifactSession({ params, payload, responseMode: "response-only" }),
			);
			expect(anonymous.status).toBe(401);
			const denied = yield* Effect.flip(
				createClientArtifactSession(outsider.client, params, payload),
			);
			assertTaggedError(denied, "PluginNotFoundError");
			expect(denied).toMatchObject({ reason: { code: "plugin-not-found" } });
			const staleSource = yield* Effect.flip(
				createClientArtifactSession(client, params, { ...payload, sourceHash: "0".repeat(64) }),
			);
			assertTaggedError(staleSource, "PluginConflictError");
			expect(staleSource).toMatchObject({ reason: { code: "source-revision-stale" } });
			const staleArtifact = yield* Effect.flip(
				createClientArtifactSession(client, params, { ...payload, artifactHash: "0".repeat(64) }),
			);
			assertTaggedError(staleArtifact, "PluginConflictError");
			expect(staleArtifact).toMatchObject({ reason: { code: "source-revision-stale" } });

			const session = yield* createClientArtifactSession(client, params, payload);
			const renewed = yield* renewClientArtifactSession(client, { sessionId: session.sessionId });
			expect(Date.parse(renewed.expiresAt)).toBeGreaterThanOrEqual(Date.parse(session.expiresAt));
			yield* expectNotFound(
				renewClientArtifactSession(outsider.client, { sessionId: session.sessionId }),
			);
			yield* revokeClientArtifactSession(outsider.client, { sessionId: session.sessionId });
			expect((yield* fetchTokenFile(session.token, "index.html")).status).toBe(200);
			yield* revokeClientArtifactSession(client, { sessionId: session.sessionId });
			yield* revokeClientArtifactSession(client, { sessionId: session.sessionId });
			expect((yield* fetchTokenFile(session.token, "index.html")).status).toBe(404);
		}),
	);

	it.live("serves exact artifact bytes with private response policy and uniform misses", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(client);
			const entry = yield* fixtureCatalogEntry(client);
			const artifactHash = requirePresent(
				entry.clientArtifactHash,
				"Client plugin has no artifact",
			);
			const { token } = yield* createSession(client, entry);

			const document = yield* fetchTokenFile(token, "index.html");
			const script = yield* fetchTokenFile(token, "plugin.js");
			const stylesheet = yield* fetchTokenFile(token, "plugin.css");

			expect(document.status).toBe(200);
			const logs = yield* pollUntil(
				"redacted client artifact request log",
				Effect.promise(() => Bun.file(getApiLogFile()).text()).pipe(
					Effect.map((contents) =>
						contents.includes("http.url=/api/plugin-artifact-sessions/:token/:fileName")
							? contents
							: null,
					),
				),
			);
			expect(logs.includes(token)).toBe(false);
			assertArtifactHeaders(document, "text/html; charset=utf-8", true);
			assertArtifactHeaders(script, "text/javascript; charset=utf-8");
			assertArtifactHeaders(stylesheet, "text/css; charset=utf-8");

			const markup = yield* Effect.promise(() => document.text());
			expect(markup).toContain(`"hash":"${artifactHash}"`);
			expect(markup).toContain('src="./plugin.js"');
			expect(markup).toContain('href="./plugin.css"');
			const stylesheetText = yield* Effect.promise(() => stylesheet.text());
			expect(stylesheetText).toContain("Outfit Variable");
			expect(stylesheetText).toContain("Lora Variable");
			const fontNames = new Set(
				[...stylesheetText.matchAll(/\.\/(asset-[0-9a-f]{64}\.woff2)/g)].map((match) =>
					requirePresent(match[1], "Artifact CSS contains an invalid font URL"),
				),
			);
			expect(fontNames.size).toBe(9);
			const fontName = requirePresent(fontNames.values().next().value, "Artifact CSS has no font");
			const font = yield* fetchTokenFile(token, fontName);
			const fontBytes = new Uint8Array(yield* Effect.promise(() => font.arrayBuffer()));
			expect(font.status).toBe(200);
			assertArtifactHeaders(font, "font/woff2");
			expect(new TextDecoder().decode(fontBytes.slice(0, 4))).toBe("wOF2");
			expect(sha256Hex(fontBytes)).toBe(fontName.slice("asset-".length, -".woff2".length));
			expect(yield* fetchTokenFileBytes(token, "index.html")).toEqual(
				new TextEncoder().encode(markup),
			);
			expect(yield* fetchTokenFileBytes(token, "plugin.js")).toEqual(
				new Uint8Array(yield* Effect.promise(() => script.arrayBuffer())),
			);
			expect(yield* fetchTokenFileBytes(token, "plugin.css")).toEqual(
				new TextEncoder().encode(stylesheetText),
			);
			expect(yield* fetchTokenFileBytes(token, fontName)).toEqual(fontBytes);

			const misses = yield* Effect.all([
				fetchTokenFile("invalid!token", "index.html"),
				fetchTokenFile("short", "index.html"),
				fetchTokenFile("a".repeat(43), "index.html"),
				fetchTokenFile(artifactHash, "index.html"),
				fetchTokenFile(token, "secrets.json"),
			]);
			const missBodies = yield* Effect.all(
				misses.map((response) =>
					Effect.promise(async () => ({ status: response.status, body: await response.text() })),
				),
			);
			expect(new Set(missBodies.map(({ status }) => status))).toEqual(new Set([404]));
			expect(new Set(missBodies.map(({ body }) => body)).size).toBe(1);

			const oldRoute = yield* Effect.promise(() =>
				fetch(`${getApiUrl()}/plugins/artifacts/${artifactHash}/plugin.js`),
			);
			expect(oldRoute.status).toBe(404);
		}),
	);

	it.live("updates plugin source atomically and invalidates the revision A session", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const variant = crypto.randomUUID();
			const revisionA = yield* installFixtureClientPlugin(client, "A", variant);
			const before = yield* fixtureCatalogEntry(client);
			const artifactA = requirePresent(
				before.clientArtifactHash,
				"Fixture client plugin revision A has no compiled artifact",
			);
			const sessionA = yield* createSession(client, before);
			yield* fetchTokenFileBytes(sessionA.token, "plugin.js");

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
			expect(artifactB).toBe(artifactA);
			yield* fetchTokenFileBytes((yield* createSession(client, after)).token, "plugin.js");
			expect((yield* fetchTokenFile(sessionA.token, "plugin.js")).status).toBe(404);
		}),
	);

	it.live("preserves revision A when revision B client compilation fails", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(client, "A");
			const before = yield* fixtureCatalogEntry(client);
			const sessionA = yield* createSession(client, before);
			const bytesA = yield* fetchTokenFileBytes(sessionA.token, "plugin.js");

			const failure = yield* Effect.flip(updateFixtureClientPluginWithCompileFailure(client));
			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason.code).toBe("compilation-failed");

			expect(yield* fixtureCatalogEntry(client)).toEqual(before);
			expect(yield* fetchTokenFileBytes(sessionA.token, "plugin.js")).toEqual(bytesA);
		}),
	);

	it.live(
		"preserves revision A when an unreachable archived client file has a semantic error",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				yield* installFixtureClientPlugin(client, "A");
				const before = yield* fixtureCatalogEntry(client);
				const sessionA = yield* createSession(client, before);
				const bytesA = yield* fetchTokenFileBytes(sessionA.token, "plugin.js");

				const failure = yield* Effect.flip(
					updateFixtureClientPluginWithArchivedSemanticFailure(client),
				);
				assertTaggedError(failure, "PluginRequestError");
				expect(failure).toMatchObject({
					reason: {
						code: "compilation-failed",
						diagnostics: [
							{
								line: 1,
								code: "TS2322",
								phase: "compile",
								severity: "error",
								file: "client/unreachable.ts",
							},
						],
					},
				});

				expect(yield* fixtureCatalogEntry(client)).toEqual(before);
				expect(yield* fetchTokenFileBytes(sessionA.token, "plugin.js")).toEqual(bytesA);
			}),
	);
});
