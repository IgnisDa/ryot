export type ShowProgressProps = {
	readonly name: string;
	readonly totalEpisodes: number;
	readonly watchedEpisodes: number;
};

const episodeLabel = (count: number) => `${count} ${count === 1 ? "episode" : "episodes"}`;

const ShowProgress = ({ name, totalEpisodes, watchedEpisodes }: ShowProgressProps) => {
	const boundedWatched = Math.max(0, Math.min(watchedEpisodes, totalEpisodes));
	const remaining = Math.max(0, totalEpisodes - boundedWatched);

	return (
		<section className="rounded-lg border border-border bg-surface p-4 text-text">
			<h3 className="font-display text-lg">{name}</h3>
			<p className="mt-1 text-sm text-text-muted">
				{episodeLabel(boundedWatched)} watched
				{remaining > 0 ? `, ${episodeLabel(remaining)} remaining` : ", complete"}
			</p>
			<progress
				value={boundedWatched}
				className="mt-3 w-full accent-accent"
				aria-label={`${name} viewing progress`}
				max={Math.max(1, totalEpisodes)}
			/>
		</section>
	);
};

export default ShowProgress;
