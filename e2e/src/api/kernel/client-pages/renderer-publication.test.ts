import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect, Result } from "effect";

import {
	buildComposedClientRendererDefinition,
	buildClientRendererDefinition,
	createAuthenticatedClient,
	createClientPageSession,
	createClientRenderer,
	createRendererSavedView,
	deleteClientRenderer,
	encodeClientRendererSource,
	getClientRenderer,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	installFixtureClientPlugin,
	listClientRenderers,
	prepareClientPage,
	publishClientRenderer,
	renewClientPageSession,
	replaceClientRendererDraft,
	revokeClientPageSession,
	updateFixtureClientPlugin,
} from "~/fixtures/kernel";
import { assertCondition, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

const definitionWithSource = (source: string) =>
	buildClientRendererDefinition({
		files: [{ path: "client/page.tsx", content: encodeClientRendererSource(source) }],
	});
const initialDraftRevision = 1;

describe("client renderer publication E2E", () => {
	it.live("creates, lists, and gets an owned renderer", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createClientRenderer(client);

			const listed = yield* listClientRenderers(client);
			const listedRenderer = listed.find(({ id }) => id === created.id);
			expect(listedRenderer).toMatchObject({
				id: created.id,
				slug: created.slug,
				name: created.name,
				publishedHash: null,
				publishedRevision: null,
				draftRevision: initialDraftRevision,
			});

			const fetched = yield* getClientRenderer(client, created.id);
			expect(fetched).toEqual(created);
		}),
	);

	it.live("saves invalid syntax as a draft and reports a build failure on publish", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createClientRenderer(client);
			const invalidDefinition = definitionWithSource("export default <;");
			const saved = yield* replaceClientRendererDraft(client, created.id, {
				draftDefinition: invalidDefinition,
				expectedDraftRevision: initialDraftRevision,
			});

			expect(saved.draftRevision).toBe(initialDraftRevision + 1);
			const error = yield* Effect.flip(
				publishClientRenderer(client, created.id, initialDraftRevision + 1),
			);
			assertTaggedError(error, "ClientRendererBadRequest");
			expect(error.reason).toMatchObject({ code: "build-failed" });
			if (error.reason.code === "build-failed") {
				expect(error.reason.diagnostics.length).toBeGreaterThan(0);
			}

			const fetched = yield* getClientRenderer(client, created.id);
			expect(fetched.draftRevision).toBe(initialDraftRevision + 1);
			expect(fetched.draftDefinition).toEqual(invalidDefinition);
			expect(fetched.publishedRevision).toBeNull();
			expect(fetched.publishedDefinition).toBeNull();
		}),
	);

	it.live("rejects a renderer file outside the canonical client and shared paths", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const invalidDefinition = buildClientRendererDefinition({
				files: [
					{
						path: "../page.tsx",
						content: encodeClientRendererSource("export default () => null;"),
					},
				],
			});

			const error = yield* Effect.flip(
				createClientRenderer(client, { draftDefinition: invalidDefinition }),
			);
			assertTaggedError(error, "ClientRendererBadRequest");
			expect(error.reason).toMatchObject({ code: "definition-invalid" });
		}),
	);

	it.live("rejects unsupported shared files and non-client entries before storage", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			for (const draftDefinition of [
				buildClientRendererDefinition({
					files: [{ path: "shared/file.exe", content: encodeClientRendererSource("not source") }],
				}),
				buildClientRendererDefinition({
					entry: "shared/page.ts",
					files: [
						{
							path: "shared/page.ts",
							content: encodeClientRendererSource("export default () => null;"),
						},
					],
				}),
			]) {
				const error = yield* Effect.flip(createClientRenderer(client, { draftDefinition }));
				assertTaggedError(error, "ClientRendererBadRequest");
				expect(error.reason).toMatchObject({ code: "definition-invalid" });
			}
		}),
	);

	it.live("increments draft revisions and rejects stale replacements", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createClientRenderer(client);
			const nextDefinition = definitionWithSource(
				"export default function Page() { return <h1>Draft revision two</h1>; }",
			);

			const replaced = yield* replaceClientRendererDraft(client, created.id, {
				draftDefinition: nextDefinition,
				expectedDraftRevision: initialDraftRevision,
			});
			expect(replaced.draftRevision).toBe(initialDraftRevision + 1);
			expect(replaced.draftDefinition).toEqual(nextDefinition);

			const stale = yield* Effect.flip(
				replaceClientRendererDraft(client, created.id, {
					expectedDraftRevision: initialDraftRevision,
					draftDefinition: buildClientRendererDefinition(),
				}),
			);
			assertTaggedError(stale, "ClientRendererBadRequest");
			expect(stale.reason).toEqual({ code: "draft-revision-stale" });

			const fetched = yield* getClientRenderer(client, created.id);
			expect(fetched.draftRevision).toBe(initialDraftRevision + 1);
			expect(fetched.draftDefinition).toEqual(nextDefinition);
		}),
	);

	it.live("publishes successfully without replacing the editable draft", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const draftDefinition = definitionWithSource(
				"export default function Page() { return <h1>Published draft</h1>; }",
			);
			const created = yield* createClientRenderer(client, { draftDefinition });

			const publication = yield* publishClientRenderer(client, created.id, initialDraftRevision);
			expect(publication.publishedRevision).toBe(initialDraftRevision);
			expect(publication.publishedHash).toMatch(/^[0-9a-f]{64}$/);
			expect(publication.buildId.length).toBeGreaterThan(0);

			const fetched = yield* getClientRenderer(client, created.id);
			expect(fetched.draftRevision).toBe(initialDraftRevision);
			expect(fetched.draftDefinition).toEqual(draftDefinition);
			expect(fetched.publishedRevision).toBe(initialDraftRevision);
			expect(fetched.publishedDefinition).toEqual(draftDefinition);
			expect(fetched.publishedHash).toBe(publication.publishedHash);
		}),
	);

	it.live("rejects unavailable, undeclared, and missing public exports", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const unavailable = yield* createClientRenderer(client, {
				draftDefinition: buildClientRendererDefinition({
					pluginDependencies: [PluginSlug.make("not-installed")],
				}),
			});
			const unavailableError = yield* Effect.flip(
				publishClientRenderer(client, unavailable.id, initialDraftRevision),
			);
			assertTaggedError(unavailableError, "ClientRendererBadRequest");
			expect(unavailableError.reason).toEqual({
				pluginSlug: "not-installed",
				code: "dependency-unavailable",
			});

			const undeclaredSpecifier = "@ryot-app/plugins/fixture/pokemon-types";
			const undeclared = yield* createClientRenderer(client, {
				draftDefinition: definitionWithSource(
					`import PokemonTypes from "${undeclaredSpecifier}"; export default PokemonTypes;`,
				),
			});
			const undeclaredError = yield* Effect.flip(
				publishClientRenderer(client, undeclared.id, initialDraftRevision),
			);
			assertTaggedError(undeclaredError, "ClientRendererBadRequest");
			expect(undeclaredError.reason).toEqual({
				code: "export-not-found",
				exportName: undeclaredSpecifier,
			});

			yield* installFixtureClientPlugin(client);
			const missingSpecifier = "@ryot-app/plugins/fixture/missing-component";
			const missing = yield* createClientRenderer(client, {
				draftDefinition: buildClientRendererDefinition({
					pluginDependencies: [FIXTURE_CLIENT_PLUGIN_SLUG],
					files: [
						{
							path: "client/page.tsx",
							content: encodeClientRendererSource(
								`import Missing from "${missingSpecifier}"; export default Missing;`,
							),
						},
					],
				}),
			});
			const missingError = yield* Effect.flip(
				publishClientRenderer(client, missing.id, initialDraftRevision),
			);
			assertTaggedError(missingError, "ClientRendererBadRequest");
			expect(missingError.reason).toEqual({
				code: "export-not-found",
				exportName: missingSpecifier,
			});
		}),
	);

	it.live("tracks composed graph identity without hashing saved-view setting values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* installFixtureClientPlugin(client);
			const renderer = yield* createClientRenderer(client, {
				draftDefinition: buildComposedClientRendererDefinition(),
			});
			yield* publishClientRenderer(client, renderer.id, initialDraftRevision);
			const view = yield* createRendererSavedView(client, renderer.id, { label: "Before" });
			const before = yield* prepareClientPage(client, view.id);

			expect(before.identity.contributors).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "plugin", pluginSlug: "media" }),
					expect.objectContaining({
						kind: "plugin",
						sourceHash: fixture.sourceHash,
						pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG,
						installationId: expect.any(String),
					}),
				]),
			);

			const settingsView = yield* createRendererSavedView(client, renderer.id, { label: "After" });
			const settingsChanged = yield* prepareClientPage(client, settingsView.id);
			expect(settingsChanged.context.settings).toEqual({ label: "After" });
			expect(settingsChanged.identity).toMatchObject({
				buildId: before.identity.buildId,
				graphHash: before.identity.graphHash,
				artifactHash: before.identity.artifactHash,
			});

			yield* updateFixtureClientPlugin(client, "B", crypto.randomUUID());
			const dependencyChanged = yield* prepareClientPage(client, view.id);
			expect(dependencyChanged.identity.buildId).not.toBe(before.identity.buildId);
			expect(dependencyChanged.identity.graphHash).not.toBe(before.identity.graphHash);
			expect(dependencyChanged.identity.contributors).not.toEqual(before.identity.contributors);

			const changedSource = definitionWithSource(
				"export default function Page() { return <h1>Changed source</h1>; }",
			);
			yield* replaceClientRendererDraft(client, renderer.id, {
				draftDefinition: changedSource,
				expectedDraftRevision: initialDraftRevision,
			});
			yield* publishClientRenderer(client, renderer.id, initialDraftRevision + 1);
			const sourceChanged = yield* prepareClientPage(client, view.id);
			expect(sourceChanged.identity.buildId).not.toBe(dependencyChanged.identity.buildId);
			expect(sourceChanged.identity.graphHash).not.toBe(dependencyChanged.identity.graphHash);
			expect(sourceChanged.identity.artifactHash).not.toBe(dependencyChanged.identity.artifactHash);
		}),
	);

	it.live("enforces ownership and stale dependency identity for a composed private page", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(owner.client);
			const renderer = yield* createClientRenderer(owner.client, {
				draftDefinition: buildComposedClientRendererDefinition(),
			});
			yield* publishClientRenderer(owner.client, renderer.id, initialDraftRevision);
			const view = yield* createRendererSavedView(owner.client, renderer.id, { label: "Owned" });
			const prepared = yield* prepareClientPage(owner.client, view.id);

			const denied = yield* Effect.flip(
				createClientPageSession(outsider.client, prepared.identity),
			);
			assertTaggedError(denied, "ClientPageStalePreparation");
			expect(denied.reason).toEqual({ code: "stale-preparation" });

			const session = yield* createClientPageSession(owner.client, prepared.identity);
			const artifactUrl = `${getApiUrl()}/client-pages/artifacts/${encodeURIComponent(session.token)}/index.html`;
			expect((yield* Effect.promise(() => fetch(artifactUrl))).status).toBe(200);

			yield* updateFixtureClientPlugin(owner.client, "B", crypto.randomUUID());
			const stale = yield* Effect.flip(createClientPageSession(owner.client, prepared.identity));
			assertTaggedError(stale, "ClientPageStalePreparation");
			expect(stale.reason).toEqual({ code: "stale-preparation" });
			expect((yield* Effect.promise(() => fetch(artifactUrl))).status).toBe(404);
		}),
	);

	it.live("preserves the previous publication after a later publication fails", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const initialDefinition = buildClientRendererDefinition();
			const created = yield* createClientRenderer(client, { draftDefinition: initialDefinition });
			const initialPublication = yield* publishClientRenderer(
				client,
				created.id,
				initialDraftRevision,
			);
			const view = yield* createRendererSavedView(client, created.id, { label: "Published" });
			const initialPrepared = yield* prepareClientPage(client, view.id);
			const failedDefinition = definitionWithSource("export default <;");

			yield* replaceClientRendererDraft(client, created.id, {
				draftDefinition: failedDefinition,
				expectedDraftRevision: initialDraftRevision,
			});
			const error = yield* Effect.flip(
				publishClientRenderer(client, created.id, initialDraftRevision + 1),
			);
			assertTaggedError(error, "ClientRendererBadRequest");
			expect(error.reason).toMatchObject({ code: "build-failed" });

			const fetched = yield* getClientRenderer(client, created.id);
			expect(fetched.draftRevision).toBe(initialDraftRevision + 1);
			expect(fetched.draftDefinition).toEqual(failedDefinition);
			expect(fetched.publishedRevision).toBe(initialDraftRevision);
			expect(fetched.publishedDefinition).toEqual(initialDefinition);
			expect(fetched.publishedHash).toBe(initialPublication.publishedHash);
			expect((yield* prepareClientPage(client, view.id)).identity).toEqual(
				initialPrepared.identity,
			);
		}),
	);

	it.live("preserves the previous publication when the requested draft revision is stale", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const renderer = yield* createClientRenderer(client);
			const initialPublication = yield* publishClientRenderer(
				client,
				renderer.id,
				initialDraftRevision,
			);
			yield* replaceClientRendererDraft(client, renderer.id, {
				expectedDraftRevision: initialDraftRevision,
				draftDefinition: definitionWithSource(
					"export default function Page() { return <h1>New draft</h1>; }",
				),
			});

			const stale = yield* Effect.flip(
				publishClientRenderer(client, renderer.id, initialDraftRevision),
			);
			assertTaggedError(stale, "ClientRendererBadRequest");
			expect(stale.reason).toEqual({ code: "draft-revision-stale" });
			const fetched = yield* getClientRenderer(client, renderer.id);
			expect(fetched.publishedRevision).toBe(initialDraftRevision);
			expect(fetched.publishedHash).toBe(initialPublication.publishedHash);
		}),
	);

	it.live("rejects a saved view that references an unpublished renderer", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const renderer = yield* createClientRenderer(client);

			const error = yield* Effect.flip(
				createRendererSavedView(client, renderer.id, { label: "Unpublished" }),
			);
			assertTaggedError(error, "SavedViewBadRequest");
			expect(error.reason).toEqual({ code: "renderer-unpublished" });
		}),
	);

	it.live("reuses one publication for saved views with different settings", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const renderer = yield* createClientRenderer(client);
			const publication = yield* publishClientRenderer(client, renderer.id, initialDraftRevision);
			const firstView = yield* createRendererSavedView(client, renderer.id, {
				label: "First setting",
			});
			const secondView = yield* createRendererSavedView(client, renderer.id, {
				label: "Second setting",
			});

			expect(firstView.renderer).toEqual({ kind: "custom", rendererId: renderer.id });
			expect(secondView.renderer).toEqual({ kind: "custom", rendererId: renderer.id });
			expect(firstView.settings).toEqual({ label: "First setting" });
			expect(secondView.settings).toEqual({ label: "Second setting" });

			const firstPrepared = yield* prepareClientPage(client, firstView.id);
			const secondPrepared = yield* prepareClientPage(client, secondView.id);
			expect(firstPrepared.identity).toMatchObject({
				rendererId: renderer.id,
				publishedHash: publication.publishedHash,
				publishedRevision: publication.publishedRevision,
			});
			expect(secondPrepared.identity).toMatchObject({
				rendererId: renderer.id,
				publishedHash: publication.publishedHash,
				publishedRevision: publication.publishedRevision,
			});
			expect(firstPrepared.identity.buildId).toBe(secondPrepared.identity.buildId);
			expect(firstPrepared.identity.artifactHash).toBe(secondPrepared.identity.artifactHash);
			expect(firstPrepared.context.settings).toEqual({ label: "First setting" });
			expect(secondPrepared.context.settings).toEqual({ label: "Second setting" });
		}),
	);

	it.live("rejects changed preparation identities and enforces the session lifecycle", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const renderer = yield* createClientRenderer(owner.client);
			yield* publishClientRenderer(owner.client, renderer.id, initialDraftRevision);
			const view = yield* createRendererSavedView(owner.client, renderer.id, {
				label: "Session lifecycle",
			});
			const prepared = yield* prepareClientPage(owner.client, view.id);
			assertCondition(
				prepared.identity.kind === "saved-view",
				"Expected a saved-view preparation identity",
			);

			const stale = yield* Effect.flip(
				createClientPageSession(owner.client, {
					...prepared.identity,
					viewRevision: prepared.identity.viewRevision + 1,
				}),
			);
			assertTaggedError(stale, "ClientPageStalePreparation");
			expect(stale.reason).toEqual({ code: "stale-preparation" });

			const session = yield* createClientPageSession(owner.client, prepared.identity);
			const artifact = yield* Effect.promise(() =>
				fetch(
					`${getApiUrl()}/client-pages/artifacts/${encodeURIComponent(session.token)}/index.html`,
				),
			);
			expect(artifact.status).toBe(200);
			expect(yield* Effect.promise(() => artifact.text())).toContain("ryot-client-artifact");

			const outsiderRenewal = yield* Effect.flip(
				renewClientPageSession(outsider.client, session.sessionId),
			);
			assertTaggedError(outsiderRenewal, "ClientPageSessionNotFound");
			expect(outsiderRenewal.reason).toEqual({ code: "page-session-not-found" });
			expect(
				(yield* renewClientPageSession(owner.client, session.sessionId)).expiresAt,
			).toBeTruthy();

			yield* revokeClientPageSession(owner.client, session.sessionId);
			const revokedArtifact = yield* Effect.promise(() =>
				fetch(
					`${getApiUrl()}/client-pages/artifacts/${encodeURIComponent(session.token)}/index.html`,
				),
			);
			expect(revokedArtifact.status).toBe(404);
		}),
	);

	it.live("serializes incompatible publication and saved-view creation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const renderer = yield* createClientRenderer(client);
			const initialPublication = yield* publishClientRenderer(
				client,
				renderer.id,
				initialDraftRevision,
			);
			const incompatibleDefinition = buildClientRendererDefinition({
				settingsSchema: {
					unknownKeys: "strict",
					fields: { label: { type: "number", label: "Label", description: "Numeric label" } },
				},
			});
			yield* replaceClientRendererDraft(client, renderer.id, {
				draftDefinition: incompatibleDefinition,
				expectedDraftRevision: initialDraftRevision,
			});

			const [publication, creation] = yield* Effect.all(
				[
					Effect.result(publishClientRenderer(client, renderer.id, initialDraftRevision + 1)),
					Effect.result(createRendererSavedView(client, renderer.id, { label: "String setting" })),
				],
				{ concurrency: "unbounded" },
			);
			expect(Result.isSuccess(publication)).not.toBe(Result.isSuccess(creation));

			if (Result.isFailure(publication)) {
				assertTaggedError(publication.failure, "ClientRendererBadRequest");
				expect(publication.failure.reason).toMatchObject({ code: "settings-incompatible" });
				expect((yield* getClientRenderer(client, renderer.id)).publishedHash).toBe(
					initialPublication.publishedHash,
				);
			}
			if (Result.isFailure(creation)) {
				assertTaggedError(creation.failure, "SavedViewBadRequest");
				expect(creation.failure.reason).toMatchObject({ code: "settings-incompatible" });
				expect((yield* getClientRenderer(client, renderer.id)).publishedRevision).toBe(
					initialDraftRevision + 1,
				);
			}
		}),
	);

	it.live("rejects deletion while a saved view uses the renderer", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const renderer = yield* createClientRenderer(client);
			yield* publishClientRenderer(client, renderer.id, initialDraftRevision);
			yield* createRendererSavedView(client, renderer.id, { label: "In use" });

			const error = yield* Effect.flip(deleteClientRenderer(client, renderer.id));
			assertTaggedError(error, "ClientRendererBadRequest");
			expect(error.reason).toEqual({ code: "renderer-in-use" });
			expect((yield* getClientRenderer(client, renderer.id)).id).toBe(renderer.id);
		}),
	);

	it.live("hides renderers from other users and returns not-found", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const renderer = yield* createClientRenderer(owner.client);

			expect((yield* listClientRenderers(outsider.client)).map(({ id }) => id)).not.toContain(
				renderer.id,
			);

			const getError = yield* Effect.flip(getClientRenderer(outsider.client, renderer.id));
			assertTaggedError(getError, "ClientRendererNotFound");
			expect(getError.reason).toEqual({ code: "renderer-not-found" });

			const replaceError = yield* Effect.flip(
				replaceClientRendererDraft(outsider.client, renderer.id, {
					expectedDraftRevision: initialDraftRevision,
					draftDefinition: buildClientRendererDefinition(),
				}),
			);
			assertTaggedError(replaceError, "ClientRendererNotFound");
			expect(replaceError.reason).toEqual({ code: "renderer-not-found" });

			const publishError = yield* Effect.flip(
				publishClientRenderer(outsider.client, renderer.id, initialDraftRevision),
			);
			assertTaggedError(publishError, "ClientRendererNotFound");
			expect(publishError.reason).toEqual({ code: "renderer-not-found" });

			const deleteError = yield* Effect.flip(deleteClientRenderer(outsider.client, renderer.id));
			assertTaggedError(deleteError, "ClientRendererNotFound");
			expect(deleteError.reason).toEqual({ code: "renderer-not-found" });
		}),
	);
});
