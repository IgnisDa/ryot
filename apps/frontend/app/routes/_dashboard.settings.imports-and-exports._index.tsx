import { CodeHighlight } from "@mantine/code-highlight";
import {
	Accordion,
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Divider,
	FileInput,
	Group,
	Indicator,
	Paper,
	Progress,
	Select,
	Skeleton,
	Stack,
	Tabs,
	Text,
	TextInput,
	ThemeIcon,
	Title,
	Tooltip,
} from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import {
	DeployExportJobDocument,
	DeployImportJobDocument,
	ImportSource,
	UserExportsDocument,
	type UserExportsQuery,
	UserImportReportsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	getActionIntent,
	kebabCase,
	processSubmission,
} from "@ryot/ts-utils";
import { IconDownload, IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { filesize } from "filesize";
import { useMemo, useState } from "react";
import { Form, data, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useApplicationEvents,
	useConfirmSubmit,
	useCoreDetails,
	useNonHiddenUserCollections,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/query-factory";
import {
	convertEnumToSelectData,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import {
	createToastHeaders,
	parseFormDataWithTemporaryUpload,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.settings.imports-and-exports._index";

export const loader = async ({ request }: Route.LoaderArgs) => {
	const [{ userExports }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UserExportsDocument, {}),
	]);
	return { userExports };
};

export const meta = () => {
	return [{ title: "Imports and Exports | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await parseFormDataWithTemporaryUpload(request.clone());
	const intent = getActionIntent(request);
	return await match(intent)
		.with("deployImport", async () => {
			const source = formData.get("source") as ImportSource;
			formData.delete("source");
			const values = await match(source)
				.with(
					ImportSource.Hevy,
					ImportSource.Imdb,
					ImportSource.OpenScale,
					ImportSource.Goodreads,
					ImportSource.Grouvee,
					ImportSource.Hardcover,
					ImportSource.Storygraph,
					() => ({
						genericCsv: processSubmission(formData, genericCsvImportFormSchema),
					}),
				)
				.with(
					ImportSource.Plex,
					ImportSource.Mediatracker,
					ImportSource.Audiobookshelf,
					() => ({
						urlAndKey: processSubmission(formData, urlAndKeyImportFormSchema),
					}),
				)
				.with(ImportSource.StrongApp, () => ({
					strongApp: processSubmission(formData, strongAppImportFormSchema),
				}))
				.with(ImportSource.Trakt, () => ({
					trakt: processSubmission(formData, traktImportFormSchema),
				}))
				.with(ImportSource.Movary, async () => ({
					movary: processSubmission(formData, movaryImportFormSchema),
				}))
				.with(ImportSource.Myanimelist, async () => ({
					mal: processSubmission(formData, malImportFormSchema),
				}))
				.with(ImportSource.GenericJson, ImportSource.Anilist, async () => ({
					genericJson: processSubmission(formData, jsonImportFormSchema),
				}))
				.with(ImportSource.Jellyfin, async () => ({
					jellyfin: processSubmission(formData, jellyfinImportFormSchema),
				}))
				.with(ImportSource.Igdb, async () => ({
					igdb: processSubmission(formData, igdbImportFormSchema),
				}))
				.exhaustive();
			await serverGqlService.authenticatedRequest(
				request,
				DeployImportJobDocument,
				{ input: { source, ...values } },
			);
			return data({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Import job started in the background",
				}),
			});
		})
		.with("deployExport", async () => {
			await serverGqlService.authenticatedRequest(
				request,
				DeployExportJobDocument,
				{},
			);
			return data({ status: "success" } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Export job started in the background",
				}),
			});
		})
		.run();
};

const traktImportFormSchema = z.object({
	user: z.string().optional(),
	list: z
		.object({
			url: z.string(),
			collection: z.string(),
		})
		.optional(),
});

const usernameImportFormSchema = z.object({ username: z.string() });

const apiUrlImportFormSchema = z.object({
	apiUrl: z.string(),
});

const urlAndKeyImportFormSchema = apiUrlImportFormSchema.merge(
	z.object({ apiKey: z.string() }),
);

const jellyfinImportFormSchema = usernameImportFormSchema
	.merge(apiUrlImportFormSchema)
	.merge(z.object({ password: z.string().optional() }));

const genericCsvImportFormSchema = z.object({ csvPath: z.string() });

const strongAppImportFormSchema = z.object({ dataExportPath: z.string() });

const igdbImportFormSchema = z
	.object({ collection: z.string() })
	.merge(genericCsvImportFormSchema);

const movaryImportFormSchema = z.object({
	ratings: z.string(),
	history: z.string(),
	watchlist: z.string(),
});

const jsonImportFormSchema = z.object({ export: z.string() });

const malImportFormSchema = z.object({
	animePath: z.string().optional(),
	mangaPath: z.string().optional(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const submit = useConfirmSubmit();
	const { inViewport, ref } = useInViewport();
	const userCollections = useNonHiddenUserCollections();
	const events = useApplicationEvents();
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();

	const userImportsReportsQuery = useQuery({
		enabled: inViewport,
		refetchInterval: 5000,
		queryKey: ["userImportsReports"],
		queryFn: async () => {
			const { userImportReports } = await clientGqlService.request(
				UserImportReportsDocument,
			);
			return userImportReports;
		},
	});

	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	return (
		<Container size="xs">
			<Tabs defaultValue="import">
				<Tabs.List>
					<Tabs.Tab value="import">Import</Tabs.Tab>
					<Tabs.Tab value="export">Export</Tabs.Tab>
				</Tabs.List>
				<Box mt="xl">
					<Tabs.Panel value="import">
						<Form
							method="POST"
							encType="multipart/form-data"
							action={withQuery(".", { intent: "deployImport" })}
						>
							<input hidden name="source" defaultValue={deployImportSource} />
							<Stack>
								<Title order={2}>Import data</Title>
								<Select
									required
									searchable
									id="import-source"
									label="Select a source"
									data={convertEnumToSelectData(ImportSource)}
									onChange={(v) => {
										if (v) setDeployImportSource(v as ImportSource);
									}}
								/>
								{deployImportSource ? (
									<Anchor
										size="xs"
										target="_blank"
										href={`${coreDetails.docsLink}/importing/${kebabCase(deployImportSource)}.html`}
									>
										Click here to see the documentation for this source
									</Anchor>
								) : null}
								{deployImportSource ? (
									<>
										{match(deployImportSource)
											.with(
												ImportSource.Plex,
												ImportSource.Mediatracker,
												ImportSource.Audiobookshelf,
												() => (
													<>
														<TextInput
															label="Instance Url"
															required
															name="apiUrl"
														/>
														<TextInput
															mt="sm"
															label="API Key"
															required
															name="apiKey"
														/>
													</>
												),
											)
											.with(
												ImportSource.Hevy,
												ImportSource.Imdb,
												ImportSource.OpenScale,
												ImportSource.Goodreads,
												ImportSource.Grouvee,
												ImportSource.Hardcover,
												ImportSource.Storygraph,
												() => (
													<>
														<FileInput
															label="CSV file"
															accept=".csv"
															required
															name="csvPath"
														/>
													</>
												),
											)
											.with(ImportSource.StrongApp, () => (
												<>
													<FileInput
														required
														accept=".csv"
														label="CSV file"
														name="dataExportPath"
													/>
												</>
											))
											.with(ImportSource.Trakt, () => (
												<Tabs defaultValue="user" keepMounted={false}>
													<Tabs.List>
														<Tabs.Tab value="user">User</Tabs.Tab>
														<Tabs.Tab value="list">List</Tabs.Tab>
													</Tabs.List>
													<Tabs.Panel value="user" mt="xs">
														<TextInput
															required
															name="user"
															label="The username of the Trakt user to import"
														/>
													</Tabs.Panel>
													<Tabs.Panel value="list" mt="xs">
														<Stack gap="xs">
															<TextInput
																required
																name="list.url"
																label="The URL of the list to import"
																placeholder="https://trakt.tv/users/felix66/lists/trakt-movie-the-new-york-times-guide-to-the-best-1-000-movies-ever-made?sort=rank,asc"
															/>
															<Select
																required
																label="Collection"
																name="list.collection"
																data={userCollections.map((c) => c.name)}
															/>
														</Stack>
													</Tabs.Panel>
												</Tabs>
											))
											.with(ImportSource.Jellyfin, () => (
												<>
													<TextInput
														required
														name="apiUrl"
														label="Instance Url"
													/>
													<TextInput
														required
														name="username"
														label="Username"
													/>
													<TextInput mt="sm" name="password" label="Password" />
												</>
											))
											.with(ImportSource.Movary, () => (
												<>
													<FileInput
														label="History CSV file"
														accept=".csv"
														required
														name="history"
													/>
													<FileInput
														label="Ratings CSV file"
														accept=".csv"
														required
														name="ratings"
													/>
													<FileInput
														label="Watchlist CSV file"
														accept=".csv"
														required
														name="watchlist"
													/>
												</>
											))
											.with(ImportSource.Igdb, () => (
												<>
													<Select
														label="Collection"
														required
														name="collection"
														data={userCollections.map((c) => c.name)}
													/>
													<FileInput
														label="CSV File"
														accept=".csv"
														required
														name="csvPath"
													/>
												</>
											))
											.with(ImportSource.Myanimelist, () => (
												<>
													<FileInput
														label="Anime export file"
														name="animePath"
													/>
													<FileInput
														label="Manga export file"
														name="mangaPath"
													/>
												</>
											))
											.with(
												ImportSource.Anilist,
												ImportSource.GenericJson,
												() => (
													<>
														<FileInput
															label="JSON export file"
															accept=".json"
															required
															name="export"
														/>
													</>
												),
											)
											.exhaustive()}
										<Button
											mt="md"
											fullWidth
											radius="md"
											color="blue"
											type="submit"
											variant="light"
											onClick={(e) => {
												const form = e.currentTarget.form;
												e.preventDefault();
												openConfirmationModal(
													"Are you sure you want to deploy an import job? This action is irreversible.",
													() => {
														submit(form);
														events.deployImport(deployImportSource);
													},
												);
											}}
										>
											Import
										</Button>
									</>
								) : null}
								<Divider />
								<Title order={3} ref={ref}>
									Import history
								</Title>
								{userImportsReportsQuery.data ? (
									userImportsReportsQuery.data.length > 0 ? (
										<Accordion>
											{userImportsReportsQuery.data.map((report) => {
												const isInProgress =
													typeof report.wasSuccess !== "boolean";

												return (
													<Accordion.Item
														key={report.id}
														value={report.id}
														data-import-report-id={report.id}
													>
														<Accordion.Control disabled={isInProgress}>
															<Stack gap="xs">
																<Box>
																	<Indicator
																		inline
																		size={12}
																		zIndex={0}
																		offset={-3}
																		processing={isInProgress}
																		color={
																			isInProgress
																				? undefined
																				: report.wasSuccess
																					? "green"
																					: "red"
																		}
																	>
																		{changeCase(report.source)}{" "}
																		<Text size="xs" span c="dimmed">
																			({dayjsLib(report.startedOn).fromNow()})
																		</Text>
																	</Indicator>
																</Box>
																{isInProgress && report.progress ? (
																	<>
																		<Box>
																			<Text span fw="bold" mr={4}>
																				Estimated to finish at:
																			</Text>
																			{dayjsLib(
																				report.estimatedFinishTime,
																			).format("lll")}
																		</Box>
																		<Group wrap="nowrap">
																			<Progress
																				flex={1}
																				animated
																				value={Number(report.progress)}
																			/>
																			<Text size="xs">
																				{Number.parseFloat(
																					report.progress,
																				).toFixed(3)}
																				%
																			</Text>
																		</Group>
																	</>
																) : null}
															</Stack>
														</Accordion.Control>
														<Accordion.Panel
															styles={{ content: { paddingTop: 0 } }}
														>
															<Stack>
																<Box>
																	<Group>
																		{report.details ? (
																			<Box>
																				<Text span fw="bold" mr={4}>
																					Total imported:
																				</Text>
																				{report.details.import.total},
																			</Box>
																		) : null}
																		<Box>
																			<Text span fw="bold" mr={4}>
																				Started at:
																			</Text>
																			{dayjsLib(report.startedOn).format("lll")}
																		</Box>
																	</Group>
																	<Group>
																		<Box>
																			{report.finishedOn ? (
																				<>
																					<Text span fw="bold" mr={4}>
																						Finished on:
																					</Text>
																					{dayjsLib(report.finishedOn).format(
																						"lll",
																					)}
																				</>
																			) : null}
																		</Box>
																		{report.details ? (
																			<Box>
																				<Text span fw="bold" mr={4}>
																					Failed:
																				</Text>
																				{report.details.failedItems.length}
																			</Box>
																		) : null}
																	</Group>
																</Box>
																{report.details &&
																report.details.failedItems.length > 0 ? (
																	<CodeHighlight
																		mah={400}
																		language="json"
																		style={{ overflow: "scroll" }}
																		code={JSON.stringify(
																			report.details.failedItems,
																			null,
																			2,
																		)}
																	/>
																) : null}
															</Stack>
														</Accordion.Panel>
													</Accordion.Item>
												);
											})}
										</Accordion>
									) : (
										<Text>You have not performed any imports</Text>
									)
								) : (
									<Skeleton h={80} w="100%" />
								)}
							</Stack>
						</Form>
					</Tabs.Panel>
					<Tabs.Panel value="export">
						<Stack>
							<Group justify="space-between">
								<Title order={2}>Export data</Title>
								<Anchor
									size="xs"
									href={`${coreDetails.docsLink}/guides/exporting.html`}
									target="_blank"
								>
									Docs
								</Anchor>
							</Group>
							<Form
								method="POST"
								encType="multipart/form-data"
								action={withQuery(".", { intent: "deployExport" })}
							>
								<input
									hidden
									name="dummy"
									defaultValue="this is required because of the encType"
								/>
								<Tooltip
									label="Please enable file storage to use this feature"
									disabled={!fileUploadNotAllowed}
								>
									<Button
										mt="xs"
										fullWidth
										radius="md"
										color="blue"
										type="submit"
										variant="light"
										disabled={fileUploadNotAllowed}
									>
										Start job
									</Button>
								</Tooltip>
							</Form>
							<Divider />
							<Title order={3}>Export history</Title>
							{loaderData.userExports.length > 0 ? (
								<Stack>
									{loaderData.userExports.map((exp) => (
										<ExportItem key={exp.startedAt} item={exp} />
									))}
								</Stack>
							) : (
								<Text>You have not performed any exports</Text>
							)}
						</Stack>
					</Tabs.Panel>
				</Box>
			</Tabs>
		</Container>
	);
}

type ExportItemProps = {
	item: UserExportsQuery["userExports"][number];
};

const ExportItem = (props: ExportItemProps) => {
	const submit = useConfirmSubmit();

	const duration = useMemo(() => {
		const seconds = dayjsLib(props.item.endedAt).diff(
			dayjsLib(props.item.startedAt),
			"second",
		);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	}, [props.item.startedAt, props.item.endedAt]);

	return (
		<Paper withBorder p={{ base: "sm", md: "md" }}>
			<Group justify="space-between" wrap="wrap">
				<Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
					<Text span>
						{dayjsLib(props.item.startedAt).format("MMM DD, YYYY [at] h:mm A")}
					</Text>
					<Text span size="xs" c="dimmed">
						(Took {duration}, {filesize(props.item.size)})
					</Text>
				</Stack>
				<Group>
					<Anchor href={props.item.url} target="_blank" rel="noreferrer">
						<ThemeIcon color="blue" variant="transparent">
							<IconDownload />
						</ThemeIcon>
					</Anchor>
					<Form
						method="POST"
						action={withQuery($path("/actions"), {
							intent: "deleteS3Asset",
						})}
					>
						<input hidden name="key" defaultValue={props.item.key} />
						<ActionIcon
							color="red"
							type="submit"
							variant="transparent"
							onClick={(e) => {
								const form = e.currentTarget.form;
								e.preventDefault();
								openConfirmationModal(
									"Are you sure you want to delete this export? This action is irreversible.",
									() => submit(form),
								);
							}}
						>
							<IconTrash />
						</ActionIcon>
					</Form>
				</Group>
			</Group>
		</Paper>
	);
};
