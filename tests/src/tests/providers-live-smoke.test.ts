import { describe, expect, it } from "bun:test";

import { SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	countEntityTranslations,
	createAuthenticatedClient,
	enqueueEntityImport,
	enqueueEntitySearch,
	findBuiltinSchemaBySlug,
	getEntity,
	openInterestStream,
	pollEntityImportResult,
	pollEntitySearchResult,
	pollEntityUntilTranslationStatus,
	queryInLibraryRelationship,
	seedPopulatedProviderEntity,
	setUserLanguage,
} from "../fixtures";
import {
	assertCondition,
	assertPresent,
	requireArray,
	requireObjectRecord,
	requireString,
} from "../test-support/assertions";

// The ONLY tests in this suite that make real external HTTP calls. Every other provider-driven test
// is hermetic (it seeds a fake sandbox_script that returns fixed data offline). These live smokes are
// gated behind RUN_LIVE_PROVIDER_TESTS so PR CI stays fast and deterministic; run them in a nightly /
// pre-release job to get early warning of upstream drift — provider schema changes, endpoint moves,
// and auth/credential failures that a fully-mocked test can never surface.
//
//   RUN_LIVE_PROVIDER_TESTS=1 bun test src/tests/providers-live-smoke.test.ts
//
// Coverage (kept intentionally minimal — this is a drift signal, not exhaustive behaviour):
//   • OpenLibrary (book) search -> import: keyless, so it runs whenever the flag is set.
//   • TMDB (movie) translate-on-interest: requires `providers.tmdbAccessToken` in the backend env;
//     without it the translate job never completes and this test times out.
const RUN_LIVE =
	process.env.RUN_LIVE_PROVIDER_TESTS === "1" || process.env.RUN_LIVE_PROVIDER_TESTS === "true";

function providerScriptId(
	schema: { providers: ReadonlyArray<{ name: string; scriptId: string }> },
	providerName: string,
): SandboxScriptId {
	const provider = schema.providers.find((candidate) => candidate.name === providerName);
	assertPresent(provider, `Expected a '${providerName}' provider on the builtin schema`);
	return SandboxScriptId.make(provider.scriptId);
}

describe.skipIf(!RUN_LIVE)("live provider smoke (real external APIs)", () => {
	it("searches OpenLibrary and imports a real result into the library", async () => {
		const { client, email } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(client, "book");
		const scriptId = providerScriptId(schema, "OpenLibrary");

		const { jobId } = await enqueueEntitySearch(client, {
			scriptId,
			context: { query: "The Hobbit", page: 1, pageSize: 5 },
		});
		const search = await pollEntitySearchResult(client, jobId, { timeoutMs: 60_000 });
		assertCondition(
			search.status === "completed",
			`Expected OpenLibrary search to complete, got '${search.status}'`,
		);

		// Import the first real result by its own externalId, so we never hardcode a provider-specific
		// id format — the search proves the id is valid for the very import that follows.
		const value = requireObjectRecord(search.value, "Expected search result to be an object");
		const items = requireArray(value.items, "Expected search result items to be an array");
		assertCondition(items.length > 0, "OpenLibrary returned no results for 'The Hobbit'");
		const firstItem = requireObjectRecord(
			items[0],
			"Expected the first search item to be an object",
		);
		const externalId = requireString(
			firstItem.externalId,
			"Expected the search item to carry a string externalId",
		);

		const { jobId: importJobId } = await enqueueEntityImport(client, {
			scriptId,
			externalId,
			entitySchemaId: schema.id,
		});
		const imported = await pollEntityImportResult(client, importJobId, { timeoutMs: 60_000 });
		assertCondition(
			imported.status === "completed",
			`Expected OpenLibrary import to complete, got '${imported.status}'`,
		);
		expect(imported.data.name.length).toBeGreaterThan(0);
		expect(imported.data.entitySchemaId).toBe(schema.id);

		const inLibrary = await queryInLibraryRelationship(client, imported.data.id, email);
		expect(inLibrary.rowCount).toBeGreaterThan(0);
	}, 90_000);

	it("translates a real TMDB movie on interest (requires tmdbAccessToken)", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;
		const { schema } = await findBuiltinSchemaBySlug(client, "movie");
		const scriptId = providerScriptId(schema, "TMDB");

		// Seed a globally-populated entity whose provenance is the real TMDB movie provider, keyed by a
		// stable canonical id (550 = "Fight Club"). Declaring interest then drives a real TMDB translate.
		const movie = await seedPopulatedProviderEntity({
			externalId: "550",
			entitySchemaId: schema.id,
			sandboxScriptId: scriptId,
			name: "Canonical Fight Club",
			properties: { description: "Canonical overview of Fight Club." },
		});

		await setUserLanguage(client, "es");
		const beforeInterest = await getEntity(client, movie.id);
		expect(beforeInterest.translationStatus).toBe("pending");

		const stream = await openInterestStream(auth);
		await stream.declareInterest([movie.id]);
		try {
			const event = await stream.waitForEntityUpdated(movie.id, "translated", {
				timeoutMs: 90_000,
			});
			expect(event.reason).toBe("translated");

			const localized = await pollEntityUntilTranslationStatus(client, movie.id, "ready", {
				timeoutMs: 90_000,
			});
			// The Spanish overlay must differ from the canonical English name and be non-empty; we do not
			// assert an exact string because upstream copy can change (that drift is fine, breakage isn't).
			expect(localized.name).not.toBe("Canonical Fight Club");
			expect(localized.name.length).toBeGreaterThan(0);
			expect(await countEntityTranslations(movie.id)).toBe(1);
		} finally {
			stream.close();
		}
	}, 150_000);
});
