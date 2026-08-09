import { useGoBack } from "@/modules/navigation/use-go-back";
import { ManagedAssetHost } from "@/modules/ui/managed-asset-host";

import { ShowBackdrop } from "./show-backdrop";
import { SHOW_ART_HEIGHT, ShowHero } from "./show-hero";
import { showOverviewManagedAssets } from "./show-overview-state";
import { ShowScreenContent } from "./show-screen-content";
import { ShowScreenFrame } from "./show-screen-frame";
import { showBackdropAsset, showManagedAssets } from "./show-summary-state";
import { ShowTint } from "./show-tint";
import { useShowOverview } from "./use-show-overview";
import { useShowSummary } from "./use-show-summary";

export function ShowScreen(props: { readonly entityId: string }) {
	const goBack = useGoBack();
	const { state, refresh } = useShowSummary(props.entityId);
	const overview = useShowOverview(props.entityId);
	const assets = state.status === "ready" ? showManagedAssets(state.show) : [];
	const overviewAssets =
		overview.state.status === "ready" ? showOverviewManagedAssets(overview.state.overview) : [];
	const title = state.status === "ready" ? state.show.name : "";
	const hasArt = state.status === "ready" && showBackdropAsset(state.show) !== undefined;
	return (
		<ManagedAssetHost label="show summary" assets={assets}>
			<ShowScreenFrame
				title={title}
				onBack={goBack}
				artHeight={hasArt ? SHOW_ART_HEIGHT : undefined}
				tint={state.status === "ready" ? <ShowTint show={state.show} /> : null}
				artwork={
					state.status === "ready" ? (
						<>
							<ShowHero show={state.show} />
							<ShowBackdrop show={state.show} />
						</>
					) : null
				}
			>
				<ManagedAssetHost label="show overview" assets={overviewAssets}>
					<ShowScreenContent
						state={state}
						refresh={refresh}
						overview={overview.state}
						refreshOverview={overview.refresh}
					/>
				</ManagedAssetHost>
			</ShowScreenFrame>
		</ManagedAssetHost>
	);
}
