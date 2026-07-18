import { Text, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { useServerUrl } from "@/modules/server/state";
import { CLOUD_URL } from "@/modules/server/url";
import { BottomSheet } from "@/modules/ui/bottom-sheet";

import { SavedViewLayoutSelector } from "./saved-view-layout-selector";

export function SavedViewFilterSheet(props: { viewSlug: string; onClose: () => void }) {
	const client = useAuthClient();
	const serverUrl = useServerUrl() ?? CLOUD_URL;
	const { data: session } = client.useSession();
	return (
		<BottomSheet
			snapPoints={[260]}
			title="View options"
			onClose={props.onClose}
			description="Choose how the items in this saved view are displayed."
		>
			<View className="gap-2.5">
				<Text className="font-ui-semibold text-[11px] uppercase tracking-[0.8px] text-text-muted">
					Layout
				</Text>
				<View className="flex-row items-center justify-between">
					<Text className="font-ui-medium text-[15px] text-text">View as</Text>
					<SavedViewLayoutSelector
						serverUrl={serverUrl}
						viewSlug={props.viewSlug}
						userId={session?.user.id ?? ""}
					/>
				</View>
			</View>
		</BottomSheet>
	);
}
