import { useDisplayText } from "@ryot-app/plugin-client-sdk/react";
import type { ReactNode } from "react";

import type { AiringScheduleList } from "../../shared/anime";
import { formatLocalDateTimeLabel } from "../media/date";
import { MediaLabeledRows, MediaOverviewSection } from "../media/primitives";
import { useMediaCopy } from "../messages";

const UPCOMING_EPISODE_LIMIT = 6;

/** The next episodes still to air, soonest first. Providers keep every past entry too. */
export const animeUpcomingEpisodes = (schedule: AiringScheduleList, now: number = Date.now()) =>
	[...(schedule ?? [])]
		.filter((entry) => Date.parse(entry.airingAt) > now)
		.sort((left, right) => Date.parse(left.airingAt) - Date.parse(right.airingAt))
		.slice(0, UPCOMING_EPISODE_LIMIT);

export function AnimeAiringScheduleSection(props: { readonly schedule: AiringScheduleList }) {
	const { text, formatters } = useMediaCopy();
	const displayText = useDisplayText();
	const upcoming = animeUpcomingEpisodes(props.schedule);
	if (upcoming.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection title={text("property.airing-schedule")}>
			<MediaLabeledRows
				rows={upcoming.map((entry) => ({
					key: `${entry.episode}:${entry.airingAt}`,
					title: text("log.episode-code", { episode: entry.episode }),
					detail: displayText(formatLocalDateTimeLabel(formatters, entry.airingAt)),
				}))}
			/>
		</MediaOverviewSection>
	);
}

export const animeAiringTrailing = (input: {
	readonly summary: { readonly airingSchedule: AiringScheduleList };
}): ReactNode => <AnimeAiringScheduleSection schedule={input.summary.airingSchedule} />;
