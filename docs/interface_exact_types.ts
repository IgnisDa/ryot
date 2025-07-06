// ============================================================================
// MINIMAL INTERFACE: EXACT TYPESCRIPT TYPES & SIGNATURES
// ============================================================================

// FILE: apps/app-backend/src/modules/query-engine/view-orchestrator.ts (NEW)
// ============================================================================

import type { QueryEngineRequest, QueryEngineResponse } from './schemas';
import type {
  DisplayConfiguration,
  SavedViewQueryDefinition,
  EventJoinDefinition,
} from '~/modules/saved-views';
import type {
  QueryEngineSchemaLike,
  QueryEngineEventJoinLike,
} from '~/lib/views/reference';
import type {
  QueryEngineSchemaRow,
  QueryEnginePreparedEventJoin,
} from './query-builder';

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * A view definition with query filters and display configuration.
 */
export type ViewDefinition = {
  queryDefinition: SavedViewQueryDefinition;
  displayConfiguration: DisplayConfiguration;
};

/**
 * Two sources for preparing views:
 * - "runtime": Direct QueryEngineRequest from API caller
 * - "saved-view": Persisted view definition with UI layout config
 */
export type ViewSource =
  | { kind: "runtime"; request: QueryEngineRequest }
  | { kind: "saved-view"; definition: ViewDefinition };

/**
 * Valid layout types from DisplayConfiguration.
 */
export type SavedViewLayout = keyof DisplayConfiguration;

/**
 * Optional input for executing a prepared view.
 * If source is "saved-view", layout and pagination are required.
 */
export type RuntimeExecutionInput = {
  layout?: SavedViewLayout;
  pagination?: QueryEngineRequest["pagination"];
};

/**
 * Result of preparing a view: validation passed, ready for execution.
 * All three methods share access to validated schema/event-join state.
 */
export type PreparedView = {
  /**
   * Validates that this view is savable (source must be "saved-view").
   * Throws QueryEngineValidationError if source is "runtime".
   *
   * Called during saved-view creation/update to validate before persistence.
   */
  assertSavable(): void;

  /**
   * Builds a QueryEngineRequest for UI rendering with a specific layout.
   * Throws if source is not "saved-view" or displayConfiguration unavailable.
   *
   * Useful for generating paginated queries for grid/list/table display.
   */
  toRuntimeRequest(input: {
    layout: SavedViewLayout;
    pagination: QueryEngineRequest["pagination"];
  }): QueryEngineRequest;

  /**
   * Executes the prepared view against the database.
   *
   * For "runtime" source: uses the original request directly.
   * For "saved-view" source: requires layout + pagination to build request.
   *
   * Returns paginated results with metadata.
   * Throws QueryEngineValidationError if references are invalid during execution.
   */
  execute(input?: RuntimeExecutionInput): Promise<QueryEngineResponse>;
};

// ============================================================================
// DEPENDENCY INJECTION TYPES (For Testing)
// ============================================================================

/**
 * Dependencies that validateAndPrepareView uses internally.
 * Separate type to enable testing with mocked DB lookups.
 */
export type ViewOrchestratorDeps = {
  /**
   * Load all schemas visible to the user (with permission filtering).
   * Throws QueryEngineNotFoundError if any slug is not found.
   * Throws QueryEngineValidationError if slug resolves to multiple schemas.
   */
  loadVisibleSchemas(input: {
    userId: string;
    entitySchemaSlugs: string[];
  }): Promise<QueryEngineSchemaRow[]>;

  /**
   * Load event joins and their associated schemas.
   * Throws if event schema not available for runtime schemas.
   */
  loadVisibleEventJoins(input: {
    userId: string;
    eventJoins: EventJoinDefinition[];
    runtimeSchemas: QueryEngineSchemaRow[];
  }): Promise<QueryEnginePreparedEventJoin[]>;

  /**
   * Execute a prepared query and return results.
   * Handles SQL building, field resolution, sorting, filtering, pagination.
   */
  executePreparedQuery(input: {
    userId: string;
    request: QueryEngineRequest;
    runtimeSchemas: QueryEngineSchemaRow[];
    eventJoins: QueryEnginePreparedEventJoin[];
    schemaMap: Map<string, QueryEngineSchemaRow>;
    eventJoinMap: Map<string, QueryEnginePreparedEventJoin>;
  }): Promise<QueryEngineResponse>;
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Single entry point for view preparation and validation.
 *
 * Handles both runtime requests and saved-view definitions.
 *
 * Flow:
 * 1. Extract schema slugs from source
 * 2. Load schemas with user permission filtering
 * 3. Load event joins (if defined)
 * 4. Build canonical maps (schemaMap, eventJoinMap)
 * 5. Validate query references and display configuration
 * 6. Return PreparedView for execution or introspection
 *
 * Throws:
 * - QueryEngineNotFoundError: Schema not found or not visible to user
 * - QueryEngineValidationError: Reference validation failed
 *
 * Usage:
 *   const prepared = await validateAndPrepareView({
 *     userId: "user-123",
 *     source: { kind: "runtime", request: {...} }
 *   });
 *   const result = await prepared.execute();
 */
export async function validateAndPrepareView(input: {
  userId: string;
  source: ViewSource;
}): Promise<PreparedView>;

/**
 * Factory for testing: create an orchestrator with custom dependencies.
 *
 * Useful when you want to mock DB lookups without changing the module.
 *
 * Usage:
 *   const mockDeps = {
 *     loadVisibleSchemas: async () => [...],
 *     loadVisibleEventJoins: async () => [...],
 *     executePreparedQuery: async () => ({...}),
 *   };
 *   const orchestrator = createViewOrchestrator(mockDeps);
 *   const prepared = await orchestrator({
 *     userId: "user-123",
 *     source: {...}
 *   });
 */
export function createViewOrchestrator(
  deps?: Partial<ViewOrchestratorDeps>
): (input: { userId: string; source: ViewSource }) => Promise<PreparedView>;

// ============================================================================
// IMPLEMENTATION NOTES
// ============================================================================

/*
 * Internal State (Not Exported):
 *
 * type PreparedViewState = {
 *   userId: string;
 *   source: ViewSource["kind"];
 *   eventJoins: QueryEnginePreparedEventJoin[];
 *   runtimeRequest?: QueryEngineRequest;
 *   runtimeSchemas: QueryEngineSchemaRow[];
 *   queryDefinition: SavedViewQueryDefinition;
 *   displayConfiguration?: DisplayConfiguration;
 *   schemaMap: Map<string, QueryEngineSchemaRow>;
 *   eventJoinMap: Map<string, QueryEnginePreparedEventJoin>;
 * };
 *
 * The PreparedView methods close over this state and use it to:
 * - assertSavable(): Check source === "saved-view"
 * - toRuntimeRequest(): Build request using displayConfiguration + schema maps
 * - execute(): Validate references then call executePreparedQuery
 */

// ============================================================================
// FILE: apps/app-backend/src/lib/views/validator-public.ts (NEW)
// ============================================================================

import type {
  DisplayConfiguration,
  SavedViewQueryDefinition,
} from '~/modules/saved-views';
import type {
  QueryEngineReferenceContext,
  QueryEngineSchemaLike,
  QueryEngineEventJoinLike,
} from './reference';

/**
 * Pure validation context (no DB access).
 * Contains schema and event join information needed for validation.
 */
export type ViewDefinitionValidationContext = QueryEngineReferenceContext<
  QueryEngineSchemaLike,
  QueryEngineEventJoinLike
>;

/**
 * Pure validation without DB or HTTP.
 *
 * Validates that a saved-view definition is well-formed:
 * - All property expressions reference existing schemas/properties
 * - All display configuration expressions are valid for their layouts
 * - All computed fields have valid references
 * - All sort and filter expressions are valid
 *
 * Does NOT:
 * - Access the database
 * - Check user permissions
 * - Execute any queries
 *
 * Useful for:
 * - Unit tests verifying validation logic in isolation
 * - Pre-flight checks before expensive DB lookups
 * - Rapid validation during development
 *
 * Throws:
 * - QueryEngineValidationError: If any validation check fails (with descriptive message)
 *
 * Usage:
 *   const schemas = new Map([
 *     ['smartphones', { id: 'id-1', slug: 'smartphones', propertiesSchema: {...} }],
 *   ]);
 *   const eventJoins = new Map();
 *
 *   validateViewDefinitionOnly({
 *     queryDefinition: {
 *       entitySchemaSlugs: ['smartphones'],
 *       filter: null,
 *       sort: { expression: {...}, direction: 'asc' },
 *       eventJoins: [],
 *       computedFields: [],
 *     },
 *     displayConfiguration: {
 *       grid: {
 *         titleProperty: { type: 'entity-property', slug: 'smartphones', property: 'name' },
 *         // ...
 *       },
 *       list: { ... },
 *       table: { ... },
 *     },
 *     context: { schemaMap: schemas, eventJoinMap: eventJoins },
 *   });
 *   // No throw = valid
 */
export function validateViewDefinitionOnly(input: {
  queryDefinition: SavedViewQueryDefinition;
  displayConfiguration: DisplayConfiguration;
  context: ViewDefinitionValidationContext;
}): void;

// ============================================================================
// TYPES EXPORTED FROM query-engine/index.ts
// ============================================================================

export type {
  ViewDefinition,
  ViewSource,
  SavedViewLayout,
  RuntimeExecutionInput,
  PreparedView,
  ViewOrchestratorDeps,
} from './view-orchestrator';

export {
  validateAndPrepareView,
  createViewOrchestrator,
} from './view-orchestrator';

// (Re-export existing types, unchanged)
export type {
  QueryEngineField,
  QueryEngineItem,
  QueryEngineRequest,
  QueryEngineResponse,
} from './schemas';

export {
  executePreparedQuery,
  calculatePagination,
  mapQueryRowToItem,
} from './query-builder';

// ============================================================================
// USAGE IN ROUTES
// ============================================================================

/*
 * query-engine/routes.ts:
 *
 * import { validateAndPrepareView } from './view-orchestrator';
 * import type { AuthType } from '~/lib/auth';
 *
 * export const queryEngineApi = new OpenAPIHono<{ Variables: AuthType }>()
 *   .openapi(executeQueryEngineRoute, async (c) => {
 *     const user = c.get("user");
 *     const body = c.req.valid("json");
 *
 *     try {
 *       const prepared = await validateAndPrepareView({
 *         userId: user.id,
 *         source: { kind: "runtime", request: body },
 *       });
 *       const result = await prepared.execute();
 *       return c.json(successResponse(result), 200);
 *     } catch (error) {
 *       if (error instanceof QueryEngineNotFoundError) {
 *         return c.json(createNotFoundErrorResult(error.message).body, 404);
 *       }
 *       if (error instanceof QueryEngineValidationError) {
 *         return c.json(createValidationErrorResult(error.message).body, 400);
 *       }
 *       throw error;
 *     }
 *   });
 */

/*
 * saved-views/routes.ts:
 *
 * import { validateAndPrepareView } from '~/modules/query-engine';
 *
 * const createSavedViewRoute = createAuthRoute(...);
 * export const savedViewsApi = new OpenAPIHono<{ Variables: AuthType }>()
 *   .openapi(createSavedViewRoute, async (c) => {
 *     const user = c.get("user");
 *     const body = c.req.valid("json");
 *
 *     try {
 *       const prepared = await validateAndPrepareView({
 *         userId: user.id,
 *         source: {
 *           kind: "saved-view",
 *           definition: {
 *             queryDefinition: body.queryDefinition,
 *             displayConfiguration: body.displayConfiguration,
 *           },
 *         },
 *       });
 *       prepared.assertSavable(); // Redundant but explicit
 *     } catch (error) {
 *       return c.json(resolveSavedViewValidationErrorResult(error).body, 400);
 *     }
 *
 *     // Validation passed, persist to DB
 *     const result = await createSavedView({ body, userId: user.id });
 *     if ("error" in result) {
 *       return c.json(createValidationServiceErrorResult(result).body, 400);
 *     }
 *     return c.json(createSuccessResult(result.data).body, 201);
 *   });
 */

/*
 * tests/src/tests/query-engine.test.ts:
 *
 * import { validateViewDefinitionOnly } from '~/lib/views/validator-public';
 * import { describe, expect, it } from 'bun:test';
 *
 * describe('view definition validation', () => {
 *   it('rejects undefined property', () => {
 *     const schemas = new Map([
 *       ['smartphones', {
 *         id: 'schema-1',
 *         slug: 'smartphones',
 *         propertiesSchema: { type: 'object', properties: { name: {...} } },
 *       }],
 *     ]);
 *
 *     expect(() => {
 *       validateViewDefinitionOnly({
 *         queryDefinition: {
 *           entitySchemaSlugs: ['smartphones'],
 *           filter: null,
 *           sort: { expression: {...}, direction: 'asc' },
 *           eventJoins: [],
 *           computedFields: [],
 *         },
 *         displayConfiguration: {
 *           grid: {
 *             titleProperty: {
 *               type: 'entity-property',
 *               slug: 'smartphones',
 *               property: 'undefined_property', // ERROR!
 *             },
 *           },
 *         },
 *         context: { schemaMap: schemas, eventJoinMap: new Map() },
 *       });
 *     }).toThrow(QueryEngineValidationError);
 *   });
 * });
 */

