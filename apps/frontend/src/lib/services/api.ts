import { QueryClient } from "@tanstack/react-query";
import { createGqlClient } from "@ryot/graphql/client";

const baseUrl =
	process.env.NEXT_PUBLIC_BASE_URL ||
	(typeof window !== "undefined" ? window.location.origin : "");

export const queryClient = new QueryClient();
export const gqlClient = createGqlClient(baseUrl);
