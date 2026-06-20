import type { RootSource } from "../../language";
import type { RootAliasKind } from "../types";

// A doc alias resolved to its SQL table alias, the kind of root it belongs to, and its schema
// slugs (needed for the multi-schema property CASE guard).
export type SqlRef = {
	readonly kind: RootAliasKind;
	readonly sqlAlias: string;
	readonly schemas: readonly string[];
};

// The whole compilation shares one alias counter so correlated sub-source aliases (e1, ev2, r3, ...)
// are globally unique across every nesting level.
type AliasAllocator = { next: () => number };

// Lexical scope mapping doc aliases to SQL refs. A correlated sub-source or include opens a child
// scope for its own aliases; refs to an ancestor source fall through to the parent chain.
export class CompileScope {
	private constructor(
		readonly userId: string,
		readonly language: string | null,
		private readonly bindings: ReadonlyMap<string, SqlRef>,
		private readonly parent: CompileScope | null,
		private readonly allocator: AliasAllocator,
	) {}

	static make(
		userId: string,
		language: string | null,
		bindings: Map<string, SqlRef>,
	): CompileScope {
		let counter = 0;
		return new CompileScope(userId, language, bindings, null, { next: () => (counter += 1) });
	}

	child(bindings: Map<string, SqlRef>): CompileScope {
		return new CompileScope(this.userId, this.language, bindings, this, this.allocator);
	}

	// Validation has already resolved every alias, so a miss is an internal invariant violation.
	resolve(docAlias: string): SqlRef {
		const found = this.bindings.get(docAlias);
		if (found) {
			return found;
		}
		if (this.parent) {
			return this.parent.resolve(docAlias);
		}
		throw new Error(`query-engine compile: unresolved alias '${docAlias}'`);
	}

	freshSuffix(): number {
		return this.allocator.next();
	}
}

// Root-source alias bindings, mirroring the SQL FROM builders: entity `e`/`es`; event `ev`/`evs`
// plus its entity `e`/`es`; relationship `r`/`rs` plus endpoint entities `se`/`ses`, `te`/`tes`.
export const rootScope = (
	source: RootSource,
	userId: string,
	language: string | null,
): CompileScope => {
	const bindings = new Map<string, SqlRef>();
	if (source.type === "entities") {
		bindings.set(source.alias, { kind: "entity", sqlAlias: "e", schemas: source.schemas });
		if (source.via !== undefined) {
			bindings.set(source.via.alias, {
				kind: "relationship",
				sqlAlias: "r",
				schemas: [source.via.schema],
			});
		}
	} else if (source.type === "events") {
		bindings.set(source.alias, { kind: "event", sqlAlias: "ev", schemas: source.schemas });
		bindings.set(source.entity.alias, {
			kind: "entity",
			sqlAlias: "e",
			schemas: source.entity.schemas,
		});
	} else {
		bindings.set(source.alias, { kind: "relationship", sqlAlias: "r", schemas: source.schemas });
		bindings.set(source.sourceEntity.alias, {
			kind: "entity",
			sqlAlias: "se",
			schemas: source.sourceEntity.schemas,
		});
		bindings.set(source.targetEntity.alias, {
			kind: "entity",
			sqlAlias: "te",
			schemas: source.targetEntity.schemas,
		});
	}
	return CompileScope.make(userId, language, bindings);
};
