import { type Entitlement, isEntitled } from "@ryot-app/contract/schema/entitlement";

import { createRyotQuery } from "./definitions";
import { useRyotQuery } from "./hooks";

const accountQuery = createRyotQuery(({ client }) => client.account);

export const useUserPreferences = () => {
	const account = useRyotQuery(accountQuery);
	return { ...account, data: account.data?.preferences };
};

export const useEntitlement = (entitlement: Entitlement) => {
	const account = useRyotQuery(accountQuery);
	return {
		...account,
		data: account.data?.entitlements,
		granted: account.data !== undefined && isEntitled(account.data.entitlements, entitlement),
	};
};
