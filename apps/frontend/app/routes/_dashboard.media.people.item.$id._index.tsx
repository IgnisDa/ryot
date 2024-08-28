import {
	Anchor,
	Box,
	Button,
	Container,
	Group,
	Menu,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	DeployUpdatePersonJobDocument,
	EntityLot,
	PersonDetailsDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission } from "@ryot/ts-utils";
import {
	IconDeviceTv,
	IconInfoCircle,
	IconMessageCircle2,
	IconUser,
} from "@tabler/icons-react";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import {
	DisplayCollection,
	MediaDetailsLayout,
	ReviewItemDisplay,
} from "~/components/common";
import {
	MediaIsPartial,
	MediaScrollArea,
	PartialMetadataDisplay,
	ToggleMediaMonitorMenuItem,
} from "~/components/media";
import { useUserPreferences } from "~/lib/hooks";
import { useAddEntityToCollection, useReviewEntity } from "~/lib/state/media";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	defaultTab: z.string().optional().default("media"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { id: personId } = zx.parseParams(params, { id: z.string() });
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ personDetails }, { userPersonDetails }] = await Promise.all([
		serverGqlService.request(PersonDetailsDocument, { personId }),
		serverGqlService.authenticatedRequest(request, UserPersonDetailsDocument, {
			personId,
		}),
	]);
	return { query, personId, userPersonDetails, personDetails };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.personDetails.details.name} | Ryot` }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		deployUpdatePersonJob: async () => {
			const submission = processSubmission(formData, personIdSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DeployUpdatePersonJobDocument,
				submission,
			);
			return Response.json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Metadata person job deployed successfully",
				}),
			});
		},
	});
});

const personIdSchema = z.object({ personId: z.string() });

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();

	return (
		<Container>
			<MediaDetailsLayout
				images={loaderData.personDetails.details.displayImages}
				externalLink={{
					source: loaderData.personDetails.details.source,
					href: loaderData.personDetails.sourceUrl,
				}}
			>
				<Title id="creator-title">
					{loaderData.personDetails.details.name}
				</Title>
				<Text c="dimmed" fz={{ base: "sm", lg: "md" }}>
					{[
						`${
							loaderData.personDetails.contents.flatMap((c) => c.items).length
						} media items`,
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
								href={loaderData.personDetails.details.website}
								target="_blank"
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
				{loaderData.personDetails.details.isPartial ? (
					<MediaIsPartial mediaType="person" />
				) : null}
				<Tabs variant="outline" defaultValue={loaderData.query.defaultTab}>
					<Tabs.List mb="xs">
						<Tabs.Tab value="media" leftSection={<IconDeviceTv size={16} />}>
							Media
						</Tabs.Tab>
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
					<Tabs.Panel value="media">
						<MediaScrollArea>
							<Stack>
								{loaderData.personDetails.contents.map((role) => (
									<Box key={role.name}>
										<Title order={3} mb="xs" ta="center">
											{role.name}
										</Title>
										<SimpleGrid cols={{ base: 3, md: 4, lg: 5 }}>
											{role.items.map((item) => (
												<PartialMetadataDisplay
													key={item.mediaId}
													metadataId={item.mediaId}
													extraText={
														item.character ? `as ${item.character}` : undefined
													}
												/>
											))}
										</SimpleGrid>
									</Box>
								))}
							</Stack>
						</MediaScrollArea>
					</Tabs.Panel>
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
										<Form
											replace
											method="POST"
											action={withQuery("", {
												intent: "deployUpdatePersonJob",
											})}
										>
											<Menu.Item
												type="submit"
												name="personId"
												value={loaderData.personId}
											>
												Update person
											</Menu.Item>
										</Form>
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
