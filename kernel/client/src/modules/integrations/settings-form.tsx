import {
	SchemaForm,
	type SchemaFileUpload,
	type SchemaFormApi,
	type SchemaFormIcons,
	type SchemaFormMode,
} from "@ryot-app/client-ui-sdk/schema-form";
import type { ListedIntegrationProvider } from "@ryot-app/contract/modules/integrations/schemas";

import { integrationLotDetail } from "#/modules/integrations/provider-selection";
import { AppIcon } from "#/modules/navigation/app-icon";

const schemaFormIcons: SchemaFormIcons = {
	close: <AppIcon name="x" size={14} />,
	check: <AppIcon name="check" size={14} />,
	upload: <AppIcon name="upload" size={15} />,
	search: <AppIcon name="search" size={15} />,
	remove: <AppIcon name="trash-2" size={14} />,
	file: <AppIcon name="file-text" size={15} />,
	chevron: <AppIcon name="chevron-down" size={15} />,
};

export function IntegrationSettingsForm(props: {
	readonly mode: SchemaFormMode;
	readonly form: SchemaFormApi;
	readonly uploadFile: SchemaFileUpload;
	readonly provider: ListedIntegrationProvider;
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
					title="How Ryot syncs it"
					icons={schemaFormIcons}
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
