import type { BackupRunFailure } from "@ryot-app/contract/modules/backups/schemas";
import { Schema } from "effect";

export const BackupArchiveErrorReason = Schema.Literals([
	"invalid_path",
	"invalid_entry",
	"missing_entry",
	"count_mismatch",
	"duplicate_path",
	"entry_too_large",
	"invalid_archive",
	"unexpected_path",
	"truncated_ndjson",
	"undeclared_asset",
	"checksum_mismatch",
	"unsupported_format",
	"duplicate_record_id",
	"total_size_exceeded",
	"entry_count_exceeded",
	"unsupported_compression",
	"missing_reference_mapping",
]);

export type BackupArchiveErrorReason = typeof BackupArchiveErrorReason.Type;

export class BackupArchiveError extends Schema.TaggedError<
	BackupArchiveError,
	{ readonly brand: unique symbol }
>()("BackupArchiveError", {
	message: Schema.String,
	reason: BackupArchiveErrorReason,
	path: Schema.optionalKey(Schema.String),
	maxBytes: Schema.optionalKey(Schema.Finite),
	maxCount: Schema.optionalKey(Schema.Finite),
	actualBytes: Schema.optionalKey(Schema.Finite),
	actualCount: Schema.optionalKey(Schema.Finite),
}) {}

export const archiveError = (
	reason: BackupArchiveErrorReason,
	message: string,
	path?: string,
	limits: Partial<
		Pick<BackupArchiveError, "maxBytes" | "maxCount" | "actualBytes" | "actualCount">
	> = {},
) =>
	new BackupArchiveError({ reason, message, ...limits, ...(path === undefined ? {} : { path }) });

export const archiveEntryTooLarge = (path: string, actualBytes: number, maxBytes: number) =>
	new BackupArchiveError({
		path,
		maxBytes,
		actualBytes,
		reason: "entry_too_large",
		message: `Archive data in '${path}' is too large: ${actualBytes} bytes exceeds the ${maxBytes}-byte limit`,
	});

const invalidArchiveIssues = {
	invalid_path: "invalid-path",
	invalid_entry: "invalid-entry",
	missing_entry: "missing-entry",
	count_mismatch: "count-mismatch",
	duplicate_path: "duplicate-path",
	entry_too_large: "entry-too-large",
	invalid_archive: "invalid-archive",
	unexpected_path: "unexpected-path",
	truncated_ndjson: "truncated-ndjson",
	undeclared_asset: "undeclared-asset",
	checksum_mismatch: "checksum-mismatch",
	duplicate_record_id: "duplicate-record-id",
	total_size_exceeded: "total-size-exceeded",
	entry_count_exceeded: "entry-count-exceeded",
	missing_reference_mapping: "missing-reference-mapping",
} as const satisfies Record<
	Exclude<BackupArchiveErrorReason, "unsupported_format" | "unsupported_compression">,
	Extract<BackupRunFailure, { code: "archive-invalid" }>["issue"]
>;

export const archiveFailure = (error: BackupArchiveError): BackupRunFailure => {
	if (error.reason === "unsupported_compression") {
		return { feature: "compression", code: "archive-unsupported" };
	}
	if (error.reason === "unsupported_format") {
		return { feature: "format", code: "archive-unsupported" };
	}
	return {
		code: "archive-invalid",
		issue: invalidArchiveIssues[error.reason],
		...(error.actualBytes === undefined ? {} : { actualBytes: error.actualBytes }),
		...(error.maxBytes === undefined ? {} : { maxBytes: error.maxBytes }),
		...(error.actualCount === undefined ? {} : { actualCount: error.actualCount }),
		...(error.maxCount === undefined ? {} : { maxCount: error.maxCount }),
		...(error.path === undefined ||
		(error.actualBytes === undefined && error.actualCount === undefined)
			? {}
			: { path: error.path }),
	};
};
