import type { PluginScript } from "@ryot-app/contract/modules/plugins/manifest";

export type PluginScriptMetadata = PluginScript extends infer Script
	? Script extends { readonly entry: string }
		? Omit<Script, "entry">
		: never
	: never;

export const declaredScriptMetadata = (script: PluginScript): PluginScriptMetadata => {
	const execution = {
		runtimeImports: script.runtimeImports,
		oauthConnectionFields: script.oauthConnectionFields,
		executableDependencies: script.executableDependencies,
		optionalPluginConfigKeys: script.optionalPluginConfigKeys,
	};
	if (script.kind === "script") {
		return {
			...execution,
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			...(script.providerSlug ? { providerSlug: script.providerSlug } : {}),
		};
	}
	if (script.kind === "automation") {
		if (script.automationType === "policy") {
			return {
				...execution,
				slug: script.slug,
				name: script.name,
				kind: script.kind,
				capabilities: script.capabilities,
				automationType: script.automationType,
				inputProjection: script.inputProjection,
				requiredPluginConfigKeys: script.requiredPluginConfigKeys,
			};
		}
		return {
			...execution,
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			automationType: script.automationType,
			inputProjection: script.inputProjection,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
		};
	}
	if (script.kind === "operation") {
		return {
			...execution,
			slug: script.slug,
			name: script.name,
			kind: script.kind,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
		};
	}
	if (script.kind === "workflow") {
		return {
			...execution,
			kind: "workflow",
			slug: script.slug,
			name: script.name,
			capabilities: script.capabilities,
			requiredPluginConfigKeys: script.requiredPluginConfigKeys,
		};
	}
	const provider = {
		...execution,
		slug: script.slug,
		name: script.name,
		kind: "provider" as const,
		capabilities: script.capabilities,
		providerSlug: script.providerSlug,
		requiredPluginConfigKeys: script.requiredPluginConfigKeys,
	};
	if (script.providerOperation === "translate") {
		return {
			...provider,
			providerOperation: script.providerOperation,
			translationInputs: script.translationInputs,
		};
	}
	if (script.providerOperation === "related") {
		return {
			...provider,
			providerOperation: script.providerOperation,
			...(script.relatedInputs ? { relatedInputs: script.relatedInputs } : {}),
		};
	}
	if (script.providerOperation === "search") {
		return {
			...provider,
			providerOperation: script.providerOperation,
			...(script.searchOptionsSchema ? { searchOptionsSchema: script.searchOptionsSchema } : {}),
		};
	}
	return { ...provider, providerOperation: script.providerOperation };
};
