import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { Reshaped } from "reshaped";
import ApiClientProvider from "@/hooks/api";
import AuthClientProvider from "@/hooks/auth";
import ReactQueryProvider from "../hooks/react-query";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	shellComponent: RootDocument,
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "TanStack Start Starter" },
		],
		links: [{ href: appCss, rel: "stylesheet" }],
	}),
});

function RootDocument(props: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<ApiClientProvider>
					<AuthClientProvider>
						<Reshaped theme="reshaped">
							<ReactQueryProvider>
								{props.children}
								<TanStackDevtools
									config={{ position: "bottom-right" }}
									plugins={[
										{
											name: "Tanstack Query",
											render: <ReactQueryDevtoolsPanel />,
										},
										{
											name: "Tanstack Router",
											render: <TanStackRouterDevtoolsPanel />,
										},
									]}
								/>
							</ReactQueryProvider>
						</Reshaped>
					</AuthClientProvider>
				</ApiClientProvider>
				<Scripts />
			</body>
		</html>
	);
}
