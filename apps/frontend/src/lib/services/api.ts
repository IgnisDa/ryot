import { createGqlClient } from "@ryot/graphql/client";
import { QueryClient } from "@tanstack/react-query";

export const BASE_URL =
	process.env.NEXT_PUBLIC_BASE_URL ||
	(typeof window !== "undefined" ? window.location.origin : "");

export const queryClient = new QueryClient();
export const gqlClient = createGqlClient(BASE_URL);
