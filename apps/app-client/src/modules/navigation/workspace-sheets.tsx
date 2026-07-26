import type { NavigationData } from "@ryot/ryotql-recipes/navigation";
import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";

import {
	getNavigationItems,
	getWorkspacePickerSummary,
	type NavigationItems,
} from "./navigation-data";
import { EmptyNavigationSection } from "./sidebar";

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
			<View className="gap-2">
				{props.data.workspaces.map((workspace) => {
					const items = getNavigationItems({ data: props.data, workspaceSlug: workspace.slug });
					const isCurrent = workspace.slug === props.currentWorkspaceSlug;
					return (
						<Pressable
							key={workspace.slug}
							accessibilityRole="button"
							onPress={() => props.onSelect(workspace.slug)}
							accessibilityLabel={`Switch to ${workspace.name} workspace`}
							className={clsx(
								"h-18 flex-row items-center gap-3.5 rounded-lg border px-3.5",
								isCurrent ? "border-accent-text bg-accent-soft" : "border-transparent bg-surface-2",
							)}
						>
							<View
								className={clsx(
									"h-11 w-11 items-center justify-center rounded-xl",
									isCurrent ? "bg-accent" : "bg-accent-soft",
								)}
							>
								<NavigationIcon
									size={21}
									name={workspace.icon}
									className={clsx(isCurrent ? "text-accent-ink" : "text-accent-text")}
								/>
							</View>
							<View className="min-w-0 flex-1 gap-0.5">
								<Text className="font-ui-semibold text-base text-text">{workspace.name}</Text>
								<Text className="font-ui text-xs text-text-muted">
									{getWorkspacePickerSummary(items)}
								</Text>
							</View>
							{isCurrent ? (
								<View className="h-6 w-6 items-center justify-center rounded-full bg-accent">
									<NavigationIcon className="text-accent-ink" name="check" size={14} />
								</View>
							) : (
								<NavigationIcon className="text-text-subtle" name="chevron-right" size={18} />
							)}
						</Pressable>
					);
				})}
			</View>
			<View className="mt-3.5 gap-2">
				<View className="flex-row items-center justify-between">
					<Text className="font-mono text-xs font-bold uppercase tracking-[1.6px] text-text-subtle">
						Saved Views
					</Text>
					<View className="flex-row items-center gap-1">
						<NavigationIcon className="text-accent-text" name="plus" size={14} />
						<Text className="font-ui-medium text-xs text-accent-text">New view</Text>
					</View>
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
