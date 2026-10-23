import { dataJsonIntegrationSettingsSchema } from "@ryot-app/contract/modules/imports/data-json";

export const resolveIntegrationSettingsSchema = <Lot, Schema>(
	integration: { readonly packageKey: string | null; readonly provider: string; readonly lot: Lot },
	providers:
		| ReadonlyArray<{ readonly slug: string; readonly lot: Lot; readonly settingsSchema: Schema }>
		| undefined,
) =>
	integration.packageKey === null
		? dataJsonIntegrationSettingsSchema
		: providers?.find(({ lot, slug }) => slug === integration.provider && lot === integration.lot)
				?.settingsSchema;
