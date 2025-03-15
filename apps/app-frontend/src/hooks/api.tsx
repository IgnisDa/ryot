import { hcWithType } from "@ryot/app-backend/hc";
import { createContext, type ReactNode, useContext } from "react";

const api = hcWithType("/api");

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
