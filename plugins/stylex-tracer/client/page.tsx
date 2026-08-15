/* oxlint-disable perfectionist/sort-objects -- Keep the document scaffold grouped by visual role. */
import {
	usePluginScreenSurface,
	usePluginTitle,
	useRyotViewport,
} from "@ryot-app/client-sdk/plugin";
import { useRyotTheme } from "@ryot-app/client-sdk/react";
import { StyleXTracerPanel } from "@ryot-app/client-ui-sdk/stylex-tracer";
import { tracerTheme, tracerTokens } from "@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import { pluginTracerTokens } from "./tokens.stylex";
import tracerMark from "./tracer-mark.svg";

export const StyleXTracerPage = () => {
	const theme = useRyotTheme();
	const viewport = useRyotViewport();
	const { floatingRoot } = usePluginScreenSurface();
	usePluginTitle("StyleX tracer");

	return (
		<div
			data-stylex-document="tracer"
			{...stylex.props(tracerTheme(theme.resolvedMode), styles.document)}
		>
			<header {...stylex.props(styles.intro)}>
				<img alt="" width={44} height={44} src={tracerMark} {...stylex.props(styles.mark)} />
				<div>
					<div {...stylex.props(styles.badge)}>Archive-local token</div>
					<p {...stylex.props(styles.copy)}>
						This document uses explicit StyleX foreground, background, typography, and box sizing.
					</p>
				</div>
			</header>
			<StyleXTracerPanel
				portalRoot={floatingRoot}
				compact={viewport.compact}
				resolvedTheme={theme.resolvedMode}
				safeAreaTop={viewport.safeAreaTop}
				safeAreaBottom={viewport.safeAreaBottom}
			/>
		</div>
	);
};

const styles = stylex.create({
	mark: { display: "block", flexShrink: 0 } satisfies stylex.CSSProperties,
	intro: {
		alignItems: "center",
		display: "flex",
		gap: tracerTokens.space3,
		marginBlockEnd: tracerTokens.space4,
		marginInline: "auto",
		maxWidth: "820px",
	} satisfies stylex.CSSProperties,
	copy: {
		color: tracerTokens.foreground,
		fontFamily: tracerTokens.fontBody,
		fontSize: "15px",
		lineHeight: 1.45,
		marginBlockEnd: 0,
		marginBlockStart: tracerTokens.space2,
	} satisfies stylex.CSSProperties,
	document: {
		backgroundColor: tracerTokens.background,
		boxSizing: "border-box",
		color: tracerTokens.foreground,
		fontFamily: tracerTokens.fontBody,
		minHeight: "100%",
		padding: tracerTokens.space4,
		width: "100%",
	} satisfies stylex.CSSProperties,
	badge: {
		backgroundColor: pluginTracerTokens.badgeBackground,
		borderRadius: "999px",
		color: pluginTracerTokens.badgeForeground,
		display: "inline-block",
		fontFamily: tracerTokens.fontBody,
		fontSize: "12px",
		fontWeight: 700,
		paddingBlock: tracerTokens.space1,
		paddingInline: tracerTokens.space3,
	} satisfies stylex.CSSProperties,
});

export default StyleXTracerPage;
