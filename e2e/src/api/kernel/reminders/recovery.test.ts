import { reminderDeliveriesRecipe } from "@ryot-app/ryotql-recipes/notification-delivery";
import { DateTime, Deferred, Effect } from "effect";
import getPort from "get-port";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createCollection } from "~/fixtures/kernel/collections";
import { createNotificationChannel } from "~/fixtures/kernel/notifications";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	createReminder,
	listReminders,
	reminderSubmission,
	runReminderScan,
} from "~/fixtures/kernel/reminders";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import {
	buildApiEnv,
	harnessApiEnv,
	startApiProcess,
	startCoreTestInfrastructure,
} from "~/support/provisioning";

describe("reminder recovery after process loss", () => {
	it.live("keeps completed channels and never repeats a request whose response was lost", () =>
		Effect.gen(function* () {
			const response = yield* Deferred.make<Response>();
			const provider = yield* startFakeHttpServerScoped((url) =>
				url.pathname.includes("/held/") ? Deferred.await(response) : Response.json({ ok: true }),
			);
			const bucketName = "ryot-reminder-recovery";
			const infrastructure = yield* startCoreTestInfrastructure({ bucketName });
			const port = yield* Effect.promise(() => getPort());
			const env = buildApiEnv({
				port,
				extraEnv: harnessApiEnv,
				s3BucketName: bucketName,
				label: "Reminder recovery",
				dbUrl: infrastructure.dbUrl,
				redisUrl: infrastructure.redisUrl,
				s3Endpoint: infrastructure.s3Endpoint,
				frontendUrl: `http://127.0.0.1:${port}`,
			});
			const original = yield* startApiProcess(env, "Reminder recovery before crash");
			yield* Effect.addFinalizer(() => Deferred.succeed(response, Response.json({ ok: true })));
			const { client } = yield* createAuthenticatedClient(original.target);
			for (const path of ["accepted", "held"]) {
				yield* createNotificationChannel(client, {
					channelSpecifics: { key: "local", kind: "apprise", baseUrl: `${provider.url}/${path}` },
				});
			}
			const entity = yield* createCollection(client);
			const created = yield* createReminder(client, {
				...(yield* reminderSubmission),
				replaces: null,
				timezone: "UTC",
				entityId: entity.id,
				parentEntityId: null,
				message: "One occurrence across a crash",
				dueAt: DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, 2_000)),
			});
			yield* pollUntil(
				"one completed channel and one in-flight request",
				Effect.gen(function* () {
					yield* runReminderScan(client);
					const deliveries = yield* executeRyotQLRecipe(
						client,
						reminderDeliveriesRecipe({ limit: 100, reminderId: created.id }),
					);
					return deliveries.items.some(({ status }) => status === "accepted") &&
						deliveries.items.some(({ status }) => status === "sending") &&
						provider.requests.length === 2
						? true
						: null;
				}),
			);
			yield* Effect.sync(() => original.kill("SIGKILL"));
			yield* Effect.promise(() => original.exited);
			yield* startApiProcess(
				{ ...env, SERVER_LOG_FILE: `${env.SERVER_LOG_FILE}.restart` },
				"Reminder recovery after crash",
			);
			const settled = yield* pollUntil(
				"recovered reminder result",
				Effect.gen(function* () {
					yield* runReminderScan(client);
					const row = (yield* listReminders(client)).items.find(({ id }) => id === created.id);
					return row?.state === "settled" ? row : null;
				}),
			);
			expect(settled.outcome).toBe("unknown");
			const deliveries = yield* executeRyotQLRecipe(
				client,
				reminderDeliveriesRecipe({ limit: 100, reminderId: created.id }),
			);
			expect(deliveries.items.map(({ status }) => status).sort()).toEqual(["accepted", "unknown"]);
			expect(provider.requests.filter(({ path }) => path.includes("/held/"))).toHaveLength(1);
			expect(provider.requests.filter(({ path }) => path.includes("/accepted/"))).toHaveLength(1);
			yield* Deferred.succeed(response, Response.json({ ok: true }));
			yield* runReminderScan(client);
			expect(provider.requests).toHaveLength(2);
		}),
	);
});
