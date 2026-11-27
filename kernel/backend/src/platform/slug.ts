import { sql, type SQLWrapper } from "drizzle-orm";

export const slugify = (value: string) =>
	value
		.replaceAll("_", "-")
		.trim()
		.toLowerCase()
		.replaceAll(/\s+/g, "-")
		.replaceAll(/[^a-z0-9-]/g, "")
		.replaceAll(/-+/g, "-")
		.replaceAll(/^-+|-+$/g, "");

export const slugSql = (value: SQLWrapper) =>
	sql`btrim(regexp_replace(regexp_replace(regexp_replace(lower(replace(${value}, '_', '-')), '\\s+', '-', 'g'), '[^a-z0-9-]', '', 'g'), '-+', '-', 'g'), '-')`;
