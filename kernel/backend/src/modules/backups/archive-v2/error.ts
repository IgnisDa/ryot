import { Data } from "effect";

export type BackupArchiveErrorReason =
	| "invalid_entry"
	| "invalid_path"
	| "missing_entry"
	| "count_mismatch"
	| "duplicate_path"
	| "entry_too_large"
	| "invalid_archive"
	| "unexpected_path"
	| "truncated_ndjson"
	| "undeclared_asset"
	| "checksum_mismatch"
	| "unsupported_format"
	| "duplicate_record_id"
	| "total_size_exceeded"
	| "entry_count_exceeded"
	| "unsupported_compression"
	| "missing_reference_mapping";

export class BackupArchiveError extends Data.TaggedError("BackupArchiveError")<{
	readonly path?: string;
	readonly message: string;
	readonly reason: BackupArchiveErrorReason;
}> {}

export const archiveError = (reason: BackupArchiveErrorReason, message: string, path?: string) =>
	new BackupArchiveError({ reason, message, ...(path === undefined ? {} : { path }) });
