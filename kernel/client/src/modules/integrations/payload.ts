import {
	initialSchemaFormValues,
	toSchemaFormPayload,
	type SchemaFormArrayValue,
	type SchemaFormValue,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import type {
	CreateIntegrationBody,
	ListedIntegration,
	ListedIntegrationProvider,
	UpdateIntegrationBody,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { JsonValue } from "@ryot-app/contract/modules/sandbox/wire";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

const isArrayItem = (value: unknown): value is SchemaFormArrayValue =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const toSchemaFormValue = (value: unknown): SchemaFormValue => {
	if (isArrayItem(value)) {
		return value;
	}
	return Array.isArray(value) && value.every(isArrayItem) ? value : undefined;
};

const stringField = (payload: Record<string, JsonValue>, key: string) => {
	const value = payload[key];
	return typeof value === "string" ? value : undefined;
};

const numberField = (payload: Record<string, JsonValue>, key: string) => {
	const value = payload[key];
	return typeof value === "number" ? value : undefined;
};

const booleanField = (payload: Record<string, JsonValue>, key: string) => {
	const value = payload[key];
	return typeof value === "boolean" ? value : undefined;
};

/**
 * `commonSchema` decides which of these controls a provider renders, but the request body itself is
 * a fixed typed shape, so the known keys are read back out rather than spread blindly. Anything the
 * schema did not render is omitted, which on update means "leave what the server already has".
 */
const integrationCommonBody = (commonSchema: AppSchema, values: SchemaFormValues) => {
	const payload = toSchemaFormPayload(commonSchema, values);
	const name = stringField(payload, "name");
	const isDisabled = booleanField(payload, "isDisabled");
	const syncOwnership = booleanField(payload, "syncOwnership");
	const minimumProgress = numberField(payload, "minimumProgress");
	const maximumProgress = numberField(payload, "maximumProgress");
	const disableOnContinuousErrors = booleanField(payload, "disableOnContinuousErrors");
	return {
		...(name === undefined ? {} : { name }),
		...(isDisabled === undefined ? {} : { isDisabled }),
		...(syncOwnership === undefined ? {} : { syncOwnership }),
		...(minimumProgress === undefined ? {} : { minimumProgress }),
		...(maximumProgress === undefined ? {} : { maximumProgress }),
		...(disableOnContinuousErrors === undefined
			? {}
			: { extraSettings: { disableOnContinuousErrors } }),
	};
};

export const createIntegrationBody = (input: {
	readonly values: SchemaFormValues;
	readonly provider: ListedIntegrationProvider;
}): CreateIntegrationBody => ({
	provider: input.provider.slug,
	...integrationCommonBody(input.provider.commonSchema, input.values),
	providerSpecifics: toSchemaFormPayload(input.provider.settingsSchema, input.values),
});

export const updateIntegrationBody = (input: {
	readonly values: SchemaFormValues;
	readonly provider: ListedIntegrationProvider;
}): UpdateIntegrationBody => ({
	...integrationCommonBody(input.provider.commonSchema, input.values),
	providerSpecifics: toSchemaFormPayload(input.provider.settingsSchema, input.values),
});

export const initialIntegrationFormValues = (
	provider: ListedIntegrationProvider,
): SchemaFormValues => ({
	...initialSchemaFormValues(provider.commonSchema),
	...initialSchemaFormValues(provider.settingsSchema),
});

/**
 * Secret settings are stripped before they reach the client, so they seed blank and stay blank
 * unless the user replaces them.
 */
export const storedIntegrationFormValues = (input: {
	readonly integration: ListedIntegration;
	readonly provider: ListedIntegrationProvider;
}): SchemaFormValues => {
	const stored = Object.fromEntries(
		Object.keys(input.provider.settingsSchema.fields).flatMap((key) => {
			const value = toSchemaFormValue(input.integration.providerSpecifics[key]);
			return value === undefined ? [] : [[key, value]];
		}),
	);
	return {
		...initialIntegrationFormValues(input.provider),
		...stored,
		name: input.integration.name ?? "",
		isDisabled: input.integration.isDisabled,
		syncOwnership: input.integration.syncOwnership,
		minimumProgress: input.integration.minimumProgress,
		maximumProgress: input.integration.maximumProgress,
		disableOnContinuousErrors: input.integration.extraSettings.disableOnContinuousErrors,
	};
};
