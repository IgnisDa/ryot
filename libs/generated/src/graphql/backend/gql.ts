/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 */
const documents = {
    "\n  mutation RegisterUser($input: UserInput!) {\n    registerUser(input: $input){\n      __typename\n      ... on RegisterError {\n        error\n      }\n      ... on IdObject {\n        id\n      }\n    }\n  }\n": types.RegisterUserDocument,
    "\n  mutation LoginUser($input: UserInput!) {\n    loginUser(input: $input) {\n      __typename\n      ... on LoginError {\n        error\n      }\n      ... on LoginResponse {\n        apiKey\n      }\n    }\n  }\n": types.LoginUserDocument,
    "\n  mutation LogoutUser {\n    logoutUser\n  }\n": types.LogoutUserDocument,
    "\n  mutation CommitBook($identifier: String!, $input: BookSearchInput!, $index: Int!) {\n    commitBook(identifier: $identifier, input: $input, index: $index) {\n      id\n    }\n  }\n": types.CommitBookDocument,
    "\n  mutation ProgressUpdate($input: ProgressUpdate!) {\n    progressUpdate(input: $input) {\n      id\n    }\n  }\n": types.ProgressUpdateDocument,
    "\n\tquery BooksSearch($input: BookSearchInput!) {\n  \tbooksSearch(input: $input) {\n\t\t\ttotal\n\t\t\titems {\n    \t\tidentifier\n    \t\ttitle\n\t\t\t\tstatus\n    \t\timages\n\t\t\t\tpublishYear\n\t\t\t}\n  \t}\n\t}\n": types.BooksSearchDocument,
    "\n\tquery Version {\n\t\tversion\n\t}\n": types.VersionDocument,
    "\n\tquery BookDetails($metadataId: Int!) {\n  \tbookDetails(metadataId: $metadataId) {\n    \ttitle\n    \tdescription\n    \tcreators\n    \timages\n    \tpublishYear\n    \tspecifics {\n      \tpages\n    \t}\n  \t}\n\t}\n": types.BookDetailsDocument,
    "\n\tquery SeenHistory($metadataId: Int!) {\n\t  seenHistory(metadataId: $metadataId) {\n\t    id\n\t    progress\n\t    startedOn\n\t    finishedOn\n\t    lastUpdatedOn\n\t  }\n\t}\n": types.SeenHistoryDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RegisterUser($input: UserInput!) {\n    registerUser(input: $input){\n      __typename\n      ... on RegisterError {\n        error\n      }\n      ... on IdObject {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation RegisterUser($input: UserInput!) {\n    registerUser(input: $input){\n      __typename\n      ... on RegisterError {\n        error\n      }\n      ... on IdObject {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LoginUser($input: UserInput!) {\n    loginUser(input: $input) {\n      __typename\n      ... on LoginError {\n        error\n      }\n      ... on LoginResponse {\n        apiKey\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation LoginUser($input: UserInput!) {\n    loginUser(input: $input) {\n      __typename\n      ... on LoginError {\n        error\n      }\n      ... on LoginResponse {\n        apiKey\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LogoutUser {\n    logoutUser\n  }\n"): (typeof documents)["\n  mutation LogoutUser {\n    logoutUser\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CommitBook($identifier: String!, $input: BookSearchInput!, $index: Int!) {\n    commitBook(identifier: $identifier, input: $input, index: $index) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation CommitBook($identifier: String!, $input: BookSearchInput!, $index: Int!) {\n    commitBook(identifier: $identifier, input: $input, index: $index) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ProgressUpdate($input: ProgressUpdate!) {\n    progressUpdate(input: $input) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ProgressUpdate($input: ProgressUpdate!) {\n    progressUpdate(input: $input) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BooksSearch($input: BookSearchInput!) {\n  \tbooksSearch(input: $input) {\n\t\t\ttotal\n\t\t\titems {\n    \t\tidentifier\n    \t\ttitle\n\t\t\t\tstatus\n    \t\timages\n\t\t\t\tpublishYear\n\t\t\t}\n  \t}\n\t}\n"): (typeof documents)["\n\tquery BooksSearch($input: BookSearchInput!) {\n  \tbooksSearch(input: $input) {\n\t\t\ttotal\n\t\t\titems {\n    \t\tidentifier\n    \t\ttitle\n\t\t\t\tstatus\n    \t\timages\n\t\t\t\tpublishYear\n\t\t\t}\n  \t}\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery Version {\n\t\tversion\n\t}\n"): (typeof documents)["\n\tquery Version {\n\t\tversion\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookDetails($metadataId: Int!) {\n  \tbookDetails(metadataId: $metadataId) {\n    \ttitle\n    \tdescription\n    \tcreators\n    \timages\n    \tpublishYear\n    \tspecifics {\n      \tpages\n    \t}\n  \t}\n\t}\n"): (typeof documents)["\n\tquery BookDetails($metadataId: Int!) {\n  \tbookDetails(metadataId: $metadataId) {\n    \ttitle\n    \tdescription\n    \tcreators\n    \timages\n    \tpublishYear\n    \tspecifics {\n      \tpages\n    \t}\n  \t}\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeenHistory($metadataId: Int!) {\n\t  seenHistory(metadataId: $metadataId) {\n\t    id\n\t    progress\n\t    startedOn\n\t    finishedOn\n\t    lastUpdatedOn\n\t  }\n\t}\n"): (typeof documents)["\n\tquery SeenHistory($metadataId: Int!) {\n\t  seenHistory(metadataId: $metadataId) {\n\t    id\n\t    progress\n\t    startedOn\n\t    finishedOn\n\t    lastUpdatedOn\n\t  }\n\t}\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;