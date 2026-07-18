import { buildNavigationDocument } from "@ryot/ryotql-recipes/navigation";

import { appQueryClient } from "@/api/query-client";

export const navigationAtom = appQueryClient.query("ryotql", "execute", {
	payload: buildNavigationDocument(),
});
