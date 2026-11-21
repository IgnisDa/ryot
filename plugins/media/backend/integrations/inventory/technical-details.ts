import { DateTime, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import type { MediaCopyDetails } from "../../../shared/media-copy";

type Video = {
	readonly width?: number | undefined;
	readonly range?: string | undefined;
	readonly height?: number | undefined;
	readonly interlaced?: boolean | undefined;
};

type Audio = {
	readonly codec?: string | undefined;
	readonly title?: string | undefined;
	readonly layout?: string | undefined;
	readonly profile?: string | undefined;
	readonly spatial?: string | undefined;
	readonly bitrate?: number | undefined;
	readonly channels?: number | undefined;
};

const audioCodecs: Readonly<Record<string, NonNullable<MediaCopyDetails["audioCodec"]>>> = {
	aac: "aac",
	ac3: "ac3",
	mp3: "mp3",
	dts: "dts",
	dca: "dts",
	eac3: "eac3",
	flac: "flac",
	opus: "opus",
	lpcm: "lpcm",
	truehd: "truehd",
	"dts-hd ma": "dts-hd-ma",
	"dts-hd hra": "dts-hd-hra",
};

const codecWithProfile = (codec: string, profile: string) => {
	if (codec.startsWith("pcm_")) {
		return "lpcm";
	}
	if (codec === "dca" || codec === "dts") {
		if (profile.includes("dts:x") || profile.includes("dts-hd ma")) {
			return "dts-hd-ma";
		}
		if (profile.includes("dts-hd hra")) {
			return "dts-hd-hra";
		}
	}
	return audioCodecs[codec];
};

const spatialFormat = (
	spatial: string,
	profile: string,
): MediaCopyDetails["audioSpatialFormat"] => {
	if (spatial.includes("atmos") || profile.includes("atmos")) {
		return "dolby-atmos";
	}
	if (spatial.includes("dtsx") || spatial.includes("dts:x") || profile.includes("dts:x")) {
		return "dts-x";
	}
	return undefined;
};

const describeAudio = (audio: Audio) => {
	const codec = audio.codec?.toLowerCase() ?? "";
	const profile = audio.profile?.toLowerCase() ?? "";
	const spatial = audio.spatial?.toLowerCase() ?? "";
	const audioCodec = codecWithProfile(codec, profile);
	const audioSpatialFormat = spatialFormat(spatial, profile);
	const lossless =
		audioCodec === "truehd" ||
		audioCodec === "dts-hd-ma" ||
		audioCodec === "lpcm" ||
		audioCodec === "flac";
	return {
		...audio,
		audioCodec,
		audioSpatialFormat,
		rank: Number(lossless) * 2 + Number(audioSpatialFormat !== undefined),
	};
};

const hdrFormat = (range: string | undefined) => {
	const value = range?.toLowerCase().replaceAll(/[^a-z0-9+]/g, "");
	if (!value || value.includes("invalid")) {
		return undefined;
	}
	if (value.includes("dovi") || value.includes("dolbyvision")) {
		return "dolby-vision";
	}
	if (value.includes("hdr10+") || value.includes("hdr10plus")) {
		return "hdr10-plus";
	}
	if (value.includes("hdr10")) {
		return "hdr10";
	}
	if (value.includes("hlg") || value.includes("hybridloggamma")) {
		return "hlg";
	}
	return value === "sdr" ? "sdr" : undefined;
};

const resolutionFor = (video: Video | undefined) => {
	const width = video?.width ?? 0;
	const height = video?.height ?? 0;
	if (width >= 7000 || height >= 4000) {
		return "4320";
	}
	if (width >= 3700 || height >= 2000) {
		return "2160";
	}
	if (width >= 1800 || height >= 1000) {
		return "1080";
	}
	if (width >= 1200 || height >= 700) {
		return "720";
	}
	if (height >= 560) {
		return "576";
	}
	return width >= 640 || height >= 460 ? "480" : undefined;
};

export const technicalCopyDetails = (input: {
	readonly audio: readonly Audio[];
	readonly video?: Video | undefined;
	readonly is3d?: boolean | undefined;
	readonly addedAt?: string | undefined;
}): MediaCopyDetails => {
	const audio = input.audio
		.filter((track) => !track.title?.toLowerCase().includes("commentary"))
		.map(describeAudio)
		.sort(
			(a, b) =>
				b.rank - a.rank ||
				(b.channels ?? 0) - (a.channels ?? 0) ||
				(b.bitrate ?? 0) - (a.bitrate ?? 0),
		)[0];
	const resolution = resolutionFor(input.video);
	const hdr = hdrFormat(input.video?.range);
	const audioChannels = audio?.layout?.trim();
	const addedAt = Option.getOrUndefined(
		Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(input.addedAt),
	);
	return {
		format: "digital",
		...(resolution === undefined ? {} : { resolution }),
		...(input.video?.interlaced === undefined
			? {}
			: { scanType: input.video.interlaced ? "interlaced" : "progressive" }),
		...(hdr === undefined ? {} : { hdr }),
		...(audio?.audioCodec === undefined ? {} : { audioCodec: audio.audioCodec }),
		...(audio?.audioSpatialFormat === undefined
			? {}
			: { audioSpatialFormat: audio.audioSpatialFormat }),
		...(audioChannels && audioChannels.length <= 64 ? { audioChannels } : {}),
		...(input.is3d === undefined ? {} : { is3d: input.is3d }),
		...(addedAt === undefined ? {} : { sourceAddedAt: DateTime.formatIso(addedAt) }),
	};
};
