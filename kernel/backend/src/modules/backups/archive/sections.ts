import type { Stream } from "effect";

import type { BackupArchiveError } from "./error";
import type { ARCHIVE_CODECS, ArchiveRecords } from "./schemas";

export const STREAMED_SECTION_PATHS = [
	"entities.ndjson",
	"entity-dependencies.ndjson",
	"relationships.ndjson",
	"events.ndjson",
	"saved-views.ndjson",
	"calendar-source-overrides.ndjson",
	"integrations.ndjson",
	"notification-subscriptions.ndjson",
	"reminders.ndjson",
] as const;

export type StreamedSectionPath = (typeof STREAMED_SECTION_PATHS)[number];

export type ArchiveMetadata = Pick<ArchiveRecords, "profile" | "installations" | "privatePlugins">;

export type ArchiveSectionRecord<P extends StreamedSectionPath> =
	(typeof ARCHIVE_CODECS)[P]["Type"];

export type ArchiveSections = {
	readonly [P in StreamedSectionPath]: ArchiveSectionReader<ArchiveSectionRecord<P>>;
};

export type ArchiveSectionReader<A> = {
	readonly count: number;
	readonly sha256: string;
	readonly read: () => Stream.Stream<A, BackupArchiveError>;
};

export type ArchiveSectionInput = {
	readonly count: number;
	readonly bytes: number;
	readonly sha256: string;
	readonly path: StreamedSectionPath;
	readonly chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
};
