import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";
import { unzipSync, zipSync } from "fflate";

import {
	type Client,
	createAuthenticatedClient,
	executeRyotQL,
	exportAndDownloadBackup,
	getUserSettings,
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
	it.live("rejects every non-V1 manifest version without mutating the account", () =>
		Effect.gen(function* () {
			const { email, token, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const entries = unzipSync((yield* exportAndDownloadBackup(client, token)).bytes);

			for (const version of [0, 2]) {
				const manifestBytes = entries["manifest.json"];
				assert(manifestBytes);
				const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
				const failed = yield* restoreBackup(
					client,
					zipSync({
						...entries,
						"manifest.json": new TextEncoder().encode(JSON.stringify({ ...manifest, version })),
					}),
				);
				expect(failed.run.status).toBe("failed");
				expect(failed.run.failure).toEqual({ feature: "format", code: "archive-unsupported" });
			}

			expect(yield* inspectAccount(yield* refreshedClient(email))).toEqual(before);
		}),
	);

	it.live("rejects a stale section checksum without mutating the account", () =>
		Effect.gen(function* () {
			const { email, token, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const entries = unzipSync((yield* exportAndDownloadBackup(client, token)).bytes);
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
			const { email, token, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const entries = unzipSync((yield* exportAndDownloadBackup(client, token)).bytes);
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
