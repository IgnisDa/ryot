import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine, type MockOverrides } from "#lib/test-utils/effect";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { BackupAccountCleanliness } from "./restore/account-cleanliness";
import { BackupsRepository } from "./runs/repository";
import { BackupsService } from "./service";

const user: CurrentUserValue = {
	image: null,
	name: "Backup User",
	id: UserId.make("user-1"),
	email: "backup@example.com",
	preferences: { language: null, disableIntegrations: false },
};
const timestamp = "2026-08-23T12:00:00.000Z";
const runId = BackupRunId.make("run-1");
const completedRun = {
	id: runId,
	failure: null,
	progress: 100,
	createdAt: timestamp,
	startedAt: timestamp,
	finishedAt: timestamp,
	kind: "export" as const,
	status: "completed" as const,
	artifactProvider: "local" as const,
	expiresAt: "2099-08-24T12:00:00.000Z",
};

const artifact = {
	...completedRun,
	userId: user.id,
	artifactKey: "temporary/run-1.zip",
	artifactProvider: "local" as const,
};

type Run =
	| typeof completedRun
	| (Omit<typeof completedRun, "status" | "expiresAt"> & {
			status: "pending" | "running";
			expiresAt: null;
	  });

class FakeBackupRuns extends Context.Service<
	FakeBackupRuns,
	{
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly requestedUserIds: Effect.Effect<ReadonlyArray<UserId>>;
		readonly setRunStatus: (status: "pending" | "running") => Effect.Effect<void>;
	}
>()("test/FakeBackupRuns") {}

const mockUploads = Layer.mock(ObjectStorageService);
const mockRepository = Layer.mock(BackupsRepository);

const makeLayer = (input: {
	run?: Run | null;
	artifact?: typeof artifact;
	expiredArtifacts?: ReadonlyArray<typeof artifact>;
	uploads?: MockOverrides<typeof mockUploads>;
}) =>
	BackupsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				Layer.mock(BackupAccountCleanliness, {
					assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)),
				}),
				Layer.unwrap(
					Effect.gen(function* () {
						const run = yield* Ref.make(input.run ?? null);
						const calls = yield* Ref.make<ReadonlyArray<string>>([]);
						const requestedUserIds = yield* Ref.make<ReadonlyArray<UserId>>([]);
						const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
						return Layer.mergeAll(
							Layer.succeed(FakeBackupRuns, {
								calls: Ref.get(calls),
								requestedUserIds: Ref.get(requestedUserIds),
								setRunStatus: (status) =>
									Ref.update(run, (current) =>
										current === null ? null : { ...current, status, expiresAt: null },
									),
							}),
							mockUploads({ deleteObject: () => record("artifact"), ...input.uploads }),
							mockRepository({
								deleteRunById: () => record("run").pipe(Effect.as(completedRun)),
								deleteExpiredRunById: () => record("run").pipe(Effect.as(completedRun)),
								getRunById: ({ userId }) =>
									Ref.update(requestedUserIds, (all) => [...all, userId]).pipe(
										Effect.andThen(Ref.get(run)),
									),
								...(input.artifact === undefined
									? {}
									: { getArtifactById: () => Effect.succeed(input.artifact ?? null) }),
								...(input.expiredArtifacts === undefined
									? {}
									: {
											listExpiredArtifacts: () =>
												Effect.succeed([...(input.expiredArtifacts ?? [])]),
										}),
							}),
						);
					}),
				),
			),
		),
	);

layer(makeLayer({ run: null }))((test) => {
	test.effect("enforces run ownership through the repository scope", () =>
		Effect.gen(function* () {
			const service = yield* BackupsService;
			const error = yield* service.downloadRun(user, runId).pipe(Effect.flip);
			expect(error).toMatchObject({ _tag: "BackupNotFound", reason: { code: "run-not-found" } });
			expect((yield* (yield* FakeBackupRuns).requestedUserIds).at(-1)).toBe(user.id);
		}),
	);
});

layer(makeLayer({ run: { ...completedRun, progress: 50, expiresAt: null, status: "pending" } }))(
	(test) => {
		test.effect("rejects download and deletion while a run is pending or running", () =>
			Effect.gen(function* () {
				const service = yield* BackupsService;
				expect(yield* service.downloadRun(user, runId).pipe(Effect.flip)).toMatchObject({
					_tag: "BackupConflict",
					reason: { code: "export-still-running" },
				});
				expect(yield* service.deleteRun(user, runId).pipe(Effect.flip)).toMatchObject({
					_tag: "BackupConflict",
					reason: { code: "run-still-active" },
				});
				yield* (yield* FakeBackupRuns).setRunStatus("running");
				expect(yield* service.downloadRun(user, runId).pipe(Effect.flip)).toMatchObject({
					_tag: "BackupConflict",
					reason: { code: "export-still-running" },
				});
				expect(yield* service.deleteRun(user, runId).pipe(Effect.flip)).toMatchObject({
					_tag: "BackupConflict",
					reason: { code: "run-still-active" },
				});
			}),
		);
	},
);

const archiveBytes = new TextEncoder().encode("archive");

layer(
	makeLayer({
		artifact,
		run: completedRun,
		uploads: {
			openObject: () => Effect.succeed(Stream.make(archiveBytes)),
			statObject: () => Effect.succeed({ contentType: null, size: archiveBytes.length }),
		},
	}),
)((test) => {
	test.effect("streams an owned unexpired artifact without buffering", () =>
		Effect.gen(function* () {
			const service = yield* BackupsService;
			const download = yield* service.downloadRun(user, runId);
			expect(download.size).toBe(archiveBytes.length);
			expect(Array.from(yield* Stream.runCollect(download.stream))).toEqual([archiveBytes]);
		}),
	);
});

layer(makeLayer({ artifact, run: completedRun }))((test) => {
	test.effect("deletes an artifact before its run and performs cleanup in the same order", () =>
		Effect.gen(function* () {
			const service = yield* BackupsService;
			expect(yield* service.deleteRun(user, runId)).toEqual({ id: runId });
			expect(yield* (yield* FakeBackupRuns).calls).toEqual(["artifact", "run"]);
		}),
	);
});

layer(makeLayer({ expiredArtifacts: [artifact] }))((test) => {
	test.effect("deletes expired artifact objects before race-safe run cleanup", () =>
		Effect.gen(function* () {
			const service = yield* BackupsService;
			yield* service.cleanupExpiredArtifacts(100);
			expect(yield* (yield* FakeBackupRuns).calls).toEqual(["artifact", "run"]);
		}),
	);
});
