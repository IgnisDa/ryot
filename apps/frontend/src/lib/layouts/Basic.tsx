import { Box, Flex } from "@mantine/core";

export default function ({
	children,
	header,
}: { children: JSX.Element; header?: JSX.Element }) {
	return (
		<Flex direction={"column"} w={"100%"}>
			{header}
			<Box my={"lg"}>{children}</Box>
		</Flex>
	);
}
