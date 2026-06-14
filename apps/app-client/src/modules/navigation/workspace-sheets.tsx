import type { NavigationData } from "@ryot/ryotql-recipes/navigation";
import { Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";

import type { NavigationItems } from "./navigation-data";
import { EmptyNavigationSection } from "./sidebar";
import { WorkspacePickerList } from "./workspace-picker";

export function WorkspaceSheet(props: {
	onClose: () => void;
	data: NavigationData;
	items: NavigationItems;
	currentWorkspaceSlug: string;
	onSelect: (slug: string) => void;
}) {
	return (
		<BottomSheet
			title="Workspaces"
			snapPoints={[465]}
			onClose={props.onClose}
			description="Switch between workspaces and review saved views."
		>
			<WorkspacePickerList
				variant="mobile"
				data={props.data}
				onSelect={props.onSelect}
				currentWorkspaceSlug={props.currentWorkspaceSlug}
			/>
			<View className="mt-3.5 gap-2">
				<View className="flex-row items-center justify-between">
					<Text className="font-mono text-xs font-bold uppercase tracking-[1.6px] text-text-subtle">
						Saved Views
					</Text>
				</View>
				<View className="flex-row flex-wrap gap-2">
					{props.items.savedViews.length === 0 ? (
						<EmptyNavigationSection message="No saved views yet." />
					) : (
						props.items.savedViews.map((item) => (
							<View
								key={item.slug}
								className="h-9 flex-row items-center gap-2 rounded-pill border border-border bg-surface-2 px-3"
							>
								<NavigationIcon className="text-text-muted" name={item.icon} size={15} />
								<Text className="font-ui-medium text-sm text-text">{item.name}</Text>
							</View>
						))
					)}
				</View>
			</View>
		</BottomSheet>
	);
}
