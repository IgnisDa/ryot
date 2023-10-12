import { APP_ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { fileToText, uploadFileToServiceAndGetPath } from "@/lib/utilities";
import {
	ActionIcon,
	Alert,
	Anchor,
	Box,
	Button,
	Container,
	CopyButton,
	FileInput,
	Flex,
	Group,
	PasswordInput,
	Progress,
	Select,
	Stack,
	Tabs,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	DeployImportJobDocument,
	type DeployImportJobMutationVariables,
	GenerateAuthTokenDocument,
	type GenerateAuthTokenMutationVariables,
	ImportSource,
	ExercisesListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { parse } from "csv-parse/sync";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";
import type { NextPageWithLayout } from "../../_app";

const message = {
	title: "Success",
	message: "Your import has started. Check back later.",
	color: "green",
};

const mediaTrackerImportFormSchema = z.object({
	apiUrl: z.string().url(),
	apiKey: z.string(),
});
type MediaTrackerImportFormSchema = z.infer<
	typeof mediaTrackerImportFormSchema
>;

const traktImportFormSchema = z.object({
	username: z.string(),
});
type TraktImportFormSchema = z.infer<typeof traktImportFormSchema>;

const goodreadsImportFormSchema = z.object({
	rssUrl: z.string().url(),
});
type GoodreadsImportFormSchema = z.infer<typeof goodreadsImportFormSchema>;

const movaryImportFormSchema = z.object({
	ratings: z.any(),
	history: z.any(),
	watchlist: z.any(),
});
type MovaryImportFormSchema = z.infer<typeof movaryImportFormSchema>;

const storyGraphImportFormSchema = z.object({
	export: z.any(),
});
type StoryGraphImportFormSchema = z.infer<typeof storyGraphImportFormSchema>;

const strongAppImportFormSchema = z.object({
	exportPath: z.any(),
});
type StrongAppImportFormSchema = z.infer<typeof strongAppImportFormSchema>;

const mediaJsonImportFormSchema = z.object({
	export: z.any(),
});
type MediaJsonImportFormSchema = z.infer<typeof mediaJsonImportFormSchema>;

const malImportFormSchema = z.object({
	animePath: z.string(),
	mangaPath: z.string(),
});
type MalImportFormSchema = z.infer<typeof malImportFormSchema>;

export const ImportSourceElement = (props: {
	children: JSX.Element | JSX.Element[];
}) => {
	return (
		<>
			{props.children}
			<Button
				variant="light"
				color="blue"
				fullWidth
				mt="md"
				type="submit"
				radius="md"
			>
				Import
			</Button>
		</>
	);
};

const Page: NextPageWithLayout = () => {
	const [deployImportSource, setDeployImportSource] = useState<ImportSource>();
	const [progress, setProgress] = useState<number | null>(null);

	const mediaTrackerImportForm = useForm<MediaTrackerImportFormSchema>({
		validate: zodResolver(mediaTrackerImportFormSchema),
	});
	const goodreadsImportForm = useForm<GoodreadsImportFormSchema>({
		validate: zodResolver(goodreadsImportFormSchema),
	});
	const traktImportForm = useForm<TraktImportFormSchema>({
		validate: zodResolver(traktImportFormSchema),
	});
	const movaryImportForm = useForm<MovaryImportFormSchema>({
		validate: zodResolver(movaryImportFormSchema),
	});
	const storyGraphImportForm = useForm<StoryGraphImportFormSchema>({
		validate: zodResolver(storyGraphImportFormSchema),
	});
	const strongAppImportForm = useForm<StrongAppImportFormSchema>({
		validate: zodResolver(strongAppImportFormSchema),
	});
	const mediaJsonImportForm = useForm<MediaJsonImportFormSchema>({
		validate: zodResolver(mediaJsonImportFormSchema),
	});
	const malImportForm = useForm<MalImportFormSchema>({
		validate: zodResolver(malImportFormSchema),
	});

	const deployImportJob = useMutation({
		mutationFn: async (variables: DeployImportJobMutationVariables) => {
			const { deployImportJob } = await gqlClient.request(
				DeployImportJobDocument,
				variables,
			);
			return deployImportJob;
		},
		onSuccess: () => {
			notifications.show(message);
		},
	});

	const generateAuthToken = useMutation({
		mutationFn: async (variables: GenerateAuthTokenMutationVariables) => {
			const { generateAuthToken } = await gqlClient.request(
				GenerateAuthTokenDocument,
				variables,
			);
			return generateAuthToken;
		},
	});

	const uploadFile = async (file: File) => {
		const data = await uploadFileToServiceAndGetPath(
			file,
			(event) => setProgress((event.loaded / event.total) * 100),
			() => setProgress(null),
		);
		return data;
	};

	return (
		<>
			<Head>
				<title>Perform a new import | Ryot</title>
			</Head>
			<Container size="xs">
				<Tabs defaultValue="import">
					<Tabs.List>
						<Tabs.Tab value="import">Import</Tabs.Tab>
						<Tabs.Tab value="export">Export</Tabs.Tab>
					</Tabs.List>
					<Box mt="xl">
						<Tabs.Panel value="export">
							<Stack>
								<Flex justify="space-between" align="center">
									<Title order={2}>Export data</Title>
									<Group>
										<Anchor
											size="xs"
											href="https://ignisda.github.io/ryot/guides/exporting.html"
											target="_blank"
										>
											Docs
										</Anchor>
									</Group>
								</Flex>
								<Button
									variant="light"
									color="indigo"
									radius="md"
									onClick={() => {
										generateAuthToken.mutate({});
									}}
									loading={generateAuthToken.isLoading}
								>
									Create auth token
								</Button>
								{generateAuthToken.data ? (
									<Box>
										<Alert
											title="This token will be shown only once"
											color="yellow"
										>
											<Flex align="center">
												<CopyButton value={generateAuthToken.data}>
													{({ copied, copy }) => (
														<Tooltip
															label={copied ? "Copied" : "Copy"}
															withArrow
															position="right"
														>
															<ActionIcon
																color={copied ? "teal" : "gray"}
																onClick={copy}
															>
																{copied ? (
																	<IconCheck size={16} />
																) : (
																	<IconCopy size={16} />
																)}
															</ActionIcon>
														</Tooltip>
													)}
												</CopyButton>
												<TextInput
													defaultValue={generateAuthToken.data}
													readOnly
												/>
											</Flex>
										</Alert>
									</Box>
								) : undefined}
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="import">
							<Box
								component="form"
								onSubmit={async (e) => {
									e.preventDefault();
									const yes = confirm(
										"Are you sure you want to deploy an import job? This action is irreversible.",
									);
									if (yes) {
										if (deployImportSource) {
											const values = await match(deployImportSource)
												.with(ImportSource.Goodreads, () => ({
													goodreads: goodreadsImportForm.values,
												}))
												.with(ImportSource.Trakt, () => ({
													trakt: traktImportForm.values,
												}))
												.with(ImportSource.MediaTracker, () => ({
													mediaTracker: mediaTrackerImportForm.values,
												}))
												.with(ImportSource.Movary, async () => ({
													movary: {
														ratings: await fileToText(
															movaryImportForm.values.ratings,
														),
														history: await fileToText(
															movaryImportForm.values.history,
														),
														watchlist: await fileToText(
															movaryImportForm.values.watchlist,
														),
													},
												}))
												.with(ImportSource.StoryGraph, async () => ({
													storyGraph: {
														export: await fileToText(
															storyGraphImportForm.values.export,
														),
													},
												}))
												.with(ImportSource.MediaJson, async () => ({
													mediaJson: {
														export: await fileToText(
															mediaJsonImportForm.values.export,
														),
													},
												}))
												.with(ImportSource.Mal, async () => ({
													mal: {
														animePath: malImportForm.values.mangaPath,
														mangaPath: malImportForm.values.mangaPath,
													},
												}))
												.with(ImportSource.StrongApp, async () => ({
													strongApp: {
														exportPath: strongAppImportForm.values.exportPath,
													},
												}))
												.exhaustive();
											if (values) {
												deployImportJob.mutate({
													input: {
														source: deployImportSource,
														...values,
													},
												});
											}
										}
									}
								}}
							>
								<Stack>
									<Flex justify="space-between" align="center">
										<Title order={2}>Import data</Title>
										<Group>
											<Anchor
												href={APP_ROUTES.settings.imports.reports}
												component={Link}
												size="xs"
											>
												Reports
											</Anchor>
											<Anchor
												size="xs"
												href="https://ignisda.github.io/ryot/importing.html"
												target="_blank"
											>
												Docs
											</Anchor>
										</Group>
									</Flex>
									{progress ? (
										<Progress
											value={progress}
											striped
											// TODO: Bring this back when mantine supports it
											// animate
											size="sm"
											color="orange"
										/>
									) : undefined}
									<Select
										label="Select a source"
										required
										data={Object.values(ImportSource).map((is) => ({
											label: changeCase(is),
											value: is,
										}))}
										onChange={(v) => {
											if (v) setDeployImportSource(v as ImportSource);
										}}
									/>
									{deployImportSource ? (
										<ImportSourceElement>
											{match(deployImportSource)
												.with(ImportSource.MediaTracker, () => (
													<>
														<TextInput
															label="Instance Url"
															required
															{...mediaTrackerImportForm.getInputProps(
																"apiUrl",
															)}
														/>
														<PasswordInput
															mt="sm"
															label="API Key"
															required
															{...mediaTrackerImportForm.getInputProps(
																"apiKey",
															)}
														/>
													</>
												))
												.with(ImportSource.Goodreads, () => (
													<>
														<TextInput
															label="RSS URL"
															required
															{...goodreadsImportForm.getInputProps("rssUrl")}
														/>
													</>
												))
												.with(ImportSource.Trakt, () => (
													<>
														<TextInput
															label="Username"
															required
															{...traktImportForm.getInputProps("username")}
														/>
													</>
												))
												.with(ImportSource.Movary, () => (
													<>
														<FileInput
															label="History CSV file"
															accept=".csv"
															required
															{...movaryImportForm.getInputProps("history")}
														/>
														<FileInput
															label="Ratings CSV file"
															accept=".csv"
															required
															{...movaryImportForm.getInputProps("ratings")}
														/>
														<FileInput
															label="Watchlist CSV file"
															accept=".csv"
															required
															{...movaryImportForm.getInputProps("watchlist")}
														/>
													</>
												))
												.with(ImportSource.StoryGraph, () => (
													<>
														<FileInput
															label="CSV export file"
															accept=".csv"
															required
															{...storyGraphImportForm.getInputProps("export")}
														/>
													</>
												))
												.with(ImportSource.MediaJson, () => (
													<>
														<FileInput
															label="JSON export file"
															accept=".json"
															required
															{...mediaJsonImportForm.getInputProps("export")}
														/>
													</>
												))
												.with(ImportSource.Mal, () => (
													<>
														<FileInput
															label="Anime export file"
															required
															onChange={async (file) => {
																if (file) {
																	const path = await uploadFile(file);
																	malImportForm.setFieldValue(
																		"animePath",
																		path,
																	);
																}
															}}
														/>
														<FileInput
															label="Manga export file"
															required
															onChange={async (file) => {
																if (file) {
																	const path = await uploadFile(file);
																	malImportForm.setFieldValue(
																		"mangaPath",
																		path,
																	);
																}
															}}
														/>
													</>
												))
												.with(ImportSource.StrongApp, () => (
													<>
														<FileInput
															label="CSV export file"
															accept=".csv"
															required
															onChange={async (file) => {
																if (file) {
																	const clonedFile = new File(
																		[file],
																		file.name,
																		{ type: file.type },
																	);
																	const text = await fileToText(clonedFile);
																	const csvText: { "Exercise Name": string }[] =
																		parse(text, {
																			columns: true,
																			skip_empty_lines: true,
																			delimiter: ";",
																		});
																	const exerciseNames = new Set(
																		csvText.map((s) =>
																			s["Exercise Name"].trim(),
																		),
																	);
																	for (const e of exerciseNames) {
																		const { exercisesList } =
																			await gqlClient.request(
																				ExercisesListDocument,
																				{
																					input: {
																						search: { page: 1, query: e },
																					},
																				},
																			);
																		console.log(e, exercisesList.items);
																	}
																	const path = await uploadFile(file);
																	strongAppImportForm.setFieldValue(
																		"exportPath",
																		path,
																	);
																}
															}}
														/>
													</>
												))
												.exhaustive()}
										</ImportSourceElement>
									) : undefined}
								</Stack>
							</Box>
						</Tabs.Panel>
					</Box>
				</Tabs>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
