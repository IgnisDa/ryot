import {
	isEntityReferenceParam,
	isNestedMessage,
	type Message,
	type MessageParam,
	unavailableMessage,
} from "@ryot-app/i18n/message";
import { entityMessageNamesRecipe } from "@ryot-app/ryotql-recipes/entity-message";
import { MAX_ROOT_PAGE_SIZE } from "@ryot-app/ryotql/validator";
import { Array as Arr, Effect } from "effect";

import { RyotQLService } from "#modules/ryotql/service";

export const resolveEntityMessage = Effect.fn("resolveEntityMessage")(function* (
	message: Message,
	userId: string,
	language: null | string,
) {
	const ids = new Set<string>();
	const collect = (current: Message): void => {
		for (const value of Object.values(current.params ?? {})) {
			if (isEntityReferenceParam(value)) {
				ids.add(value.entityId);
			} else if (isNestedMessage(value)) {
				collect(value);
			}
		}
	};
	collect(message);
	if (ids.size === 0) {
		return message;
	}
	const ryotql = yield* RyotQLService;
	const pages = yield* Effect.forEach(Arr.chunksOf([...ids], MAX_ROOT_PAGE_SIZE), (batch) =>
		Effect.gen(function* () {
			const recipe = entityMessageNamesRecipe(batch);
			const response = yield* ryotql.executeForUser(userId, language, "kernel", {
				source: { kind: "inline", document: recipe.document },
			});
			return yield* Effect.fromResult(recipe.decode(response)).pipe(Effect.orDie);
		}),
	);
	const names = new Map(pages.flat().map((row) => [String(row.id), row.name]));
	const resolve = (current: Message): Message => {
		const params: Record<string, MessageParam> = {};
		for (const [key, value] of Object.entries(current.params ?? {})) {
			if (isEntityReferenceParam(value)) {
				params[key] = names.get(value.entityId) ?? unavailableMessage;
			} else {
				params[key] = isNestedMessage(value) ? resolve(value) : value;
			}
		}
		return { ...current, params };
	};
	return resolve(message);
});
