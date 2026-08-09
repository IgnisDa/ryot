import { createContext, useContext } from "react";

export type GodModeContextValue = {
	readonly lock: () => void;
	readonly sessionId: string;
	readonly unauthorized: () => void;
};

export const GodModeContext = createContext<GodModeContextValue | undefined>(undefined);

export function useGodMode() {
	const context = useContext(GodModeContext);
	if (context === undefined) {
		throw new Error("useGodMode must be used inside GodModeShell");
	}
	return context;
}
