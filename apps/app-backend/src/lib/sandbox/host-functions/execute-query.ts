import { apiFailure, apiSuccess, type HostFunction } from "~/lib/sandbox/types";
import { viewDefinitionModule } from "~/lib/views/definition";
import { executeQueryEngineBody } from "~/modules/query-engine/schemas";

type ExecuteQueryContext = {
	userId: string;
};

export const createExecuteQueryHostFunction =
	(): HostFunction<ExecuteQueryContext> => {
		return async (context, request) => {
			if (typeof context.userId !== "string" || !context.userId.trim()) {
				return apiFailure(
					"executeQuery requires a non-empty userId in context",
				);
			}

			const parsed = executeQueryEngineBody.safeParse(request);
			if (!parsed.success) {
				const errors = parsed.error.issues.map((i) => i.message).join("; ");
				return apiFailure(`Invalid QueryEngineRequest: ${errors}`);
			}

			try {
				const result = await (
					await viewDefinitionModule.prepare({
						userId: context.userId,
						source: { kind: "runtime", request: parsed.data },
					})
				).execute();
				return apiSuccess(result);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				return apiFailure(message);
			}
		};
	};

export const executeQuery = createExecuteQueryHostFunction();
