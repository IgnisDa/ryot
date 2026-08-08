import { column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { Effect } from "effect";
import { zipSync } from "fflate";

import {
	type Client,
	createAuthenticatedClient,
	executeRyotQL,
	getUserSettings,
	makeSession,
	pollBackupRunUntilTerminal,
	requireRows,
	requireRyotQLText,
	restoreBackup,
	signInWithPassword,
	startBackupExport,
} from "~/fixtures";
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
	"plugin-state.ndjson",
	"entities.ndjson",
	"entity-dependencies.ndjson",
	"relationships.ndjson",
	"events.ndjson",
	"saved-views.ndjson",
	"notification-subscriptions.ndjson",
] as const;

const readFixtureEntries = Effect.fn(function* () {
	const entries = yield* Effect.forEach(fixturePaths, (path) =>
		Effect.promise(async () => {
			const bytes = new Uint8Array(await Bun.file(new URL(path, fixtureRoot)).arrayBuffer());
			return [path, bytes] as const;
		}),
	);
	return Object.fromEntries(entries);
});

const getLibraryId = Effect.fn(function* (client: Client) {
	const library = table("entity", "library");
	const result = yield* executeRyotQL(
		client,
		document({
			libraries: rows(library, {
				fields: [field("id", column(library, "id"))],
				where: eq(column(library, "entitySchemaSlug"), literal("library")),
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
	const libraryId = yield* getLibraryId(client);
	return { profile, libraryId };
});

const refreshedClient = Effect.fn(function* (email: string) {
	const signIn = yield* signInWithPassword(email, "password123");
	if (signIn.error) {
		throw new Error(`Sign in failed: ${signIn.error.message}`);
	}
	const cookies = requirePresent(signIn.cookies, "Failed to refresh auth cookies");
	return makeSession(undefined, { Cookie: cookies });
});

describe("V1 backup archive validation", () => {
	it.live("restores the checked-in minimal golden archive", () =>
		Effect.gen(function* () {
			const { client, email } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const restored = yield* restoreBackup(client, zipSync(yield* readFixtureEntries()));

			expect(restored.run.status).toBe("completed");
			const after = yield* inspectAccount(yield* refreshedClient(email));
			expect(after.profile.name).toBe("Golden Archive User");
			expect(after.profile.image).toBeNull();
			expect(after.profile.preferences).toEqual({
				language: "fr",
				allowNsfw: true,
				disableIntegrations: true,
			});
			expect(after.libraryId).toBe(before.libraryId);
			expect(after.libraryId).not.toBe(archivedLibraryId);
		}),
	);

	it.live("rejects a stale section checksum without mutating the account", () =>
		Effect.gen(function* () {
			const { client, email } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const entries = yield* readFixtureEntries();
			const profile = entries["profile.json"]?.slice();
			assert(profile);
			profile[0] = profile[0] === 123 ? 91 : 123;

			const failed = yield* restoreBackup(client, zipSync({ ...entries, "profile.json": profile }));
			expect(failed.run.status).toBe("failed");
			if (failed.run.error !== null) {
				expect(failed.run.error).toContain("Section checksum mismatch");
			}
			expect(yield* inspectAccount(yield* refreshedClient(email))).toEqual(before);

			const restored = yield* restoreBackup(client, zipSync(entries));
			expect(restored.run.status).toBe("completed");
			const after = yield* inspectAccount(yield* refreshedClient(email));
			expect(after.profile.name).toBe("Golden Archive User");
			expect(after.libraryId).toBe(before.libraryId);
		}),
	);

	it.live("rejects a traversal entry without mutating or blocking the account", () =>
		Effect.gen(function* () {
			const { client, email } = yield* createAuthenticatedClient();
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
