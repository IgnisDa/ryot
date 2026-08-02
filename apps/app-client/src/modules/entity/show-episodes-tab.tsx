import { useState } from "react";

import { ManagedAssetHost } from "@/modules/ui/managed-asset-host";

import { ShowEpisodes } from "./show-episodes";
import { selectedShowSeason, showEpisodesManagedAssets } from "./show-episodes-state";
import { useShowEpisodes } from "./use-show-episodes";
import { useShowSeasonEpisodes } from "./use-show-season-episodes";

export function ShowEpisodesTab(props: { readonly entityId: string }) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const { state, refresh } = useShowEpisodes(props.entityId);
	const seasonId =
		state.status === "ready" ? selectedShowSeason(state.seasons, selectedId).id : null;
	const seasonEpisodes = useShowSeasonEpisodes(props.entityId, seasonId);
	const assets =
		state.status === "ready" ? showEpisodesManagedAssets(state.seasons, seasonEpisodes.state) : [];
	return (
		<ManagedAssetHost label="show episodes" assets={assets}>
			<ShowEpisodes
				state={state}
				refresh={refresh}
				selectedId={selectedId}
				onSelect={setSelectedId}
				seasonEpisodes={seasonEpisodes.state}
				onRefreshSeason={seasonEpisodes.refresh}
			/>
		</ManagedAssetHost>
	);
}
