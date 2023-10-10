import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { APP_ROUTES } from "@/lib/constants";
import { useEnabledCoreFeatures } from "@/lib/hooks/graphql";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { uploadFileAndGetKey } from "@/lib/utilities";
import {
	Anchor,
	Box,
	Button,
	Code,
	Container,
	FileInput,
	Group,
	JsonInput,
	NumberInput,
	ScrollArea,
	Select,
	Stack,
	Switch,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateCustomMediaDocument,
	type CreateCustomMediaMutationVariables,
	GetPresignedUrlDocument,
	MetadataLot,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { IconCalendar, IconPhoto, IconVideo } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { camelCase } from "lodash";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement } from "react";
import { withQuery } from "ufo";
import { z } from "zod";
import type { NextPageWithLayout } from "../../_app";

const optionalString = z.string().optional();

const formSchema = z.object({
	title: z.string(),
	lot: z.nativeEnum(MetadataLot),
	description: optionalString,
	isNsfw: z.boolean().optional(),
	publishYear: z.number().optional(),
	genres: optionalString,
	creators: optionalString,
	specifics: optionalString,
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const router = useRouter();

	const [images, setImages] = useListState<string>([]);
	const [videos, setVideos] = useListState<string>([]);
	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });

	const enabledFeatures = useEnabledCoreFeatures();
	const imageUrls = useQuery(
		["presignedUrl", images],
		async () => {
			const imageUrls = [];
			const videoUrls = [];
			const getUrl = async (key: string) => {
				const { getPresignedUrl } = await gqlClient.request(
					GetPresignedUrlDocument,
					{ key },
				);
				return getPresignedUrl;
			};
			for (const image of images) imageUrls.push(await getUrl(image));
			for (const video of videos) videoUrls.push(await getUrl(video));
			return { imageUrls, videoUrls };
		},
		{ staleTime: Infinity },
	);

	const createCustomMedia = useMutation({
		mutationFn: async (variables: CreateCustomMediaMutationVariables) => {
			const { createCustomMedia } = await gqlClient.request(
				CreateCustomMediaDocument,
				variables,
			);
			return createCustomMedia;
		},
		onSuccess: (data) => {
			if (data.__typename === "IdObject")
				router.push(
					withQuery(APP_ROUTES.media.individualMediaItem.details, {
						id: data.id,
					}),
				);
		},
	});

	const fileUploadNowAllowed = !enabledFeatures?.data?.fileStorage;

	const uploadFiles = async (files: File[], to: "image" | "video") => {
		if (files.length > 0) {
			let totalFiles = 0;
			for (const file of files) {
				const uploadedKey = await uploadFileAndGetKey(
					file.name,
					file.type,
					await file.arrayBuffer(),
				);
				if (to === "image") setImages.append(uploadedKey);
				else if (to === "video") setVideos.append(uploadedKey);
				totalFiles++;
			}
			notifications.show({
				title: "Success",
				message: `Uploaded ${totalFiles} files`,
			});
		}
	};

	return (
		<>
			<Head>
				<title>Create Media | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					images={imageUrls?.data?.imageUrls || []}
					externalLink={{ source: MetadataSource.Custom, lot: form.values.lot }}
				>
					<ScrollArea.Autosize mah={400}>
						<Box
							component="form"
							onSubmit={form.onSubmit((values) => {
								// biome-ignore lint/suspicious/noExplicitAny: required
								const input: any = {
									...values,
									images,
									videos,
									[`${camelCase(values.lot)}Specifics`]: JSON.parse(
										values.specifics || "{}",
									),
								};
								input.specifics = undefined;
								input.genres = input.genres?.split(", ");
								input.creators = input.creators?.split(", ");
								createCustomMedia.mutate({ input });
							})}
						>
							<Stack>
								<Title>Create Media</Title>
								<TextInput
									label="Title"
									{...form.getInputProps("title")}
									required
									autoFocus
								/>
								<Group>
									<Select
										label="Type"
										{...form.getInputProps("lot")}
										data={Object.values(MetadataLot)}
										required
									/>
									<Switch
										mt="md"
										label="Is it NSFW?"
										{...form.getInputProps("isNsfw")}
									/>
								</Group>
								<JsonInput
									label="Specifics"
									{...form.getInputProps("specifics")}
									formatOnBlur
									required
									description={
										<>
											Please search for <Code>Specfics</Code> inputs at the{" "}
											<Anchor
												href="/graphql"
												size="xs"
												target="_blank"
												rel="noopener noreferrer"
											>
												graphql endpoint
											</Anchor>{" "}
											for the required JSON structure
										</>
									}
								/>
								<Textarea
									label="Description"
									description="Markdown is supported"
									{...form.getInputProps("description")}
								/>
								<FileInput
									label="Images"
									multiple
									disabled={fileUploadNowAllowed}
									description={
										fileUploadNowAllowed &&
										"Please set the S3 variables required to enable file uploading"
									}
									onChange={(f) => uploadFiles(f, "image")}
									accept="image/png,image/jpeg,image/jpg"
									leftSection={<IconPhoto />}
								/>
								<FileInput
									label="Videos"
									multiple
									disabled={fileUploadNowAllowed}
									description={
										fileUploadNowAllowed &&
										"Please set the S3 variables required to enable file uploading"
									}
									onChange={(f) => uploadFiles(f, "video")}
									accept="video/mp4,video/x-m4v,video/*"
									leftSection={<IconVideo />}
								/>
								<NumberInput
									label="Publish year"
									{...form.getInputProps("publishYear")}
									leftSection={<IconCalendar />}
								/>
								<TextInput
									label="Creators"
									{...form.getInputProps("creators")}
									placeholder="Comma separated names"
								/>
								<TextInput
									label="Genres"
									{...form.getInputProps("genres")}
									placeholder="Comma separated values"
								/>
								<Button type="submit">Create</Button>
							</Stack>
						</Box>
					</ScrollArea.Autosize>
				</MediaDetailsLayout>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
