import { usePluginScreenSurface, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Skeleton } from "@ryot-app/plugin-ui-sdk";
import type { RefObject } from "react";

import { libraryMediaCountRecipe } from "../../shared/lifecycle-list-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { ActivitySection } from "./activity-section";
import { AddTitleMenu } from "./add-title";
import { airingQuery, AiringRail } from "./airing-rail";
import { BacklogRail } from "./backlog-rail";
import { ContinueRail, libraryStateQuery } from "./continue-rail";
import { FirstRun } from "./first-run";
import { LazySection } from "./lazy-section";
import { SuggestionsRail } from "./suggestions-rail";
import { TrendingRail } from "./trending-rail";
import { useLocalToday } from "./use-local-today";

const libraryCountQuery = createRyotQuery(({ client }) =>
	client.data.query(libraryMediaCountRecipe(client.pluginIdentity(PLUGIN_PACKAGE_ID))),
);

const CONTINUE = { state: "in_progress" } as const;

const BACKLOG = { state: "backlog" } as const;

const SKELETON_RAILS = 3;

function HomeSkeleton() {
	return (
		<div role="status" aria-label="Loading your media" className="flex flex-col gap-8">
			{Array.from({ length: SKELETON_RAILS }, (_rail, index) => (
				<div key={index} className="flex flex-col gap-3">
					<Skeleton className="h-5 w-40" />
					<div className="flex gap-4 overflow-hidden">
						{Array.from({ length: 6 }, (_tile, tile) => (
							<Skeleton key={tile} className="h-48 w-32 shrink-0 rounded-lg" />
						))}
					</div>
				</div>
			))}
		</div>
	);
}

export function HomeBody(props: {
	readonly compact: boolean;
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
	if (gate.data === 0) {
		return <FirstRun compact={compact} />;
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
	const { scrollRootRef } = usePluginScreenSurface();
	return (
		<PluginScreenFrame
			title="Media"
			actions={<AddTitleMenu variant="button" />}
			barActions={<AddTitleMenu variant="icon" />}
		>
			<HomeBody compact={compact} scrollRootRef={scrollRootRef} />
		</PluginScreenFrame>
	);
}
