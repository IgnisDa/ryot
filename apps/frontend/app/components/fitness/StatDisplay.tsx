import { Box, Text } from "@mantine/core";

export const StatDisplay = (props: {
	name: string;
	value: string;
	isHidden?: boolean;
	onClick?: () => void;
	highlightValue?: boolean;
}) => {
	return (
		<Box
			mx="auto"
			onClick={props.onClick}
			style={{
				display: props.isHidden ? "none" : undefined,
				cursor: props.onClick ? "pointer" : undefined,
			}}
		>
			<Text
				ta="center"
				fz={{ md: "xl" }}
				c={props.highlightValue ? "red" : undefined}
			>
				{props.value}
			</Text>
			<Text c="dimmed" size="sm" ta="center">
				{props.name}
			</Text>
		</Box>
	);
};
