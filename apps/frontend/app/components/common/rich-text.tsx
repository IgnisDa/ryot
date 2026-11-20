import type { ComponentProps } from "react";
import { sanitizeRichText } from "~/lib/shared/sanitize-rich-text";

type RichTextProps = Omit<
	ComponentProps<"div">,
	"children" | "dangerouslySetInnerHTML"
> & { html: string };

export const RichText = (props: RichTextProps) => {
	const { html, ...divProps } = props;
	return (
		<div
			{...divProps}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized at the render boundary
			dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
		/>
	);
};
