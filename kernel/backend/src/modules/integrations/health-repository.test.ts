import { expect, layer } from "@effect/vitest";
import { IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";

import { IntegrationsRepository } from "./repository";

const services = IntegrationsRepository.layer.pipe(
	Layer.provideMerge(PluginConfigEncryptionKey.layer),
	Layer.provide(makeAppConfigLayer()),
	Layer.provideMerge(isolatedDatabaseLayer("integration_health")),
	Layer.provideMerge(makeConfigProviderLayer()),
);

const seedIntegration = Effect.fn(function* (id: string) {
	const database = yield* DatabaseSession;
	const userId = UserId.make(id);
	const integrationId = IntegrationId.make(`${id}-integration`);
	yield* database.run((db) =>
		db.insert(tables.user).values({ name: id, id: userId, email: `${id}@example.test` }),
	);
	yield* database.run((db) =>
		db
			.insert(tables.integration)
			.values({
				userId,
				lot: "sink",
				id: integrationId,
				provider: "data-json",
				providerSpecifics: {},
				clientProviderSpecifics: {},
				webhookToken: `${id}-webhook`,
				extraSettings: { disableOnContinuousErrors: true },
			}),
	);
	return { userId, integrationId };
});

layer(services)((test) => {
	test.effect(
		"ignores setup deliveries while retaining successful and cancelled streak boundaries",
		() =>
			Effect.gen(function* () {
				const owner = yield* seedIntegration("health-history");
				const database = yield* DatabaseSession;
				const repository = yield* IntegrationsRepository;
				const timestamp = DateTime.makeUnsafe("2026-09-23T00:00:00.000Z");
				const records = [
					{ status: "failed", failureReason: { code: "source-fetch-failed" } },
					{ status: "failed", failureReason: { code: "provider-details-failed" } },
					{ status: "completed" },
					{ status: "failed", failureReason: { code: "database-commit-failed" } },
					{ status: "failed", failureReason: { code: "event-policy-failed" } },
					{ status: "cancelled" },
					{ status: "expired", expiryReason: "setup-deadline-expired" },
					{ status: "blocked", blockReasons: [{ key: "token", code: "configuration-required" }] },
					{ status: "failed", failureReason: { code: "integration-disabled" } },
					{ status: "failed", failureReason: { code: "pro-key-required" } },
					{
						status: "failed",
						failureReason: { code: "queue-unavailable", operation: "integration-webhook" },
					},
				] satisfies Partial<typeof tables.importRun.$inferInsert>[];
				for (const [index, record] of records.entries()) {
					const createdAt = DateTime.toDateUtc(DateTime.add(timestamp, { seconds: index }));
					yield* database.run((db) =>
						db
							.insert(tables.importRun)
							.values({
								...owner,
								...record,
								createdAt,
								source: "data-json",
								integrationLot: "sink",
								accountGeneration: "test-account-generation",
								blockDeadline:
									record.status === "blocked"
										? DateTime.toDateUtc(DateTime.add(DateTime.makeUnsafe(createdAt), { days: 7 }))
										: null,
							}),
					);
				}
				expect(yield* repository.listRecentHealthStatuses(owner)).toEqual([
					{ status: "cancelled" },
					{ status: "failed" },
					{ status: "failed" },
					{ status: "completed" },
					{ status: "failed" },
				]);
				expect(
					yield* repository.listRecentHealthStatuses({
						...owner,
						userId: UserId.make("other-owner"),
					}),
				).toEqual([]);
			}),
	);

	test.effect(
		"keeps the actual newest successful finish time during replay and out-of-order sink completion",
		() =>
			Effect.gen(function* () {
				const owner = yield* seedIntegration("health-finish");
				const repository = yield* IntegrationsRepository;
				const older = DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-23T12:00:00.000Z"));
				const newer = DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-23T13:00:00.000Z"));
				yield* repository.recordRunFinished({ ...owner, finishedAt: newer });
				yield* repository.recordRunFinished({ ...owner, finishedAt: older });
				yield* repository.recordRunFinished({ ...owner, finishedAt: newer });
				yield* repository.recordRunFinished({
					...owner,
					userId: UserId.make("other-owner"),
					finishedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-24T00:00:00.000Z")),
				});
				expect((yield* repository.getForUser(owner))?.lastFinishedAt).toBe(newer.toISOString());
			}),
	);
});
