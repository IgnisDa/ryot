import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";

import { textStyle } from "./styles";

type ITextProps = React.ComponentProps<"span"> &
	VariantProps<typeof textStyle> & {
		// React Native prop — ignored on web
		numberOfLines?: number;
	};

const Text = React.forwardRef<React.ComponentRef<"span">, ITextProps>(function Text(
	{
		sub,
		bold,
		italic,
		className,
		underline,
		highlight,
		isTruncated,
		size = "md",
		strikeThrough,
		numberOfLines: _numberOfLines,
		...props
	},
	ref,
) {
	return (
		<span
			className={textStyle({
				sub,
				size,
				bold,
				italic,
				underline,
				highlight,
				isTruncated,
				strikeThrough,
				class: className,
			})}
			{...props}
			ref={ref}
		/>
	);
});

Text.displayName = "Text";

export { Text };
