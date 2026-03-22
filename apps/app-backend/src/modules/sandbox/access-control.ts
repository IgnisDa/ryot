import type { InferSelectModel } from "drizzle-orm";
import type { sandboxScript } from "~/lib/db/schema/tables";

export type SandboxScriptAccessRow = Pick<
	InferSelectModel<typeof sandboxScript>,
	"userId" | "isBuiltin"
>;

export const canUserRunScript = (input: {
	userId: string;
	script: SandboxScriptAccessRow | null;
}): boolean => {
	if (!input.script) {
		return false;
	}
	if (input.script.isBuiltin) {
		return true;
	}
	return input.script.userId === input.userId;
};
