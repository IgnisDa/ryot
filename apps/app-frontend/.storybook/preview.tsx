import { MantineProvider } from "@mantine/core";
import themesAddon, { DecoratorHelpers } from "@storybook/addon-themes";
import { type Decorator, definePreview } from "@storybook/react-vite";
import { theme } from "#/lib/theme";
import "../src/styles.css";

const themeNames = ["light", "dark"];

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

export default definePreview({
	addons: [themesAddon()],
	decorators: [withMantine],
});
