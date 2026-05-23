import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";

import { textStyle } from "./styles";

type ITextProps = React.ComponentProps<"span"> &
	VariantProps<typeof textStyle> & {
		selectable?: boolean;
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
		selectable,
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

	const selectableStyle: React.CSSProperties | undefined =
		selectable === false
			? { userSelect: "none" }
			: selectable === true
				? { userSelect: "text" }
				: undefined;

	const mergedStyle = {
		...style,
		...clampStyle,
		...selectableStyle,
	};

	return (
		<span
			{...props}
			ref={ref}
			style={Object.keys(mergedStyle).length > 0 ? mergedStyle : undefined}
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
