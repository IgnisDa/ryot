import { createContext, type ReactNode, useContext, useMemo } from "react";

import { type ApiScope, apiScopeKey, canonicalApiScope } from "./request-key";

const ApiScopeContext = createContext<ApiScope | undefined>(undefined);

function ApiScopeRuntime(props: { scope: ApiScope; children: ReactNode }) {
	return <ApiScopeContext.Provider value={props.scope}>{props.children}</ApiScopeContext.Provider>;
}

export function ApiScopeProvider(props: ApiScope & { children: ReactNode }) {
	const scope = useMemo(
		() => canonicalApiScope({ serverUrl: props.serverUrl, userId: props.userId }),
		[props.serverUrl, props.userId],
	);
	return (
		<ApiScopeRuntime key={apiScopeKey(scope)} scope={scope}>
			{props.children}
		</ApiScopeRuntime>
	);
}

export function useApiScope() {
	const scope = useContext(ApiScopeContext);
	if (!scope) {
		throw new Error("useApiScope must be used within ApiScopeProvider");
	}
	return scope;
}
