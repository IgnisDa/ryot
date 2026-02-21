import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import AuthClientProvider from "@/hooks/auth";
import ReactQueryProvider from "../hooks/react-query";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "TanStack Start Starter",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument(props: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<ColorSchemeScript />
				<HeadContent />
			</head>
			<body>
				<AuthClientProvider>
					<MantineProvider>
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
					</MantineProvider>
				</AuthClientProvider>
				<Scripts />
			</body>
		</html>
	);
}
