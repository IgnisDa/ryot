import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import { sandboxScript } from "~/lib/db/schema/tables";

export type SandboxScriptAccessRow = {
	code: string;
	isBuiltin: boolean;
	userId: string | null;
};

const sandboxScriptAccessSelection = {
	code: sandboxScript.code,
	userId: sandboxScript.userId,
	isBuiltin: sandboxScript.isBuiltin,
};

export const getSandboxScriptForUser = async (input: {
	scriptId: string;
	userId: string;
}) => {
	const [foundSandboxScript] = await db
		.select(sandboxScriptAccessSelection)
		.from(sandboxScript)
		.where(
			and(
				eq(sandboxScript.id, input.scriptId),
				or(
					eq(sandboxScript.isBuiltin, true),
					eq(sandboxScript.userId, input.userId),
				),
			),
		)
		.limit(1);

	return foundSandboxScript;
};

export const getBuiltinSandboxScriptBySlug = async (slug: string) => {
	const [foundScript] = await db
		.select({ id: sandboxScript.id, code: sandboxScript.code })
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
