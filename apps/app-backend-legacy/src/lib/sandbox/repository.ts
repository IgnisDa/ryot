import { eq } from "drizzle-orm";

import { db } from "~/lib/db";
import { sandboxScript } from "~/lib/db/schema";

export const getSandboxScriptById = async (scriptId: string) => {
	const [found] = await db
		.select({
			code: sandboxScript.code,
			metadata: sandboxScript.metadata,
		})
		.from(sandboxScript)
		.where(eq(sandboxScript.id, scriptId))
		.limit(1);

	return found ?? null;
};
