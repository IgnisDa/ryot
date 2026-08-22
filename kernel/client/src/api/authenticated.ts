import { runContract, type ContractProgram } from "@ryot/contract/client";

import { serverApiUrl } from "./origin";
import { canonicalApiScope, type ApiScope } from "./scope";

export const runAuthenticatedContract = <A, E>(scope: ApiScope, program: ContractProgram<A, E>) => {
	const canonical = canonicalApiScope(scope);
	return runContract(program, {
		credentials: "include",
		baseUrl: serverApiUrl(canonical.serverUrl),
	});
};
