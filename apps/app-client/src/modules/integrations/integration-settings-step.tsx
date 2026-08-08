import type { ListedIntegrationProvider } from "@ryot/contract/modules/integrations/schemas";
import { Text, View } from "react-native";

import { AppButton } from "@/modules/ui/button";
import { FormMessage } from "@/modules/ui/form";
import type { SchemaFileUpload } from "@/modules/ui/schema-form/file-upload";
import type { SchemaFormApi } from "@/modules/ui/schema-form/schema-form";

import { IntegrationSettingsForm } from "./integration-settings-form";

export function IntegrationSettingsStep(props: {
	readonly onBack: () => void;
	readonly form: SchemaFormApi;
	readonly onContinue: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly failureDetail: string | undefined;
	readonly provider: ListedIntegrationProvider;
}) {
	return (
		<View className="gap-4">
			<View className="gap-1">
				<Text className="font-display-semibold text-lg text-text">{props.provider.name}</Text>
				<Text className="font-ui text-sm leading-6 text-text-muted">
					{props.provider.description}
				</Text>
			</View>
			<IntegrationSettingsForm
				mode="create"
				form={props.form}
				provider={props.provider}
				uploadFile={props.uploadFile}
			/>
			{props.failureDetail === undefined ? null : <FormMessage>{props.failureDetail}</FormMessage>}
			<View className="gap-2 sm:flex-row-reverse sm:justify-end">
				<AppButton
					size="default"
					label="Continue"
					variant="primary"
					className="sm:px-6"
					onPress={props.onContinue}
				/>
				<AppButton size="default" label="Back" onPress={props.onBack} className="sm:px-6" />
			</View>
		</View>
	);
}
