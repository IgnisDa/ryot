import type { ManagedAssetLocator, ManagedAssetResolution } from "@ryot-app/client-sdk";
import type { EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, Chip, StatusMessage } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useEffect, useEffectEvent, useState } from "react";

import type { MediaImage } from "../shared/media-image";
import { showSummaryRecipe, type ShowSummaryResult } from "../shared/show-recipes";
import {
	classifyShow,
	remoteShowBackdrop,
	showCover,
	showEpisodeCountLabel,
	showIdentityLabel,
	showSeasonCountLabel,
	type ShowDetails,
} from "./show-state";

const SHOW_SUMMARY_COLLECTION_LIMIT = 6;

const showQuery = createRyotQuery<{ readonly entityId: string }, ShowSummaryResult>(
	({ client, input, signal }) =>
		client.data.query(
			showSummaryRecipe({ ...input, collectionLimit: SHOW_SUMMARY_COLLECTION_LIMIT }),
			{ signal },
		),
);

const managedCoverQuery = createRyotQuery<ManagedAssetLocator, ManagedAssetResolution>(
	async ({ client, input, signal }) => {
		const [resolution] = await client.assets.resolve([input], { signal });
		if (resolution === undefined) {
			throw new Error("Managed asset resolution returned no result");
		}
		return resolution;
	},
	{ cancelOnUnmount: true },
);

const ASSET_REFRESH_LEAD_MS = 60_000;
const coverClassName =
	"absolute top-0 left-0 aspect-2/3 w-28 rounded-xl bg-surface-2 object-cover shadow-sm md:relative md:w-60 md:shrink-0";

const ShowUnavailable = (props: { readonly reason: "missing" | "wrong-schema" }) => (
	<PluginScreenFrame title="Show unavailable">
		<p className="rounded-xl border border-border bg-surface p-5 text-text-muted">
			{props.reason === "missing" ? "This entity no longer exists." : "This entity is not a Show."}
		</p>
	</PluginScreenFrame>
);

const ShowArt = (props: { readonly url: string }) => (
	<div className="relative h-65 overflow-hidden md:h-85">
		<img alt="" src={props.url} className="size-full object-cover" />
		<div className="absolute inset-0 bg-linear-to-b from-bg/35 via-bg/70 to-bg" />
	</div>
);

const CoverPlaceholder = (props: { readonly loading: boolean }) => (
	<div
		aria-hidden="true"
		className={clsx(coverClassName, "bg-surface-2", props.loading && "animate-pulse")}
	/>
);

const CoverImage = (props: { readonly url: string; readonly onError?: () => void }) => {
	const [failedUrl, setFailedUrl] = useState<string>();
	if (failedUrl === props.url) {
		return <CoverPlaceholder loading={false} />;
	}
	return (
		<img
			alt=""
			loading="lazy"
			src={props.url}
			className={coverClassName}
			onError={() => {
				setFailedUrl(props.url);
				props.onError?.();
			}}
		/>
	);
};

const ManagedShowCover = (props: { readonly asset: ManagedAssetLocator }) => {
	const result = useRyotQuery(managedCoverQuery, props.asset);
	const refresh = useEffectEvent(() => result.refetch());
	const resolution = result.data;

	useEffect(() => {
		const timer =
			resolution === undefined
				? undefined
				: window.setTimeout(
						refresh,
						Math.max(
							ASSET_REFRESH_LEAD_MS,
							Date.parse(resolution.expiresAt) - ASSET_REFRESH_LEAD_MS - Date.now(),
						),
					);
		return () => window.clearTimeout(timer);
	}, [resolution]);

	return resolution === undefined ? (
		<CoverPlaceholder loading={result.status === "pending"} />
	) : (
		<CoverImage url={resolution.url} onError={refresh} />
	);
};

const ShowCover = (props: { readonly image: MediaImage }) =>
	props.image.type === "remote" ? (
		<CoverImage url={props.image.url} />
	) : (
		<ManagedShowCover asset={{ type: props.image.type, key: props.image.key }} />
	);

const ShowFact = (props: { readonly label: string; readonly value: string }) => (
	<div className="min-w-28 border-l-2 border-accent-border pl-3">
		<dt className="text-xs font-medium uppercase tracking-wide text-text-subtle">{props.label}</dt>
		<dd className="mt-1 font-medium text-text">{props.value}</dd>
	</div>
);

const ReadyShow = (props: { readonly show: ShowDetails }) => {
	const cover = showCover(props.show);
	const backdrop = remoteShowBackdrop(props.show);
	const seasons = showSeasonCountLabel(props.show);
	const episodes = showEpisodeCountLabel(props.show);

	return (
		<PluginScreenFrame
			hideTitle
			title={props.show.name}
			hero={backdrop === undefined ? undefined : <ShowArt url={backdrop.url} />}
		>
			<article
				className={clsx(
					"relative flex flex-col gap-6 text-text md:flex-row md:items-start md:gap-8",
					backdrop !== undefined && "-mt-36 md:-mt-64",
				)}
			>
				{cover === undefined ? null : <ShowCover image={cover} />}
				<div className="min-w-0 flex-1">
					<div
						className={clsx(
							"flex flex-col justify-end gap-2.5 md:pl-0",
							cover === undefined ? undefined : "min-h-40 pl-32 md:min-h-56",
						)}
					>
						<h1 className="font-display text-3xl leading-tight text-text md:text-4xl">
							{props.show.name}
						</h1>
						<p className="text-sm text-text-muted">{showIdentityLabel(props.show)}</p>
						{props.show.genres === null || props.show.genres.length === 0 ? null : (
							<div className="flex flex-wrap gap-2">
								{props.show.genres.map((genre) => (
									<Chip checked={false} key={genre} label={genre} />
								))}
							</div>
						)}
					</div>
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
