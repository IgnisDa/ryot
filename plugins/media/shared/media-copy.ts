import { Schema } from "@ryot-app/plugin-kit/effect";
import type { LocalMessage } from "@ryot-app/plugin-kit/messages";
import type { AuthoredAppSchema } from "@ryot-app/plugin-kit/schema";

import { catalogMessage } from "./messages.generated";

export const mediaCopyRelationship = "media-copy";
export const mediaImportedCopyKey = (
	integrationSourceKey: string | undefined,
	source: string,
	sourceId: string,
) =>
	JSON.stringify(
		integrationSourceKey === undefined
			? ["import", source, sourceId]
			: ["integration", integrationSourceKey, sourceId],
	);
const mediaFormats = ["digital", "dvd", "blu-ray", "uhd-blu-ray", "physical"] as const;
const mediaResolutions = ["480", "576", "720", "1080", "2160", "4320"] as const;
const mediaScanTypes = ["progressive", "interlaced"] as const;
const mediaHdrFormats = ["sdr", "hdr10", "hdr10-plus", "hlg", "dolby-vision"] as const;
const mediaAudioCodecs = [
	"lpcm",
	"truehd",
	"dts",
	"dts-hd-ma",
	"dts-hd-hra",
	"ac3",
	"eac3",
	"aac",
	"flac",
	"opus",
	"mp3",
] as const;
const mediaSpatialFormats = ["dolby-atmos", "dts-x"] as const;
const specificationLabels = {
	aac: catalogMessage("ownership.choice.aac"),
	ac3: catalogMessage("ownership.choice.ac3"),
	dts: catalogMessage("ownership.choice.dts"),
	dvd: catalogMessage("ownership.choice.dvd"),
	hlg: catalogMessage("ownership.choice.hlg"),
	mp3: catalogMessage("ownership.choice.mp3"),
	sdr: catalogMessage("ownership.choice.sdr"),
	eac3: catalogMessage("ownership.choice.eac3"),
	flac: catalogMessage("ownership.choice.flac"),
	lpcm: catalogMessage("ownership.choice.lpcm"),
	opus: catalogMessage("ownership.choice.opus"),
	hdr10: catalogMessage("ownership.choice.hdr10"),
	"dts-x": catalogMessage("ownership.choice.dts-x"),
	truehd: catalogMessage("ownership.choice.truehd"),
	digital: catalogMessage("ownership.choice.digital"),
	"blu-ray": catalogMessage("ownership.choice.blu-ray"),
	physical: catalogMessage("ownership.choice.physical"),
	"dts-hd-ma": catalogMessage("ownership.choice.dts-hd-ma"),
	interlaced: catalogMessage("ownership.choice.interlaced"),
	"dts-hd-hra": catalogMessage("ownership.choice.dts-hd-hra"),
	"hdr10-plus": catalogMessage("ownership.choice.hdr10-plus"),
	progressive: catalogMessage("ownership.choice.progressive"),
	"dolby-atmos": catalogMessage("ownership.choice.dolby-atmos"),
	"uhd-blu-ray": catalogMessage("ownership.choice.uhd-blu-ray"),
	"dolby-vision": catalogMessage("ownership.choice.dolby-vision"),
};
export const mediaCopySpecification = (value: keyof typeof specificationLabels) =>
	specificationLabels[value];

const DateOnly = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const ChannelLayout = Schema.NonEmptyString.check(Schema.isMaxLength(64));

export const MediaCopyDetails = Schema.Struct({
	is3d: Schema.optionalKey(Schema.Boolean),
	acquiredOn: Schema.optionalKey(DateOnly),
	audioChannels: Schema.optionalKey(ChannelLayout),
	sourceAddedAt: Schema.optionalKey(Schema.String),
	format: Schema.optionalKey(Schema.Literals(mediaFormats)),
	hdr: Schema.optionalKey(Schema.Literals(mediaHdrFormats)),
	scanType: Schema.optionalKey(Schema.Literals(mediaScanTypes)),
	resolution: Schema.optionalKey(Schema.Literals(mediaResolutions)),
	audioCodec: Schema.optionalKey(Schema.Literals(mediaAudioCodecs)),
	audioSpatialFormat: Schema.optionalKey(Schema.Literals(mediaSpatialFormats)),
});

export type MediaCopyDetails = typeof MediaCopyDetails.Type;

export const MediaCopyProperties = Schema.Struct({
	...MediaCopyDetails.fields,
	source: Schema.optionalKey(Schema.NonEmptyString),
	seenInRun: Schema.optionalKey(Schema.NonEmptyString),
	origin: Schema.Literals(["manual", "import", "integration"]),
	legacySources: Schema.optionalKey(Schema.Array(Schema.String)),
	integrationSourceKey: Schema.optionalKey(Schema.NonEmptyString),
});

const choice = <Value extends string>(
	type: readonly Value[],
	label: LocalMessage,
	description: string,
	labelValue?: (value: NoInfer<Value>) => LocalMessage,
) => ({
	label,
	description,
	type: "enum" as const,
	choices: {
		kind: "static" as const,
		values: type.map((value) => ({ value, label: labelValue?.(value) })),
	},
});

export const mediaCopyFields = {
	resolution: choice(
		mediaResolutions,
		catalogMessage("ownership.resolution"),
		"Nominal video resolution in lines",
	),
	acquiredOn: {
		type: "date",
		description: "Date the copy was acquired",
		label: catalogMessage("property.owned-on"),
	},
	hdr: choice(
		mediaHdrFormats,
		catalogMessage("ownership.hdr"),
		"Video dynamic range format",
		mediaCopySpecification,
	),
	is3d: {
		type: "boolean",
		label: catalogMessage("ownership.video-3d"),
		description: "Whether this copy contains 3D video",
	},
	format: choice(
		mediaFormats,
		catalogMessage("ownership.format"),
		"Physical or digital copy format",
		mediaCopySpecification,
	),
	scanType: choice(
		mediaScanTypes,
		catalogMessage("ownership.scan-type"),
		"Progressive or interlaced video",
		mediaCopySpecification,
	),
	sourceAddedAt: {
		type: "datetime",
		label: catalogMessage("ownership.source-added"),
		description: "Timestamp the source added this copy",
	},
	audioCodec: choice(
		mediaAudioCodecs,
		catalogMessage("ownership.audio-codec"),
		"Audio codec of the representative track",
		mediaCopySpecification,
	),
	audioSpatialFormat: choice(
		mediaSpatialFormats,
		catalogMessage("ownership.audio-spatial-format"),
		"Spatial audio format",
		mediaCopySpecification,
	),
	audioChannels: {
		type: "string",
		validation: { minLength: 1, maxLength: 64 },
		description: "Source-reported channel layout",
		label: catalogMessage("ownership.audio-channels"),
	},
} satisfies AuthoredAppSchema["fields"];

export const mediaCopyPropertiesSchema = {
	unknownKeys: "strict",
	fields: {
		...mediaCopyFields,
		source: {
			type: "string",
			label: catalogMessage("property.source"),
			description: "Source attribution for this copy",
		},
		integrationSourceKey: {
			type: "string",
			label: catalogMessage("property.source"),
			description: "Owning integration connection",
		},
		seenInRun: {
			type: "string",
			label: catalogMessage("property.source"),
			description: "Most recent inventory scan that observed the copy",
		},
		origin: {
			...choice(
				["manual", "import", "integration"],
				catalogMessage("property.source"),
				"Authority that created this copy",
			),
			validation: { required: true },
		},
		legacySources: {
			type: "array",
			label: catalogMessage("property.ownership-sources"),
			description: "Sources reported by the previous ownership model",
			items: {
				type: "string",
				description: "Reported source",
				label: catalogMessage("property.source"),
			},
		},
	},
} satisfies AuthoredAppSchema;
