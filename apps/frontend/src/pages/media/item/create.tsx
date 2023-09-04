import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { APP_ROUTES } from "@/lib/constants";
import { useEnabledCoreFeatures } from "@/lib/hooks/graphql";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	Box,
	Button,
	Container,
	FileInput,
	JsonInput,
	NumberInput,
	ScrollArea,
	Select,
	Stack,
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
	PresignedPutUrlDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { IconCalendar, IconPhoto } from "@tabler/icons-react";
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
	publishYear: z.number().optional(),
	genres: optionalString,
	creators: optionalString,
	specifics: optionalString,
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const router = useRouter();

	const [images, setImages] = useListState<string>([]);
	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });

	const enabledFeatures = useEnabledCoreFeatures();
	const imageUrls = useQuery(
		["presignedUrl", images],
		async () => {
			const urls = [];
			for (const image of images) {
				const { getPresignedUrl } = await gqlClient.request(
					GetPresignedUrlDocument,
					{ key: image },
				);
				urls.push(getPresignedUrl);
			}
			return urls || [];
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

	return (
		<>
			<Head>
				<title>Create media item | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					posterImages={imageUrls?.data || []}
					backdropImages={[]}
					externalLink={{ source: MetadataSource.Custom, lot: form.values.lot }}
				>
					<ScrollArea.Autosize mah={400}>
						<Box
							component="form"
							onSubmit={form.onSubmit((values) => {
								const input: any = {
									...values,
									images,
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
								<Select
									label="Type"
									{...form.getInputProps("lot")}
									data={Object.values(MetadataLot)}
									required
								/>
								<Textarea
									label="Description"
									description={"Markdown is supported"}
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
									onChange={async (files) => {
										if (files.length > 0) {
											let totalFiles = 0;
											for (const file of files) {
												const uploadUrl = await gqlClient.request(
													PresignedPutUrlDocument,
													{ fileName: file.name },
												);
												await fetch(uploadUrl.presignedPutUrl.uploadUrl, {
													method: "PUT",
													body: file,
													headers: { "Content-Type": file.type },
												});
												setImages.append(uploadUrl.presignedPutUrl.key);
												totalFiles++;
											}
											notifications.show({
												title: "Success",
												message: `Uploaded ${totalFiles} files`,
											});
										}
									}}
									accept="image/png,image/jpeg,image/jpg"
									icon={<IconPhoto />}
								/>
								<NumberInput
									label="Publish year"
									{...form.getInputProps("publishYear")}
									icon={<IconCalendar />}
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
								<Box>
									<JsonInput
										label="Specifics (JSON)"
										{...form.getInputProps("specifics")}
										formatOnBlur
										required
										error={
											createCustomMedia.isError &&
											"JSON data does not conform to the expected schema. Please look at the `*Specfics` inputs at the `/graphql` endpoint."
										}
									/>
								</Box>
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
