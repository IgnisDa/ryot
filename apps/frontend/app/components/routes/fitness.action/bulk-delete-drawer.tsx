import { Drawer, Text } from "@mantine/core";
import { styles } from "./utils";

export const BulkDeleteDrawer = (props: {
	opened: boolean;
	onClose: () => void;
}) => {
	return (
		<Drawer
			size="sm"
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			styles={{ body: { ...styles.body, height: "100%" } }}
		>
			<Text>hello world</Text>
		</Drawer>
	);
};
