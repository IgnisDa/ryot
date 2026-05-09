import { ManagedAssetHost } from "@/modules/ui/managed-asset-host";

import { ShowEpisodes } from "./show-episodes";
import { showEpisodesManagedAssets } from "./show-episodes-state";
import { useShowEpisodes } from "./use-show-episodes";

export function ShowEpisodesTab(props: { readonly entityId: string }) {
	const { state, refresh } = useShowEpisodes(props.entityId);
	const assets = state.status === "ready" ? showEpisodesManagedAssets(state.seasons) : [];
	return (
		<ManagedAssetHost label="show episodes" assets={assets}>
			<ShowEpisodes state={state} refresh={refresh} />
		</ManagedAssetHost>
	);
}
