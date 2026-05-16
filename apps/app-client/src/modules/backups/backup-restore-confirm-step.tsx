import { Text, View } from "react-native";

import { AppButton } from "@/modules/ui/button";
import { FormMessage } from "@/modules/ui/form";

const PRECONDITIONS = [
	"This account must be new and empty. If it already holds anything, the restore stops without changing it.",
	"The same plugins and providers this backup was made with must be available on this server.",
	"Integrations and notification channels are not restored. You set those up again yourself.",
	"This cannot be undone, and it cannot be repeated without resetting the account first.",
];

export function BackupRestoreConfirmStep(props: {
	readonly pending: boolean;
	readonly onBack: () => void;
	readonly onRestore: () => void;
	readonly failureDetail: string | undefined;
}) {
	return (
		<View className="gap-4">
			<Text className="font-ui text-sm leading-6 text-text-muted">
				Before this starts, check each of these.
			</Text>
			<View className="gap-2 rounded-lg border border-border bg-surface p-3">
				{PRECONDITIONS.map((line) => (
					<View key={line} className="flex-row gap-2">
						<Text className="font-ui text-xs text-text-subtle">·</Text>
						<Text className="min-w-0 flex-1 font-ui text-xs leading-5 text-text-muted">{line}</Text>
					</View>
				))}
			</View>
			{props.failureDetail === undefined ? null : <FormMessage>{props.failureDetail}</FormMessage>}
			<View className="gap-2 sm:flex-row-reverse sm:justify-end">
				<AppButton
					size="default"
					variant="primary"
					className="sm:px-6"
					pending={props.pending}
					onPress={props.onRestore}
					pendingLabel="Starting..."
					label="Restore this backup"
				/>
				<AppButton
					label="Back"
					size="default"
					className="sm:px-6"
					onPress={props.onBack}
					disabled={props.pending}
					accessibilityLabel="Back to choosing a file"
				/>
			</View>
		</View>
	);
}
