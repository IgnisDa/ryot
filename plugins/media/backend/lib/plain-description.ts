import { escapeMarkdownText } from "@ryot-app/plugin-backend-sdk/markdown-text";

export const normalizePlainDescription = (input: unknown): null | string =>
	typeof input === "string" && input.trim() ? escapeMarkdownText(input.trim()) : null;
