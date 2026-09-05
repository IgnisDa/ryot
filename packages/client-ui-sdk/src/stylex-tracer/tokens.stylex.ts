/* oxlint-disable perfectionist/sort-objects -- Token groups match their visual roles. */
import * as stylex from "@stylexjs/stylex";

export const tracerTokens = stylex.defineVars({
	space1: "4px",
	space2: "8px",
	space3: "12px",
	space4: "16px",
	space6: "24px",
	error: "#b42318",
	focus: "#2563eb",
	accent: "#d97706",
	border: "#d6d0c4",
	surface: "#fffdf8",
	radiusPanel: "18px",
	accentInk: "#fffaf0",
	background: "#f5f2eb",
	foreground: "#25221d",
	radiusControl: "10px",
	accentHover: "#b45309",
	surfaceRaised: "#ffffff",
	foregroundMuted: "#6b655b",
	fontDisplay: '"Lora Variable", Georgia, serif',
	fontBody: '"Outfit Variable", "Avenir Next", sans-serif',
});

export const lightTracerTheme = stylex.createTheme(tracerTokens, {
	error: "#b42318",
	focus: "#2563eb",
	accent: "#d97706",
	border: "#d6d0c4",
	surface: "#fffdf8",
	accentInk: "#fffaf0",
	background: "#f5f2eb",
	foreground: "#25221d",
	accentHover: "#b45309",
	surfaceRaised: "#ffffff",
	foregroundMuted: "#6b655b",
});

export const darkTracerTheme = stylex.createTheme(tracerTokens, {
	error: "#ff8a80",
	focus: "#7db4ff",
	accent: "#f59e0b",
	border: "#45413b",
	surface: "#211f1b",
	accentInk: "#241604",
	background: "#151513",
	foreground: "#f5f1e8",
	accentHover: "#fbbf24",
	surfaceRaised: "#2a2722",
	foregroundMuted: "#b8b0a4",
});

export const tracerTheme = (resolvedTheme: "light" | "dark") =>
	resolvedTheme === "dark" ? darkTracerTheme : lightTracerTheme;
