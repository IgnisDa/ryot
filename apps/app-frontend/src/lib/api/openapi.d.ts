export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Check backend health */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Database and Redis checks passed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** @enum {string} */
                                status: "healthy";
                            };
                        };
                    };
                };
                /** @description Database or Redis checks failed */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["HealthCheckFailedError"];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export metrics in Prometheus format */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prometheus metrics in text format */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/plain": string;
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the current user session */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Authenticated session details */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                user?: unknown;
                                session?: unknown;
                            };
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sandbox/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run a sandbox script */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        code: string;
                    };
                };
            };
            responses: {
                /** @description Sandbox run completed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                logs?: string | null;
                                error?: string | null;
                                value?: unknown;
                                durationMs: number;
                            };
                        };
                    };
                };
                /** @description Request payload validation failed */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["ValidationFailedError"];
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/entities/{entityId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a single entity by id */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    entityId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Entity was found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                name: string;
                                createdAt: string;
                                updatedAt: string;
                                schemaSlug: string;
                                externalId: string;
                                properties?: unknown;
                                detailsScriptId: string;
                            };
                        };
                    };
                };
                /** @description Path parameter validation failed */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["ValidationFailedError"];
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
                /** @description Entity does not exist for this user */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["NotFoundError"];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/entity-schemas/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List available entity schemas */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Schemas available for the user */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                slug: string;
                                name: string;
                                scriptPairs: {
                                    searchScriptId: string;
                                    detailsScriptId: string;
                                    searchScriptName: string;
                                    detailsScriptName: string;
                                }[];
                                eventSchemas: {
                                    id: string;
                                    slug: string;
                                    name: string;
                                }[];
                            }[];
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/entity-schemas/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search entities for a schema */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        query: string;
                        /** @default 1 */
                        page?: number;
                        searchScriptId: string;
                    };
                };
            };
            responses: {
                /** @description Search results for the schema query */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                title: string;
                                identifier: string;
                                image?: string | null;
                                publishYear?: number | null;
                            }[];
                            meta: {
                                hasMore: boolean;
                                page: number;
                                total: number;
                            };
                        };
                    };
                };
                /** @description Request payload validation failed */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["ValidationFailedError"];
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
                /** @description Search script is missing */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["NotFoundError"];
                        };
                    };
                };
                /** @description Search execution or payload parsing failed */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["InternalServerError"];
                        };
                    };
                };
                /** @description Search sandbox job timed out */
                504: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["TimeoutError"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/entity-schemas/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import an entity from schema scripts */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        identifier: string;
                        detailsScriptId: string;
                    };
                };
            };
            responses: {
                /** @description Entity import persisted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                created: boolean;
                                entityId: string;
                            };
                        };
                    };
                };
                /** @description Request payload validation failed */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["ValidationFailedError"];
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
                /** @description Details script is missing */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["NotFoundError"];
                        };
                    };
                };
                /** @description Import execution or persistence failed */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["InternalServerError"];
                        };
                    };
                };
                /** @description Import sandbox job timed out */
                504: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["TimeoutError"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/event-schemas/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List event schemas for the user */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Event schemas available for the user */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                slug: string;
                                name: string;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                updatedAt: string;
                                entitySchemaName: string;
                            }[];
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
                /** @description Failed to list event schemas */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["InternalServerError"];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/event-schemas/{eventSchemaId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an event for an event schema */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    eventSchemaId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        entityId: string;
                        /** Format: date-time */
                        occurredAt?: string | null;
                        /** @default {} */
                        properties?: {
                            [key: string]: unknown;
                        };
                        sessionEntityId?: string;
                    };
                };
            };
            responses: {
                /** @description Event was created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                eventId: string;
                            };
                        };
                    };
                };
                /** @description Request validation failed */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["ValidationFailedError"];
                        };
                    };
                };
                /** @description Request is unauthenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["UnauthenticatedError"];
                        };
                    };
                };
                /** @description Event schema or entity was not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["NotFoundError"];
                        };
                    };
                };
                /** @description Failed to create event */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: components["schemas"]["InternalServerError"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        HealthCheckFailedError: {
            message: string;
            /** @enum {string} */
            code: "health_check_failed";
        };
        UnauthenticatedError: {
            message: string;
            /** @enum {string} */
            code: "unauthenticated";
        };
        ValidationFailedError: {
            message: string;
            /** @enum {string} */
            code: "validation_failed";
        };
        NotFoundError: {
            message: string;
            /** @enum {string} */
            code: "not_found";
        };
        InternalServerError: {
            message: string;
            /** @enum {string} */
            code: "internal_error";
        };
        TimeoutError: {
            message: string;
            /** @enum {string} */
            code: "timeout";
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
