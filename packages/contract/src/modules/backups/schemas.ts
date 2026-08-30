import { Schema } from "effect";

import { BackupRunId } from "../../schema/brands";
import { RunStatus } from "../../schema/run-status";

export const BackupRunKind = Schema.Literals(["export", "restore"]);
export type BackupRunKind = typeof BackupRunKind.Type;

export const BackupAccountDataCategory = Schema.Literals([
	"events",
	"entities",
	"preferences",
	"relationships",
	"saved-views",
	"plugin-state",
	"integrations",
	"managed-assets",
	"notification-channels",
	"notification-subscriptions",
]);
export type BackupAccountDataCategory = typeof BackupAccountDataCategory.Type;

export const BackupRunFailure = Schema.Union([
	Schema.Struct({ category: BackupAccountDataCategory, code: Schema.Literal("account-not-clean") }),
	Schema.Struct({
		code: Schema.Literal("archive-invalid"),
		issue: Schema.Literals([
			"invalid-entry",
			"invalid-path",
			"missing-entry",
			"count-mismatch",
			"duplicate-path",
			"entry-too-large",
			"invalid-archive",
			"unexpected-path",
			"truncated-ndjson",
			"undeclared-asset",
			"checksum-mismatch",
			"duplicate-record-id",
			"total-size-exceeded",
			"entry-count-exceeded",
			"missing-reference-mapping",
		]),
	}),
	Schema.Struct({
		code: Schema.Literal("archive-unsupported"),
		feature: Schema.Literals(["format", "compression"]),
	}),
	Schema.Struct({
		pluginSlug: Schema.String,
		requiredVersion: Schema.String,
		code: Schema.Literal("required-plugin-unavailable"),
	}),
	Schema.Struct({ code: Schema.Literal("upload-unavailable") }),
	Schema.Struct({ operation: BackupRunKind, code: Schema.Literal("unexpected-failure") }),
]);
export type BackupRunFailure = typeof BackupRunFailure.Type;

const BackupBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("account-not-found") }),
	Schema.Struct({ code: Schema.Literal("restore-has-no-artifact") }),
	Schema.Struct({ code: Schema.Literal("export-has-no-artifact") }),
]);

const BackupConflictReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("active-run-exists") }),
	Schema.Struct({ category: BackupAccountDataCategory, code: Schema.Literal("account-not-clean") }),
	Schema.Struct({ code: Schema.Literal("export-still-running") }),
	Schema.Struct({ code: Schema.Literal("run-still-active") }),
]);

const BackupNotFoundReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("run-not-found") }),
	Schema.Struct({ code: Schema.Literal("artifact-expired") }),
	Schema.Struct({ code: Schema.Literal("artifact-not-found") }),
]);

const BackupInternalErrorReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("persistence-failed") }),
	Schema.Struct({ code: Schema.Literal("export-dispatch-failed") }),
	Schema.Struct({ code: Schema.Literal("restore-dispatch-failed") }),
	Schema.Struct({ code: Schema.Literal("artifact-storage-unavailable") }),
	Schema.Struct({ code: Schema.Literal("artifact-delete-failed") }),
	Schema.Struct({ code: Schema.Literal("unexpected-error") }),
]);

export class BackupBadRequest extends Schema.TaggedError<BackupBadRequest>()("BackupBadRequest", {
	reason: BackupBadRequestReason,
}) {}

export class BackupConflict extends Schema.TaggedError<BackupConflict>()("BackupConflict", {
	reason: BackupConflictReason,
}) {}

export class BackupNotFound extends Schema.TaggedError<BackupNotFound>()("BackupNotFound", {
	reason: BackupNotFoundReason,
}) {}

export class BackupInternalError extends Schema.TaggedError<BackupInternalError>()(
	"BackupInternalError",
	{ reason: BackupInternalErrorReason },
) {}

export const BackupRunArtifactProvider = Schema.Literals(["local", "s3"]);
export type BackupRunArtifactProvider = typeof BackupRunArtifactProvider.Type;

export const BackupRun = Schema.Struct({
	id: BackupRunId,
	status: RunStatus,
	kind: BackupRunKind,
	progress: Schema.Number,
	createdAt: Schema.String,
	expiresAt: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	failure: Schema.NullOr(BackupRunFailure),
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
