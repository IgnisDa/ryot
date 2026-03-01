import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let context: { queryClient: QueryClient } | undefined;

export function getContext() {
	if (context) return context;

	const queryClient = new QueryClient();
	context = { queryClient };

	return context;
}

export default function ReactQueryProvider(props: { children: ReactNode }) {
	const { queryClient } = getContext();

	return (
		<QueryClientProvider client={queryClient}>
			{props.children}
		</QueryClientProvider>
	);
}
