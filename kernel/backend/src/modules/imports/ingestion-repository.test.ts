import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type {
	IngestionBatch,
	IngestionCapture,
	IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";

import { ingestionTestSource } from "./ingestion.test-support";
import { ImportsRepository } from "./repository";

const userId = UserId.make("ingestion-owner");
const integrationId = IntegrationId.make("ingestion-integration");
const acceptedAt = new Date("2026-10-01T00:00:00.000Z");
const deadline = new Date("2026-10-08T00:00:00.000Z");
const pins = {
	scriptId: "script",
	pluginRevisionId: null,
	executionId: "source-owner",
	pluginConfigRevisionId: null,
};
const batchOwner = {
	executionId: "batch-owner",
	workflowName: "ProcessGenericImportChunksWorkflow",
};
const plan = { selection: {}, operation: "collect" };
const reasons = [{ key: "endpoint", code: "configuration-required" as const }];

const seed = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({
					id: userId,
					name: "Owner",
					accountGeneration: "generation",
					email: "ingestion@example.test",
				}),
		);
		yield* session.run((db) =>
			db
				.insert(tables.integration)
				.values({
					userId,
					lot: "sink",
					id: integrationId,
					provider: "data-json",
					providerSpecifics: {},
					clientProviderSpecifics: {},
					webhookToken: "ingestion-webhook",
					extraSettings: { disableOnContinuousErrors: false },
				}),
		);
	}),
);

const blockedRun = Effect.fn(function* () {
	const runId = yield* (yield* DatabaseSession).transaction(
		(yield* ImportsRepository).createBlockedRun({
			userId,
			acceptedAt,
			integrationId,
			inputSummary: {},
			source: "data-json",
			blockReasons: reasons,
			pluginInstallationId: null,
			accountGeneration: { userId, token: "generation" },
		}),
	);
	return {
		runId,
		userId,
		accountGeneration: { userId, token: "generation" },
	} satisfies IngestionScope;
});

const runningRun = Effect.fn(function* () {
	const scope = yield* blockedRun();
	const repository = yield* ImportsRepository;
	expect(yield* repository.releaseBlocked({ plan, pins, scope, now: acceptedAt })).toBe(true);
	expect(yield* repository.startIngestion({ scope, startedAt: acceptedAt })).toBe(true);
	return scope;
});

const capture: IngestionCapture = {
	ordinal: 0,
	state: "captured",
	phase: "collection",
	id: "source-page-0",
	checkpoint: { next: "page-1" },
	payload: { byteSize: 42, checksum: "checksum", locator: "opaque-object" },
};
const batch: IngestionBatch = {
	ordinal: 0,
	summary: [],
	id: "batch-0",
	state: "pending",
	captureId: capture.id,
	inputFingerprint: "batch-input",
};
const summary = [
	{
		unit: "plays",
		recordKind: "listening-event",
		counts: { created: 2, updated: 0, skipped: 3, unchanged: 1, unsuccessful: 1 },
	},
];

layer(
	seed.pipe(
		Layer.provideMerge(IntegrationsRepository.layer),
		Layer.provideMerge(
			PluginInstallationRepository.layer.pipe(Layer.provideMerge(PluginConfigEncryptionKey.layer)),
		),
		Layer.provideMerge(ImportsRepository.layer),
		Layer.provideMerge(isolatedDatabaseLayer("ingestion_repository")),
	),
)((test) => {
	test.effect("encrypts prepared release state and binds it to its ingestion scope", () =>
		Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const repository = yield* ImportsRepository;
			const scope = yield* blockedRun();
			const releasePlan = { ...plan, selection: { provider: "tmdb" } };
			const marker = "prepared-release-private-value";
			const preparedRelease = {
				plan: releasePlan,
				requiresProKey: true,
				state: {
					...ingestionTestSource,
					sourcePayload: { credential: marker },
					executionSettings: {
						userSettings: { timezone: "Pacific/Auckland" },
						integration: {
							syncOwnership: true,
							minimumProgress: 10,
							maximumProgress: 90,
							providerSpecifics: { token: marker, provider: "tmdb" },
						},
					},
				},
			};
			const releasePins = {
				executionId: `${scope.runId}-import`,
				scriptId: ingestionTestSource.workflowScriptId,
				pluginRevisionId: ingestionTestSource.pluginRevision.revisionId,
				pluginConfigRevisionId: ingestionTestSource.pluginRevision.configRevisionId,
			};

			yield* database.transaction(
				repository.reserveIngestionPins(scope, releasePins, preparedRelease),
			);
			const [storedRun] = yield* database.run((db) =>
				db
					.select({ preparedRelease: tables.importRun.preparedRelease })
					.from(tables.importRun)
					.where(eq(tables.importRun.id, scope.runId))
					.limit(1),
			);
			assert(storedRun?.preparedRelease);
			expect(storedRun.preparedRelease).toMatchObject({
				plan: releasePlan,
				requiresProKey: true,
				state: {
					keyId: expect.any(String),
					nonce: expect.any(String),
					ciphertext: expect.any(String),
				},
			});
			expect(stableStringify(storedRun.preparedRelease)).not.toContain(marker);
			expect(stableStringify(storedRun.preparedRelease)).not.toContain("Pacific/Auckland");
			expect(yield* repository.getPreparedRelease(scope)).toEqual(preparedRelease);

			const otherScope = yield* blockedRun();
			yield* database.run((db) =>
				db
					.update(tables.importRun)
					.set({ pins: releasePins, preparedRelease: storedRun.preparedRelease })
					.where(eq(tables.importRun.id, otherScope.runId)),
			);
			const crossScope = yield* Effect.exit(repository.getPreparedRelease(otherScope));
			expect(crossScope._tag).toBe("Failure");
		}),
	);

	test.effect(
		"arbitrates competing deliveries until committed application settles and releases failed owners",
		() =>
			Effect.gen(function* () {
				const repository = yield* ImportsRepository;
				const first = yield* blockedRun();
				const second = yield* blockedRun();
				for (const scope of [first, second]) {
					expect(yield* repository.releaseBlocked({ plan, pins, scope, now: acceptedAt })).toBe(
						true,
					);
				}
				const starts = yield* Effect.forEach(
					[first, second],
					(scope) =>
						repository.startIntegrationIngestion({ scope, integrationId, startedAt: acceptedAt }),
					{ concurrency: "unbounded" },
				);
				expect(starts.filter(Boolean)).toHaveLength(1);
				const winner = starts[0] ? first : second;
				const waiting = starts[0] ? second : first;
				expect(
					yield* repository.startIntegrationIngestion({
						scope: winner,
						integrationId,
						startedAt: acceptedAt,
					}),
				).toBe(true);
				expect(
					yield* repository.startIntegrationIngestion({
						integrationId,
						scope: waiting,
						startedAt: acceptedAt,
					}),
				).toBe(false);
				expect(
					yield* repository.settleIngestion({
						scope: winner,
						status: "failed",
						finishedAt: acceptedAt,
					}),
				).toBe(true);
				expect(
					yield* repository.startIntegrationIngestion({
						integrationId,
						scope: waiting,
						startedAt: acceptedAt,
					}),
				).toBe(true);
				expect(
					yield* repository.settleIngestion({
						scope: waiting,
						status: "completed",
						finishedAt: acceptedAt,
					}),
				).toBe(true);
			}),
	);
	test.effect(
		"expiry and cancellation retire a prepared release without extending its acceptance deadline",
		() =>
			Effect.gen(function* () {
				const database = yield* DatabaseSession;
				const repository = yield* ImportsRepository;
				const retained = {
					...pins,
					scriptId: ingestionTestSource.workflowScriptId,
					pluginRevisionId: ingestionTestSource.pluginRevision.revisionId,
					pluginConfigRevisionId: ingestionTestSource.pluginRevision.configRevisionId,
				};
				for (const terminal of ["expired", "cancelled"] as const) {
					const scope = yield* blockedRun();
					yield* database.transaction(
						repository.reserveIngestionPins(scope, retained, {
							plan,
							requiresProKey: false,
							state: ingestionTestSource,
						}),
					);
					if (terminal === "expired") {
						expect(yield* repository.expireBlocked({ scope, now: deadline })).toBe(true);
					} else {
						yield* repository.cancelIngestion(scope);
						yield* repository.settleIngestion({
							scope,
							status: "cancelled",
							finishedAt: acceptedAt,
						});
					}
					expect(
						yield* repository.releaseBlocked({ plan, scope, pins: retained, now: acceptedAt }),
					).toBe(false);
					expect((yield* repository.getIngestionRun(scope))?.blockDeadline).toBe(
						deadline.toISOString(),
					);
					expect(yield* repository.releaseIngestionPins(scope)).toBe(true);
					expect(yield* repository.getPreparedRelease(scope)).toBeNull();
				}
			}),
	);
	test.effect(
		"retains the prepared release atomically, rejects replanning, and preserves the original deadline",
		() =>
			Effect.gen(function* () {
				const scope = yield* blockedRun();
				const database = yield* DatabaseSession;
				const repository = yield* ImportsRepository;
				const retained = {
					...pins,
					scriptId: ingestionTestSource.workflowScriptId,
					pluginRevisionId: ingestionTestSource.pluginRevision.revisionId,
					pluginConfigRevisionId: ingestionTestSource.pluginRevision.configRevisionId,
				};
				const prepared = { plan, requiresProKey: false, state: ingestionTestSource };
				yield* database.transaction(repository.reserveIngestionPins(scope, retained, prepared));
				expect(yield* repository.getPreparedRelease(scope)).toEqual(prepared);
				expect(
					yield* repository.releaseBlocked({
						scope,
						pins: retained,
						now: acceptedAt,
						plan: { selection: {}, operation: "changed" },
					}),
				).toBe(false);
				assertExitFails(
					yield* Effect.exit(
						database.transaction(
							repository.reserveIngestionPins(
								scope,
								{ ...retained, pluginConfigRevisionId: "changed" },
								prepared,
							),
						),
					),
					new DbError({ message: "Ingestion pin reservation changed" }),
				);
				expect(
					yield* repository.releaseBlocked({ plan, scope, pins: retained, now: acceptedAt }),
				).toBe(true);
				expect((yield* repository.getIngestionRun(scope))?.blockDeadline).toBe(
					deadline.toISOString(),
				);
			}),
	);
	test.effect(
		"fences admission and release before integration deletion even when admission raced retirement",
		() =>
			Effect.gen(function* () {
				const database = yield* DatabaseSession;
				const repository = yield* ImportsRepository;
				const integrations = yield* IntegrationsRepository;
				const id = IntegrationId.make("retiring-integration");
				yield* database.run((db) =>
					db
						.insert(tables.integration)
						.values({
							id,
							userId,
							lot: "sink",
							provider: "data-json",
							providerSpecifics: {},
							clientProviderSpecifics: {},
							webhookToken: "retiring-token",
							extraSettings: { disableOnContinuousErrors: false },
						}),
				);
				const admit = repository.createBlockedRun({
					userId,
					acceptedAt,
					inputSummary: {},
					integrationId: id,
					source: "data-json",
					blockReasons: reasons,
					pluginInstallationId: null,
					accountGeneration: { userId, token: "generation" },
				});
				const accepted = yield* database.transaction(admit);
				const acceptedScope = {
					userId,
					runId: accepted,
					accountGeneration: { userId, token: "generation" },
				};
				const reservation = {
					ordinal: 0,
					checkpoint: null,
					id: "released-page",
					recoveryBytes: "YQ==",
					captureState: "sealed" as const,
					inputFingerprint: "fingerprint",
					capturePhase: "collection" as const,
					payload: { byteSize: 1, locator: "owned", checksum: "checksum" },
				};
				const unrelated = yield* blockedRun();
				yield* database.transaction(
					Effect.gen(function* () {
						yield* repository.reservePayload(acceptedScope, reservation);
						yield* repository.reservePayload(acceptedScope, {
							...reservation,
							ordinal: 1,
							id: "live-page",
						});
						yield* repository.reservePayload(unrelated, reservation);
					}),
				);
				yield* repository.releasePayloadReservation(acceptedScope, reservation.id);
				yield* repository.releasePayloadReservation(unrelated, reservation.id);
				const [admission] = yield* Effect.all(
					[
						Effect.exit(database.transaction(admit)),
						database.transaction(integrations.beginRetirement({ userId, integrationId: id })),
					],
					{ concurrency: "unbounded" },
				);
				assertExitFails(
					yield* Effect.exit(database.transaction(admit)),
					new DbError({ message: "Integration ingestion owner has retired" }),
				);
				assertExitFails(
					yield* Effect.exit(integrations.deleteForUser({ userId, integrationId: id })),
					new DbError({ message: "Integration retirement cleanup is incomplete" }),
				);
				expect(
					yield* repository.releaseBlocked({
						pins,
						plan,
						now: acceptedAt,
						scope: { userId, runId: accepted, accountGeneration: { userId, token: "generation" } },
					}),
				).toBe(false);
				if (admission._tag === "Success") {
					const scope = {
						userId,
						runId: admission.value,
						accountGeneration: { userId, token: "generation" },
					};
					expect(yield* repository.releaseBlocked({ pins, plan, scope, now: acceptedAt })).toBe(
						false,
					);
					const retired = yield* database.transaction(
						repository.retireRuns({ userId, integrationId: id }),
					);
					expect(retired.map((run) => run.id)).toContain(admission.value);
					expect((yield* repository.getIngestionRun(scope))?.status).toBe("cancelling");
				}
				for (const run of yield* database.transaction(
					repository.retireRuns({ userId, integrationId: id }),
				)) {
					yield* repository.settleIngestion({
						status: "cancelled",
						finishedAt: acceptedAt,
						scope: {
							userId,
							runId: ImportRunId.make(run.id),
							accountGeneration: { userId, token: "generation" },
						},
					});
				}
				yield* integrations.deleteForUser({
					integrationId: id,
					userId: UserId.make("other-owner"),
				});
				expect(
					yield* repository.getPayloadReservation(acceptedScope, reservation.id),
				).not.toBeNull();
				assertExitFails(
					yield* Effect.exit(integrations.deleteForUser({ userId, integrationId: id })),
					new DbError({ message: "Integration retirement cleanup is incomplete" }),
				);
				expect(
					yield* repository.getPayloadReservation(acceptedScope, reservation.id),
				).not.toBeNull();
				expect(yield* repository.getPayloadReservation(acceptedScope, "live-page")).toMatchObject({
					released: false,
					payload: reservation.payload,
				});
				yield* repository.releasePayloadReservation(acceptedScope, "live-page");
				yield* integrations.deleteForUser({ userId, integrationId: id });
				expect(yield* integrations.getForUser({ userId, integrationId: id })).toBeNull();
				expect(yield* repository.getIngestionRun(acceptedScope)).toBeNull();
				expect(yield* repository.getPayloadReservation(unrelated, reservation.id)).toMatchObject({
					released: true,
				});
			}),
	);
	test.effect(
		"fences manual admission before installation cleanup and retains its locator owners",
		() =>
			Effect.gen(function* () {
				const database = yield* DatabaseSession;
				const repository = yield* ImportsRepository;
				const installations = yield* PluginInstallationRepository;
				yield* database.run((db) =>
					db
						.insert(tables.plugin)
						.values({ status: "inactive", id: "retiring-plugin", slug: "retiring-plugin" }),
				);
				yield* database.run((db) =>
					db
						.insert(tables.pluginInstallation)
						.values({ userId, id: "retiring-installation", pluginId: "retiring-plugin" }),
				);
				const admit = repository.createManualRun({
					userId,
					inputSummary: {},
					source: "fixture",
					pluginInstallationId: "retiring-installation",
				});
				const [admission] = yield* Effect.all(
					[
						Effect.exit(database.transaction(admit)),
						database.transaction(
							installations.beginIngestionRetirement(userId, "retiring-installation"),
						),
					],
					{ concurrency: "unbounded" },
				);
				assertExitFails(
					yield* Effect.exit(database.transaction(admit)),
					new DbError({ message: "Installation ingestion owner has retired" }),
				);
				const retired = yield* database.transaction(
					repository.retireRuns({ userId, pluginInstallationId: "retiring-installation" }),
				);
				if (admission._tag === "Success") {
					expect(retired.map((run) => run.id)).toContain(admission.value.id);
				}
			}),
	);
	test.effect(
		"releases once, keeps the fixed deadline, and does not expire a released delivery",
		() =>
			Effect.gen(function* () {
				const scope = yield* blockedRun();
				const repository = yield* ImportsRepository;
				const releases = yield* Effect.all(
					[
						repository.releaseBlocked({ plan, pins, scope, now: acceptedAt }),
						repository.releaseBlocked({ plan, pins, scope, now: acceptedAt }),
					],
					{ concurrency: "unbounded" },
				);
				expect(releases.filter(Boolean)).toHaveLength(1);
				expect(yield* repository.expireBlocked({ scope, now: deadline })).toBe(false);
				const run = yield* repository.getIngestionRun(scope);
				expect(run).toMatchObject({
					plan,
					pins,
					blockReasons: [],
					status: "pending",
					blockDeadline: deadline.toISOString(),
				});
				expect(yield* repository.startIngestion({ scope, startedAt: deadline })).toBe(true);
				expect(yield* repository.startIngestion({ scope, startedAt: deadline })).toBe(false);
			}),
	);

	test.effect("expiry wins over release at the exact deadline and records a setup reason", () =>
		Effect.gen(function* () {
			const scope = yield* blockedRun();
			const repository = yield* ImportsRepository;
			expect(yield* repository.expireBlocked({ scope, now: acceptedAt })).toBe(false);
			yield* (yield* DatabaseSession).transaction(repository.publishCapture(scope, capture));
			const results = yield* Effect.all(
				[
					repository.releaseBlocked({ plan, pins, scope, now: deadline }),
					repository.expireBlocked({ scope, now: deadline }),
				],
				{ concurrency: "unbounded" },
			);
			expect(results).toEqual([false, true]);
			expect(yield* repository.getIngestionRun(scope)).toMatchObject({
				status: "expired",
				blockReasons: reasons,
				finishedAt: deadline.toISOString(),
				expiryReason: "setup-deadline-expired",
			});
			expect(yield* repository.cancelIngestion(scope)).toBe(false);
			expect(yield* repository.releaseCapture(scope, capture.id)).toBe(true);
		}),
	);

	test.effect("selects one winner between blocked cancellation and expiry", () =>
		Effect.gen(function* () {
			const scope = yield* blockedRun();
			const repository = yield* ImportsRepository;
			const winners = yield* Effect.all(
				[repository.cancelIngestion(scope), repository.expireBlocked({ scope, now: deadline })],
				{ concurrency: "unbounded" },
			);
			expect(winners.filter(Boolean)).toHaveLength(1);
			expect(yield* repository.releaseBlocked({ plan, pins, scope, now: acceptedAt })).toBe(false);
			expect(yield* repository.startIngestion({ scope, startedAt: acceptedAt })).toBe(false);
		}),
	);

	test.effect("arbitrates release against cancellation and start against cancellation", () =>
		Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const scope = yield* blockedRun();
			const results = yield* Effect.all(
				[
					repository.releaseBlocked({ plan, pins, scope, now: acceptedAt }),
					repository.cancelIngestion(scope),
				],
				{ concurrency: "unbounded" },
			);
			expect(results[1]).toBe(true);
			expect(yield* repository.getIngestionRun(scope)).toMatchObject({ status: "cancelling" });
			const pending = yield* blockedRun();
			yield* repository.releaseBlocked({ plan, pins, scope: pending, now: acceptedAt });
			const starts = yield* Effect.all(
				[
					repository.startIngestion({ scope: pending, startedAt: acceptedAt }),
					repository.cancelIngestion(pending),
				],
				{ concurrency: "unbounded" },
			);
			expect(starts[1]).toBe(true);
			expect(yield* repository.getIngestionRun(pending)).toMatchObject({ status: "cancelling" });
			expect(yield* repository.startIngestion({ scope: pending, startedAt: acceptedAt })).toBe(
				false,
			);
		}),
	);

	test.effect("fences other users and retired generations on reads and transitions", () =>
		Effect.gen(function* () {
			const scope = yield* blockedRun();
			const repository = yield* ImportsRepository;
			for (const denied of [
				{ ...scope, userId: UserId.make("other-user") },
				{ ...scope, accountGeneration: { userId, token: "retired" } },
				{ ...scope, accountGeneration: { token: "generation", userId: UserId.make("other-user") } },
			]) {
				expect(yield* repository.getIngestionRun(denied)).toBeNull();
				expect(
					yield* repository.releaseBlocked({ plan, pins, scope: denied, now: acceptedAt }),
				).toBe(false);
				expect(yield* repository.expireBlocked({ scope: denied, now: deadline })).toBe(false);
				expect(yield* repository.cancelIngestion(denied)).toBe(false);
			}
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "replacement" })
					.where(eq(tables.user.id, userId)),
			);
			expect(yield* repository.startIngestion({ scope, startedAt: acceptedAt })).toBe(false);
			expect(yield* repository.getIngestionRun(scope)).toBeNull();
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "generation" })
					.where(eq(tables.user.id, userId)),
			);
		}),
	);

	test.effect(
		"publishes immutable captures, rejects ordinal collisions, and seals collection",
		() =>
			Effect.gen(function* () {
				const scope = yield* runningRun();
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				expect(yield* session.transaction(repository.publishCapture(scope, capture))).toBe(true);
				expect(yield* session.transaction(repository.publishCapture(scope, capture))).toBe(false);
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.publishCapture(scope, {
								...capture,
								payload: { byteSize: 1, locator: "changed", checksum: "changed" },
							}),
						),
					))._tag,
				).toBe("Failure");
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.publishCapture(scope, { ...capture, id: "same-ordinal" }),
						),
					))._tag,
				).toBe("Failure");
				yield* session.transaction(repository.sealCollection(scope));
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.publishCapture(scope, { ...capture, ordinal: 1, id: "late-page" }),
						),
					))._tag,
				).toBe("Failure");
				expect(yield* repository.listCaptures(scope)).toEqual([{ data: capture }]);
			}),
	);

	test.effect(
		"projects batch results once while cancelling and preserves them through terminal cleanup",
		() =>
			Effect.gen(function* () {
				const scope = yield* runningRun();
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				yield* session.transaction(repository.publishCapture(scope, capture));
				yield* session.transaction(repository.registerBatch(scope, batch, [], batchOwner));
				expect(
					yield* session.transaction(repository.registerBatch(scope, batch, [], batchOwner)),
				).toBe(false);
				expect(
					yield* session.transaction(repository.advanceBatch(scope, batch.id, "applying")),
				).toBe(false);
				expect(
					yield* session.transaction(repository.advanceBatch(scope, batch.id, "preparing")),
				).toBe(true);
				expect(
					yield* session.transaction(repository.advanceBatch(scope, batch.id, "applying")),
				).toBe(true);
				expect(
					yield* session.transaction(repository.advanceBatch(scope, batch.id, "preparing")),
				).toBe(false);
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.registerBatch(
								scope,
								{ ...batch, inputFingerprint: "changed" },
								[],
								batchOwner,
							),
						),
					))._tag,
				).toBe("Failure");
				expect(yield* repository.releaseCapture(scope, capture.id)).toBe(false);
				expect(yield* repository.cancelIngestion(scope)).toBe(true);
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.publishCapture(scope, { ...capture, ordinal: 1, id: "late" }),
						),
					))._tag,
				).toBe("Failure");
				const applied = { ...batch, summary, state: "applied" as const };
				expect(yield* session.transaction(repository.projectBatch(scope, applied))).toBe(true);
				expect(yield* session.transaction(repository.projectBatch(scope, applied))).toBe(false);
				expect(
					(yield* Effect.exit(
						session.transaction(repository.projectBatch(scope, { ...applied, summary: [] })),
					))._tag,
				).toBe("Failure");
				expect(
					yield* repository.settleIngestion({ scope, status: "completed", finishedAt: deadline }),
				).toBe(false);
				expect(
					yield* repository.settleIngestion({ scope, status: "cancelled", finishedAt: deadline }),
				).toBe(true);
				expect(yield* repository.releaseCapture(scope, capture.id)).toBe(true);
				expect(yield* repository.releaseCapture(scope, capture.id)).toBe(true);
				expect(yield* repository.listCaptures(scope)).toEqual([
					{ data: { ...capture, payload: null, state: "released" } },
				]);
				expect(yield* repository.getIngestionRun(scope)).toMatchObject({
					summary,
					status: "cancelled",
				});
			}),
	);

	test.effect(
		"keeps source-unit activities monotonic and enforces run-local parent and capture references",
		() =>
			Effect.gen(function* () {
				const scope = yield* runningRun();
				const other = yield* runningRun();
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				const activity = {
					id: "read",
					wait: null,
					completed: 1,
					batchId: null,
					parentId: null,
					exactTotal: null,
					unit: "source-pages",
					kind: "reading" as const,
					state: "running" as const,
					lastAdvancedAt: acceptedAt.toISOString(),
				};
				yield* session.transaction(repository.putActivity(scope, activity));
				expect(
					(yield* Effect.exit(
						session.transaction(repository.putActivity(scope, { ...activity, unit: "plays" })),
					))._tag,
				).toBe("Failure");
				expect(
					(yield* Effect.exit(
						session.transaction(repository.putActivity(scope, { ...activity, completed: 0 })),
					))._tag,
				).toBe("Failure");
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.putActivity(scope, { ...activity, completed: 2, exactTotal: 1 }),
						),
					))._tag,
				).toBe("Failure");
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.putActivity(other, { ...activity, id: "child", parentId: activity.id }),
						),
					))._tag,
				).toBe("Failure");
				yield* session.transaction(
					repository.putActivity(scope, { ...activity, completed: 2, exactTotal: 2 }),
				);
				yield* session.transaction(repository.publishCapture(scope, capture));
				expect(
					(yield* Effect.exit(
						session.transaction(repository.registerBatch(other, batch, [], batchOwner)),
					))._tag,
				).toBe("Failure");
				expect(yield* repository.getIngestionRun(scope)).toMatchObject({
					activities: [{ ...activity, completed: 2, exactTotal: 2 }],
				});
				expect(yield* repository.deleteIngestionReport(scope)).toBe(false);
				yield* repository.cancelIngestion(scope);
				yield* repository.settleIngestion({ scope, status: "cancelled", finishedAt: deadline });
				yield* repository.releaseCapture(scope, capture.id);
				expect(yield* repository.releaseIngestionPins(scope)).toBe(true);
				expect(yield* repository.deleteIngestionReport(scope)).toBe(true);
				expect(yield* repository.listCaptures(scope)).toEqual([]);
				expect(yield* repository.getIngestionRun(scope)).toBeNull();
			}),
	);

	test.effect(
		"keeps operation identity independent of batch identity and requires committed receipt evidence",
		() =>
			Effect.gen(function* () {
				const scope = yield* runningRun();
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				const outcome = {
					reason: null,
					unit: "plays",
					recordKind: "event",
					receiptId: "receipt",
					result: "created" as const,
					operationId: "record-7:event-0",
					inputFingerprint: "operation-input",
					attribution: {
						recordId: "record-7",
						sourceLabel: "Track",
						sourceIdentifier: "source-id",
					},
				};
				expect(
					(yield* Effect.exit(session.transaction(repository.recordOutcome(scope, outcome))))._tag,
				).toBe("Failure");
				yield* session.run((db) =>
					db
						.insert(tables.mutationReceipt)
						.values({
							result: {},
							dispatch: {},
							id: "receipt",
							receiptType: "item",
							ownerUserId: userId,
							scopeUserId: userId,
							executionId: "child",
							mutationScope: "user",
							commandKind: "event:create",
							rootExecutionId: scope.runId,
							itemIdentity: outcome.operationId,
							inputFingerprint: outcome.inputFingerprint,
							accountGeneration: scope.accountGeneration,
						}),
				);
				expect(yield* session.transaction(repository.recordOutcome(scope, outcome))).toBe(true);
				expect(yield* session.transaction(repository.recordOutcome(scope, outcome))).toBe(false);
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.recordOutcome(scope, { ...outcome, inputFingerprint: "changed" }),
						),
					))._tag,
				).toBe("Failure");
				expect(yield* repository.getOutcome(scope, outcome.operationId)).toEqual(outcome);
				const issue = {
					recordKind: "event",
					id: "record-7:warning",
					severity: "warning" as const,
					operationId: outcome.operationId,
					attribution: outcome.attribution,
					reason: { key: null, code: "provider-unavailable" },
				};
				expect(yield* session.transaction(repository.recordIssue(scope, issue))).toBe(true);
				expect(yield* session.transaction(repository.recordIssue(scope, issue))).toBe(false);
				expect(yield* repository.listIssues({ scope, limit: 10 })).toEqual([{ data: issue }]);
				expect(yield* repository.listIssues({ scope, limit: 10, after: issue.id })).toEqual([]);
				const run = yield* repository.getIngestionRun(scope);
				assert(run);
				expect(run.summary).toEqual([]);
			}),
	);
	test.effect(
		"seals collected inputs while allowing prepared application captures and requires their applied batches",
		() =>
			Effect.gen(function* () {
				const scope = yield* runningRun();
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				const sourceCapture = { ...capture, ordinal: 64 };
				yield* session.transaction(repository.publishCapture(scope, sourceCapture));
				yield* session.transaction(repository.sealCollection(scope));
				expect(yield* repository.isIngestionApplied(scope)).toBe(true);
				const prepared = { ...sourceCapture, id: "prepared", phase: "application" as const };
				expect(yield* session.transaction(repository.publishCapture(scope, prepared))).toBe(true);
				expect(yield* repository.pageCaptures(scope, null, 100)).toEqual([{ data: sourceCapture }]);
				expect(yield* repository.isIngestionApplied(scope)).toBe(false);
				const preparedBatch = { ...batch, captureId: prepared.id };
				yield* session.transaction(repository.registerBatch(scope, preparedBatch, [], batchOwner));
				yield* session.transaction(
					repository.projectBatch(scope, { ...preparedBatch, state: "applied" }),
				);
				expect(yield* repository.isIngestionApplied(scope)).toBe(true);
			}),
	);
	test.effect(
		"arbitrates completed admission against rollback without replacing a retained pin",
		() =>
			Effect.gen(function* () {
				const scope = yield* blockedRun();
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				yield* repository.releaseBlocked({ plan, pins, scope, now: acceptedAt });
				expect(yield* repository.claimAdmissionAbort(scope)).toBe(false);
				expect((yield* repository.getIngestionRun(scope))?.pins).toEqual(pins);
				const pending = yield* session.transaction(
					repository.createManualRun({
						userId,
						inputSummary: {},
						source: "fixture",
						pluginInstallationId: null,
					}),
				);
				const pendingScope = { ...scope, runId: pending.id };
				yield* session.transaction(repository.reserveIngestionPins(pendingScope, pins));
				expect(yield* repository.claimAdmissionAbort(pendingScope)).toBe(true);
				expect(yield* repository.pinIngestion({ plan, pins, scope: pendingScope })).toBe(false);
				expect(
					(yield* Effect.exit(
						session.transaction(repository.reserveIngestionPins(pendingScope, pins)),
					))._tag,
				).toBe("Failure");
			}),
	);
	test.effect(
		"keeps the first durable reservation across concurrent encrypted-byte proposals",
		() =>
			Effect.gen(function* () {
				const scope = yield* runningRun();
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				const proposal = {
					ordinal: 33,
					id: "envelope",
					checkpoint: null,
					recoveryBytes: "ZW5jcnlwdGVk",
					captureState: "sealed" as const,
					inputFingerprint: "same-plaintext",
					capturePhase: "collection" as const,
					payload: { byteSize: 9, locator: "original-object", checksum: "original-ciphertext" },
				};
				const values = yield* Effect.all(
					[
						session.transaction(repository.reservePayload(scope, proposal)),
						session.transaction(
							repository.reservePayload(scope, {
								...proposal,
								payload: {
									...proposal.payload,
									locator: "other-object",
									checksum: "other-ciphertext",
								},
							}),
						),
					],
					{ concurrency: 2 },
				);
				expect(values[0].payload).toEqual(values[1].payload);
				expect(yield* repository.listPayloadReservations(scope)).toHaveLength(1);
				expect(
					(yield* Effect.exit(
						session.transaction(
							repository.reservePayload(scope, {
								...proposal,
								inputFingerprint: "changed-plaintext",
							}),
						),
					))._tag,
				).toBe("Failure");
			}),
	);
	test.effect(
		"reuses the original Data submission under races and preserves changed-document conflict evidence",
		() =>
			Effect.gen(function* () {
				const repository = yield* ImportsRepository;
				const session = yield* DatabaseSession;
				const input = {
					userId,
					integrationId,
					inputSummary: {},
					digest: "document",
					uploadTokenHash: null,
					submissionKey: "same-data",
					accountGeneration: { userId, token: "generation" },
					payload: { byteSize: 10, checksum: "document", locator: "data-object" },
				};
				const admissions = yield* Effect.all(
					[
						session.transaction(
							repository.admitDataSubmission({
								...input,
								runId: ImportRunId.make(crypto.randomUUID()),
							}),
						),
						session.transaction(
							repository.admitDataSubmission({
								...input,
								runId: ImportRunId.make(crypto.randomUUID()),
							}),
						),
					],
					{ concurrency: 2 },
				);
				expect(admissions.filter((value) => value.created)).toHaveLength(1);
				expect(admissions[0].runId).toBe(admissions[1].runId);
				const changed = yield* session.transaction(
					repository.admitDataSubmission({
						...input,
						digest: "changed-document",
						runId: ImportRunId.make(crypto.randomUUID()),
					}),
				);
				expect(changed).toEqual({ created: false, digest: "document", runId: admissions[0].runId });
				const next = yield* session.transaction(
					repository.admitDataSubmission({
						...input,
						submissionKey: "new-data",
						runId: ImportRunId.make(crypto.randomUUID()),
					}),
				);
				expect(next.created).toBe(true);
				expect(next.runId).not.toBe(changed.runId);
			}),
	);
	test.effect("fences a reserved publication before dispatch when retirement wins", () =>
		Effect.gen(function* () {
			const scope = yield* runningRun();
			const repository = yield* ImportsRepository;
			const session = yield* DatabaseSession;
			const reservation = {
				ordinal: 64,
				checkpoint: null,
				id: "pending-page",
				recoveryBytes: "YQ==",
				captureState: "sealed" as const,
				inputFingerprint: "fingerprint",
				capturePhase: "collection" as const,
				payload: { byteSize: 1, locator: "owned", checksum: "checksum" },
			};
			yield* session.transaction(repository.reservePayload(scope, reservation));
			const stopped = yield* session.transaction(repository.stopPayloadWrites(scope));
			expect(stopped[0]?.reservation).toMatchObject({ retiring: true, writeStarted: false });
			expect(
				(yield* Effect.exit(
					session.transaction(repository.startPayloadWrite(scope, reservation.id)),
				))._tag,
			).toBe("Failure");
			expect(
				(yield* Effect.exit(session.transaction(repository.reservePayload(scope, reservation))))
					._tag,
			).toBe("Failure");
		}),
	);
});
