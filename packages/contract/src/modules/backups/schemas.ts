import { Schema } from "effect";

import { BackupRunId } from "../../schema/brands";

export const BackupRunKind = Schema.Literals(["export", "restore"]);
export type BackupRunKind = typeof BackupRunKind.Type;

export const BackupRunStatus = Schema.Literals(["pending", "running", "completed", "failed"]);
export type BackupRunStatus = typeof BackupRunStatus.Type;

export const BackupRunArtifactProvider = Schema.Literals(["local", "s3"]);
export type BackupRunArtifactProvider = typeof BackupRunArtifactProvider.Type;

export const BackupRun = Schema.Struct({
	id: BackupRunId,
	kind: BackupRunKind,
	status: BackupRunStatus,
	progress: Schema.Number,
	createdAt: Schema.String,
	error: Schema.NullOr(Schema.String),
	expiresAt: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	artifactProvider: Schema.NullOr(BackupRunArtifactProvider),
});
export type BackupRun = typeof BackupRun.Type;

export const BackupRunIdResponse = Schema.Struct({ id: BackupRunId });
export type BackupRunIdResponse = typeof BackupRunIdResponse.Type;

export const ListRunsResponse = Schema.Struct({ items: Schema.Array(BackupRun) });
export type ListRunsResponse = typeof ListRunsResponse.Type;

export const CreateRestoreBody = Schema.Struct({ uploadToken: Schema.NonEmptyString });
export type CreateRestoreBody = typeof CreateRestoreBody.Type;
