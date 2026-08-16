import type { ComponentProps } from "react";
import { Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";
import { AppButton } from "@/modules/ui/button";

export function DestructiveActionSheet(props: {
	readonly title: string;
	readonly detail: string;
	readonly pending: boolean;
	readonly actionLabel: string;
	readonly pendingLabel: string;
	readonly errorMessage?: string;
	readonly actionDisabled?: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly snapPoints: ComponentProps<typeof BottomSheet>["snapPoints"];
}) {
	return (
		<BottomSheet
			title={props.title}
			onClose={props.onClose}
			description={props.detail}
			dismissible={!props.pending}
			snapPoints={props.snapPoints}
		>
			<View className="gap-4">
				<Text className="font-ui text-sm leading-6 text-text-muted">{props.detail}</Text>
				{props.errorMessage === undefined ? null : (
					<Text className="font-ui text-xs text-danger">{props.errorMessage}</Text>
				)}
				<View className="gap-2 sm:flex-row-reverse">
					<AppButton
						size="default"
						variant="primary"
						className="sm:flex-1"
						pending={props.pending}
						onPress={props.onConfirm}
						label={props.actionLabel}
						pendingLabel={props.pendingLabel}
						disabled={props.actionDisabled}
						leading={<AppIcon size={15} name="trash-2" className="text-accent-ink" />}
					/>
					<AppButton
						size="default"
						label="Keep it"
						className="sm:flex-1"
						onPress={props.onClose}
						disabled={props.pending}
					/>
				</View>
			</View>
		</BottomSheet>
	);
}
