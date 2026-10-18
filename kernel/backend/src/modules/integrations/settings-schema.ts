import { dataJsonIntegrationSettingsSchema } from "@ryot-app/contract/modules/imports/data-json";

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
