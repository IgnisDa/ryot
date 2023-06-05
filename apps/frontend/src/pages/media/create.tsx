import type { NextPageWithLayout } from "../_app";
import MediaDetailsLayout from "@/lib/components/MediaDetailsLayout";
import LoggedIn from "@/lib/layouts/LoggedIn";
import {
	Box,
	Container,
	FileInput,
	JsonInput,
	ScrollArea,
	Select,
	Stack,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { YearPickerInput } from "@mantine/dates";
import { useForm, zodResolver } from "@mantine/form";
import { MetadataLot } from "@ryot/generated/graphql/backend/graphql";
import { IconPhoto } from "@tabler/icons-react";
import Head from "next/head";
import type { ReactElement } from "react";
import { z } from "zod";

const commaSeparatedString = z
	.string()
	.transform((v) => v.split(",").filter(Boolean));

const formSchema = z.object({
	title: z.string(),
	lot: z.nativeEnum(MetadataLot),
	description: z.string().optional(),
	files: z.any().array(),
	publishYear: z.number().optional(),
	genres: commaSeparatedString,
	creators: commaSeparatedString,
	specifics: z.string(),
});
type FormSchema = z.infer<typeof formSchema>;

const Page: NextPageWithLayout = () => {
	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });

	return (
		<>
			<Head>
				<title>Create media item | Ryot</title>
			</Head>
			<Container>
				<MediaDetailsLayout
					backdropImages={[]}
					posterImages={[]}
					externalLink={{ source: "custom" }}
				>
					<ScrollArea.Autosize mah={400}>
						<Box
							component="form"
							onSubmit={form.onSubmit((values) => {
								console.log(values);
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
									{...form.getInputProps("files")}
									multiple
									accept="image/png,image/jpeg,image/jpg"
									icon={<IconPhoto />}
									w="350px"
								/>
								<YearPickerInput
									label="Publish year"
									{...form.getInputProps("publishYear")}
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
								<JsonInput
									label="Specifics (JSON)"
									{...form.getInputProps("specifics")}
									formatOnBlur
								/>
							</Stack>
						</Box>
					</ScrollArea.Autosize>
					<></>
				</MediaDetailsLayout>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
