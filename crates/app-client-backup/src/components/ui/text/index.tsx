import type { VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { Text as RNText } from "react-native";

import { textStyle } from "./styles";

type ITextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textStyle>;

const Text = React.forwardRef<React.ComponentRef<typeof RNText>, ITextProps>(
	function Text(props, ref) {
		const {
			className,
			isTruncated,
			bold,
			underline,
			strikeThrough,
			size = "md",
			sub,
			italic,
			highlight,
			...rest
		} = props;
		return (
			<RNText
				className={textStyle({
					isTruncated: isTruncated ?? false,
					bold: bold ?? false,
					underline: underline ?? false,
					strikeThrough: strikeThrough ?? false,
					size,
					sub: sub ?? false,
					italic: italic ?? false,
					highlight: highlight ?? false,
					class: className,
				})}
				{...rest}
				ref={ref}
			/>
		);
	},
);

Text.displayName = "Text";

export { Text };
