import type { EntityDefinition } from "@ryot/contract/modules/definitions/schemas";
import { EntitySchemaSlug } from "@ryot/contract/schema/brands";

export const PROVIDER_ADD_SEARCH_PARAM = "add";

export const PROVIDER_ADD_PICKER_VALUE = "1";

export type ProviderAddFlowState =
	| { readonly kind: "closed" }
	| { readonly kind: "schema-picker" }
	| { readonly kind: "search"; readonly entitySchemaSlug: EntitySchemaSlug };

export const parseAddParam = (value: string | string[] | undefined): ProviderAddFlowState => {
	const raw = (Array.isArray(value) ? value[0] : value)?.trim();
	if (raw === undefined) {
		return { kind: "closed" };
	}
	if (raw === "" || raw === PROVIDER_ADD_PICKER_VALUE) {
		return { kind: "schema-picker" };
	}
	return { kind: "search", entitySchemaSlug: EntitySchemaSlug.make(raw) };
};

export const selectAddableDefinitions = (definitions: readonly EntityDefinition[]) =>
	definitions
		.filter((definition) => definition.providers.length > 0)
		.sort((left, right) => left.name.localeCompare(right.name));
