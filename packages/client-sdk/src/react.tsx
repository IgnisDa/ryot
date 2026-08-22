import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import type { RyotClient } from "./index";

const RyotContext = createContext<RyotClient | undefined>(undefined);

export const RyotProvider = ({ client, children }: { client: RyotClient; children: ReactNode }) => (
	<RyotContext.Provider value={client}>{children}</RyotContext.Provider>
);

export const useRyot = () => {
	const client = useContext(RyotContext);
	if (!client) {
		throw new Error("useRyot must be used within RyotProvider");
	}
	return client;
};

export const useRyotTheme = () => {
	const { theme } = useRyot();
	return useSyncExternalStore(theme.subscribe, theme.getSnapshot, theme.getSnapshot);
};
