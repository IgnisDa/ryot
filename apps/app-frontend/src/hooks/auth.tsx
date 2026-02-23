import { createAuthClient } from "better-auth/client";
import { anonymousClient, apiKeyClient } from "better-auth/client/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start/solid";
import { createContext, type ReactNode, useContext } from "react";

const authClientInstance = createAuthClient({
	plugins: [apiKeyClient(), anonymousClient(), tanstackStartCookies()],
});

type AuthClient = typeof authClientInstance;

const AuthClientContext = createContext<AuthClient | undefined>(undefined);

export function useAuthClient() {
	const context = useContext(AuthClientContext);
	if (!context)
		throw new Error("useAuthClient must be used within AuthClientProvider");
	return context;
}

export default function AuthClientProvider(props: { children: ReactNode }) {
	return (
		<AuthClientContext.Provider value={authClientInstance}>
			{props.children}
		</AuthClientContext.Provider>
	);
}
