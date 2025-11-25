import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Divider,
	Drawer,
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
import { IconDownload, IconEye, IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { filesize } from "filesize";
import { DataTable } from "mantine-datatable";
import { useMemo, useState } from "react";
import { Form, data, useSubmit } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { SkeletonLoader } from "~/components/common";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useApplicationEvents,
	useCoreDetails,
	useDeleteS3AssetMutation,
	useNonHiddenUserCollections,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	openConfirmationModal,
	triggerDownload,
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
				.with(
					ImportSource.GenericJson,
					ImportSource.Anilist,
					ImportSource.Watcharr,
					async () => ({
						path: processSubmission(formData, exportPathImportFormSchema),
					}),
				)
				.with(ImportSource.Netflix, async () => ({
					netflix: processSubmission(formData, netflixImportFormSchema),
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

const exportPathImportFormSchema = z.object({ exportPath: z.string() });

const netflixImportFormSchema = z.object({
	input: exportPathImportFormSchema,
	profileName: z.string().optional(),
});

const malImportFormSchema = z.object({
	animePath: z.string().optional(),
	mangaPath: z.string().optional(),
});

export default function Page() {
	const submit = useSubmit();
	const coreDetails = useCoreDetails();
	const events = useApplicationEvents();
	const { inViewport, ref } = useInViewport();
	const userCollections = useNonHiddenUserCollections();
	const [openDrawerId, setOpenDrawerId] = useState<string | null>(null);
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();

	const fileUploadNotAllowed = !coreDetails.fileStorageEnabled;

	const userImportsReportsQuery = useQuery({
		enabled: inViewport,
		refetchInterval: 5000,
		queryKey: ["userImportsReports"],
		queryFn: () =>
			clientGqlService
				.request(UserImportReportsDocument)
				.then((u) => u.userImportReports),
	});

	const userExportsQuery = useQuery({
		queryKey: ["userExports"],
		queryFn: () =>
			clientGqlService.request(UserExportsDocument).then((u) => u.userExports),
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
							<form
								onSubmit={(event) => {
									event.preventDefault();
									const form = event.target as HTMLFormElement;
									openConfirmationModal(
										"Are you sure you want to deploy an import job? This action is irreversible.",
										() => {
											const formData = new FormData(form);
											formData.set("intent", "deployImport");
											submit(formData, {
												method: "POST",
												encType: "multipart/form-data",
											});
											if (deployImportSource) {
												events.deployImport(deployImportSource);
											}
										},
									);
								}}
							>
								<Stack>
									<input hidden name="source" value={deployImportSource} />
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
														<FileInput
															required
															name="csvPath"
															accept=".csv"
															label="CSV file"
														/>
													),
												)
												.with(ImportSource.StrongApp, () => (
													<FileInput
														required
														accept=".csv"
														label="CSV file"
														name="dataExportPath"
													/>
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
													ImportSource.Watcharr,
													ImportSource.GenericJson,
													() => (
														<FileInput
															required
															accept=".json"
															name="exportPath"
															label="JSON export file"
														/>
													),
												)
												.with(ImportSource.Netflix, () => (
													<>
														<FileInput
															required
															accept=".zip"
															name="input.exportPath"
															label="Netflix ZIP export file"
														/>
														<TextInput
															name="profileName"
															label="Profile Name"
															description="Filter import to a specific Netflix profile"
														/>
													</>
												))
												.exhaustive()}
											<Button
												mt="md"
												fullWidth
												radius="md"
												color="blue"
												type="submit"
												variant="light"
											>
												Import
											</Button>
										</>
									) : null}
								</Stack>
							</form>
							<Divider />
							<Title order={3} ref={ref}>
								Import history
							</Title>
							{userImportsReportsQuery.data ? (
								userImportsReportsQuery.data.length > 0 ? (
									<Stack>
										{userImportsReportsQuery.data.map((report) => {
											const isInProgress =
												typeof report.wasSuccess !== "boolean";

											return (
												<Paper
													p="md"
													withBorder
													key={report.id}
													data-import-report-id={report.id}
												>
													<Group justify="space-between" wrap="nowrap">
														<Stack gap="xs" flex={1} miw={0}>
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
														{!isInProgress && (
															<ActionIcon
																color="blue"
																variant="transparent"
																onClick={() => setOpenDrawerId(report.id)}
															>
																<IconEye />
															</ActionIcon>
														)}
													</Group>
													<Drawer
														size="xl"
														position="bottom"
														opened={openDrawerId === report.id}
														onClose={() => setOpenDrawerId(null)}
														title={`${changeCase(report.source)} Import Details`}
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
																<Box>
																	<Group justify="space-between" mb="md">
																		<Title order={4}>Failed Items</Title>
																		<Tooltip label="Download errors">
																			<ActionIcon
																				color="blue"
																				variant="light"
																				onClick={() => {
																					if (!report.details) return;
																					const json = JSON.stringify(
																						report.details.failedItems,
																						null,
																						2,
																					);
																					const blob = new Blob([json], {
																						type: "application/json",
																					});
																					const url = URL.createObjectURL(blob);
																					triggerDownload(
																						url,
																						`failed-items-${report.id}.json`,
																					);
																					URL.revokeObjectURL(url);
																				}}
																			>
																				<IconDownload />
																			</ActionIcon>
																		</Tooltip>
																	</Group>
																	<DataTable
																		height={500}
																		withTableBorder
																		borderRadius="sm"
																		withColumnBorders
																		records={report.details.failedItems}
																		columns={[
																			{
																				title: "Identifier",
																				accessor: "identifier",
																			},
																			{
																				title: "Step",
																				accessor: "step",
																				render: (record) =>
																					changeCase(record.step),
																			},
																			{
																				title: "Error",
																				accessor: "error",
																				render: (record) => record.error || "-",
																			},
																			{
																				title: "Type",
																				accessor: "lot",
																				render: (record) =>
																					record.lot
																						? changeCase(record.lot)
																						: "-",
																			},
																		]}
																	/>
																</Box>
															) : null}
														</Stack>
													</Drawer>
												</Paper>
											);
										})}
									</Stack>
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
												key={exp.key}
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
	const deleteS3AssetMutation = useDeleteS3AssetMutation();

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
					<ActionIcon
						color="red"
						variant="transparent"
						disabled={deleteS3AssetMutation.isPending}
						onClick={() => {
							openConfirmationModal(
								"Are you sure you want to delete this export? This action is irreversible.",
								() => {
									deleteS3AssetMutation
										.mutateAsync(props.item.key)
										.then(() => props.refetch());
								},
							);
						}}
					>
						<IconTrash />
					</ActionIcon>
				</Group>
			</Group>
		</Paper>
	);
};
