import { describe, expect, it } from "bun:test";

import {
	countEntityTranslations,
	createAuthenticatedClient,
	deleteGlobalEntityByProvenance,
	findBuiltinSchemaBySlug,
	getEntity,
	getEntityTranslationRow,
	openInterestStream,
	pollEntityUntilTranslationStatus,
	seedMediaEntity,
	seedPopulatedTmdbMovie,
	setUserLanguage,
	waitForEntityPopulated,
} from "../fixtures";
import type { InterestStream } from "../fixtures";
import { assertPresent } from "../test-support/assertions";

const CANONICAL_LANGUAGE = "en";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function declareInterest(
	auth: Awaited<ReturnType<typeof createAuthenticatedClient>>,
	entityIds: string[],
): Promise<InterestStream> {
	const stream = await openInterestStream(auth);
	await stream.declareInterest(entityIds);
	return stream;
}

describe("entity translation via client-declared interest", () => {
	it("reports pending, translates on interest, then shares the overlay across users", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;
		const movie = await seedPopulatedTmdbMovie(client, {
			externalId: "550",
			name: "Canonical Fight Club",
		});

		await setUserLanguage(client, "es");

		// A read reports the pending translation status.
		const beforeInterest = await getEntity(client, movie.id);
		expect(beforeInterest.translationStatus).toBe("pending");
		expect(beforeInterest.name).toBe("Canonical Fight Club");

		const stream = await declareInterest(auth, [movie.id]);
		try {
			// Interest triggers the fill; completion fans out over the stream.
			const event = await stream.waitForEntityUpdated(movie.id, "translated", {
				timeoutMs: 90_000,
			});
			expect(event.reason).toBe("translated");

			const localizedRead = await pollEntityUntilTranslationStatus(client, movie.id, "ready", {
				timeoutMs: 90_000,
			});
			expect(localizedRead.name).not.toBe("Canonical Fight Club");
			expect(localizedRead.name.length).toBeGreaterThan(0);

			// A second non-canonical user reads the shared overlay directly — no interest needed.
			const { client: clientB } = await createAuthenticatedClient();
			await setUserLanguage(clientB, "es");
			const sharedRead = await getEntity(clientB, movie.id);
			expect(sharedRead.translationStatus).toBe("ready");
			expect(sharedRead.name).toBe(localizedRead.name);
			expect(await countEntityTranslations(movie.id)).toBe(1);
		} finally {
			stream.close();
		}
	}, 150_000);

	it("negative-caches when the provider has no translation and does not refetch", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;
		const movie = await seedPopulatedTmdbMovie(client, {
			externalId: "238",
			name: "Canonical The Godfather",
		});

		await setUserLanguage(client, "xx");

		const firstRead = await getEntity(client, movie.id);
		expect(firstRead.translationStatus).toBe("pending");

		const stream = await declareInterest(auth, [movie.id]);
		try {
			await stream.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 90_000 });

			const settledRead = await pollEntityUntilTranslationStatus(client, movie.id, "none", {
				timeoutMs: 90_000,
			});
			expect(settledRead.name).toBe("Canonical The Godfather");

			const overlay = await getEntityTranslationRow({ entityId: movie.id, language: "xx" });
			expect(overlay?.name ?? null).toBeNull();
			expect(overlay?.properties?.description ?? null).toBeNull();
			expect(await countEntityTranslations(movie.id)).toBe(1);
		} finally {
			stream.close();
		}
	}, 120_000);

	it("renders canonical without fetching when the resolved language is canonical or unset", async () => {
		const { client } = await createAuthenticatedClient();
		const movie = await seedPopulatedTmdbMovie(client, {
			externalId: "278",
			name: "Canonical The Shawshank Redemption",
		});

		await setUserLanguage(client, CANONICAL_LANGUAGE);
		const canonicalPreferenceRead = await getEntity(client, movie.id);
		expect(canonicalPreferenceRead.translationStatus).toBe("none");
		expect(canonicalPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
		expect(await countEntityTranslations(movie.id)).toBe(0);

		const { client: noPreferenceClient } = await createAuthenticatedClient();
		const noPreferenceRead = await getEntity(noPreferenceClient, movie.id);
		expect(noPreferenceRead.translationStatus).toBe("none");
		expect(noPreferenceRead.name).toBe("Canonical The Shawshank Redemption");
		expect(await countEntityTranslations(movie.id)).toBe(0);
	});

	it("enqueues only population (never an all-null overlay) when interest hits an unpopulated entity", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;
		const { schema } = await findBuiltinSchemaBySlug(client, "movie");
		const sandboxScriptId = schema.providers.find((provider) => provider.name === "TMDB")?.scriptId;
		assertPresent(sandboxScriptId, "TMDB movie provider script not found");
		const provenance = { externalId: "680", entitySchemaId: schema.id, sandboxScriptId };

		await deleteGlobalEntityByProvenance(provenance);
		const seeded = await seedMediaEntity({
			userId: null,
			properties: {},
			sandboxScriptId,
			name: "Partial Pulp Fiction",
			entitySchemaId: schema.id,
			externalId: provenance.externalId,
		});

		// A non-canonical language must NOT cause a premature translate on an unpopulated entity (which
		// would write an all-null overlay and permanently mislabel the status as "none").
		await setUserLanguage(client, "es");

		const stream = await declareInterest(auth, [seeded.id]);
		try {
			const event = await stream.waitForEntityUpdated(seeded.id, "populated", {
				timeoutMs: 60_000,
			});
			expect(event.reason).toBe("populated");

			const populated = await waitForEntityPopulated(provenance);
			expect(populated.populatedAt).not.toBeNull();

			// Give any (incorrect) translate enqueue a chance to land, then prove none did.
			await delay(3000);
			expect(await countEntityTranslations(seeded.id)).toBe(0);
		} finally {
			stream.close();
		}
	}, 90_000);
});
