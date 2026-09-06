import {
	usePageContext,
	usePluginScreenSurface,
	useRyotViewport,
} from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import type { RefObject } from "react";

import { libraryMediaCountRecipe } from "../../shared/lifecycle-list-recipes";
import { ActivitySection } from "./activity-section";
import { AiringRail, airingQuery } from "./airing-rail";
import { BacklogRail } from "./backlog-rail";
import { ContinueRail, libraryEntries, libraryStateQuery } from "./continue-rail";
import { FirstRun } from "./first-run";
import { LazySection } from "./lazy-section";
import { SuggestionsRail } from "./suggestions-rail";
import { TrendingRail } from "./trending-rail";
import { useLocalToday } from "./use-local-today";

const libraryCountQuery = createRyotQuery(({ client, signal }) =>
	client.data.query(libraryMediaCountRecipe(), { signal }),
);

const CONTINUE = { state: "in_progress" } as const;

const BACKLOG = { state: "backlog" } as const;

const SKELETON_RAILS = 3;

function HomeSkeleton() {
	return (
		<div role="status" aria-label="Loading your media" className="flex flex-col gap-8">
			{Array.from({ length: SKELETON_RAILS }, (_, index) => (
				<div key={index} className="h-48 animate-pulse rounded-lg bg-surface-2" />
			))}
		</div>
	);
}

/**
 * The gate decides between the first-run panel and the rails. It fails open: when the count errors
 * the rails still load, and the first-run panel shows only if every eager rail loads empty.
 */
export function HomeBody(props: {
	readonly compact: boolean;
	readonly pluginId: string;
	readonly scrollRootRef: RefObject<HTMLElement | null>;
}) {
	const { compact, scrollRootRef } = props;
	const today = useLocalToday();
	const gate = useRyotQuery(libraryCountQuery);
	const continuing = useRyotQuery(libraryStateQuery, CONTINUE);
	const airing = useRyotQuery(airingQuery, { today });
	const backlog = useRyotQuery(libraryStateQuery, BACKLOG);
	if (gate.data === undefined && gate.status !== "error") {
		return <HomeSkeleton />;
	}
	const railsEmpty =
		continuing.data !== undefined &&
		libraryEntries(continuing.data).length === 0 &&
		backlog.data !== undefined &&
		libraryEntries(backlog.data).length === 0 &&
		airing.data !== undefined &&
		airing.data.shows.length + airing.data.anime.length === 0;
	if (gate.data === 0 || (gate.data === undefined && railsEmpty)) {
		return <FirstRun compact={compact} pluginId={props.pluginId} />;
	}
	return (
		<div className={compact ? "flex flex-col gap-6" : "flex flex-col gap-8"}>
			<ContinueRail today={today} compact={compact} result={continuing} />
			<AiringRail today={today} result={airing} compact={compact} />
			<BacklogRail result={backlog} compact={compact} />
			<LazySection scrollRootRef={scrollRootRef}>
				<SuggestionsRail compact={compact} />
			</LazySection>
			<LazySection scrollRootRef={scrollRootRef}>
				<TrendingRail compact={compact} />
			</LazySection>
			<LazySection scrollRootRef={scrollRootRef}>
				<ActivitySection today={today} compact={compact} />
			</LazySection>
		</div>
	);
}

export default function Home() {
	const { compact } = useRyotViewport();
	const { renderer } = usePageContext();
	const { scrollRootRef } = usePluginScreenSurface();
	return (
		<PluginScreenFrame title="Media">
			<HomeBody
				compact={compact}
				scrollRootRef={scrollRootRef}
				pluginId={renderer.kind === "plugin" ? renderer.pluginId : ""}
			/>
		</PluginScreenFrame>
	);
}
