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
import { Form, data } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { SkeletonLoader } from "~/components/common";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useApplicationEvents,
	useConfirmSubmit,
	useCoreDetails,
	useNonHiddenUserCollections,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
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
	list: z.object({ url: z.string(), collection: z.string() }).optional(),
});

const usernameImportFormSchema = z.object({ username: z.string() });

const apiUrlImportFormSchema = z.object({
	apiUrl: z.string(),
});

const apiKeySchema = z.object({ apiKey: z.string() });

const urlAndKeyImportFormSchema = apiUrlImportFormSchema.extend(
	apiKeySchema.shape,
);

const optionalPasswordSchema = z.object({ password: z.string().optional() });

const jellyfinImportFormSchema = usernameImportFormSchema
	.extend(apiUrlImportFormSchema.shape)
	.extend(optionalPasswordSchema.shape);

const genericCsvImportFormSchema = z.object({ csvPath: z.string() });

const strongAppImportFormSchema = z.object({ dataExportPath: z.string() });

const igdbImportFormSchema = z
	.object({ collection: z.string() })
	.extend(genericCsvImportFormSchema.shape);

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
	const submit = useConfirmSubmit();
	const coreDetails = useCoreDetails();
	const events = useApplicationEvents();
	const { inViewport, ref } = useInViewport();
	const userCollections = useNonHiddenUserCollections();
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();

	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

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

	const userExportsQuery = useQuery({
		queryKey: ["userExports"],
		queryFn: async () => {
			const { userExports } =
				await clientGqlService.request(UserExportsDocument);
			return userExports;
		},
	});

	return (
		<Container size="xs">
			<Tabs defaultValue="import">
				<Tabs.List>
					<Tabs.Tab value="import">Import</Tabs.Tab>
					<Tabs.Tab value="export">Export</Tabs.Tab>
				</Tabs.List>
				<Box mt="xl">
					<Tabs.Panel value="import">
						<Stack>
							<Form
								method="POST"
								encType="multipart/form-data"
								action={withQuery(".", { intent: "deployImport" })}
							>
								<Stack>
									<input
										hidden
										name="source"
										defaultValue={deployImportSource}
									/>
									<Title order={2}>Import data</Title>
									<Select
										required
										searchable
										id="import-source"
										label="Select a source"
										data={convertEnumToSelectData(ImportSource)}
										onChange={(v) => setDeployImportSource(v as ImportSource)}
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
																required
																name="csvPath"
																accept=".csv"
																label="CSV file"
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
														<TextInput
															mt="sm"
															name="password"
															label="Password"
														/>
													</>
												))
												.with(ImportSource.Movary, () => (
													<>
														<FileInput
															required
															accept=".csv"
															name="history"
															label="History CSV file"
														/>
														<FileInput
															required
															accept=".csv"
															name="ratings"
															label="Ratings CSV file"
														/>
														<FileInput
															required
															accept=".csv"
															name="watchlist"
															label="Watchlist CSV file"
														/>
													</>
												))
												.with(ImportSource.Igdb, () => (
													<>
														<Select
															required
															name="collection"
															label="Collection"
															data={userCollections.map((c) => c.name)}
														/>
														<FileInput
															required
															accept=".csv"
															name="csvPath"
															label="CSV File"
														/>
													</>
												))
												.with(ImportSource.Myanimelist, () => (
													<>
														<FileInput
															name="animePath"
															label="Anime export file"
														/>
														<FileInput
															name="mangaPath"
															label="Manga export file"
														/>
													</>
												))
												.with(
													ImportSource.Anilist,
													ImportSource.GenericJson,
													() => (
														<>
															<FileInput
																required
																name="export"
																accept=".json"
																label="JSON export file"
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
								</Stack>
							</Form>
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
								<SkeletonLoader />
							)}
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="export">
						<Stack>
							<Group justify="space-between">
								<Title order={2}>Export data</Title>
								<Anchor
									size="xs"
									target="_blank"
									href={`${coreDetails.docsLink}/exporting.html`}
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
							{userExportsQuery.data ? (
								userExportsQuery.data.length > 0 ? (
									<Stack>
										{userExportsQuery.data.map((exp) => (
											<DisplayExport
												item={exp}
												key={exp.startedAt}
												refetch={userExportsQuery.refetch}
											/>
										))}
									</Stack>
								) : (
									<Text>You have not performed any exports</Text>
								)
							) : (
								<SkeletonLoader />
							)}
						</Stack>
					</Tabs.Panel>
				</Box>
			</Tabs>
		</Container>
	);
}

type ExportItemProps = {
	refetch: () => void;
	item: UserExportsQuery["userExports"][number];
};

const DisplayExport = (props: ExportItemProps) => {
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
				<Stack gap="xs" flex={1} miw={0}>
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
									() => {
										submit(form);
										props.refetch();
									},
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
