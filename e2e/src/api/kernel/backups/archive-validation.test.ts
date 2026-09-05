import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect } from "effect";
import { zipSync } from "fflate";

import {
	type Client,
	createAuthenticatedClient,
	executeRyotQL,
	getSavedView,
	getUserSettings,
	buildSavedViewBody,
	makeSession,
	pollBackupRunUntilTerminal,
	requireRows,
	requireRyotQLText,
	restoreBackup,
	signInWithPassword,
	startBackupExport,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { assert, describe, expect, it } from "~/support/effect-test";

const archivedLibraryId = "00000000-0000-4000-8000-000000000001";
const fixtureRoot = new URL(
	"../../../../../packages/contract/src/modules/backups/fixtures/v1/",
	import.meta.url,
);
const fixturePaths = [
	"manifest.json",
	"profile.json",
	"private-plugins.ndjson",
	"installations.ndjson",
	"entities.ndjson",
	"entity-dependencies.ndjson",
	"relationships.ndjson",
	"events.ndjson",
	"saved-views.ndjson",
	"integrations.ndjson",
	"notification-subscriptions.ndjson",
] as const;

const readFixtureEntries = Effect.fn(function* () {
	const entries = yield* Effect.forEach(fixturePaths, (path) =>
		Effect.promise(async () => {
			const bytes = new Uint8Array(await Bun.file(new URL(path, fixtureRoot)).arrayBuffer());
			return [path, bytes] as const;
		}),
	);
	const files = Object.fromEntries(entries);
	const manifestBytes = files["manifest.json"];
	assert(manifestBytes);
	const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
	manifest.requiredPlugins = [];
	manifest.sections = manifest.sections.filter(
		(section: { path: string }) => section.path !== "client-renderers.ndjson",
	);
	const installationsSection = manifest.sections.find(
		(section: { path: string }) => section.path === "installations.ndjson",
	);
	assert(installationsSection);
	installationsSection.count = 0;
	installationsSection.sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
	files["installations.ndjson"] = new Uint8Array();
	const savedViews = files["saved-views.ndjson"];
	assert(savedViews);
	const archivedView = JSON.parse(new TextDecoder().decode(savedViews));
	const savedView = buildSavedViewBody({ name: archivedView.name });
	const rewrittenSavedViews = new TextEncoder().encode(
		JSON.stringify({ ...archivedView, ...savedView }) + "\n",
	);
	files["saved-views.ndjson"] = rewrittenSavedViews;
	const savedViewsSection = manifest.sections.find(
		(section: { path: string }) => section.path === "saved-views.ndjson",
	);
	assert(savedViewsSection);
	savedViewsSection.count = 1;
	savedViewsSection.sha256 = sha256Hex(rewrittenSavedViews);
	files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
	return files;
});

const getMediaLibraryId = Effect.fn(function* (client: Client) {
	const mediaLibrary = table("entity", "mediaLibrary");
	const result = yield* executeRyotQL(
		client,
		document({
			libraries: rows(mediaLibrary, {
				fields: [field("id", column(mediaLibrary, "id"))],
				where: eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
			}),
		}),
	);
	const libraries = requireRows(result.data.libraries, "libraries");
	expect(libraries.items).toHaveLength(1);
	const row = libraries.items[0];
	assert(row);
	return requireRyotQLText(row, "id");
});

const inspectAccount = Effect.fn(function* (client: Client) {
	const profile = yield* getUserSettings(client);
	const libraryId = yield* getMediaLibraryId(client);
	return { profile, libraryId };
});

const refreshedClient = Effect.fn(function* (email: string) {
	const signIn = yield* signInWithPassword(email, "password123");
	if (signIn.error) {
		throw new Error(`Sign in failed: ${signIn.error.message}`);
	}
	const token = requirePresent(signIn.token, "Failed to refresh auth token");
	return makeSession(undefined, { Authorization: `Bearer ${token}` });
});

describe("V1 backup archive validation", () => {
	it.live("restores the checked-in minimal golden archive", () =>
		Effect.gen(function* () {
			const { email, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const restored = yield* restoreBackup(client, zipSync(yield* readFixtureEntries()));

			expect(restored.run.status).toBe("completed");
			const restoredClient = yield* refreshedClient(email);
			const after = yield* inspectAccount(restoredClient);
			expect(after.profile.name).toBe("Fixture");
			expect(after.profile.image).toBeNull();
			expect(after.profile.preferences).toEqual({
				language: null,
				allowNsfw: false,
				disableIntegrations: false,
			});
			expect(after.libraryId).toBe(before.libraryId);
			expect(after.libraryId).not.toBe(archivedLibraryId);
			expect(yield* getSavedView(restoredClient, "fixture")).toMatchObject({
				dataSources: expect.any(Object),
				settings: { sourceName: "savedView" },
				renderer: { kind: "kernel", name: "entity-browser" },
			});
		}),
	);

	it.live("rejects every non-V1 manifest version without mutating the account", () =>
		Effect.gen(function* () {
			const { email, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);

			for (const version of [0, 2]) {
				const entries = yield* readFixtureEntries();
				const manifestBytes = entries["manifest.json"];
				assert(manifestBytes);
				const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
				entries["manifest.json"] = new TextEncoder().encode(
					JSON.stringify({ ...manifest, version }),
				);

				const failed = yield* restoreBackup(client, zipSync(entries));
				expect(failed.run.status).toBe("failed");
				expect(failed.run.failure).toEqual({ feature: "format", code: "archive-unsupported" });
			}

			expect(yield* inspectAccount(yield* refreshedClient(email))).toEqual(before);
		}),
	);

	it.live("rejects a stale section checksum without mutating the account", () =>
		Effect.gen(function* () {
			const { email, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const entries = yield* readFixtureEntries();
			const profile = entries["profile.json"]?.slice();
			assert(profile);
			profile[0] = profile[0] === 123 ? 91 : 123;

			const failed = yield* restoreBackup(client, zipSync({ ...entries, "profile.json": profile }));
			expect(failed.run.status).toBe("failed");
			expect(failed.run.failure).toEqual({ code: "archive-invalid", issue: "checksum-mismatch" });
			expect(yield* inspectAccount(yield* refreshedClient(email))).toEqual(before);
		}),
	);

	it.live("rejects a traversal entry without mutating or blocking the account", () =>
		Effect.gen(function* () {
			const { email, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const entries = yield* readFixtureEntries();
			const archive = zipSync({ ...entries, "../escape": new Uint8Array([1]) });

			const failed = yield* restoreBackup(client, archive);
			expect(failed.run.status).toBe("failed");
			const refreshed = yield* refreshedClient(email);
			expect(yield* inspectAccount(refreshed)).toEqual(before);

			const exportId = yield* startBackupExport(refreshed);
			const exported = yield* pollBackupRunUntilTerminal(refreshed, exportId);
			expect(exported.status).toBe("completed");
		}),
	);
});
