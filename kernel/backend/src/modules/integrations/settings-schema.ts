import { dataJsonIntegrationSettingsSchema } from "@ryot-app/contract/modules/imports/data-json";
import { jsonByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";

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
	(jsonByteLength({
		name: integration.name,
		provider: integration.provider,
		providerSpecifics: integration.providerSpecifics,
	}) ?? Infinity) > SANDBOX_LIMITS.integrations.settingsBytes;
