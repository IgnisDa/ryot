import type { AppType } from "@ryot/app-backend";
import { hc } from "hono/client";
import { createContext, type ReactNode, useContext } from "react";

const api = hc<AppType>("/api");

const AuthClientContext = createContext<typeof api | undefined>(undefined);

export function useApiClient() {
	const context = useContext(AuthClientContext);
	if (!context)
		throw new Error("useApiClient must be used within ApiClientProvider");
	return context;
}

export default function ApiClientProvider(props: { children: ReactNode }) {
	return (
		<AuthClientContext.Provider value={api}>
			{props.children}
		</AuthClientContext.Provider>
	);
}
