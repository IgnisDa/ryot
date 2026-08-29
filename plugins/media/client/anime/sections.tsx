import type { ReactNode } from "react";

import type { AiringScheduleList } from "../../shared/anime";
import { formatLocalDateTimeLabel } from "../media/date";
import { MediaLabeledRows, MediaOverviewSection } from "../media/primitives";

const UPCOMING_EPISODE_LIMIT = 6;

/** The next episodes still to air, soonest first. Providers keep every past entry too. */
export const animeUpcomingEpisodes = (schedule: AiringScheduleList, now: number = Date.now()) =>
	[...(schedule ?? [])]
		.filter((entry) => Date.parse(entry.airingAt) > now)
		.sort((left, right) => Date.parse(left.airingAt) - Date.parse(right.airingAt))
		.slice(0, UPCOMING_EPISODE_LIMIT);

export function AnimeAiringScheduleSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly schedule: AiringScheduleList;
}) {
	const upcoming = animeUpcomingEpisodes(props.schedule);
	if (upcoming.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection title="Airing schedule" divided={props.divided} compact={props.compact}>
			<MediaLabeledRows
				rows={upcoming.map((entry) => ({
					title: `Episode ${entry.episode}`,
					key: `${entry.episode}:${entry.airingAt}`,
					detail: formatLocalDateTimeLabel(entry.airingAt),
				}))}
			/>
		</MediaOverviewSection>
	);
}

export const animeAiringTrailing = (input: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly summary: { readonly airingSchedule: AiringScheduleList };
}): ReactNode => (
	<AnimeAiringScheduleSection
		compact={input.compact}
		divided={input.divided}
		schedule={input.summary.airingSchedule}
	/>
);
