import { useMediaMessages } from "../messages";

export type ShowProgressProps = {
	readonly name: string;
	readonly totalEpisodes: number;
	readonly watchedEpisodes: number;
};

const ShowProgress = ({ name, totalEpisodes, watchedEpisodes }: ShowProgressProps) => {
	const text = useMediaMessages();
	const boundedWatched = Math.max(0, Math.min(watchedEpisodes, totalEpisodes));
	const remaining = Math.max(0, totalEpisodes - boundedWatched);

	return (
		<section className="rounded-lg border border-border bg-surface p-4 text-text">
			<h3 className="font-display text-lg">{name}</h3>
			<p className="mt-1 text-sm text-text-muted">
				{remaining > 0
					? text("show.progress-remaining", { remaining, watched: boundedWatched })
					: text("show.progress-complete", { watched: boundedWatched })}
			</p>
			<progress
				value={boundedWatched}
				max={Math.max(1, totalEpisodes)}
				className="mt-3 w-full accent-accent"
				aria-label={text("show.progress-label", { name })}
			/>
		</section>
	);
};

export default ShowProgress;
