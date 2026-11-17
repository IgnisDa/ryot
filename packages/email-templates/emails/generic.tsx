import { Text } from "react-email";

import Layout, { type LayoutProps } from "../layout";

/** Every text prop is already rendered in the recipient's locale, whose tag and direction are `lang` and `dir`. */
type GenericEmailProps = Pick<LayoutProps, "dir" | "lang"> & {
	heading: string;
	message: string;
	preview: string;
};

/** Renders each line break of plain text as `<br>`, which HTML would otherwise collapse. */
const Lines = ({ lines: [first, ...rest] }: { lines: readonly string[] }) => (
	<>
		{first}
		{rest.length > 0 ? (
			<>
				<br />
				<Lines lines={rest} />
			</>
		) : null}
	</>
);

const GenericEmail = (
	props: GenericEmailProps = { lang: "en", dir: "ltr", heading: "", message: "", preview: "" },
) => (
	<Layout dir={props.dir} lang={props.lang} headingText={props.heading} previewText={props.preview}>
		<Text>
			<Lines lines={props.message.split("\n")} />
		</Text>
	</Layout>
);

export default GenericEmail;
