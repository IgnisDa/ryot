import {
	Anchor,
	Button,
	Container,
	Group,
	Menu,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
} from "@mantine/core";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	DeployUpdatePersonJobDocument,
	EntityLot,
	PersonDetailsDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { sum } from "@ryot/ts-utils";
import {
	IconDeviceTv,
	IconInfoCircle,
	IconLibrary,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { $path } from "remix-routes";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { zx } from "zodix";
import {
	DisplayCollection,
	MediaDetailsLayout,
	ReviewItemDisplay,
} from "~/components/common";
import {
	BaseEntityDisplay,
	MarkEntityAsPartialMenuItem,
	MediaScrollArea,
	PartialMetadataDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import { clientGqlService, getMetadataGroupDetailsQuery } from "~/lib/generals";
import { useUserPreferences } from "~/lib/hooks";
import { useAddEntityToCollection, useReviewEntity } from "~/lib/state/media";
import { serverGqlService } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const { id: personId } = zx.parseParams(params, { id: z.string() });
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ personDetails }, { userPersonDetails }] = await Promise.all([
		serverGqlService.request(PersonDetailsDocument, { personId }),
		serverGqlService.authenticatedRequest(request, UserPersonDetailsDocument, {
			personId,
		}),
	]);
	if (personDetails.details.isPartial)
		await serverGqlService.request(DeployUpdatePersonJobDocument, {
			personId,
		});
	return { query, personId, userPersonDetails, personDetails };
};

export const meta = ({ data }: MetaArgs<typeof loader>) => {
	return [{ title: `${data?.personDetails.details.name} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();
	const [mediaRoleFilter, setMediaRoleFilter] = useLocalStorage(
		"MediaTabRoleFilter",
		loaderData.personDetails.associatedMetadata.map((c) => c.name).at(0) ||
			null,
	);
	const [groupRoleFilter, setGroupRoleFilter] = useLocalStorage(
		"MediaTabRoleFilter",
		loaderData.personDetails.associatedMetadataGroups
			.map((c) => c.name)
			.at(0) || null,
	);

	const totalMetadata = sum(
		loaderData.personDetails.associatedMetadata.map((c) => c.count),
	);
	const totalMetadataGroups = sum(
		loaderData.personDetails.associatedMetadataGroups.map((c) => c.count),
	);

	return (
		<Container>
			<MediaDetailsLayout
				title={loaderData.personDetails.details.name}
				images={loaderData.personDetails.details.displayImages}
				externalLink={{
					source: loaderData.personDetails.details.source,
					href: loaderData.personDetails.details.sourceUrl,
				}}
				partialDetailsFetcher={{
					entityId: loaderData.personDetails.details.id,
					isAlreadyPartial: loaderData.personDetails.details.isPartial,
					fn: () =>
						clientGqlService
							.request(PersonDetailsDocument, {
								personId: loaderData.personDetails.details.id,
							})
							.then((data) => data.personDetails.details.isPartial),
				}}
			>
				<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
					{[
						totalMetadata ? `${totalMetadata} media items` : null,
						totalMetadataGroups ? `${totalMetadataGroups} groups` : null,
						loaderData.personDetails.details.birthDate &&
							`Birth: ${loaderData.personDetails.details.birthDate}`,
						loaderData.personDetails.details.deathDate &&
							`Death: ${loaderData.personDetails.details.deathDate}`,
						loaderData.personDetails.details.place &&
							loaderData.personDetails.details.place,
						loaderData.personDetails.details.gender,
						loaderData.personDetails.details.website && (
							<Anchor
								target="_blank"
								referrerPolicy="no-referrer"
								fz={{ base: "xs", md: "sm" }}
								href={loaderData.personDetails.details.website}
							>
								Website
							</Anchor>
						),
						loaderData.personDetails.details.alternateNames &&
							loaderData.personDetails.details.alternateNames.length > 0 &&
							`Also called ${loaderData.personDetails.details.alternateNames.slice(0, 5).join(", ")}`,
					]
						.filter(Boolean)
						.map<ReactNode>((s) => s)
						.reduce((prev, curr) => [prev, " • ", curr])}
				</Text>
				{loaderData.userPersonDetails.collections.length > 0 ? (
					<Group>
						{loaderData.userPersonDetails.collections.map((col) => (
							<DisplayCollection
								col={col}
								key={col.id}
								creatorUserId={col.userId}
								entityLot={EntityLot.Person}
								entityId={loaderData.personId}
							/>
						))}
					</Group>
				) : null}
				<Tabs
					variant="outline"
					defaultValue={
						loaderData.query.defaultTab ||
						(totalMetadata > 0 ? "media" : "actions")
					}
				>
					<Tabs.List mb="xs">
						{totalMetadata > 0 ? (
							<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
								Media
							</Tabs.Tab>
						) : null}
						{totalMetadataGroups > 0 ? (
							<Tabs.Tab value="groups" leftSection={<IconLibrary size={16} />}>
								Groups
							</Tabs.Tab>
						) : null}
						{loaderData.personDetails.details.description ? (
							<Tabs.Tab
								value="overview"
								leftSection={<IconInfoCircle size={16} />}
							>
								Overview
							</Tabs.Tab>
						) : null}
						{!userPreferences.general.disableReviews ? (
							<Tabs.Tab
								value="reviews"
								leftSection={<IconMessageCircle2 size={16} />}
							>
								Reviews
							</Tabs.Tab>
						) : null}
						<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
							Actions
						</Tabs.Tab>
					</Tabs.List>
					{totalMetadata > 0 ? (
						<Tabs.Panel value="media">
							<MediaScrollArea>
								<Stack gap="xl">
									<Group justify="center">
										<Text size="sm" c="dimmed">
											Role:
										</Text>
										<Select
											size="xs"
											value={mediaRoleFilter}
											onChange={(value) => setMediaRoleFilter(value)}
											data={loaderData.personDetails.associatedMetadata.map(
												(c) => ({
													value: c.name,
													label: `${c.name} (${c.count})`,
												}),
											)}
										/>
									</Group>
									<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
										{loaderData.personDetails.associatedMetadata
											.find((c) => c.name === mediaRoleFilter)
											?.items.map((item) => (
												<MetadataDisplay
													key={item.entityId}
													character={item.character}
													metadataId={item.entityId}
												/>
											))}
									</SimpleGrid>
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
					) : null}
					{totalMetadataGroups > 0 ? (
						<Tabs.Panel value="groups">
							<MediaScrollArea>
								<Stack gap="xl">
									<Group justify="center">
										<Text size="sm" c="dimmed">
											Role:
										</Text>
										<Select
											size="xs"
											value={groupRoleFilter}
											onChange={(value) => setGroupRoleFilter(value)}
											data={loaderData.personDetails.associatedMetadataGroups.map(
												(c) => ({
													value: c.name,
													label: `${c.name} (${c.count})`,
												}),
											)}
										/>
									</Group>
									<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
										{loaderData.personDetails.associatedMetadataGroups
											.find((c) => c.name === groupRoleFilter)
											?.items.map((item) => (
												<MetadataGroupDisplay
													key={item.entityId}
													metadataGroupId={item.entityId}
												/>
											))}
									</SimpleGrid>
								</Stack>
							</MediaScrollArea>
						</Tabs.Panel>
					) : null}
					{loaderData.personDetails.details.description ? (
						<Tabs.Panel value="overview">
							<MediaScrollArea>
								<div
									// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
									dangerouslySetInnerHTML={{
										__html: loaderData.personDetails.details.description,
									}}
								/>
							</MediaScrollArea>
						</Tabs.Panel>
					) : null}
					<Tabs.Panel value="actions">
						<MediaScrollArea>
							<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
								<Button
									variant="outline"
									w="100%"
									onClick={() => {
										setEntityToReview({
											entityId: loaderData.personId,
											entityLot: EntityLot.Person,
											entityTitle: loaderData.personDetails.details.name,
										});
									}}
								>
									Post a review
								</Button>
								<Button
									variant="outline"
									onClick={() => {
										setAddEntityToCollectionData({
											entityId: loaderData.personId,
											entityLot: EntityLot.Person,
											alreadyInCollections:
												loaderData.userPersonDetails.collections.map(
													(c) => c.id,
												),
										});
									}}
								>
									Add to collection
								</Button>
								<Menu shadow="md">
									<Menu.Target>
										<Button variant="outline">More actions</Button>
									</Menu.Target>
									<Menu.Dropdown>
										<ToggleMediaMonitorMenuItem
											inCollections={loaderData.userPersonDetails.collections.map(
												(c) => c.name,
											)}
											formValue={loaderData.personId}
											entityLot={EntityLot.Person}
										/>
										<MarkEntityAsPartialMenuItem
											entityLot={EntityLot.Person}
											entityId={loaderData.personId}
										/>
									</Menu.Dropdown>
								</Menu>
							</SimpleGrid>
						</MediaScrollArea>
					</Tabs.Panel>
					{!userPreferences.general.disableReviews ? (
						<Tabs.Panel value="reviews">
							<MediaScrollArea>
								{loaderData.userPersonDetails.reviews.length > 0 ? (
									<Stack>
										{loaderData.userPersonDetails.reviews.map((r) => (
											<ReviewItemDisplay
												review={r}
												key={r.id}
												entityLot={EntityLot.Person}
												entityId={loaderData.personId}
												title={loaderData.personDetails.details.name}
											/>
										))}
									</Stack>
								) : (
									<Text>No reviews</Text>
								)}
							</MediaScrollArea>
						</Tabs.Panel>
					) : null}
				</Tabs>
			</MediaDetailsLayout>
		</Container>
	);
}

const MetadataDisplay = (props: {
	metadataId: string;
	character?: string | null;
}) => {
	return (
		<PartialMetadataDisplay
			metadataId={props.metadataId}
			extraText={props.character ? `as ${props.character}` : undefined}
		/>
	);
};

const MetadataGroupDisplay = (props: {
	metadataGroupId: string;
}) => {
	const { data: metadataGroupDetails } = useQuery(
		getMetadataGroupDetailsQuery(props.metadataGroupId),
	);

	return (
		<BaseEntityDisplay
			title={metadataGroupDetails?.details.title}
			image={metadataGroupDetails?.details.displayImages[0]}
			link={$path("/media/groups/item/:id", { id: props.metadataGroupId })}
		/>
	);
};
