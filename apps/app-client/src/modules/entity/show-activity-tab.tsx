import { ManagedAssetHost } from "@/modules/ui/managed-asset-host";

import { ShowActivity } from "./show-activity";
import { showActivityManagedAssets } from "./show-activity-state";
import { useShowActivity } from "./use-show-query";

export function ShowActivityTab(props: { readonly entityId: string }) {
	const { state, refresh } = useShowActivity(props.entityId);
	const assets = state.status === "ready" ? showActivityManagedAssets(state.journal) : [];
	return (
		<ManagedAssetHost label="show activity" assets={assets}>
			<ShowActivity state={state} refresh={refresh} />
		</ManagedAssetHost>
	);
}
