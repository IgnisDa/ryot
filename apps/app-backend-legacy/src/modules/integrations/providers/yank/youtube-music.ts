import { dayjs } from "@ryot/ts-utils/dayjs";
import { Innertube, YTNodes } from "youtubei.js";

import { redis } from "~/lib/redis";
import { redisKeys } from "~/lib/redis-keys";
import type { ImportEntityRef, ImportMediaEntityGroup } from "~/modules/imports/jobs";
import { finalizeEntityGroups } from "~/modules/imports/media/book/shared";
import { getOrCreateMediaEntityGroup } from "~/modules/imports/media/groups";
import type { MediaImportAdapterResult } from "~/modules/imports/media/import-processor";

type SongEntry = {
	title: string;
	videoId: string;
};

export type YoutubeMusicInput = {
	userId: string;
	timezone: string;
	authCookie: string;
	integrationId: string;
};

type ClaimResult = { claimed: boolean };

export type YoutubeMusicAdapterDeps = {
	fetchTodaySongs: (authCookie: string, timezone: string) => Promise<SongEntry[]>;
	claimCacheKey: (key: string, ttlSeconds: number) => Promise<ClaimResult>;
};

const secondsUntilMidnight = (timezone: string): number => {
	const now = dayjs().tz(timezone);
	const midnight = now.endOf("day");
	return Math.max(1, Math.ceil(midnight.diff(now, "second")));
};

const isTodayHeader = (title: string, timezone: string): boolean => {
	const lower = title.toLowerCase();
	if (lower === "today") {
		return true;
	}
	const localDate = dayjs().tz(timezone).format("MMMM D, YYYY").toLowerCase();
	return lower.includes(localDate);
};

export const fetchTodayYoutubeMusicSongs = async (
	authCookie: string,
	timezone: string,
): Promise<SongEntry[]> => {
	const innertube = await Innertube.create({ cookie: authCookie });
	const history = await innertube.getHistory();

	const songs: SongEntry[] = [];

	for (const section of history.sections) {
		const header = section.header;
		if (!header?.is(YTNodes.ItemSectionHeader)) {
			continue;
		}

		const sectionTitle = header.title.toString();
		if (!isTodayHeader(sectionTitle, timezone)) {
			continue;
		}

		for (const node of section.contents) {
			if (!node.is(YTNodes.Video)) {
				continue;
			}
			const videoId = node.video_id;
			const title = node.title.toString();
			if (videoId) {
				songs.push({ videoId, title });
			}
		}

		break;
	}

	return songs;
};

const claimRedisKey = async (key: string, ttlSeconds: number): Promise<ClaimResult> => {
	const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
	return { claimed: result !== null };
};

const defaultDeps: YoutubeMusicAdapterDeps = {
	claimCacheKey: claimRedisKey,
	fetchTodaySongs: fetchTodayYoutubeMusicSongs,
};

export const fetchYoutubeMusicProgress = async (
	input: YoutubeMusicInput,
	deps: YoutubeMusicAdapterDeps = defaultDeps,
): Promise<MediaImportAdapterResult> => {
	const groupMap = new Map<string, ImportMediaEntityGroup>();
	const now = dayjs().toISOString();
	const localDate = dayjs().tz(input.timezone).format("YYYY-MM-DD");
	const ttl = secondsUntilMidnight(input.timezone);

	let songs: SongEntry[];
	try {
		songs = await deps.fetchTodaySongs(input.authCookie, input.timezone);
	} catch (error) {
		return {
			failures: [
				{
					itemIndex: 0,
					stage: "source_fetch",
					message: error instanceof Error ? error.message : "Failed to fetch YoutubeMusic history",
				},
			],
			entityGroups: [],
		};
	}

	for (const [idx, song] of songs.entries()) {
		const cacheKey = redisKeys.integrations.cache(
			input.integrationId,
			`${input.userId}:${song.videoId}:${localDate}`,
		);

		// oxlint-disable-next-line no-await-in-loop
		const { claimed } = await deps.claimCacheKey(cacheKey, ttl);
		const progressPercent = claimed ? 35 : 100;

		const ref: ImportEntityRef = {
			kind: "resolved",
			sourceLabel: song.title,
			externalId: song.videoId,
			entitySchemaSlug: "music",
			scriptSlug: "music.youtube-music",
		};

		const group = getOrCreateMediaEntityGroup(groupMap, ref, idx);
		group.events.push({
			occurredAt: now,
			eventSchemaSlug: "progress",
			properties: { progressPercent, consumedOn: "youtube_music" },
		});
	}

	return { failures: [], entityGroups: finalizeEntityGroups(groupMap) };
};
