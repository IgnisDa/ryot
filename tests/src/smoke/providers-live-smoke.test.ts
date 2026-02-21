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
	assertCompleted,
	assertCondition,
	assertPresent,
	requireArray,
	requireObjectRecord,
	requireString,
} from "../test-support/assertions";

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
		assertCompleted(search, "OpenLibrary search");

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
		assertCompleted(imported, "OpenLibrary import");
		expect(imported.data.name.length).toBeGreaterThan(0);
		expect(imported.data.entitySchemaId).toBe(schema.id);

		const inLibrary = await queryInLibraryRelationship(client, imported.data.id, email);
		expect(inLibrary.rowCount).toBeGreaterThan(0);
	});

	it("translates a real TMDB movie on interest (requires tmdbAccessToken)", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;
		const { schema } = await findBuiltinSchemaBySlug(client, "movie");
		const scriptId = providerScriptId(schema, "TMDB");

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
			expect(localized.name).not.toBe("Canonical Fight Club");
			expect(localized.name.length).toBeGreaterThan(0);
			expect(await countEntityTranslations(movie.id)).toBe(1);
		} finally {
			stream.close();
		}
	}, 150_000);
});
