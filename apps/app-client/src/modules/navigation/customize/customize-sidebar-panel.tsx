import type { NavigationData } from "@ryot/ryotql-recipes/navigation";
import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import { customizeHaptics } from "./customize-haptics";
import { CustomizePanel } from "./customize-panel";
import type { CustomizeSection } from "./customize-state";
import { useCustomizeDraft } from "./use-customize-draft";

export function CustomizeSidebarPanel(props: {
	onClose: () => void;
	data: NavigationData;
	workspaceSlug: string;
	initialSection?: CustomizeSection | undefined;
}) {
	const customize = useCustomizeDraft({ data: props.data, workspaceSlug: props.workspaceSlug });

	async function save() {
		if (await customize.save()) {
			props.onClose();
		}
	}

	return (
		<View className="flex-1 bg-surface">
			<View className="flex-row items-start gap-3 border-b border-border px-4 py-4">
				<View className="min-w-0 flex-1 gap-1">
					<Text className="font-display-semibold text-xl text-text">Customize sidebar</Text>
					<Text className="font-ui text-xs leading-5 text-text-muted">
						Reorder and choose which views appear in your sidebar.
					</Text>
				</View>
				<Pressable
					onPress={props.onClose}
					className="rounded-md p-1"
					accessibilityRole="button"
					accessibilityLabel="Close customize sidebar"
				>
					<AppIcon className="text-text-muted" name="x" size={18} />
				</Pressable>
			</View>
			<View className="flex-1">
				<CustomizePanel
					draft={customize.draft}
					onMove={customize.move}
					onToggle={customize.toggle}
					onDrop={customizeHaptics.onDrop}
					onPickUp={customizeHaptics.onPickUp}
					initialSection={props.initialSection}
				/>
			</View>
			<View className="gap-2.5 border-t border-border p-3">
				{customize.error !== null && (
					<Text className="font-ui text-xs text-danger">{customize.error}</Text>
				)}
				<View className="flex-row justify-end gap-2">
					<Pressable
						onPress={props.onClose}
						accessibilityRole="button"
						className="rounded-lg px-3 py-2"
						accessibilityLabel="Cancel sidebar customization"
					>
						<Text className="font-ui-medium text-sm text-text-muted">Cancel</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						onPress={() => void save()}
						accessibilityLabel="Save sidebar changes"
						disabled={!customize.isDirty || customize.isSaving}
						className={clsx(
							"rounded-lg px-3 py-2",
							customize.isDirty && !customize.isSaving ? "bg-accent" : "bg-surface-2",
						)}
					>
						<Text
							className={clsx(
								"font-ui-medium text-sm",
								customize.isDirty && !customize.isSaving ? "text-accent-text" : "text-text-subtle",
							)}
						>
							{customize.isSaving ? "Saving..." : "Save changes"}
						</Text>
					</Pressable>
				</View>
			</View>
		</View>
	);
}
