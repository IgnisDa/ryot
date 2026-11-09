import type { FileSystem, Schema } from "effect";
import { Effect, Stream } from "effect";

import type { CreateArchiveInput } from "./archive";
import { ARCHIVE_CODECS, type ArchiveRecords } from "./schemas";
import type {
	ArchiveMetadata,
	ArchiveSectionInput,
	ArchiveSectionReader,
	ArchiveSections,
	StreamedSectionPath,
} from "./sections";
import { decodeNdjson, encodeNdjson, IncrementalSha256 } from "./streaming";

export type ArchiveFixtureEvents = Omit<ArchiveSectionInput, "path">;

export type ArchiveFixtureInput = Omit<CreateArchiveInput, "records" | "sections"> & {
	readonly records: ArchiveRecords;
	readonly events: ArchiveFixtureEvents;
};

type ArchiveFixtureValidated = {
	readonly records: ArchiveMetadata;
	readonly sections: ArchiveSections;
};

const encodeSection = <A, I>(
	path: StreamedSectionPath,
	rows: ReadonlyArray<A>,
	codec: Schema.Codec<A, I>,
): ArchiveSectionInput => {
	const chunks = [...encodeNdjson(rows, codec, path)];
	const hash = new IncrementalSha256();
	for (const chunk of chunks) {
		hash.update(chunk);
	}
	return { path, chunks, count: rows.length, ...hash.digest() };
};

export const archiveFixtureSections = (
	records: ArchiveRecords,
	events: ArchiveFixtureEvents,
): ReadonlyArray<ArchiveSectionInput> => [
	encodeSection("entities.ndjson", records.entities, ARCHIVE_CODECS["entities.ndjson"]),
	encodeSection(
		"entity-dependencies.ndjson",
		records.entityDependencies,
		ARCHIVE_CODECS["entity-dependencies.ndjson"],
	),
	encodeSection(
		"relationships.ndjson",
		records.relationships,
		ARCHIVE_CODECS["relationships.ndjson"],
	),
	{ path: "events.ndjson", ...events },
	encodeSection("saved-views.ndjson", records.savedViews, ARCHIVE_CODECS["saved-views.ndjson"]),
	encodeSection(
		"calendar-source-overrides.ndjson",
		records.calendarSourceOverrides,
		ARCHIVE_CODECS["calendar-source-overrides.ndjson"],
	),
	encodeSection("integrations.ndjson", records.integrations, ARCHIVE_CODECS["integrations.ndjson"]),
	encodeSection(
		"notification-subscriptions.ndjson",
		records.notificationSubscriptions,
		ARCHIVE_CODECS["notification-subscriptions.ndjson"],
	),
	encodeSection("reminders.ndjson", records.reminders, ARCHIVE_CODECS["reminders.ndjson"]),
	encodeSection("publications.ndjson", records.publications, ARCHIVE_CODECS["publications.ndjson"]),
	encodeSection("fold-values.ndjson", records.foldValues, ARCHIVE_CODECS["fold-values.ndjson"]),
];

export const archiveFixtureMetadata = (records: ArchiveRecords): ArchiveMetadata => ({
	profile: records.profile,
	installations: records.installations,
	privatePlugins: records.privatePlugins,
});

export const archiveFixtureInput = (input: ArchiveFixtureInput): CreateArchiveInput => {
	const { events, records, ...archiveInput } = input;
	return {
		...archiveInput,
		records: archiveFixtureMetadata(records),
		sections: archiveFixtureSections(records, events),
	};
};

const collectSection = <A>(section: ArchiveSectionReader<A>) =>
	Stream.runCollect(section.read()).pipe(Effect.map((rows) => Array.from(rows)));

export const collectFixtureRecords = Effect.fn(function* (archive: ArchiveFixtureValidated) {
	const entities = yield* collectSection(archive.sections["entities.ndjson"]);
	const entityDependencies = yield* collectSection(archive.sections["entity-dependencies.ndjson"]);
	const relationships = yield* collectSection(archive.sections["relationships.ndjson"]);
	const savedViews = yield* collectSection(archive.sections["saved-views.ndjson"]);
	const calendarSourceOverrides = yield* collectSection(
		archive.sections["calendar-source-overrides.ndjson"],
	);
	const integrations = yield* collectSection(archive.sections["integrations.ndjson"]);
	const notificationSubscriptions = yield* collectSection(
		archive.sections["notification-subscriptions.ndjson"],
	);
	const reminders = yield* collectSection(archive.sections["reminders.ndjson"]);
	const publications = yield* collectSection(archive.sections["publications.ndjson"]);
	const foldValues = yield* collectSection(archive.sections["fold-values.ndjson"]);
	return {
		...archive.records,
		entities,
		reminders,
		foldValues,
		savedViews,
		integrations,
		publications,
		relationships,
		entityDependencies,
		calendarSourceOverrides,
		notificationSubscriptions,
	} satisfies ArchiveRecords;
});

type ExportFixtureSnapshot = {
	readonly records: ArchiveMetadata;
	readonly sections: ReadonlyArray<{
		readonly filePath: string;
		readonly path: StreamedSectionPath;
	}>;
};

const collectExportSection = <A, I>(
	snapshot: ExportFixtureSnapshot,
	fs: FileSystem.FileSystem,
	path: Exclude<StreamedSectionPath, "events.ndjson">,
	codec: Schema.Codec<A, I>,
) =>
	Effect.gen(function* () {
		const section = snapshot.sections.find((candidate) => candidate.path === path);
		if (!section) {
			return yield* Effect.die(new Error(`Missing export fixture section '${path}'`));
		}
		return Array.from(decodeNdjson<A, I>([yield* fs.readFile(section.filePath)], codec, path));
	});

export const collectExportFixtureRecords = Effect.fn(function* (
	snapshot: ExportFixtureSnapshot,
	fs: FileSystem.FileSystem,
) {
	const entities = yield* collectExportSection(
		snapshot,
		fs,
		"entities.ndjson",
		ARCHIVE_CODECS["entities.ndjson"],
	);
	const entityDependencies = yield* collectExportSection(
		snapshot,
		fs,
		"entity-dependencies.ndjson",
		ARCHIVE_CODECS["entity-dependencies.ndjson"],
	);
	const relationships = yield* collectExportSection(
		snapshot,
		fs,
		"relationships.ndjson",
		ARCHIVE_CODECS["relationships.ndjson"],
	);
	const savedViews = yield* collectExportSection(
		snapshot,
		fs,
		"saved-views.ndjson",
		ARCHIVE_CODECS["saved-views.ndjson"],
	);
	const calendarSourceOverrides = yield* collectExportSection(
		snapshot,
		fs,
		"calendar-source-overrides.ndjson",
		ARCHIVE_CODECS["calendar-source-overrides.ndjson"],
	);
	const integrations = yield* collectExportSection(
		snapshot,
		fs,
		"integrations.ndjson",
		ARCHIVE_CODECS["integrations.ndjson"],
	);
	const notificationSubscriptions = yield* collectExportSection(
		snapshot,
		fs,
		"notification-subscriptions.ndjson",
		ARCHIVE_CODECS["notification-subscriptions.ndjson"],
	);
	const reminders = yield* collectExportSection(
		snapshot,
		fs,
		"reminders.ndjson",
		ARCHIVE_CODECS["reminders.ndjson"],
	);
	const publications = yield* collectExportSection(
		snapshot,
		fs,
		"publications.ndjson",
		ARCHIVE_CODECS["publications.ndjson"],
	);
	const foldValues = yield* collectExportSection(
		snapshot,
		fs,
		"fold-values.ndjson",
		ARCHIVE_CODECS["fold-values.ndjson"],
	);
	return {
		...snapshot.records,
		entities,
		reminders,
		foldValues,
		savedViews,
		integrations,
		publications,
		relationships,
		entityDependencies,
		calendarSourceOverrides,
		notificationSubscriptions,
	} satisfies ArchiveRecords;
});
