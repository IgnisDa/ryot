import { MantineProvider } from "@mantine/core";
import { type Decorator, definePreview } from "@storybook/react-vite";
import "../src/styles.css";

const withMantine: Decorator = (Story) => (
	<MantineProvider>
		<Story />
	</MantineProvider>
);

export default definePreview({
	addons: [],
	decorators: [withMantine],
});
