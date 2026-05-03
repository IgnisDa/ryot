import type { ListedIntegrationProvider } from "@ryot/contract/modules/integrations/schemas";
import { Text, View } from "react-native";

import type { SchemaFileUpload } from "@/modules/ui/schema-form/file-upload";
import { SchemaForm, type SchemaFormApi } from "@/modules/ui/schema-form/schema-form";
import type { SchemaFormMode } from "@/modules/ui/schema-form/schema-form-state";

import { integrationLotDetail } from "./provider-selection";

export function IntegrationSettingsForm(props: {
	readonly mode: SchemaFormMode;
	readonly form: SchemaFormApi;
	readonly uploadFile: SchemaFileUpload;
	readonly provider: ListedIntegrationProvider;
}) {
	return (
		<View className="gap-5">
			<View className="gap-2">
				<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
					{props.provider.name}
				</Text>
				<SchemaForm
					mode={props.mode}
					form={props.form}
					onChange={() => undefined}
					uploadFile={props.uploadFile}
					schema={props.provider.settingsSchema}
				/>
			</View>
			<View className="gap-2">
				<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
					How Ryot syncs it
				</Text>
				<SchemaForm
					mode={props.mode}
					form={props.form}
					onChange={() => undefined}
					uploadFile={props.uploadFile}
					schema={props.provider.commonSchema}
				/>
				<Text className="font-ui text-xs leading-5 text-text-subtle">
					{integrationLotDetail(props.provider.lot)}
				</Text>
			</View>
		</View>
	);
}
