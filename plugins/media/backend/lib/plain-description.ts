import { escapeMarkdownText } from "@ryot-app/plugin-backend-sdk/markdown-text";

export const normalizePlainDescription = (input: unknown): string | null =>
	typeof input === "string" && input.trim() ? escapeMarkdownText(input.trim()) : null;
