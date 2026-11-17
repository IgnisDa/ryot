import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { renderSchemaAsset } from "@ryot-app/plugin-client-sdk/react";
import {
	type SchemaAssetUpload,
	type SchemaFileUpload,
	SchemaForm,
	type SchemaFormApi,
	type SchemaFormMode,
	type SchemaOAuthConnect,
} from "@ryot-app/plugin-ui-sdk/schema-form";

import { integrationLotDetail } from "#/modules/integrations/provider-selection";
import type { IntegrationProviderItem } from "#/modules/integrations/service";
import { schemaFormReorderFeedback } from "#/modules/ui/schema-form-feedback";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";

export function IntegrationSettingsForm(props: {
	readonly form: SchemaFormApi;
	readonly mode: SchemaFormMode;
	readonly uploadFile: SchemaFileUpload;
	readonly uploadAsset: SchemaAssetUpload;
	readonly connectOAuth: SchemaOAuthConnect;
	readonly provider: IntegrationProviderItem;
	readonly oauthDisabledReason: Text | undefined;
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-5">
			<SchemaForm
				mode={props.mode}
				form={props.form}
				icons={schemaFormIcons}
				onChange={() => undefined}
				uploadFile={props.uploadFile}
				title={t(props.provider.name)}
				uploadAsset={props.uploadAsset}
				renderAsset={renderSchemaAsset}
				connectOAuth={props.connectOAuth}
				onReorder={schemaFormReorderFeedback}
				schema={props.provider.settingsSchema}
				{...(props.oauthDisabledReason === undefined
					? {}
					: { oauthDisabledReason: props.oauthDisabledReason })}
			/>
			<div className="flex flex-col gap-2">
				<SchemaForm
					mode={props.mode}
					form={props.form}
					icons={schemaFormIcons}
					onChange={() => undefined}
					uploadFile={props.uploadFile}
					uploadAsset={props.uploadAsset}
					renderAsset={renderSchemaAsset}
					schema={props.provider.commonSchema}
					onReorder={schemaFormReorderFeedback}
					title={t(kernelMessage("client.integrations.sync-title"))}
				/>
				<p className="text-xs leading-5 text-text-subtle">
					{t(integrationLotDetail(props.provider.lot))}
				</p>
			</div>
		</div>
	);
}
