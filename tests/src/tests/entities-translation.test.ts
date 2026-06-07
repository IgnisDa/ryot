import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	cleanupBuiltinProviderScript,
	countEntityTranslations,
	createAuthenticatedClient,
	detailsDriverCode,
	findBuiltinSchemaBySlug,
	getEntity,
	getEntityTranslationRow,
	openInterestStream,
	pollEntityUntilTranslationStatus,
	seedBuiltinProviderScript,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	setUserLanguage,
	translateDriverCode,
	waitForEntityPopulated,
	type InterestStream,
	type SeededProviderScript,
} from "../fixtures";

const CANONICAL_LANGUAGE = "en";
const GRACE_WINDOW_MS = 3000;
const TRANSLATED_ES_NAME = "Título Traducido E2E";
const TRANSLATED_ES_DESCRIPTION = "Descripción traducida E2E.";
const POPULATED_NAME = "E2E Populated Movie";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let providerScript: SeededProviderScript;

async function seedPopulatedMovie(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
	name: string,
) {
	const { schema } = await findBuiltinSchemaBySlug(client, "movie");
	return seedPopulatedProviderEntity({
		name,
		entitySchemaId: schema.id,
		sandboxScriptId: providerScript.scriptId,
		externalId: `e2e-translate-${crypto.randomUUID()}`,
		properties: { description: `Canonical overview of ${name}.` },
	});
}

async function declareInterest(
	auth: Awaited<ReturnType<typeof createAuthenticatedClient>>,
	entityIds: string[],
): Promise<InterestStream> {
	const stream = await openInterestStream(auth);
	await stream.declareInterest(entityIds);
	return stream;
}

describe("entity translation via client-declared interest", () => {
	beforeAll(async () => {
		providerScript = await seedBuiltinProviderScript({
			metadata: { providerInformation: { source: "e2e", canonicalLanguage: CANONICAL_LANGUAGE } },
			code: [
				detailsDriverCode({
					name: POPULATED_NAME,
					properties: { description: "Populated by the e2e fake provider." },
				}),
				translateDriverCode({
					es: {
						name: TRANSLATED_ES_NAME,
						properties: { description: TRANSLATED_ES_DESCRIPTION },
					},
				}),
			].join("\n"),
		});
	});

	afterAll(async () => {
		await cleanupBuiltinProviderScript(providerScript);
	});

	it("reports pending, translates on interest, then shares the overlay across users", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;
		const movie = await seedPopulatedMovie(client, "Canonical Fight Club");

		await setUserLanguage(client, "es");

		const beforeInterest = await getEntity(client, movie.id);
		expect(beforeInterest.translationStatus).toBe("pending");
		expect(beforeInterest.name).toBe("Canonical Fight Club");

		const stream = await declareInterest(auth, [movie.id]);
		try {
			const event = await stream.waitForEntityUpdated(movie.id, "translated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("translated");

			const localizedRead = await pollEntityUntilTranslationStatus(client, movie.id, "ready", {
				timeoutMs: 30_000,
			});
			expect(localizedRead.name).toBe(TRANSLATED_ES_NAME);

			const { client: clientB } = await createAuthenticatedClient();
			await setUserLanguage(clientB, "es");
			const sharedRead = await getEntity(clientB, movie.id);
			expect(sharedRead.translationStatus).toBe("ready");
			expect(sharedRead.name).toBe(TRANSLATED_ES_NAME);
			expect(await countEntityTranslations(movie.id)).toBe(1);
		} finally {
			stream.close();
		}
	}, 60_000);

	it("negative-caches when the provider has no translation and does not refetch", async () => {
		const auth = await createAuthenticatedClient();
		const { client } = auth;
		const movie = await seedPopulatedMovie(client, "Canonical The Godfather");

		await setUserLanguage(client, "xx");

		const firstRead = await getEntity(client, movie.id);
		expect(firstRead.translationStatus).toBe("pending");

		const stream = await declareInterest(auth, [movie.id]);
		try {
			await stream.waitForEntityUpdated(movie.id, "translated", { timeoutMs: 30_000 });

			const settledRead = await pollEntityUntilTranslationStatus(client, movie.id, "none", {
				timeoutMs: 30_000,
			});
			expect(settledRead.name).toBe("Canonical The Godfather");

			const overlay = await getEntityTranslationRow({ entityId: movie.id, language: "xx" });
			expect(overlay?.name ?? null).toBeNull();
			expect(overlay?.properties?.description ?? null).toBeNull();
			expect(await countEntityTranslations(movie.id)).toBe(1);
		} finally {
			stream.close();
		}
	}, 60_000);

	it("renders canonical without fetching when the resolved language is canonical or unset", async () => {
		const { client } = await createAuthenticatedClient();
		const movie = await seedPopulatedMovie(client, "Canonical The Shawshank Redemption");

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
		const provenance = {
			entitySchemaId: schema.id,
			sandboxScriptId: providerScript.scriptId,
			externalId: `e2e-translate-unpopulated-${crypto.randomUUID()}`,
		};

		const seeded = await seedMediaEntity({
			userId: null,
			properties: {},
			entitySchemaId: schema.id,
			name: "Partial Pulp Fiction",
			externalId: provenance.externalId,
			sandboxScriptId: providerScript.scriptId,
		});

		await setUserLanguage(client, "es");

		const stream = await declareInterest(auth, [seeded.id]);
		try {
			const event = await stream.waitForEntityUpdated(seeded.id, "populated", {
				timeoutMs: 30_000,
			});
			expect(event.reason).toBe("populated");

			const populated = await waitForEntityPopulated(provenance);
			expect(populated.populatedAt).not.toBeNull();

			// Give any (incorrect) translate enqueue a chance to land, then prove none did.
			await delay(GRACE_WINDOW_MS);
			expect(await countEntityTranslations(seeded.id)).toBe(0);
		} finally {
			stream.close();
		}
	}, 60_000);
});
