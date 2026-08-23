import {
	useFocusTrap,
	useInertBackground,
	useRestoreFocus,
	useScrollLock,
} from "@ryot-app/client-ui-sdk/overlay";
import { OverlayScope } from "@ryot-app/client-ui-sdk/shortcut";
/* oxlint-disable perfectionist/sort-jsx-props, perfectionist/sort-objects -- Keep StyleX declarations and ARIA groups readable. */
import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { StyleXTracerButton, StyleXTracerTextField } from "./controls";
import { tracerTheme, tracerTokens } from "./tokens.stylex";

export type StyleXTracerPanelProps = {
	readonly compact: boolean;
	readonly portalRoot: HTMLElement | null;
	readonly resolvedTheme: "light" | "dark";
	readonly safeAreaBottom: number;
	readonly safeAreaTop: number;
};

const permittedAdvanceOverride = stylex.create({
	colors: { color: "#fff7fb", backgroundColor: "#8f3f71" } satisfies stylex.CSSProperties,
});

export function StyleXTracerPanel(props: StyleXTracerPanelProps) {
	const [name, setName] = useState("Ryot");
	const [progress, setProgress] = useState(35);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const detailsButtonRef = useRef<HTMLButtonElement>(null);
	const detailsId = useId();
	const invalid = name.trim().length === 0;
	const selectedTheme = tracerTheme(props.resolvedTheme);

	useEffect(() => {
		if (props.portalRoot === null) {
			return undefined;
		}
		const themeProps = stylex.props(selectedTheme);
		const classes = themeProps.className?.split(" ").filter(Boolean) ?? [];
		props.portalRoot.classList.add(...classes);
		props.portalRoot.dataset.stylexTracerTheme = props.resolvedTheme;
		return () => {
			props.portalRoot?.classList.remove(...classes);
			if (props.portalRoot?.dataset.stylexTracerTheme === props.resolvedTheme) {
				delete props.portalRoot.dataset.stylexTracerTheme;
			}
		};
	}, [props.portalRoot, props.resolvedTheme, selectedTheme]);

	return (
		<section
			data-testid="stylex-tracer-panel"
			data-layout={props.compact ? "compact" : "wide"}
			{...stylex.props(
				selectedTheme,
				panelStyles.panel,
				panelStyles.safeArea(props.safeAreaTop, props.safeAreaBottom),
			)}
		>
			<header {...stylex.props(panelStyles.header)}>
				<div {...stylex.props(panelStyles.eyebrow)}>Shared UI SDK experiment</div>
				<h2 {...stylex.props(panelStyles.heading)}>StyleX tracer</h2>
				<p role="status" {...stylex.props(panelStyles.readout)}>
					Resolved theme: <strong>{props.resolvedTheme}</strong> · Layout:{" "}
					<strong>{props.compact ? "compact" : "wide"}</strong>
				</p>
			</header>

			<div {...stylex.props(panelStyles.body, !props.compact && panelStyles.bodyWide)}>
				<StyleXTracerTextField
					label="Name"
					value={name}
					placeholder="Enter a name"
					{...(invalid ? { error: "Name is required." } : {})}
					onChange={(event) => setName(event.currentTarget.value)}
				/>

				<div {...stylex.props(panelStyles.progressGroup)}>
					<div {...stylex.props(panelStyles.progressLabel)}>
						<span>Progress</span>
						<strong>{progress}%</strong>
					</div>
					<div
						aria-valuemin={0}
						role="progressbar"
						aria-valuemax={100}
						aria-valuenow={progress}
						aria-label="Tracer progress"
						{...stylex.props(panelStyles.progressTrack)}
					>
						<div
							{...stylex.props(
								panelStyles.progressFillBase,
								panelStyles.progressFillReducedMotion,
								panelStyles.progressFill(`${progress}%`),
							)}
						/>
					</div>
				</div>
			</div>

			<div {...stylex.props(panelStyles.actions, props.compact && panelStyles.actionsCompact)}>
				<StyleXTracerButton
					disabled={invalid || progress === 100}
					xstyle={permittedAdvanceOverride.colors}
					onClick={() => setProgress((current) => Math.min(100, current + 7))}
				>
					Advance progress
				</StyleXTracerButton>
				<StyleXTracerButton
					tone="secondary"
					onClick={() => {
						setName("Ryot");
						setProgress(35);
					}}
				>
					Reset
				</StyleXTracerButton>
				<StyleXTracerButton
					tone="secondary"
					ref={detailsButtonRef}
					aria-controls={detailsId}
					aria-expanded={detailsOpen}
					onClick={() => setDetailsOpen(true)}
				>
					Details
				</StyleXTracerButton>
			</div>

			{detailsOpen &&
				props.portalRoot !== null &&
				createPortal(
					<StyleXTracerDetails
						id={detailsId}
						name={invalid ? "No name" : name}
						progress={progress}
						theme={selectedTheme}
						triggerRef={detailsButtonRef}
						onClose={() => setDetailsOpen(false)}
					/>,
					props.portalRoot,
				)}
		</section>
	);
}

function StyleXTracerDetails(props: {
	readonly id: string;
	readonly name: string;
	readonly onClose: () => void;
	readonly progress: number;
	readonly theme: ReturnType<typeof tracerTheme>;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const surfaceRef = useRef<HTMLDivElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	useFocusTrap(surfaceRef, { enabled: true });
	useInertBackground(surfaceRef);
	useRestoreFocus(props.triggerRef);
	useScrollLock(true);

	useEffect(() => closeButtonRef.current?.focus(), []);

	return (
		<OverlayScope
			onEscape={props.onClose}
			onBack={() => {
				props.onClose();
				return true;
			}}
		>
			<div
				role="dialog"
				tabIndex={-1}
				id={props.id}
				ref={surfaceRef}
				aria-modal="true"
				aria-label="Tracer details"
				data-testid="stylex-tracer-details"
				{...stylex.props(props.theme, panelStyles.portalSurface)}
			>
				<div>
					<h3 {...stylex.props(panelStyles.portalHeading)}>Current details</h3>
					<p {...stylex.props(panelStyles.portalText)}>Name: {props.name}</p>
					<p {...stylex.props(panelStyles.portalText)}>Progress: {props.progress}%</p>
				</div>
				<StyleXTracerButton ref={closeButtonRef} tone="secondary" onClick={props.onClose}>
					Close details
				</StyleXTracerButton>
			</div>
		</OverlayScope>
	);
}

const panelStyles = stylex.create({
	body: { display: "grid", gap: tracerTokens.space6 } satisfies stylex.CSSProperties,
	actionsCompact: { alignItems: "stretch", flexDirection: "column" } satisfies stylex.CSSProperties,
	actions: {
		display: "flex",
		flexWrap: "wrap",
		gap: tracerTokens.space3,
	} satisfies stylex.CSSProperties,
	bodyWide: {
		gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.8fr)",
	} satisfies stylex.CSSProperties,
	header: {
		display: "flex",
		flexDirection: "column",
		gap: tracerTokens.space2,
	} satisfies stylex.CSSProperties,
	readout: {
		color: tracerTokens.foregroundMuted,
		fontSize: "14px",
		marginBlock: 0,
	} satisfies stylex.CSSProperties,
	portalText: {
		color: tracerTokens.foregroundMuted,
		marginBlock: tracerTokens.space1,
	} satisfies stylex.CSSProperties,
	progressLabel: {
		display: "flex",
		justifyContent: "space-between",
		fontSize: "14px",
	} satisfies stylex.CSSProperties,
	progressTrack: {
		backgroundColor: tracerTokens.background,
		borderRadius: "999px",
		height: "12px",
		overflow: "hidden",
	} satisfies stylex.CSSProperties,
	portalHeading: {
		color: tracerTokens.foreground,
		fontFamily: tracerTokens.fontDisplay,
		fontSize: "20px",
		marginBlock: 0,
	} satisfies stylex.CSSProperties,
	progressGroup: {
		alignSelf: "center",
		display: "flex",
		flexDirection: "column",
		gap: tracerTokens.space2,
		width: "100%",
	} satisfies stylex.CSSProperties,
	eyebrow: {
		color: tracerTokens.accent,
		fontSize: "12px",
		fontWeight: 750,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	} satisfies stylex.CSSProperties,
	heading: {
		color: tracerTokens.foreground,
		fontFamily: tracerTokens.fontDisplay,
		fontSize: "clamp(25px, 5vw, 34px)",
		fontWeight: 650,
		lineHeight: 1.08,
		marginBlock: 0,
	} satisfies stylex.CSSProperties,
	safeArea: (safeAreaTop: number, safeAreaBottom: number): stylex.CSSProperties => ({
		paddingBlockEnd: safeAreaBottom + 24,
		paddingBlockStart: safeAreaTop + 24,
		paddingInline: tracerTokens.space6,
	}),
	progressFill: (width: string): stylex.CSSProperties => ({ width }),
	progressFillBase: {
		backgroundColor: tracerTokens.accent,
		borderRadius: "999px",
		height: "100%",
		transitionDuration: "180ms",
		transitionProperty: "width",
		transitionTimingFunction: "ease-out",
	} satisfies stylex.CSSProperties,
	progressFillReducedMotion: {
		"@media (prefers-reduced-motion: reduce)": {
			transitionDuration: "0ms",
		} satisfies stylex.CSSProperties,
	},
	portalSurface: {
		backgroundColor: tracerTokens.surfaceRaised,
		borderColor: tracerTokens.border,
		borderRadius: tracerTokens.radiusPanel,
		borderStyle: "solid",
		borderWidth: "1px",
		boxShadow: "0 20px 55px rgba(0, 0, 0, 0.24)",
		boxSizing: "border-box",
		color: tracerTokens.foreground,
		display: "flex",
		fontFamily: tracerTokens.fontBody,
		gap: tracerTokens.space6,
		insetBlockStart: tracerTokens.space6,
		insetInlineEnd: tracerTokens.space6,
		justifyContent: "space-between",
		maxWidth: "calc(100% - 48px)",
		padding: tracerTokens.space4,
		position: "fixed",
		zIndex: 1000,
	} satisfies stylex.CSSProperties,
	panel: {
		backgroundColor: tracerTokens.surface,
		borderColor: tracerTokens.border,
		borderRadius: tracerTokens.radiusPanel,
		borderStyle: "solid",
		borderWidth: "1px",
		boxShadow: "0 18px 45px rgba(20, 18, 14, 0.12)",
		boxSizing: "border-box",
		color: tracerTokens.foreground,
		display: "flex",
		flexDirection: "column",
		fontFamily: tracerTokens.fontBody,
		gap: tracerTokens.space6,
		marginInline: "auto",
		maxWidth: "820px",
		width: "100%",
	} satisfies stylex.CSSProperties,
});
