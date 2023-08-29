import type { NextPageWithLayout } from "../../_app";
import { APP_ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { BASE_URL, gqlClient } from "@/lib/services/api";
import { fileToText } from "@/lib/utilities";
import {
	Anchor,
	Box,
	Button,
	Container,
	FileInput,
	Flex,
	Group,
	PasswordInput,
	Select,
	Stack,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	DeployImportJobDocument,
	type DeployImportJobMutationVariables,
	ImportLot,
	ImportSource,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";

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

	const uploadFileToServiceAndGetPath = async (file: File) => {
		const formData = new FormData();
		formData.append(`files[]`, file, file.name);
		const resp = await fetch(`${BASE_URL}/upload`, {
			method: "POST",
			body: formData,
		});
		const data: string[] = await resp.json();
		return data[0];
	};

	return (
		<>
			<Head>
				<title>Perform a new import | Ryot</title>
			</Head>
			<Container size={"xs"}>
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
									.exhaustive();
								if (values) {
									deployImportJob.mutate({
										input: {
											lot: ImportLot.Media,
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
						<Flex justify={"space-between"} align={"center"}>
							<Title>Import data</Title>
							<Group>
								<Link
									passHref
									legacyBehavior
									href={APP_ROUTES.settings.imports.reports}
								>
									<Anchor size="xs">Reports</Anchor>
								</Link>
								<Anchor
									size="xs"
									href="https://ignisda.github.io/ryot/importing.html"
									target="_blank"
								>
									Docs
								</Anchor>
							</Group>
						</Flex>
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
												{...mediaTrackerImportForm.getInputProps("apiUrl")}
											/>
											<PasswordInput
												mt="sm"
												label="API Key"
												required
												{...mediaTrackerImportForm.getInputProps("apiKey")}
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
														const path = await uploadFileToServiceAndGetPath(
															file,
														);
														malImportForm.setFieldValue("animePath", path);
													}
												}}
											/>
											<FileInput
												label="Manga export file"
												required
												onChange={async (file) => {
													if (file) {
														const path = await uploadFileToServiceAndGetPath(
															file,
														);
														malImportForm.setFieldValue("mangaPath", path);
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
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
