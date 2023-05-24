import { createGqlClient } from "@ryot/graphql/client";
import { QueryClient } from "@tanstack/react-query";

const baseUrl =
	process.env.NEXT_PUBLIC_BASE_URL ||
	(typeof window !== "undefined" ? window.location.origin : "");

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: { staleTime: Infinity },
	},
});
export const gqlClient = createGqlClient(baseUrl);
