import { MantineProvider } from "@mantine/core";
import themesAddon, { DecoratorHelpers } from "@storybook/addon-themes";
import { type Decorator, definePreview } from "@storybook/react-vite";
import {
	createMemoryHistory,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { authClientInstance } from "#/hooks/auth";
import { theme } from "#/lib/theme";
import { routeTree } from "#/routeTree.gen";
import "../src/styles.css";

const themeNames = ["light", "dark"];

const storybookRouter = createRouter({
	routeTree,
	context: { authClientInstance },
	history: createMemoryHistory({ initialEntries: ["/"] }),
});

DecoratorHelpers.initializeThemeState(themeNames, "light");

const withMantine: Decorator = (Story, ctx) => {
	const selectedTheme = DecoratorHelpers.pluckThemeFromContext(ctx);
	const scheme = selectedTheme === "dark" ? "dark" : "light";
	return (
		<MantineProvider theme={theme} forceColorScheme={scheme}>
			<Story />
		</MantineProvider>
	);
};

const withRouter: Decorator = (Story) => {
	return (
		<RouterContextProvider router={storybookRouter}>
			<Story />
		</RouterContextProvider>
	);
};

export default definePreview({
	addons: [themesAddon()],
	decorators: [withMantine, withRouter],
});
