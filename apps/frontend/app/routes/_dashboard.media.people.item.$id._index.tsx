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
import {
	EntityLot,
	EntityTranslationVariant,
} from "@ryot/generated/graphql/backend/graphql";
import { parseParameters, parseSearchQuery } from "@ryot/ts-utils";
import {
	IconDeviceTv,
	IconInfoCircle,
	IconLibrary,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	DisplayCollectionToEntity,
	EditButton,
	SkeletonLoader,
} from "~/components/common";
import { MediaDetailsLayout } from "~/components/common/layout";
import { ReviewItemDisplay } from "~/components/common/review";
import {
	BaseEntityDisplay,
	MediaScrollArea,
	PartialMetadataDisplay,
} from "~/components/media/base-display";
import {
	MarkEntityAsPartialMenuItem,
	ToggleMediaMonitorMenuItem,
} from "~/components/media/menu-items";
import {
	useMetadataGroupDetails,
	usePersonDetails,
	useUserPersonDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { useAddEntityToCollections, useReviewEntity } from "~/lib/state/media";
import type { Route } from "./+types/_dashboard.media.people.item.$id._index";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { id: personId } = parseParameters(
		params,
		z.object({ id: z.string() }),
	);
	const query = parseSearchQuery(request, searchParamsSchema);

	return { query, personId };
};

export const meta = () => {
	return [{ title: "Person Details | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();

	const [
		personDetails,
		isPersonPartialStatusActive,
		usePersonTranslationValue,
	] = usePersonDetails(loaderData.personId);
	const userPersonDetails = useUserPersonDetails(loaderData.personId);

	const personTitleTranslation = usePersonTranslationValue({
		variant: EntityTranslationVariant.Title,
	});

	const personDescriptionTranslation = usePersonTranslationValue({
		variant: EntityTranslationVariant.Description,
	});

	const personImageTranslation = usePersonTranslationValue({
		variant: EntityTranslationVariant.Image,
	});

	const title =
		personTitleTranslation || personDetails.data?.details.name || "";
	const description =
		personDescriptionTranslation || personDetails.data?.details.description;

	const [mediaRoleFilter, setMediaRoleFilter] = useLocalStorage(
		"PersonMediaTabRoleFilter",
		personDetails.data?.associatedMetadata.map((c) => c.name).at(0) || null,
	);
	const [groupRoleFilter, setGroupRoleFilter] = useLocalStorage(
		"PersonGroupTabRoleFilter",
		personDetails.data?.associatedMetadataGroups.map((c) => c.name).at(0) ||
			null,
	);

	const totalMetadata = personDetails.data?.associatedMetadata.length || 0;
	const totalMetadataGroups =
		personDetails.data?.associatedMetadataGroups.length || 0;
	const additionalPersonDetails = [
		totalMetadata ? `${totalMetadata} media items` : null,
		totalMetadataGroups ? `${totalMetadataGroups} groups` : null,
		personDetails.data?.details.birthDate &&
			`Birth: ${personDetails.data?.details.birthDate}`,
		personDetails.data?.details.deathDate &&
			`Death: ${personDetails.data?.details.deathDate}`,
		personDetails.data?.details.place,
		personDetails.data?.details.gender,
		personDetails.data?.details.alternateNames &&
			personDetails.data?.details.alternateNames.length > 0 &&
			`Also called ${personDetails.data?.details.alternateNames.slice(0, 5).join(", ")}`,
		personDetails.data?.details.website && (
			<Anchor
				target="_blank"
				referrerPolicy="no-referrer"
				href={personDetails.data?.details.website}
			>
				Website
			</Anchor>
		),
	].filter(Boolean);

	return (
		<Container>
			{personDetails.data && userPersonDetails.data ? (
				<MediaDetailsLayout
					title={title}
					extraImage={personImageTranslation}
					assets={personDetails.data.details.assets}
					isPartialStatusActive={isPersonPartialStatusActive}
					externalLink={{
						source: personDetails.data.details.source,
						href: personDetails.data.details.sourceUrl,
					}}
				>
					{additionalPersonDetails.length > 0 ? (
						<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
							{additionalPersonDetails
								.map<ReactNode>((s) => s)
								.reduce((prev, curr) => [prev, " • ", curr])}
						</Text>
					) : null}
					{userPersonDetails.data.collections.length > 0 ? (
						<Group>
							{userPersonDetails.data.collections.map((col) => (
								<DisplayCollectionToEntity
									col={col}
									key={col.id}
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
								<Tabs.Tab
									value="media"
									leftSection={<IconDeviceTv size={16} />}
								>
									Media
								</Tabs.Tab>
							) : null}
							{totalMetadataGroups > 0 ? (
								<Tabs.Tab
									value="groups"
									leftSection={<IconLibrary size={16} />}
								>
									Groups
								</Tabs.Tab>
							) : null}
							{description ? (
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
												data={personDetails.data.associatedMetadata.map(
													(c) => ({
														value: c.name,
														label: `${c.name} (${c.items.length})`,
													}),
												)}
											/>
										</Group>
										<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
											{personDetails.data.associatedMetadata
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
												data={personDetails.data.associatedMetadataGroups.map(
													(c) => ({
														value: c.name,
														label: `${c.name} (${c.items.length})`,
													}),
												)}
											/>
										</Group>
										<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
											{personDetails.data.associatedMetadataGroups
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
						{description ? (
							<Tabs.Panel value="overview">
								<MediaScrollArea>
									<div
										// biome-ignore lint/security/noDangerouslySetInnerHtml: generated by the backend securely
										dangerouslySetInnerHTML={{ __html: description }}
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
												entityLot: EntityLot.Person,
												entityId: loaderData.personId,
												entityTitle:
													personTitleTranslation ||
													personDetails.data.details.name,
											});
										}}
									>
										Post a review
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											setAddEntityToCollectionsData({
												entityLot: EntityLot.Person,
												entityId: loaderData.personId,
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
												entityLot={EntityLot.Person}
												formValue={loaderData.personId}
												inCollections={userPersonDetails.data.collections.map(
													(c) => c.details.collectionName,
												)}
											/>
											<MarkEntityAsPartialMenuItem
												entityLot={EntityLot.Person}
												entityId={loaderData.personId}
											/>
										</Menu.Dropdown>
									</Menu>
									{personDetails.data && (
										<EditButton
											label="Edit person"
											editRouteType="people"
											entityId={personDetails.data.details.id}
											source={personDetails.data.details.source}
											createdByUserId={
												personDetails.data.details.createdByUserId
											}
										/>
									)}
								</SimpleGrid>
							</MediaScrollArea>
						</Tabs.Panel>
						{!userPreferences.general.disableReviews ? (
							<Tabs.Panel value="reviews">
								<MediaScrollArea>
									{userPersonDetails.data.reviews.length > 0 ? (
										<Stack>
											{userPersonDetails.data.reviews.map((r) => (
												<ReviewItemDisplay
													review={r}
													key={r.id}
													entityLot={EntityLot.Person}
													entityId={loaderData.personId}
													title={personDetails.data.details.name}
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
			) : (
				<SkeletonLoader />
			)}
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

const MetadataGroupDisplay = (props: { metadataGroupId: string }) => {
	const [
		{ data: metadataGroupDetails },
		isMetadataGroupPartialStatusActive,
		useMetadataGroupTranslationValue,
	] = useMetadataGroupDetails(props.metadataGroupId);

	const metadataGroupTitleTranslation = useMetadataGroupTranslationValue({
		variant: EntityTranslationVariant.Title,
	});

	const metadataGroupImageTranslation = useMetadataGroupTranslationValue({
		variant: EntityTranslationVariant.Image,
	});

	return (
		<BaseEntityDisplay
			isPartialStatusActive={isMetadataGroupPartialStatusActive}
			link={$path("/media/groups/item/:id", { id: props.metadataGroupId })}
			title={
				metadataGroupTitleTranslation || metadataGroupDetails?.details.title
			}
			image={
				metadataGroupImageTranslation ||
				metadataGroupDetails?.details.assets.remoteImages.at(0)
			}
		/>
	);
};
