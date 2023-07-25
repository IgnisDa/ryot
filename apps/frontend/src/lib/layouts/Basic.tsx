import { useCoreDetails } from "@/lib/hooks/graphql";
import { Anchor, Box, Container, Flex, Text } from "@mantine/core";

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

export const Footer = () => {
	const coreDetails = useCoreDetails();

	return coreDetails.data ? (
		<Flex gap={80} justify={"center"}>
			<Anchor
				href={`${coreDetails.data.repositoryLink}/releases/v${coreDetails.data.version}`}
				target="_blank"
			>
				<Text color="red" weight={"bold"}>
					v{coreDetails.data.version}
				</Text>
			</Anchor>
			<Anchor href="https://diptesh.me" target="_blank">
				<Text color="indigo" weight={"bold"}>
					{coreDetails.data.authorName}
				</Text>
			</Anchor>
			<Anchor href={coreDetails.data.repositoryLink} target="_blank">
				<Text color="orange" weight={"bold"}>
					Github
				</Text>
			</Anchor>
		</Flex>
	) : null;
};
