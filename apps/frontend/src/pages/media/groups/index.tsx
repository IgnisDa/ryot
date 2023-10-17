import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
	PartialMetadataDisplay,
} from "@/lib/components/MediaComponents";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Button,
	Container,
	Flex,
	Group,
	SimpleGrid,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import {
	EntityLot,
	MetadataGroupDetailsDocument,
	UserMetadataGroupDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconDeviceTv, IconUser } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataGroupId = parseInt(router.query.id?.toString() || "0");
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
	] = useDisclosure(false);
	const [activeTab, setActiveTab] = useLocalStorage({
		key: LOCAL_STORAGE_KEYS.savedActiveMetadataGroupDetailsTab,
		getInitialValueInEffect: false,
		defaultValue: "media",
	});

	const groupDetails = useQuery({
		queryKey: ["groupDetails", metadataGroupId],
		queryFn: async () => {
			const { metadataGroupDetails } = await gqlClient.request(
				MetadataGroupDetailsDocument,
				{ metadataGroupId },
			);
			return metadataGroupDetails;
		},
		staleTime: Infinity,
		enabled: !!metadataGroupId,
	});
	const userMetadataGroupDetails = useQuery({
		queryKey: ["usermetadataGroupDetails", metadataGroupId],
		queryFn: async () => {
			const { userMetadataGroupDetails } = await gqlClient.request(
				UserMetadataGroupDetailsDocument,
				{ metadataGroupId },
			);
			return userMetadataGroupDetails;
		},
		enabled: !!metadataGroupId,
	});

	return groupDetails.data && userMetadataGroupDetails.data ? (
		<>
			<Head>
				<title>{groupDetails.data.details.title} | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					images={groupDetails.data.details.displayImages}
					externalLink={{
						source: groupDetails.data.details.source,
						lot: groupDetails.data.details.lot,
						href: groupDetails.data.sourceUrl,
					}}
				>
					<Title id="group-title">{groupDetails.data.details.title}</Title>
					<Flex id="group-details" wrap="wrap" gap={4}>
						<Text>{groupDetails.data.details.parts} media items</Text>
					</Flex>
					{userMetadataGroupDetails.data &&
					userMetadataGroupDetails.data.collections.length > 0 ? (
						<Group id="entity-collections">
							{userMetadataGroupDetails.data.collections.map((col) => (
								<DisplayCollection
									col={col}
									entityId={metadataGroupId}
									entityLot={EntityLot.MetadataGroup}
									refetch={userMetadataGroupDetails.refetch}
									key={col.id}
								/>
							))}
						</Group>
					) : undefined}
					<Tabs
						value={activeTab}
						onChange={(v) => {
							if (v) setActiveTab(v);
						}}
						variant="outline"
					>
						<Tabs.List mb="xs">
							<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
								Media
							</Tabs.Tab>
							<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
								Actions
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="media">
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
									{groupDetails.data.contents.map((media) => (
										<PartialMetadataDisplay
											key={media.identifier}
											media={media}
										/>
									))}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						<Tabs.Panel value="actions">
							<MediaScrollArea>
								<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
									<Button variant="outline" onClick={collectionModalOpen}>
										Add to collection
									</Button>
									<AddEntityToCollectionModal
										onClose={collectionModalClose}
										opened={collectionModalOpened}
										entityId={metadataGroupId}
										refetchUserMedia={userMetadataGroupDetails.refetch}
										entityLot={EntityLot.MetadataGroup}
									/>
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
					</Tabs>
				</MediaDetailsLayout>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
