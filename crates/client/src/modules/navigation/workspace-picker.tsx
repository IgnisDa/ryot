import type { NavigationData, NavigationWorkspace } from "@ryot-app/ryotql-recipes/navigation";
import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";

import { getNavigationItems, getWorkspacePickerSummary } from "./navigation-data";

const pickerStyles = {
	iconSize: 18,
	indicatorSize: 16,
	list: "w-full gap-2",
	currentIcon: "bg-accent",
	otherIcon: "bg-surface-2",
	otherWorkspaceIcon: "text-text",
	otherIndicator: "text-text-subtle",
	currentIndicator: "text-accent-text",
	otherRow: "border-border bg-surface",
	name: "font-ui text-[15px] text-text",
	currentWorkspaceIcon: "text-accent-ink",
	detail: "font-ui text-xs text-text-muted",
	currentRow: "border-accent bg-accent-soft",
	icon: "h-9 w-9 items-center justify-center rounded-[10px]",
	row: "w-full flex-row items-center gap-3 rounded-xl border px-3 py-3",
} as const;

function WorkspacePickerIndicator(props: { isCurrent: boolean }) {
	let name: "chevron-right" | "circle-check" = "chevron-right";
	if (props.isCurrent) {
		name = "circle-check";
	}

	return (
		<NavigationIcon
			name={name}
			size={pickerStyles.indicatorSize}
			className={clsx(
				props.isCurrent && pickerStyles.currentIndicator,
				!props.isCurrent && pickerStyles.otherIndicator,
			)}
		/>
	);
}

function WorkspacePickerRow(props: {
	summary: string;
	isCurrent: boolean;
	onSelect: () => void;
	workspace: NavigationWorkspace;
}) {
	return (
		<Pressable
			onPress={props.onSelect}
			accessibilityRole="button"
			accessibilityLabel={`Switch to ${props.workspace.name} workspace`}
			className={clsx(
				pickerStyles.row,
				props.isCurrent && pickerStyles.currentRow,
				!props.isCurrent && pickerStyles.otherRow,
			)}
		>
			<View
				className={clsx(
					pickerStyles.icon,
					props.isCurrent && pickerStyles.currentIcon,
					!props.isCurrent && pickerStyles.otherIcon,
				)}
			>
				<NavigationIcon
					name={props.workspace.icon}
					size={pickerStyles.iconSize}
					className={clsx(
						props.isCurrent && pickerStyles.currentWorkspaceIcon,
						!props.isCurrent && pickerStyles.otherWorkspaceIcon,
					)}
				/>
			</View>
			<View className="flex-1">
				<Text className={pickerStyles.name}>{props.workspace.name}</Text>
				<Text className={pickerStyles.detail}>{props.summary}</Text>
			</View>
			<WorkspacePickerIndicator isCurrent={props.isCurrent} />
		</Pressable>
	);
}

export function WorkspacePickerList(props: {
	data: NavigationData;
	currentWorkspaceSlug: string;
	onSelect: (slug: string) => void;
}) {
	return (
		<View className={pickerStyles.list}>
			{props.data.workspaces.map((workspace) => {
				const items = getNavigationItems({ data: props.data, workspaceSlug: workspace.slug });
				return (
					<WorkspacePickerRow
						key={workspace.slug}
						workspace={workspace}
						summary={getWorkspacePickerSummary(items)}
						onSelect={() => props.onSelect(workspace.slug)}
						isCurrent={workspace.slug === props.currentWorkspaceSlug}
					/>
				);
			})}
		</View>
	);
}

export function WorkspaceSwitcher(props: {
	data: NavigationData;
	currentWorkspaceSlug: string;
	onSelect: (slug: string) => void;
}) {
	return (
		<View className="gap-2.5">
			<View className="flex-row items-center gap-2 rounded-lg border border-border-strong bg-transparent px-2.5 py-2">
				<NavigationIcon className="text-text-muted" name="search" size={14} />
				<Text className="font-ui text-xs text-text-muted">Find workspace</Text>
			</View>
			<WorkspacePickerList
				data={props.data}
				onSelect={props.onSelect}
				currentWorkspaceSlug={props.currentWorkspaceSlug}
			/>
		</View>
	);
}
