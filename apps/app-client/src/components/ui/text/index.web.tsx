import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";

import { textStyle } from "./styles";

type ITextProps = React.ComponentProps<"span"> &
	VariantProps<typeof textStyle> & {
		numberOfLines?: number;
	};

const Text = React.forwardRef<React.ComponentRef<"span">, ITextProps>(function Text(
	{
		sub,
		bold,
		style,
		italic,
		className,
		underline,
		highlight,
		isTruncated,
		size = "md",
		strikeThrough,
		numberOfLines,
		...props
	},
	ref,
) {
	const clampStyle: React.CSSProperties | undefined =
		numberOfLines !== undefined && numberOfLines > 0
			? {
					overflow: "hidden",
					display: "-webkit-box",
					WebkitBoxOrient: "vertical",
					WebkitLineClamp: numberOfLines,
				}
			: undefined;

	return (
		<span
			{...props}
			ref={ref}
			style={clampStyle ? { ...style, ...clampStyle } : style}
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
		/>
	);
});

Text.displayName = "Text";

export { Text };
