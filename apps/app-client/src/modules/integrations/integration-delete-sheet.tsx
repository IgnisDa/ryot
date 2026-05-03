import { Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";
import { AppButton } from "@/modules/ui/button";

export function IntegrationDeleteSheet(props: {
	readonly detail: string;
	readonly pending: boolean;
	readonly hasFailed: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}) {
	return (
		<BottomSheet
			snapPoints={[300]}
			onClose={props.onClose}
			description={props.detail}
			title="Delete this integration?"
		>
			<View className="gap-4">
				<Text className="font-ui text-sm leading-6 text-text-muted">{props.detail}</Text>
				{props.hasFailed ? (
					<Text className="font-ui text-xs text-danger">
						This integration could not be deleted. Try again.
					</Text>
				) : null}
				<View className="gap-2 sm:flex-row-reverse">
					<AppButton
						size="default"
						variant="primary"
						className="sm:flex-1"
						pending={props.pending}
						onPress={props.onConfirm}
						label="Delete integration"
						pendingLabel="Deleting..."
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
