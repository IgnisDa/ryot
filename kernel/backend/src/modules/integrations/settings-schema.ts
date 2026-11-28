import { dataJsonIntegrationSettingsSchema } from "@ryot-app/contract/modules/imports/data-json";
import { INTEGRATION_LIMITS } from "@ryot-app/contract/modules/integrations/schemas";
import { exceedsJsonBytes } from "@ryot-app/ts-utils/json";

export const resolveIntegrationSettingsSchema = <Lot, Schema>(
	integration: { readonly lot: Lot; readonly provider: string; readonly packageKey: null | string },
	providers:
		| undefined
		| ReadonlyArray<{ readonly lot: Lot; readonly slug: string; readonly settingsSchema: Schema }>,
) =>
	integration.packageKey === null
		? dataJsonIntegrationSettingsSchema
		: providers?.find(({ lot, slug }) => slug === integration.provider && lot === integration.lot)
				?.settingsSchema;

export const isIntegrationSettingsTooLarge = (integration: {
	readonly provider: string;
	readonly name: null | string;
	readonly providerSpecifics: Readonly<Record<string, unknown>>;
}) =>
	exceedsJsonBytes(
		{
			name: integration.name,
			provider: integration.provider,
			providerSpecifics: integration.providerSpecifics,
		},
		INTEGRATION_LIMITS.settingsBytes,
	);
