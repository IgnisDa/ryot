import { mediaPlugin } from "@ryot-app/media-plugin";
import { arrayContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { DateTime, Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createEventFixture,
	createNotificationChannel,
	fakeProviderDetailsResult,
	getEntity,
	pollUntil,
	runSignalScheduleScan,
	shippedPluginTestProviders,
	startFakeAppriseServer,
} from "~/fixtures/kernel";
import {
	createBuiltinMediaLifecycleFixture,
	enableMediaMonitoring,
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
	triggerCronAndWaitForEntity,
	waitForLibrarySummary,
} from "~/fixtures/plugins/media";
import { requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { type FakeHttpServer, startFakeHttpServer } from "~/support/fake-http-server";
import { startIsolatedHarness } from "~/support/isolated-harness";

type Harness = Effect.Success<ReturnType<typeof startIsolatedHarness>>;

let fakeApprise: FakeHttpServer;
let fakeUnkey: FakeHttpServer;
let keyless: Harness | undefined;
let pro: Harness | undefined;
let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			fakeApprise = yield* startFakeAppriseServer;
			fakeUnkey = yield* startFakeHttpServer(() =>
				Response.json({
					meta: { requestId: crypto.randomUUID() },
					data: { valid: true, code: "VALID", meta: { expiry: "2030-01-01" } },
				}),
			);
			const [keylessHarness, proHarness] = yield* Effect.all(
				[
					startIsolatedHarness("Media Scheduled Notifications", { SERVER_PRO_KEY: "" }),
					startIsolatedHarness("Media Scheduled Notifications Pro", {
						SERVER_PRO_KEY_VERIFICATION_URL: fakeUnkey.url,
						SERVER_PRO_KEY: "e2e-scheduled-notifications-key",
					}),
				],
				{ concurrency: "unbounded" },
			);
			keyless = keylessHarness;
			pro = proHarness;
			media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId, keyless.target);
		}),
	),
);

afterAll(() =>
	runPromise(
		Effect.gen(function* () {
			yield* Effect.promise(() => fakeApprise.stop());
			yield* Effect.promise(() => fakeUnkey.stop());
			yield* keyless?.stop ?? Effect.void;
			yield* pro?.stop ?? Effect.void;
		}),
	),
);

const requireHarness = (harness: Harness | undefined) => {
	if (!harness) {
		throw new Error("Harness did not start");
	}
	return harness.target;
};

const bodies = (key: string) =>
	fakeApprise.requests
		.filter(({ path }) => path === `/notify/${key}`)
		.map(({ body }) => String(requireObjectRecord(body, "Missing notification body").body));

const subscribedClient = (harness: Harness | undefined, key: string) =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient(requireHarness(harness));
		yield* createNotificationChannel(client, {
			channelSpecifics: { key, kind: "apprise", baseUrl: fakeApprise.url },
		});
		return client;
	});

const seedStaleBook = (
	client: Client,
	input: { readonly daysAgo: number; readonly state: "on_hold" | "progress" },
) =>
	Effect.gen(function* () {
		const fixture = yield* createBuiltinMediaLifecycleFixture(client);
		yield* insertLibraryMembership(client, { mediaEntityId: fixture.entityId });
		const now = yield* DateTime.now;
		yield* createEventFixture(client, {
			entityId: fixture.entityId,
			properties: { progressPercent: 40 },
			occurredAt: DateTime.formatIso(DateTime.subtract(now, { hours: 1, days: input.daysAgo })),
			eventSchemaSlug:
				input.state === "progress"
					? fixture.progressEventSchemaSlug
					: fixture.onHoldEventSchemaSlug,
		});
		yield* waitForLibrarySummary(client, fixture.entityId);
		return yield* getEntity(client, fixture.entityId);
	});

const waitForBodies = (key: string, count: number) =>
	pollUntil(
		`${count} notifications for ${key}`,
		Effect.sync(() => (bodies(key).length >= count ? true : null)),
	);

describe("Media scheduled notifications", () => {
	it.live("notifies a fresh monitored release once and skips unmonitored releases", () =>
		Effect.gen(function* () {
			const today = DateTime.formatIsoDate(yield* DateTime.now);
			const client = yield* subscribedClient(keyless, "releases");
			const { schema: movieSchema } = yield* findMediaEntitySchema(client, "movie");
			const seedMovie = (name: string) =>
				Effect.gen(function* () {
					const provider = yield* media.attachProvider({
						rootEntitySchemaSlug: movieSchema.id,
						slug: `movie.release-e2e-${yield* randomUuid}`,
						details: fakeProviderDetailsResult({ name, properties: { publishDate: today } }),
					});
					return yield* seedMediaEntity({
						name,
						target: requireHarness(keyless),
						providerId: provider.providerId,
						entitySchemaSlug: movieSchema.id,
						properties: { publishDate: today },
						externalId: `release-${yield* randomUuid}`,
					});
				});
			const monitored = yield* seedMovie(`Monitored Release ${yield* randomUuid}`);
			const unmonitored = yield* seedMovie(`Unmonitored Release ${yield* randomUuid}`);
			yield* insertLibraryMembership(client, { mediaEntityId: unmonitored.id });
			yield* enableMediaMonitoring(client, monitored.id);

			yield* runSignalScheduleScan(client);
			yield* Effect.sleep("2 seconds");
			expect(bodies("releases")).toEqual([]);

			yield* triggerCronAndWaitForEntity({ client }, monitored.id);
			yield* runSignalScheduleScan(client);
			yield* waitForBodies("releases", 1);
			expect(bodies("releases")).toEqual([`${monitored.name} has been released today`]);

			yield* runSignalScheduleScan(client);
			yield* Effect.sleep("2 seconds");
			expect(bodies("releases")).toHaveLength(1);
		}),
	);

	it.live("withholds stale-progress nudges without a validated Pro key", () =>
		Effect.gen(function* () {
			const client = yield* subscribedClient(keyless, "keyless-stale");
			yield* seedStaleBook(client, { daysAgo: 7, state: "progress" });
			yield* runSignalScheduleScan(client);
			yield* Effect.sleep("2 seconds");
			expect(bodies("keyless-stale")).toEqual([]);
		}),
	);

	it.live("nudges once when in-progress or on-hold media crosses its threshold", () =>
		Effect.gen(function* () {
			const client = yield* subscribedClient(pro, "stale");
			const inProgress = yield* seedStaleBook(client, { daysAgo: 7, state: "progress" });
			const onHold = yield* seedStaleBook(client, { daysAgo: 14, state: "on_hold" });
			yield* seedStaleBook(client, { daysAgo: 4, state: "progress" });
			yield* seedStaleBook(client, { daysAgo: 8, state: "on_hold" });
			yield* seedStaleBook(client, { daysAgo: 30, state: "progress" });

			yield* runSignalScheduleScan(client);
			yield* waitForBodies("stale", 2);
			expect(bodies("stale")).toHaveLength(2);
			expect(bodies("stale")).toEqual(
				arrayContaining([
					`${inProgress.name} has been in progress for 7 days without activity`,
					`${onHold.name} has been on hold for 14 days without activity`,
				]),
			);

			yield* runSignalScheduleScan(client);
			yield* Effect.sleep("2 seconds");
			expect(bodies("stale")).toHaveLength(2);
		}),
	);
});
