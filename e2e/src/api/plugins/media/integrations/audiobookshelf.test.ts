import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	listEventsForEntity,
	listIntegrationImportRuns,
	pollImportRunUntilTerminal,
	setEntityPopulatedAt,
} from "~/fixtures/kernel";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	findMediaEntitySchema,
	mediaFixtureInstallation,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

describe("Audiobookshelf integration", () => {
	it.live("syncs in-progress Audiobookshelf audio and ignores unchanged polls", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findMediaEntitySchema(client, "audiobook");
			const provider = requirePresent(
				schema.providers.find((candidate) => candidate.name === "Audible"),
				"Expected Audible audiobook provider",
			);
			const externalId = `abs-${crypto.randomUUID()}`;
			const audiobook = yield* seedMediaEntity({
				externalId,
				userId: null,
				properties: {},
				entitySchemaSlug: schema.id,
				name: "In-progress audiobook",
				providerId: provider.providerId,
			});
			yield* setEntityPopulatedAt(audiobook.id, DateTime.formatIso(yield* DateTime.now));

			const http = yield* startFakeHttpServerScoped((url) => {
				if (url.pathname === "/api/me") {
					return Response.json({ mediaProgress: [{}] });
				}
				if (url.pathname === "/api/me/items-in-progress") {
					return url.searchParams.get("limit") === "1"
						? Response.json({
								libraryItems: [
									{
										id: "book-1",
										media: { metadata: { asin: externalId, title: "In-progress audiobook" } },
									},
								],
							})
						: new Response(null, { status: 404 });
				}
				if (url.pathname === "/api/me/progress/book-1") {
					return Response.json({ progress: 0.42, isFinished: false });
				}
				return new Response(null, { status: 404 });
			});

			const integration = yield* Effect.acquireRelease(
				createIntegration(client, {
					minimumProgress: 2,
					maximumProgress: 95,
					syncOwnership: false,
					providerSpecifics: { baseUrl: http.url, token: "test-token", kind: "audiobookshelf" },
					provider: {
						slug: "audiobookshelf",
						owner: definitionOwner((yield* mediaFixtureInstallation(client.target)).id),
					},
				}),
				({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
			);

			const completedRunIds = new Set<string>();
			const waitForNextRun = () =>
				pollUntil(
					"new Audiobookshelf import run",
					Effect.gen(function* () {
						const { items } = yield* listIntegrationImportRuns(
							client,
							integration.id,
							undefined,
							100,
						);
						return items.find(({ id }) => !completedRunIds.has(id))?.id ?? null;
					}),
				);

			yield* client.call((c) => c.integrations.sync());
			const firstRunId = yield* waitForNextRun();
			const firstRun = yield* pollImportRunUntilTerminal(client, firstRunId);
			assertCompleted(firstRun, "Audiobookshelf import run");
			completedRunIds.add(firstRun.id);

			const firstEvents = yield* listEventsForEntity(client, audiobook.id, undefined, 100);
			const firstProgressEvents = firstEvents.filter(
				({ eventSchemaSlug }) => eventSchemaSlug === "progress",
			);
			expect(firstProgressEvents).toHaveLength(1);
			const firstProgressEvent = requirePresent(firstProgressEvents[0], "Expected progress event");
			expect(firstProgressEvent.properties).toMatchObject({
				progressPercent: 42,
				consumedOn: "Audiobookshelf",
			});
			expect(firstEvents.some(({ eventSchemaSlug }) => eventSchemaSlug === "complete")).toBe(false);

			yield* client.call((c) => c.integrations.sync());
			const secondRunId = yield* waitForNextRun();
			const secondRun = yield* pollImportRunUntilTerminal(client, secondRunId);
			assertCompleted(secondRun, "Audiobookshelf import run");
			completedRunIds.add(secondRun.id);

			const secondEvents = yield* listEventsForEntity(client, audiobook.id, undefined, 100);
			const secondProgressEvents = secondEvents.filter(
				({ eventSchemaSlug }) => eventSchemaSlug === "progress",
			);
			expect(secondProgressEvents).toHaveLength(1);
			const secondProgressEvent = requirePresent(
				secondProgressEvents[0],
				"Expected progress event",
			);
			expect(secondProgressEvent.id).toBe(firstProgressEvent.id);
			expect(secondProgressEvent.properties).toMatchObject({
				progressPercent: 42,
				consumedOn: "Audiobookshelf",
			});
			expect(secondEvents.some(({ eventSchemaSlug }) => eventSchemaSlug === "complete")).toBe(
				false,
			);

			const paths = http.requests.map(({ path }) => path);
			expect(paths).toContain("/api/me/items-in-progress");
			expect(paths).toContain("/api/me/progress/book-1");
			expect(
				http.requests.every(({ headers }) => headers.authorization === "Bearer test-token"),
			).toBe(true);
			expect(
				paths.some((path) => path === "/api/libraries" || path.startsWith("/api/libraries/")),
			).toBe(false);
			expect(paths.some((path) => path === "/api/items" || path.startsWith("/api/items/"))).toBe(
				false,
			);
		}),
	);
});
