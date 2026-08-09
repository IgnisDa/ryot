import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Stream } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine, type MockOverrides } from "#lib/test-utils/effect";
import { BackupDataService } from "#modules/backup-data/data-service";
import { UploadsService } from "#modules/uploads/service";

import { BackupsRepository } from "./repository";
import { BackupsService } from "./service";

const user: CurrentUserValue = {
	image: null,
	name: "Backup User",
	email: "backup@example.com",
	id: UserId.make("user-1"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};
const timestamp = "2026-08-23T12:00:00.000Z";
const runId = BackupRunId.make("run-1");
const completedRun = {
	id: runId,
	error: null,
	progress: 100,
	createdAt: timestamp,
	startedAt: timestamp,
	finishedAt: timestamp,
	kind: "export" as const,
	status: "completed" as const,
	artifactProvider: "local" as const,
	expiresAt: "2099-08-24T12:00:00.000Z",
};

const mockUploads = Layer.mock(UploadsService);
const mockRepository = Layer.mock(BackupsRepository);

const makeLayer = (input: {
	uploads?: MockOverrides<typeof mockUploads>;
	repository: MockOverrides<typeof mockRepository>;
}) =>
	BackupsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				Layer.mock(BackupDataService, { assertAccountIsClean: () => Effect.sync(() => undefined) }),
				mockUploads(input.uploads ?? {}),
				mockRepository(input.repository),
			),
		),
	);

it.effect("enforces run ownership through the repository scope", () => {
	let requestedUserId: UserId | undefined;
	const layer = makeLayer({
		repository: {
			getRunById: ({ userId }) => {
				requestedUserId = userId;
				return Effect.succeed(null);
			},
		},
	});
	return Effect.gen(function* () {
		const service = yield* BackupsService;
		const error = yield* service.getRun(user, runId).pipe(Effect.flip);
		expect(error._tag).toBe("NotFound");
		expect(requestedUserId).toBe(user.id);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects download and deletion while a run is active", () => {
	const running = { ...completedRun, status: "running" as const, progress: 50, expiresAt: null };
	const layer = makeLayer({
		repository: { getRunById: () => Effect.succeed(running) },
	});
	return Effect.gen(function* () {
		const service = yield* BackupsService;
		expect((yield* service.downloadRun(user, runId).pipe(Effect.flip))._tag).toBe("Conflict");
		expect((yield* service.deleteRun(user, runId).pipe(Effect.flip))._tag).toBe("Conflict");
	}).pipe(Effect.provide(layer));
});

it.effect("streams an owned unexpired artifact without buffering", () => {
	const bytes = new TextEncoder().encode("archive");
	const layer = makeLayer({
		repository: {
			getRunById: () => Effect.succeed(completedRun),
			getArtifactById: () =>
				Effect.succeed({
					...completedRun,
					userId: user.id,
					artifactKey: "temporary/run-1.zip",
					artifactProvider: "local",
				}),
		},
		uploads: {
			statObject: () => Effect.succeed({ size: bytes.length, contentType: null }),
			openObject: () => Effect.succeed(Stream.make(bytes)),
		},
	});
	return Effect.gen(function* () {
		const service = yield* BackupsService;
		const download = yield* service.downloadRun(user, runId);
		expect(download.size).toBe(bytes.length);
		expect(Array.from(yield* Stream.runCollect(download.stream))).toEqual([bytes]);
	}).pipe(Effect.provide(layer));
});

it.effect("deletes an artifact before its run and performs cleanup in the same order", () => {
	const calls: string[] = [];
	const artifact = {
		...completedRun,
		userId: user.id,
		artifactKey: "temporary/run-1.zip",
		artifactProvider: "local" as const,
	};
	const layer = makeLayer({
		repository: {
			getRunById: () => Effect.succeed(completedRun),
			getArtifactById: () => Effect.succeed(artifact),
			deleteRunById: () => Effect.sync(() => (calls.push("run"), completedRun)),
		},
		uploads: { deleteObject: () => Effect.sync(() => void calls.push("artifact")) },
	});
	return Effect.gen(function* () {
		const service = yield* BackupsService;
		expect(yield* service.deleteRun(user, runId)).toEqual({ id: runId });
		expect(calls).toEqual(["artifact", "run"]);
	}).pipe(Effect.provide(layer));
});

it.effect("deletes expired artifact objects before race-safe run cleanup", () => {
	const calls: string[] = [];
	const artifact = {
		...completedRun,
		userId: user.id,
		artifactKey: "temporary/run-1.zip",
		artifactProvider: "local" as const,
	};
	const layer = makeLayer({
		repository: {
			listExpiredArtifacts: () => Effect.succeed([artifact]),
			deleteExpiredRunById: () => Effect.sync(() => (calls.push("run"), completedRun)),
		},
		uploads: { deleteObject: () => Effect.sync(() => void calls.push("artifact")) },
	});
	return Effect.gen(function* () {
		const service = yield* BackupsService;
		yield* service.cleanupExpiredArtifacts(100);
		expect(calls).toEqual(["artifact", "run"]);
	}).pipe(Effect.provide(layer));
});
