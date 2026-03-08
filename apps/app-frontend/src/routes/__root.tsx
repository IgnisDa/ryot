import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { AuthClient } from "#/hooks/auth";
import { theme } from "#/lib/theme";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{
	authClientInstance: AuthClient;
}>()({
	ssr: false,
	shellComponent: RootDocument,
	head: () => ({
		links: [{ href: appCss, rel: "stylesheet" }],
		meta: [
			{ charSet: "utf-8" },
			{ title: "TanStack Start Starter" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
		],
	}),
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<ColorSchemeScript />
				<HeadContent />
			</head>
			<body>
				<MantineProvider theme={theme}>
					{children}
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				</MantineProvider>
				<Scripts />
			</body>
		</html>
	);
}
