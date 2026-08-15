import type { BackupRun } from "@ryot/contract/modules/backups/schemas";
import { Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";
import { AppButton } from "@/modules/ui/button";

import { backupRunDeleteConfirmation } from "./run-presentation";

export function BackupRunDeleteSheet(props: {
	readonly pending: boolean;
	readonly hasFailed: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly run: Pick<BackupRun, "kind">;
}) {
	const detail = backupRunDeleteConfirmation(props.run);
	return (
		<BottomSheet
			snapPoints={[320]}
			description={detail}
			onClose={props.onClose}
			title="Delete this backup record?"
		>
			<View className="gap-4">
				<Text className="font-ui text-sm leading-6 text-text-muted">{detail}</Text>
				{props.hasFailed ? (
					<Text className="font-ui text-xs text-danger">
						This record could not be deleted. Try again.
					</Text>
				) : null}
				<View className="gap-2 sm:flex-row-reverse">
					<AppButton
						size="default"
						variant="primary"
						label="Delete record"
						className="sm:flex-1"
						pending={props.pending}
						onPress={props.onConfirm}
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
