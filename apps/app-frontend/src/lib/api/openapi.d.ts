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
    "/facets/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List facets available for the user */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Facets available for the user */
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
                                config?: unknown;
                                enabled: boolean;
                                /** @enum {string} */
                                mode: "curated" | "generated";
                                isBuiltin: boolean;
                                icon?: string | null;
                                accentColor?: string | null;
                                description?: string | null;
                                sortOrder: number;
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
    "/facets/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create and enable a custom facet */
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
                        name: string;
                        slug?: string;
                        icon?: string;
                        description?: string;
                        accentColor?: string;
                    };
                };
            };
            responses: {
                /** @description Facet was created */
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
                                config?: unknown;
                                enabled: boolean;
                                /** @enum {string} */
                                mode: "curated" | "generated";
                                isBuiltin: boolean;
                                icon?: string | null;
                                accentColor?: string | null;
                                description?: string | null;
                                sortOrder: number;
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
    "/facets/{facetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update a facet */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    facetId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        icon?: string | unknown;
                        enabled?: boolean;
                        description?: string | unknown;
                        accentColor?: string | unknown;
                        name?: string;
                        slug?: string;
                    };
                };
            };
            responses: {
                /** @description Facet was updated */
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
                                config?: unknown;
                                enabled: boolean;
                                /** @enum {string} */
                                mode: "curated" | "generated";
                                isBuiltin: boolean;
                                icon?: string | null;
                                accentColor?: string | null;
                                description?: string | null;
                                sortOrder: number;
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
                /** @description Facet does not exist for this user */
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
        trace?: never;
    };
    "/facets/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reorder facets for the user */
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
                        facetIds: string[];
                    };
                };
            };
            responses: {
                /** @description Facet order was updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                facetIds: string[];
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
    "/entity-schemas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List entity schemas for a custom facet */
        get: {
            parameters: {
                query: {
                    facetId: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Entity schemas for the requested facet */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                name: string;
                                slug: string;
                                facetId: string;
                                isBuiltin: boolean;
                                propertiesSchema: {
                                    [key: string]: unknown;
                                };
                            }[];
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
                /** @description Facet does not exist for this user */
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
        /** Create an entity schema for a custom facet */
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
                        name: string;
                        slug?: string;
                        facetId: string;
                        propertiesSchema: string | {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Entity schema was created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                id: string;
                                name: string;
                                slug: string;
                                facetId: string;
                                isBuiltin: boolean;
                                propertiesSchema: {
                                    [key: string]: unknown;
                                };
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
                /** @description Facet does not exist for this user */
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
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
