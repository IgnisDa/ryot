import type { NextPageWithLayout } from "../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import { ROUTES } from "@/lib/constants";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { BASE_URL, gqlClient } from "@/lib/services/api";
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
import { notifications } from "@mantine/notifications";
import {
	CoreEnabledFeaturesDocument,
	CreateCustomMediaDocument,
	type CreateCustomMediaMutationVariables,
	GetPresignedUrlDocument,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { IconCalendar, IconPhoto } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { camelCase } from "lodash";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import { z } from "zod";

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

	const [images, setImages] = useState<string[]>([]);
	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });

	const enabledFeatures = useQuery(
		["enabledFeatures"],
		async () => {
			const { coreEnabledFeatures } = await gqlClient.request(
				CoreEnabledFeaturesDocument,
			);
			return coreEnabledFeatures;
		},
		{ staleTime: Infinity },
	);

	const imageUrls = useQuery(["presignedUrl", images], async () => {
		const urls = [];
		for (const image of images) {
			const { getPresignedUrl } = await gqlClient.request(
				GetPresignedUrlDocument,
				{ key: image },
			);
			urls.push(getPresignedUrl);
		}
		return urls || [];
	});

	const createCustomMedia = useMutation({
		mutationFn: async (variables: CreateCustomMediaMutationVariables) => {
			const { createCustomMedia } = await gqlClient.request(
				CreateCustomMediaDocument,
				variables,
			);
			return createCustomMedia;
		},
		onSuccess: (data) => {
			if (data.__typename === "IdObject") {
				router.push(`${ROUTES.media.details}?item=${data.id}`);
			}
		},
	});

	const fileUploadNowAllowed = !enabledFeatures.data?.general.find(
		(f) => f.name === "FILE_STORAGE",
	)?.enabled;

	return (
		<>
			<Head>
				<title>Create media item | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					posterImages={imageUrls?.data || []}
					backdropImages={[]}
					externalLink={{ source: "custom" }}
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
											const data = new FormData();
											for (const file of files) {
												data.append("files[]", file, file.name);
											}
											const fetchResp = await fetch(`${BASE_URL}/upload`, {
												method: "POST",
												body: data,
											});
											const json = await fetchResp.json();
											notifications.show({
												title: "Success",
												message: `Uploaded ${files.length} files`,
											});
											setImages(json);
										}
									}}
									accept="image/png,image/jpeg,image/jpg"
									icon={<IconPhoto />}
									w="350px"
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
