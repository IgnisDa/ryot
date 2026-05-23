import { and, eq, isNull, or } from "drizzle-orm";

import { assertPersisted, db } from "~/lib/db";
import { sandboxScript } from "~/lib/db/schema/tables";
import type { SandboxScriptMetadata } from "~/lib/sandbox/types";

const sandboxScriptCreationSelection = {
	id: sandboxScript.id,
	name: sandboxScript.name,
	slug: sandboxScript.slug,
	code: sandboxScript.code,
	metadata: sandboxScript.metadata,
};

export type SandboxScriptAccessRow = {
	isBuiltin: boolean;
	userId: string | null;
};

const sandboxScriptAccessSelection = {
	userId: sandboxScript.userId,
	isBuiltin: sandboxScript.isBuiltin,
};

export const getSandboxScriptForUser = async (input: { scriptId: string; userId: string }) => {
	const [foundSandboxScript] = await db
		.select(sandboxScriptAccessSelection)
		.from(sandboxScript)
		.where(
			and(
				eq(sandboxScript.id, input.scriptId),
				or(eq(sandboxScript.isBuiltin, true), eq(sandboxScript.userId, input.userId)),
			),
		)
		.limit(1);

	return foundSandboxScript;
};

export const createSandboxScriptForUser = async (input: {
	name: string;
	slug: string;
	code: string;
	userId: string;
	metadata: SandboxScriptMetadata;
}) => {
	const [createdScript] = await db
		.insert(sandboxScript)
		.values({
			name: input.name,
			slug: input.slug,
			code: input.code,
			isBuiltin: false,
			userId: input.userId,
			metadata: input.metadata,
		})
		.returning(sandboxScriptCreationSelection);

	const persistedScript = assertPersisted(createdScript, "sandbox script");

	return { ...persistedScript, metadata: input.metadata };
};

export const getSandboxScriptBySlugForUser = async (input: { slug: string; userId: string }) => {
	const [found] = await db
		.select({ id: sandboxScript.id })
		.from(sandboxScript)
		.where(and(eq(sandboxScript.slug, input.slug), eq(sandboxScript.userId, input.userId)))
		.limit(1);
	return found;
};

export const getBuiltinSandboxScriptBySlug = async (slug: string) => {
	const [foundScript] = await db
		.select({ id: sandboxScript.id })
		.from(sandboxScript)
		.where(
			and(
				eq(sandboxScript.slug, slug),
				isNull(sandboxScript.userId),
				eq(sandboxScript.isBuiltin, true),
			),
		)
		.limit(1);

	return foundScript;
};
