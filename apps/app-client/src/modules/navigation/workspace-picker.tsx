import type { NavigationData, NavigationWorkspace } from "@ryot/ryotql-recipes/navigation";
import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

import { AppIcon as NavigationIcon } from "@/modules/icons";

import { getNavigationItems, getWorkspacePickerSummary } from "./navigation-data";

type WorkspacePickerVariant = "desktop" | "mobile";

const pickerStyles = {
	desktop: {
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
	},
	mobile: {
		iconSize: 21,
		list: "gap-2",
		indicatorSize: 18,
		currentIcon: "bg-accent",
		otherIcon: "bg-accent-soft",
		otherIndicator: "text-text-subtle",
		currentIndicator: "text-accent-ink",
		otherWorkspaceIcon: "text-accent-text",
		currentWorkspaceIcon: "text-accent-ink",
		detail: "font-ui text-xs text-text-muted",
		otherRow: "border-transparent bg-surface-2",
		name: "font-ui-semibold text-base text-text",
		currentRow: "border-accent-text bg-accent-soft",
		icon: "h-11 w-11 items-center justify-center rounded-xl",
		row: "h-18 flex-row items-center gap-3.5 rounded-lg border px-3.5",
	},
} as const;

function WorkspacePickerIndicator(props: { isCurrent: boolean; variant: WorkspacePickerVariant }) {
	if (props.variant === "mobile" && props.isCurrent) {
		return (
			<View className="h-6 w-6 items-center justify-center rounded-full bg-accent">
				<NavigationIcon className="text-accent-ink" name="check" size={14} />
			</View>
		);
	}

	let name: "chevron-right" | "circle-check" = "chevron-right";
	if (props.isCurrent) {
		name = "circle-check";
	}
	const styles = pickerStyles[props.variant];

	return (
		<NavigationIcon
			name={name}
			size={styles.indicatorSize}
			className={clsx(
				props.isCurrent && styles.currentIndicator,
				!props.isCurrent && styles.otherIndicator,
			)}
		/>
	);
}

function WorkspacePickerRow(props: {
	summary: string;
	isCurrent: boolean;
	onSelect: () => void;
	workspace: NavigationWorkspace;
	variant: WorkspacePickerVariant;
}) {
	const styles = pickerStyles[props.variant];

	return (
		<Pressable
			onPress={props.onSelect}
			accessibilityRole="button"
			accessibilityLabel={`Switch to ${props.workspace.name} workspace`}
			className={clsx(
				styles.row,
				props.isCurrent && styles.currentRow,
				!props.isCurrent && styles.otherRow,
			)}
		>
			<View
				className={clsx(
					styles.icon,
					props.isCurrent && styles.currentIcon,
					!props.isCurrent && styles.otherIcon,
				)}
			>
				<NavigationIcon
					size={styles.iconSize}
					name={props.workspace.icon}
					className={clsx(
						props.isCurrent && styles.currentWorkspaceIcon,
						!props.isCurrent && styles.otherWorkspaceIcon,
					)}
				/>
			</View>
			<View className={clsx("flex-1", props.variant === "mobile" && "min-w-0 gap-0.5")}>
				<Text className={styles.name}>{props.workspace.name}</Text>
				<Text className={styles.detail}>{props.summary}</Text>
			</View>
			<WorkspacePickerIndicator isCurrent={props.isCurrent} variant={props.variant} />
		</Pressable>
	);
}

export function WorkspacePickerList(props: {
	data: NavigationData;
	currentWorkspaceSlug: string;
	variant: WorkspacePickerVariant;
	onSelect: (slug: string) => void;
}) {
	return (
		<View className={pickerStyles[props.variant].list}>
			{props.data.workspaces.map((workspace) => {
				const items = getNavigationItems({ data: props.data, workspaceSlug: workspace.slug });
				return (
					<WorkspacePickerRow
						key={workspace.slug}
						workspace={workspace}
						variant={props.variant}
						summary={getWorkspacePickerSummary(items)}
						onSelect={() => props.onSelect(workspace.slug)}
						isCurrent={workspace.slug === props.currentWorkspaceSlug}
					/>
				);
			})}
		</View>
	);
}
