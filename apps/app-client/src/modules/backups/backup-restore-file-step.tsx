import { Text, View } from "react-native";

import { AppButton } from "@/modules/ui/button";
import type { SchemaFilePicker, SchemaFileUpload } from "@/modules/ui/schema-form/file-upload";
import { SchemaFileField } from "@/modules/ui/schema-form/schema-file-field";

const INTRO =
	"Choose the zip archive Ryot exported. It is uploaded to your own server and read once.";

export function BackupRestoreFileStep(props: {
	readonly onContinue: () => void;
	readonly pickFile: SchemaFilePicker;
	readonly uploadFile: SchemaFileUpload;
	readonly uploadToken: string | undefined;
	readonly onTokenChange: (token: string | undefined) => void;
}) {
	return (
		<View className="gap-4">
			<Text className="font-ui text-sm leading-6 text-text-muted">{INTRO}</Text>
			<SchemaFileField
				label="Backup archive"
				pickFile={props.pickFile}
				value={props.uploadToken}
				readyLabel="Ready to restore"
				uploadFile={props.uploadFile}
				onChange={props.onTokenChange}
				allowedFileExtensions={["zip"]}
			/>
			<View className="gap-2 sm:flex-row-reverse sm:justify-end">
				<AppButton
					size="default"
					label="Continue"
					variant="primary"
					className="sm:px-6"
					onPress={props.onContinue}
					disabled={props.uploadToken === undefined}
					accessibilityLabel="Continue to confirm the restore"
				/>
			</View>
		</View>
	);
}
