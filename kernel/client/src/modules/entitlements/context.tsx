import {
	type Entitlement,
	type Entitlements,
	isEntitled,
} from "@ryot-app/contract/schema/entitlement";
import { createContext, type ReactNode, useContext } from "react";

const EntitlementsContext = createContext<Entitlements>([]);

export function EntitlementsProvider(props: {
	readonly children: ReactNode;
	readonly entitlements: Entitlements;
}) {
	return <EntitlementsContext value={props.entitlements}>{props.children}</EntitlementsContext>;
}

export const useEntitlement = (entitlement: Entitlement) =>
	isEntitled(useContext(EntitlementsContext), entitlement);
