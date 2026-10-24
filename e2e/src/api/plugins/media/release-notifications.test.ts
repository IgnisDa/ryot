import { mediaPlugin } from "@ryot-app/media-plugin";
import { DateTime, Effect } from "effect";

import {
	createAuthenticatedClient,
	createNotificationChannel,
	fakeProviderDetailsResult,
	pollUntil,
	runCalendarDeliveryScan,
	shippedPluginTestProviders,
	startFakeAppriseServer,
} from "~/fixtures/kernel";
import {
	enableMediaMonitoring,
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
	triggerCronAndWaitForEntity,
} from "~/fixtures/plugins/media";
import { requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";
import { startIsolatedHarness } from "~/support/isolated-harness";

let fakeApprise: FakeHttpServer;
let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];
let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			fakeApprise = yield* startFakeAppriseServer;
			harness = yield* startIsolatedHarness("Media Release Notifications");
			target = harness.target;
			media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId, target);
		}),
	),
);

afterAll(() =>
	runPromise(
		Effect.gen(function* () {
			yield* Effect.promise(() => fakeApprise.stop());
			yield* harness?.stop ?? Effect.void;
		}),
	),
);

const bodies = (key: string) =>
	fakeApprise.requests
		.filter(({ path }) => path === `/notify/${key}`)
		.map(({ body }) => String(requireObjectRecord(body, "Missing notification body").body));

describe("Media release-day notifications", () => {
	it.live("notifies a fresh monitored release once and skips unmonitored releases", () =>
		Effect.gen(function* () {
			const today = DateTime.formatIsoDate(yield* DateTime.now);
			const { client } = yield* createAuthenticatedClient(target);
			yield* createNotificationChannel(client, {
				channelSpecifics: { kind: "apprise", key: "releases", baseUrl: fakeApprise.url },
			});
			const { schema: movieSchema } = yield* findMediaEntitySchema(client, "movie");
			const seedMovie = (name: string) =>
				Effect.gen(function* () {
					const provider = yield* media.attachProvider({
						rootEntitySchemaSlug: movieSchema.id,
						slug: `movie.release-e2e-${crypto.randomUUID()}`,
						details: fakeProviderDetailsResult({ name, properties: { publishDate: today } }),
					});
					return yield* seedMediaEntity({
						name,
						target,
						providerId: provider.providerId,
						entitySchemaSlug: movieSchema.id,
						properties: { publishDate: today },
						externalId: `release-${crypto.randomUUID()}`,
					});
				});
			const monitored = yield* seedMovie(`Monitored Release ${crypto.randomUUID()}`);
			const unmonitored = yield* seedMovie(`Unmonitored Release ${crypto.randomUUID()}`);
			yield* insertLibraryMembership(client, { mediaEntityId: unmonitored.id });
			yield* enableMediaMonitoring(client, monitored.id);

			yield* runCalendarDeliveryScan(client);
			yield* Effect.sleep("2 seconds");
			expect(bodies("releases")).toEqual([]);

			yield* triggerCronAndWaitForEntity({ client }, monitored.id);
			yield* runCalendarDeliveryScan(client);
			yield* pollUntil(
				"release notification",
				Effect.sync(() => (bodies("releases").length > 0 ? true : null)),
			);
			expect(bodies("releases")).toEqual([`${monitored.name} has been released today`]);

			yield* runCalendarDeliveryScan(client);
			yield* Effect.sleep("2 seconds");
			expect(bodies("releases")).toHaveLength(1);
		}),
	);
});
