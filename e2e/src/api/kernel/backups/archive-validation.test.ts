import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect, Schema } from "effect";
import { unzipSync, zipSync } from "fflate";

import {
	type Client,
	createAuthenticatedClient,
	createIntegration,
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
	it.live("rejects a plugin provider claiming kernel ownership without mutating the target", () =>
		Effect.gen(function* () {
			const source = yield* createAuthenticatedClient();
			const target = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(target.client);
			yield* createIntegration(source.client, { provider: "data-json", providerSpecifics: {} });
			const entries = unzipSync(
				(yield* exportAndDownloadBackup(source.client, source.token)).bytes,
			);
			const manifestBytes = requirePresent(entries["manifest.json"], "Expected backup manifest");
			const integrationBytes = requirePresent(
				entries["integrations.ndjson"],
				"Expected backup integrations",
			);
			const manifest = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
			)(new TextDecoder().decode(manifestBytes));
			const integration = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
			)(new TextDecoder().decode(integrationBytes).trim());
			const invalidIntegration = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				...integration,
				provider: "plex",
			});
			const changedIntegrations = new TextEncoder().encode(`${invalidIntegration}\n`);
			const sections = yield* Schema.decodeUnknownEffect(
				Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
			)(manifest["sections"]);
			const section = requirePresent(
				sections.find((sec) => sec["path"] === "integrations.ndjson"),
				"Expected integration section declaration",
			);
			const sha256 = new Bun.CryptoHasher("sha256").update(changedIntegrations).digest("hex");
			const changedManifest = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				...manifest,
				sections: sections.map((candidate) =>
					candidate === section ? Object.assign({}, candidate, { sha256 }) : candidate,
				),
			});
			const failed = yield* restoreBackup(
				target.client,
				zipSync({
					...entries,
					"integrations.ndjson": changedIntegrations,
					"manifest.json": new TextEncoder().encode(changedManifest),
				}),
			);
			expect(failed.run.status).toBe("failed");
			expect(failed.run.failure).toEqual({ issue: "invalid-entry", code: "archive-invalid" });
			expect(yield* inspectAccount(target.client)).toEqual(before);
		}),
	);

	it.live("rejects every non-V1 manifest version without mutating the account", () =>
		Effect.gen(function* () {
			const { email, token, client } = yield* createAuthenticatedClient();
			const before = yield* inspectAccount(client);
			const entries = unzipSync((yield* exportAndDownloadBackup(client, token)).bytes);

			for (const version of [0, 2]) {
				const manifestBytes = entries["manifest.json"];
				assert(manifestBytes);
				const manifest = yield* Schema.decodeEffect(
					Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
				)(new TextDecoder().decode(manifestBytes));
				const mutatedManifest = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					...manifest,
					version,
				});
				const failed = yield* restoreBackup(
					client,
					zipSync({ ...entries, "manifest.json": new TextEncoder().encode(mutatedManifest) }),
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
