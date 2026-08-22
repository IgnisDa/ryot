import { useRyotViewport, type EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { useState, type ReactNode } from "react";

import { ShowActivityTab } from "./activity";
import { ShowEpisodesTab } from "./episodes";
import { SHOW_ART_HEIGHT, SHOW_BACKDROP_HEIGHT, ShowHero } from "./hero";
import { ManagedAssetProvider } from "./managed-assets";
import { ShowOverview } from "./overview";
import {
	mapShowOverview,
	showOverviewManagedAssets,
	type ShowOverviewState,
} from "./overview-state";
import { ShowStatusMessage } from "./primitives";
import { showOverviewQuery, showSummaryQuery } from "./queries";
import { ShowSummaryHeader } from "./summary-header";
import {
	mapShowSummary,
	showManagedAssets,
	showSummaryError,
	showSummaryUnavailable,
	type ShowSummaryState,
} from "./summary-state";
import { ShowTabBar, type ShowTabKey } from "./tabs";

export function ShowScreenBody(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly episodes: ReactNode;
	readonly activity: ReactNode;
	readonly state: ShowSummaryState;
	readonly refreshOverview: () => void;
	readonly overview: ShowOverviewState;
}) {
	const { state } = props;
	const [activeTab, setActiveTab] = useState<ShowTabKey>("overview");
	if (state.status === "loading") {
		return (
			<ShowStatusMessage
				title="Loading show..."
				detail="Fetching the latest details for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <ShowStatusMessage {...showSummaryError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "unavailable") {
		return <ShowStatusMessage {...showSummaryUnavailable(state.reason)} />;
	}
	const tabContent: Record<ShowTabKey, ReactNode> = {
		episodes: props.episodes,
		activity: props.activity,
		overview: (
			<ShowOverview
				show={state.show}
				compact={props.compact}
				overview={props.overview}
				refreshOverview={props.refreshOverview}
			/>
		),
	};
	return (
		<div className="flex flex-col gap-4">
			<ShowSummaryHeader show={state.show} compact={props.compact} />
			<ShowTabBar activeTab={activeTab} compact={props.compact} onSelect={setActiveTab} />
			{tabContent[activeTab]}
		</div>
	);
}

export function ShowScreen(props: EntityRendererProps) {
	const { compact } = useRyotViewport();
	const summaryResult = useRyotQuery(showSummaryQuery, { entityId: props.entityId });
	const overviewResult = useRyotQuery(showOverviewQuery, { entityId: props.entityId });
	const state = mapShowSummary(summaryResult);
	const overview = mapShowOverview(overviewResult);
	const assets = state.status === "ready" ? showManagedAssets(state.show) : [];
	const overviewAssets =
		overview.status === "ready" ? showOverviewManagedAssets(overview.overview) : [];
	return (
		<ManagedAssetProvider assets={assets}>
			<PluginScreenFrame
				hideTitle
				title={state.status === "ready" ? state.show.name : null}
				hero={
					state.status === "ready"
						? {
								node: <ShowHero compact={compact} show={state.show} />,
								height: compact ? SHOW_ART_HEIGHT : SHOW_BACKDROP_HEIGHT,
							}
						: undefined
				}
			>
				<ManagedAssetProvider assets={overviewAssets}>
					<ShowScreenBody
						state={state}
						compact={compact}
						overview={overview}
						refresh={summaryResult.refetch}
						refreshOverview={overviewResult.refetch}
						episodes={<ShowEpisodesTab compact={compact} entityId={props.entityId} />}
						activity={<ShowActivityTab compact={compact} entityId={props.entityId} />}
					/>
				</ManagedAssetProvider>
			</PluginScreenFrame>
		</ManagedAssetProvider>
	);
}
