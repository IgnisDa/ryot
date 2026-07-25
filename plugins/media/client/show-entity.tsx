import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, Chip, StatusMessage } from "@ryot-app/client-ui-sdk";

import { showSummaryRecipe, type ShowDetails, type ShowRecipeResult } from "./show-recipe";
import {
	classifyShow,
	remoteShowCover,
	showEpisodeCountLabel,
	showIdentityLabel,
	showSeasonCountLabel,
} from "./show-state";

const showQuery = createRyotQuery<{ readonly entityId: string }, ShowRecipeResult>(
	({ client, input, signal }) => client.data.query(showSummaryRecipe(input), { signal }),
);

const ShowUnavailable = (props: { readonly reason: "missing" | "wrong-schema" }) => (
	<PluginScreenFrame title="Show unavailable">
		<section className="rounded-xl border border-border bg-surface p-5 text-text">
			<h2 className="font-display text-xl">Show unavailable</h2>
			<p className="mt-2 text-text-muted">
				{props.reason === "missing"
					? "This entity no longer exists."
					: "This entity is not a Show."}
			</p>
		</section>
	</PluginScreenFrame>
);

const ShowFact = (props: { readonly label: string; readonly value: string }) => (
	<div className="min-w-28 border-l-2 border-accent-border pl-3">
		<dt className="text-xs font-medium uppercase tracking-wide text-text-subtle">{props.label}</dt>
		<dd className="mt-1 font-medium text-text">{props.value}</dd>
	</div>
);

const ReadyShow = (props: { readonly show: ShowDetails }) => {
	const cover = remoteShowCover(props.show);
	const seasons = showSeasonCountLabel(props.show);
	const episodes = showEpisodeCountLabel(props.show);

	return (
		<PluginScreenFrame title={props.show.name}>
			<article className="text-text">
				<div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
					{cover === undefined ? null : (
						<img
							alt=""
							src={cover.url}
							className="aspect-2/3 w-32 shrink-0 rounded-xl bg-surface-2 object-cover shadow-sm md:w-60"
						/>
					)}
					<div className="min-w-0 flex-1">
						<header>
							<h2 className="font-display text-3xl leading-tight text-text md:text-4xl">
								{props.show.name}
							</h2>
							<p className="mt-2 text-sm text-text-muted">{showIdentityLabel(props.show)}</p>
							{props.show.genres === null || props.show.genres.length === 0 ? null : (
								<div className="mt-3 flex flex-wrap gap-2">
									{props.show.genres.map((genre) => (
										<Chip checked={false} key={genre} label={genre} />
									))}
								</div>
							)}
						</header>
						{props.show.productionStatus === null &&
						seasons === undefined &&
						episodes === undefined ? null : (
							<dl className="mt-7 flex flex-wrap gap-5">
								{props.show.productionStatus === null ? null : (
									<ShowFact label="Production status" value={props.show.productionStatus} />
								)}
								{seasons === undefined ? null : <ShowFact label="Seasons" value={seasons} />}
								{episodes === undefined ? null : <ShowFact label="Episodes" value={episodes} />}
							</dl>
						)}
						{props.show.description === null ? null : (
							<p className="mt-7 max-w-3xl whitespace-pre-wrap leading-7 text-text-muted">
								{props.show.description}
							</p>
						)}
					</div>
				</div>
			</article>
		</PluginScreenFrame>
	);
};

export const ShowEntityScreen = (props: EntityRendererProps) => {
	const result = useRyotQuery(showQuery, { entityId: props.entityId });

	if (result.status === "error") {
		return (
			<PluginScreenFrame title="Show">
				<div className="flex flex-col items-start gap-4">
					<StatusMessage tone="error">Unable to load this show.</StatusMessage>
					<Button disabled={result.isFetching} onClick={result.refetch}>
						Try again
					</Button>
				</div>
			</PluginScreenFrame>
		);
	}
	if (result.status === "pending" || result.data === undefined) {
		return (
			<PluginScreenFrame title="Show">
				<StatusMessage tone="pending">Loading show...</StatusMessage>
			</PluginScreenFrame>
		);
	}

	const state = classifyShow(result.data);
	if (state.kind === "missing") {
		return <ShowUnavailable reason="missing" />;
	}
	if (state.kind === "wrong-schema") {
		return <ShowUnavailable reason="wrong-schema" />;
	}
	return <ReadyShow show={state.show} />;
};
