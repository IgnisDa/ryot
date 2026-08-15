import {
	SchemaForm,
	type SchemaFileUpload,
	type SchemaFormApi,
	type SchemaFormMode,
} from "@ryot-app/client-ui-sdk/schema-form";

import { integrationLotDetail } from "#/modules/integrations/provider-selection";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";

export function IntegrationSettingsForm(props: {
	readonly mode: SchemaFormMode;
	readonly form: SchemaFormApi;
	readonly uploadFile: SchemaFileUpload;
	readonly provider: IntegrationProviderItem;
}) {
	return (
		<div className="flex flex-col gap-5">
			<SchemaForm
				mode={props.mode}
				form={props.form}
				icons={schemaFormIcons}
				onChange={() => undefined}
				title={props.provider.name}
				uploadFile={props.uploadFile}
				schema={props.provider.settingsSchema}
			/>
			<div className="flex flex-col gap-2">
				<SchemaForm
					mode={props.mode}
					form={props.form}
					icons={schemaFormIcons}
					title="How Ryot syncs it"
					onChange={() => undefined}
					uploadFile={props.uploadFile}
					schema={props.provider.commonSchema}
				/>
				<p className="text-xs leading-5 text-text-subtle">
					{integrationLotDetail(props.provider.lot)}
				</p>
			</div>
		</div>
	);
}
