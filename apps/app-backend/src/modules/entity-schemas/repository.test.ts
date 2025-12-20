import { expect, it } from "@effect/vitest";
import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";

import { EntitySchemasRepository } from "./repository";

const makeDb = () => {
	let linkId: string | null = null;
	const insert = () => ({
		values: () => ({
			onConflictDoNothing: () => ({
				returning: () => {
					if (linkId) {
						return Promise.resolve([]);
					}
					linkId = "link-id";
					return Promise.resolve([{ id: linkId }]);
				},
			}),
		}),
	});
	const select = () => ({
		from: () => ({
			where: () => ({
				limit: () => Promise.resolve(linkId ? [{ id: linkId }] : []),
			}),
		}),
	});
	return { insert, select };
};

const makeLayer = () =>
	Layer.mergeAll(
		EntitySchemasRepository.Default,
		Layer.succeed(CurrentDb, Object.assign(Object.create(null), makeDb())),
	);

it.effect("returns the existing sandbox script link on conflict", () => {
	const input = {
		entitySchemaId: EntitySchemaId.make("entity-schema-id"),
		sandboxScriptId: SandboxScriptId.make("sandbox-script-id"),
	};

	return Effect.gen(function* () {
		const repository = yield* EntitySchemasRepository;
		const created = yield* repository.linkSandboxScript(input);
		const existing = yield* repository.linkSandboxScript(input);
		expect(created).toEqual({ id: "link-id" });
		expect(existing).toEqual(created);
	}).pipe(Effect.provide(makeLayer()));
});
