import { Anchor, Flex, Text } from "@mantine/core";
import { useCoreDetails } from "~/lib/hooks";
import { discordLink } from "../utils";

export const Footer = () => {
	const coreDetails = useCoreDetails();

	return (
		<Flex gap={80} justify="center">
			{!coreDetails.isServerKeyValidated ? (
				<Anchor
					target="_blank"
					rel="noopener noreferrer"
					href={coreDetails.websiteUrl}
				>
					<Text c="red" fw="bold">
						Ryot Pro
					</Text>
				</Anchor>
			) : null}
			<Anchor href={discordLink} target="_blank" rel="noopener noreferrer">
				<Text c="indigo" fw="bold">
					Discord
				</Text>
			</Anchor>
			<Text c="grape" fw="bold" visibleFrom="md">
				{coreDetails.version}
			</Text>
			<Anchor
				target="_blank"
				rel="noopener noreferrer"
				href={coreDetails.repositoryLink}
			>
				<Text c="orange" fw="bold">
					Github
				</Text>
			</Anchor>
		</Flex>
	);
};
