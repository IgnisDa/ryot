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
    "\n  mutation CommitMovie($identifier: String!) {\n    commitMovie(identifier: $identifier) {\n      id\n    }\n  }\n": types.CommitMovieDocument,
    "\n  mutation CommitShow($identifier: String!) {\n    commitShow(identifier: $identifier) {\n      id\n    }\n  }\n": types.CommitShowDocument,
    "\n  mutation CommitVideoGame($identifier: String!) {\n    commitVideoGame(identifier: $identifier) {\n      id\n    }\n  }\n": types.CommitVideoGameDocument,
    "\n  mutation ProgressUpdate($input: ProgressUpdate!) {\n    progressUpdate(input: $input) {\n      id\n    }\n  }\n": types.ProgressUpdateDocument,
    "\n  mutation DeleteSeenItem($seenId: Int!) {\n    deleteSeenItem(seenId: $seenId) {\n      id\n    }\n  }\n": types.DeleteSeenItemDocument,
    "\n\tquery BooksSearch($input: BookSearchInput!) {\n  \tbooksSearch(input: $input) {\n\t\t\ttotal\n\t\t\titems {\n    \t\tidentifier\n    \t\ttitle\n    \t\tposterImages\n\t\t\t\tpublishYear\n\t\t\t}\n  \t}\n\t}\n": types.BooksSearchDocument,
    "\n\tquery MoviesSearch($input: MoviesSearchInput!) {\n\t  moviesSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n": types.MoviesSearchDocument,
    "\n\tquery ShowsSearch($input: ShowSearchInput!) {\n\t  showSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n": types.ShowsSearchDocument,
    "\n\tquery VideoGamesSearch($input: VideoGamesSearchInput!) {\n\t  videoGamesSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n": types.VideoGamesSearchDocument,
    "\n\tquery CoreDetails {\n\t  coreDetails {\n\t    version\n\t    authorName\n\t  }\n\t}\n": types.CoreDetailsDocument,
    "\n\tquery MediaDetails($metadataId: Int!) {\n\t  mediaDetails(metadataId: $metadataId) {\n\t    title\n\t    description\n\t    type\n\t    creators\n\t    type\n\t    posterImages\n\t    backdropImages\n\t    publishYear\n\t    publishDate\n\t    movieSpecifics {\n\t      runtime\n\t    }\n\t    bookSpecifics {\n\t      pages\n\t    }\n\t    showSpecifics {\n\t      seasons {\n\t        seasonNumber\n\t        name\n\t        overview\n\t        backdropImages\n\t        posterImages\n\t        episodes {\n\t\t\t\t\t\tid\n\t          name\n\t\t\t\t\t\tposterImages\n\t          episodeNumber\n\t          publishDate\n\t          name\n\t          overview\n\t        }\n\t      }\n\t    }\n\t  }\n\t}\n": types.MediaDetailsDocument,
    "\n\tquery SeenHistory($metadataId: Int!) {\n\t  seenHistory(metadataId: $metadataId) {\n\t    id\n\t    progress\n\t    startedOn\n\t    finishedOn\n\t    lastUpdatedOn\n\t\t\tshowInformation {\n\t\t\t\tepisode\n\t\t\t\tseason\n\t\t\t}\n\t  }\n\t}\n": types.SeenHistoryDocument,
    "\n\tquery MediaConsumed($input: MediaConsumedInput!) {\n\t  mediaConsumed(input: $input) {\n\t    seen\n\t  }\n\t}\n": types.MediaConsumedDocument,
    "\n\tquery MediaList($input: MediaListInput!) {\n\t  mediaList(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t\t\t\tbackdropImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n": types.MediaListDocument,
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
export function graphql(source: "\n  mutation CommitMovie($identifier: String!) {\n    commitMovie(identifier: $identifier) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation CommitMovie($identifier: String!) {\n    commitMovie(identifier: $identifier) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CommitShow($identifier: String!) {\n    commitShow(identifier: $identifier) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation CommitShow($identifier: String!) {\n    commitShow(identifier: $identifier) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CommitVideoGame($identifier: String!) {\n    commitVideoGame(identifier: $identifier) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation CommitVideoGame($identifier: String!) {\n    commitVideoGame(identifier: $identifier) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ProgressUpdate($input: ProgressUpdate!) {\n    progressUpdate(input: $input) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation ProgressUpdate($input: ProgressUpdate!) {\n    progressUpdate(input: $input) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSeenItem($seenId: Int!) {\n    deleteSeenItem(seenId: $seenId) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteSeenItem($seenId: Int!) {\n    deleteSeenItem(seenId: $seenId) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BooksSearch($input: BookSearchInput!) {\n  \tbooksSearch(input: $input) {\n\t\t\ttotal\n\t\t\titems {\n    \t\tidentifier\n    \t\ttitle\n    \t\tposterImages\n\t\t\t\tpublishYear\n\t\t\t}\n  \t}\n\t}\n"): (typeof documents)["\n\tquery BooksSearch($input: BookSearchInput!) {\n  \tbooksSearch(input: $input) {\n\t\t\ttotal\n\t\t\titems {\n    \t\tidentifier\n    \t\ttitle\n    \t\tposterImages\n\t\t\t\tpublishYear\n\t\t\t}\n  \t}\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery MoviesSearch($input: MoviesSearchInput!) {\n\t  moviesSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"): (typeof documents)["\n\tquery MoviesSearch($input: MoviesSearchInput!) {\n\t  moviesSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ShowsSearch($input: ShowSearchInput!) {\n\t  showSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"): (typeof documents)["\n\tquery ShowsSearch($input: ShowSearchInput!) {\n\t  showSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery VideoGamesSearch($input: VideoGamesSearchInput!) {\n\t  videoGamesSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"): (typeof documents)["\n\tquery VideoGamesSearch($input: VideoGamesSearchInput!) {\n\t  videoGamesSearch(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery CoreDetails {\n\t  coreDetails {\n\t    version\n\t    authorName\n\t  }\n\t}\n"): (typeof documents)["\n\tquery CoreDetails {\n\t  coreDetails {\n\t    version\n\t    authorName\n\t  }\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery MediaDetails($metadataId: Int!) {\n\t  mediaDetails(metadataId: $metadataId) {\n\t    title\n\t    description\n\t    type\n\t    creators\n\t    type\n\t    posterImages\n\t    backdropImages\n\t    publishYear\n\t    publishDate\n\t    movieSpecifics {\n\t      runtime\n\t    }\n\t    bookSpecifics {\n\t      pages\n\t    }\n\t    showSpecifics {\n\t      seasons {\n\t        seasonNumber\n\t        name\n\t        overview\n\t        backdropImages\n\t        posterImages\n\t        episodes {\n\t\t\t\t\t\tid\n\t          name\n\t\t\t\t\t\tposterImages\n\t          episodeNumber\n\t          publishDate\n\t          name\n\t          overview\n\t        }\n\t      }\n\t    }\n\t  }\n\t}\n"): (typeof documents)["\n\tquery MediaDetails($metadataId: Int!) {\n\t  mediaDetails(metadataId: $metadataId) {\n\t    title\n\t    description\n\t    type\n\t    creators\n\t    type\n\t    posterImages\n\t    backdropImages\n\t    publishYear\n\t    publishDate\n\t    movieSpecifics {\n\t      runtime\n\t    }\n\t    bookSpecifics {\n\t      pages\n\t    }\n\t    showSpecifics {\n\t      seasons {\n\t        seasonNumber\n\t        name\n\t        overview\n\t        backdropImages\n\t        posterImages\n\t        episodes {\n\t\t\t\t\t\tid\n\t          name\n\t\t\t\t\t\tposterImages\n\t          episodeNumber\n\t          publishDate\n\t          name\n\t          overview\n\t        }\n\t      }\n\t    }\n\t  }\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeenHistory($metadataId: Int!) {\n\t  seenHistory(metadataId: $metadataId) {\n\t    id\n\t    progress\n\t    startedOn\n\t    finishedOn\n\t    lastUpdatedOn\n\t\t\tshowInformation {\n\t\t\t\tepisode\n\t\t\t\tseason\n\t\t\t}\n\t  }\n\t}\n"): (typeof documents)["\n\tquery SeenHistory($metadataId: Int!) {\n\t  seenHistory(metadataId: $metadataId) {\n\t    id\n\t    progress\n\t    startedOn\n\t    finishedOn\n\t    lastUpdatedOn\n\t\t\tshowInformation {\n\t\t\t\tepisode\n\t\t\t\tseason\n\t\t\t}\n\t  }\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery MediaConsumed($input: MediaConsumedInput!) {\n\t  mediaConsumed(input: $input) {\n\t    seen\n\t  }\n\t}\n"): (typeof documents)["\n\tquery MediaConsumed($input: MediaConsumedInput!) {\n\t  mediaConsumed(input: $input) {\n\t    seen\n\t  }\n\t}\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery MediaList($input: MediaListInput!) {\n\t  mediaList(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t\t\t\tbackdropImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"): (typeof documents)["\n\tquery MediaList($input: MediaListInput!) {\n\t  mediaList(input: $input) {\n\t    total\n\t    items {\n\t      identifier\n\t      title\n\t      posterImages\n\t\t\t\tbackdropImages\n\t      publishYear\n\t    }\n\t  }\n\t}\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;