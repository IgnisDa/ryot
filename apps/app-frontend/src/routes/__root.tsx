import {
	ColorSchemeScript,
	localStorageColorSchemeManager,
	MantineProvider,
} from "@mantine/core";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { AuthClient } from "#/hooks/auth";
import { STORAGE_KEYS } from "#/lib/storage-keys";
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

const colorSchemeManager = localStorageColorSchemeManager({
	key: STORAGE_KEYS.colorScheme,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<ColorSchemeScript defaultColorScheme="auto" />
				<HeadContent />
			</head>
			<body>
				<MantineProvider
					theme={theme}
					defaultColorScheme="auto"
					colorSchemeManager={colorSchemeManager}
				>
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
