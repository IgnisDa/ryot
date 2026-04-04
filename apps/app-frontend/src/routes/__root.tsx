import {
	ColorSchemeScript,
	localStorageColorSchemeManager,
	MantineProvider,
} from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { STORAGE_KEYS } from "~/lib/storage-keys";
import { theme } from "~/lib/theme";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
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
					<ModalsProvider>
						<Notifications position="top-right" />
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
					</ModalsProvider>
				</MantineProvider>
				<Scripts />
			</body>
		</html>
	);
}
