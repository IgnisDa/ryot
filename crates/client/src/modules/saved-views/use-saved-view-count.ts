import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { savedViewCountRecipe } from "@ryot-app/ryotql-recipes/saved-views";
import { Effect, Result } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { appClient } from "@/api/client";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";

import type { SavedViewCountState } from "./result-count";

const invalidCountDocumentError = new Error("Unable to build saved-view count document");

type SavedViewCountKey = string | null;

type SavedViewCountRuntimeState = {
	readonly key: SavedViewCountKey;
	readonly state: SavedViewCountState;
};

const countDocumentKey = (countDocument: RyotQLDocument | null): SavedViewCountKey =>
	countDocument === null ? null : JSON.stringify(countDocument);

export function useSavedViewCount(queryDocument: RyotQLDocument) {
	const scope = useApiScope();
	const countRecipe = savedViewCountRecipe(queryDocument);
	const key = countDocumentKey(Result.isFailure(countRecipe) ? null : countRecipe.success.document);
	const [runtime, setRuntime] = useState<SavedViewCountRuntimeState>(() => ({
		key,
		state: { status: "idle" },
	}));
	const mounted = useRef<boolean>(true);
	const currentKey = useRef(key);
	const activeRequest = useRef<{ readonly key: string } | undefined>(undefined);
	if (currentKey.current !== key) {
		currentKey.current = key;
		activeRequest.current = undefined;
	}
	const state = runtime.key === key ? runtime.state : { status: "idle" as const };

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const countAll = useEffectEvent(async () => {
		const mountedAtStart = mounted.current;
		if (!mountedAtStart || activeRequest.current?.key === key || state.status === "counting") {
			return;
		}
		if (Result.isFailure(countRecipe) || key === null) {
			setRuntime({ key, state: { cause: invalidCountDocumentError, status: "failed" } });
			return;
		}

		const request = { key };
		activeRequest.current = request;
		setRuntime({ key, state: { status: "counting" } });
		const result = await Effect.runPromise(
			appClient(scope)
				.ryotql.execute(countRecipe.success)
				.pipe(
					Effect.match({
						onFailure: (cause) => ({ cause }) as const,
						onSuccess: (total) => ({ total }) as const,
					}),
				),
		);
		if (
			!mounted.current ||
			currentKey.current !== request.key ||
			activeRequest.current !== request
		) {
			return;
		}
		activeRequest.current = undefined;
		setRuntime(
			"cause" in result
				? { key, state: { cause: result.cause, status: "failed" } }
				: { key, state: { status: "resolved", total: result.total } },
		);
	});

	useInternalRequestFailureLogging(
		`saved-view count ${state.status}`,
		state.status === "failed" ? state.cause : undefined,
	);

	return { countAll, state };
}
