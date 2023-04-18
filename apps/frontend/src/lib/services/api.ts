import { QueryClient } from "@tanstack/react-query";
import { createGqlClient } from "@trackona/graphql/client";

export const queryClient = new QueryClient();
export const gqlClient = createGqlClient("http://localhost:8000");
