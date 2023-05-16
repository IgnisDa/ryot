import { Container, Flex, Skeleton, Stack } from "@mantine/core";

export default function () {
	return (
		<Container>
			<Stack>
				<Skeleton height={80} radius="xl" />
				<Flex justify={"space-between"}>
					<Skeleton height={50} width="60%" radius="xl" />
					<Skeleton height={50} width="30%" radius="xl" />
				</Flex>
				<Skeleton height={30} radius="xl" />
				<Skeleton height={60} width="70%" radius="xl" ml="auto" />
			</Stack>
		</Container>
	);
}
