import createFetchClient from "openapi-fetch";
import createClient from "openapi-react-query";
import { createContext, type ReactNode, useContext } from "react";
import type { paths } from "@/lib/api/openapi";

const fetchClient = createFetchClient<paths>({
	baseUrl: "/api",
	credentials: "include",
});

const api = createClient(fetchClient);

const ApiClientContext = createContext<typeof api | undefined>(undefined);

export function useApiClient() {
	const context = useContext(ApiClientContext);
	if (!context)
		throw new Error("useApiClient must be used within ApiClientProvider");
	return context;
}

export default function ApiClientProvider(props: { children: ReactNode }) {
	return (
		<ApiClientContext.Provider value={api}>
			{props.children}
		</ApiClientContext.Provider>
	);
}
