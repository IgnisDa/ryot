import { createContext, useContext } from "react";

export type InstanceAdminContextValue = {
	readonly lock: () => void;
	readonly sessionId: string;
	readonly unauthorized: () => void;
};

export const InstanceAdminContext = createContext<undefined | InstanceAdminContextValue>(undefined);

export function useInstanceAdmin() {
	const context = useContext(InstanceAdminContext);
	if (context === undefined) {
		throw new Error("useInstanceAdmin must be used inside InstanceAdminShell");
	}
	return context;
}
