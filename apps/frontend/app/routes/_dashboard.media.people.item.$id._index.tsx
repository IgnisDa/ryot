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
	Title,
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
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { zx } from "zodix";
import {
	DisplayCollection,
	MediaDetailsLayout,
	ReviewItemDisplay,
} from "~/components/common";
import {
	MediaScrollArea,
	PartialMetadataDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
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
	const [roleFilter, setRoleFilter] = useLocalStorage(
		"MediaTabRoleFilter",
		loaderData.personDetails.contents.map((c) => c.name).at(0) || null,
	);

	const totalMetadata = sum(
		loaderData.personDetails.contents.map((c) => c.count),
	);

	return (
		<Container>
			<MediaDetailsLayout
				images={loaderData.personDetails.details.displayImages}
				externalLink={{
					source: loaderData.personDetails.details.source,
					href: loaderData.personDetails.details.sourceUrl,
				}}
			>
				<Title id="creator-title">
					{loaderData.personDetails.details.name}
				</Title>
				<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
					{[
						`${totalMetadata} media items`,
						loaderData.personDetails.details.birthDate &&
							`Birth: ${loaderData.personDetails.details.birthDate}`,
						loaderData.personDetails.details.deathDate &&
							`Death: ${loaderData.personDetails.details.deathDate}`,
						loaderData.personDetails.details.place &&
							loaderData.personDetails.details.place,
						loaderData.personDetails.details.gender,
					]
						.filter(Boolean)
						.join(" • ")}
					{loaderData.personDetails.details.website ? (
						<>
							{" "}
							•{" "}
							<Anchor
								target="_blank"
								referrerPolicy="no-referrer"
								fz={{ base: "xs", md: "sm" }}
								href={loaderData.personDetails.details.website}
							>
								Website
							</Anchor>
						</>
					) : null}
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
											value={roleFilter}
											onChange={(value) => setRoleFilter(value)}
											data={loaderData.personDetails.contents.map((c) => ({
												value: c.name,
												label: `${c.name} (${c.count})`,
											}))}
										/>
									</Group>
									<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
										{loaderData.personDetails.contents
											.find((c) => c.name === roleFilter)
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
