import { useGoBack } from "@/modules/navigation/use-go-back";
import { ManagedAssets } from "@/modules/ui/managed-asset-host";

import { ShowBackdrop } from "./show-backdrop";
import { SHOW_ART_HEIGHT, ShowHero } from "./show-hero";
import { ShowScreenContent } from "./show-screen-content";
import { ShowScreenFrame } from "./show-screen-frame";
import { showBackdropAsset, showManagedAssets } from "./show-summary-state";
import { ShowTint } from "./show-tint";
import { useShowSummary } from "./use-show-summary";

export function ShowScreen(props: { readonly entityId: string }) {
	const goBack = useGoBack();
	const { state, refresh } = useShowSummary(props.entityId);
	const assets = state.status === "ready" ? showManagedAssets(state.show) : [];
	const title = state.status === "ready" ? state.show.name : "";
	const hasArt = state.status === "ready" && showBackdropAsset(state.show) !== undefined;
	return (
		<ManagedAssets label="show summary" assets={assets}>
			{(resolution) => (
				<ShowScreenFrame
					title={title}
					onBack={goBack}
					artHeight={hasArt ? SHOW_ART_HEIGHT : undefined}
					tint={
						state.status === "ready" ? (
							<ShowTint show={state.show} managedUrls={resolution.urls} />
						) : null
					}
					artwork={
						state.status === "ready" ? (
							<>
								<ShowHero show={state.show} managedUrls={resolution.urls} />
								<ShowBackdrop show={state.show} managedUrls={resolution.urls} />
							</>
						) : null
					}
				>
					<ShowScreenContent state={state} refresh={refresh} managedUrls={resolution.urls} />
				</ShowScreenFrame>
			)}
		</ManagedAssets>
	);
}
