import type { NavigationData } from "@ryot/ryotql-recipes/navigation";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";

import { WorkspaceSwitcher } from "./workspace-picker";

export function WorkspaceSheet(props: {
	onClose: () => void;
	data: NavigationData;
	currentWorkspaceSlug: string;
	onSelect: (slug: string) => void;
	onCustomize?: (() => void) | undefined;
}) {
	return (
		<BottomSheet
			title="Workspaces"
			snapPoints={[420]}
			onClose={props.onClose}
			description="Switch between workspaces."
		>
			<View className="gap-2.5">
				<WorkspaceSwitcher
					data={props.data}
					onSelect={props.onSelect}
					currentWorkspaceSlug={props.currentWorkspaceSlug}
				/>
				{props.onCustomize && (
					<Pressable
						accessibilityRole="button"
						onPress={props.onCustomize}
						accessibilityLabel="Customize sidebar"
						className="flex-row items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
					>
						<AppIcon className="text-text-muted" name="sliders-horizontal" size={16} />
						<Text className="font-ui-medium text-sm text-text">Customize sidebar…</Text>
					</Pressable>
				)}
			</View>
		</BottomSheet>
	);
}
