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
}) {}

export const archiveError = (reason: BackupArchiveErrorReason, message: string, path?: string) =>
	new BackupArchiveError({ reason, message, ...(path === undefined ? {} : { path }) });
