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
    "mutation CommitAudioBook($identifier: String!) {\n  commitAudioBook(identifier: $identifier) {\n    id\n  }\n}": types.CommitAudioBookDocument,
    "mutation CommitBook($identifier: String!) {\n  commitBook(identifier: $identifier) {\n    id\n  }\n}": types.CommitBookDocument,
    "mutation CommitMovie($identifier: String!) {\n  commitMovie(identifier: $identifier) {\n    id\n  }\n}": types.CommitMovieDocument,
    "mutation CommitShow($identifier: String!) {\n  commitShow(identifier: $identifier) {\n    id\n  }\n}": types.CommitShowDocument,
    "mutation CommitVideoGame($identifier: String!) {\n  commitVideoGame(identifier: $identifier) {\n    id\n  }\n}": types.CommitVideoGameDocument,
    "mutation CreateCollection($input: NamedObjectInput!) {\n  createCollection(input: $input) {\n    id\n  }\n}": types.CreateCollectionDocument,
    "mutation DeleteSeenItem($seenId: Int!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}": types.DeleteSeenItemDocument,
    "mutation DeployImport($input: DeployImportInput!) {\n  deployImport(input: $input)\n}": types.DeployImportDocument,
    "mutation LoginUser($input: UserInput!) {\n  loginUser(input: $input) {\n    __typename\n    ... on LoginError {\n      error\n    }\n    ... on LoginResponse {\n      apiKey\n    }\n  }\n}": types.LoginUserDocument,
    "mutation LogoutUser {\n  logoutUser\n}": types.LogoutUserDocument,
    "mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}": types.PostReviewDocument,
    "mutation ProgressUpdate($input: ProgressUpdate!) {\n  progressUpdate(input: $input) {\n    id\n  }\n}": types.ProgressUpdateDocument,
    "mutation RegerateUserSummary {\n  regenerateUserSummary {\n    id\n  }\n}": types.RegerateUserSummaryDocument,
    "mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}": types.RegisterUserDocument,
    "mutation ToggleMediaInCollection($input: ToggleMediaInCollection!) {\n  toggleMediaInCollection(input: $input)\n}": types.ToggleMediaInCollectionDocument,
    "mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}": types.UpdateUserDocument,
    "query AudioBooksSearch($input: SearchInput!) {\n  audioBooksSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}": types.AudioBooksSearchDocument,
    "query BooksSearch($input: SearchInput!) {\n  booksSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}": types.BooksSearchDocument,
    "query Collections {\n  collections {\n    collectionDetails {\n      id\n      createdOn\n      name\n    }\n    mediaDetails {\n      identifier\n      lot\n      title\n      posterImages\n      publishYear\n    }\n  }\n}": types.CollectionsDocument,
    "query CoreDetails {\n  coreDetails {\n    version\n    authorName\n  }\n}": types.CoreDetailsDocument,
    "query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    name\n    enabled\n  }\n}": types.CoreEnabledFeaturesDocument,
    "query MediaDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    description\n    type\n    creators\n    type\n    posterImages\n    backdropImages\n    publishYear\n    publishDate\n    genres\n    audioBookSpecifics {\n      source\n    }\n    bookSpecifics {\n      pages\n      source\n    }\n    movieSpecifics {\n      runtime\n      source\n    }\n    showSpecifics {\n      source\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n        }\n      }\n    }\n    videoGameSpecifics {\n      source\n    }\n  }\n}": types.MediaDetailsDocument,
    "query MediaImportReports {\n  mediaImportReports {\n    id\n    source\n    startedOn\n    finishedOn\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n      }\n    }\n  }\n}": types.MediaImportReportsDocument,
    "query MediaInProgress {\n  mediaInProgress {\n    identifier\n    title\n    posterImages\n    publishYear\n    lot\n  }\n}": types.MediaInProgressDocument,
    "query MediaItemReviews($metadataId: Int!) {\n  mediaItemReviews(metadataId: $metadataId) {\n    id\n    rating\n    text\n    spoiler\n    visibility\n    seasonNumber\n    episodeNumber\n    postedOn\n    postedBy {\n      id\n      name\n    }\n  }\n}": types.MediaItemReviewsDocument,
    "query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}": types.MediaListDocument,
    "query MoviesSearch($input: SearchInput!) {\n  moviesSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}": types.MoviesSearchDocument,
    "query SeenHistory($metadataId: Int!) {\n  seenHistory(metadataId: $metadataId) {\n    id\n    progress\n    startedOn\n    finishedOn\n    lastUpdatedOn\n    showInformation {\n      episode\n      season\n    }\n  }\n}": types.SeenHistoryDocument,
    "query ShowsSearch($input: SearchInput!) {\n  showSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}": types.ShowsSearchDocument,
    "query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n    }\n  }\n}": types.UserDetailsDocument,
    "query UserSummary {\n  userSummary {\n    books {\n      pages\n      read\n    }\n    movies {\n      runtime\n      watched\n    }\n    videoGames {\n      played\n    }\n    shows {\n      runtime\n      watchedEpisodes\n      watchedShows\n    }\n    audioBooks {\n      runtime\n      played\n    }\n  }\n}": types.UserSummaryDocument,
    "query VideoGamesSearch($input: SearchInput!) {\n  videoGamesSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}": types.VideoGamesSearchDocument,
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
export function graphql(source: "mutation CommitAudioBook($identifier: String!) {\n  commitAudioBook(identifier: $identifier) {\n    id\n  }\n}"): (typeof documents)["mutation CommitAudioBook($identifier: String!) {\n  commitAudioBook(identifier: $identifier) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CommitBook($identifier: String!) {\n  commitBook(identifier: $identifier) {\n    id\n  }\n}"): (typeof documents)["mutation CommitBook($identifier: String!) {\n  commitBook(identifier: $identifier) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CommitMovie($identifier: String!) {\n  commitMovie(identifier: $identifier) {\n    id\n  }\n}"): (typeof documents)["mutation CommitMovie($identifier: String!) {\n  commitMovie(identifier: $identifier) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CommitShow($identifier: String!) {\n  commitShow(identifier: $identifier) {\n    id\n  }\n}"): (typeof documents)["mutation CommitShow($identifier: String!) {\n  commitShow(identifier: $identifier) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CommitVideoGame($identifier: String!) {\n  commitVideoGame(identifier: $identifier) {\n    id\n  }\n}"): (typeof documents)["mutation CommitVideoGame($identifier: String!) {\n  commitVideoGame(identifier: $identifier) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateCollection($input: NamedObjectInput!) {\n  createCollection(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation CreateCollection($input: NamedObjectInput!) {\n  createCollection(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteSeenItem($seenId: Int!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}"): (typeof documents)["mutation DeleteSeenItem($seenId: Int!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployImport($input: DeployImportInput!) {\n  deployImport(input: $input)\n}"): (typeof documents)["mutation DeployImport($input: DeployImportInput!) {\n  deployImport(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation LoginUser($input: UserInput!) {\n  loginUser(input: $input) {\n    __typename\n    ... on LoginError {\n      error\n    }\n    ... on LoginResponse {\n      apiKey\n    }\n  }\n}"): (typeof documents)["mutation LoginUser($input: UserInput!) {\n  loginUser(input: $input) {\n    __typename\n    ... on LoginError {\n      error\n    }\n    ... on LoginResponse {\n      apiKey\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation LogoutUser {\n  logoutUser\n}"): (typeof documents)["mutation LogoutUser {\n  logoutUser\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ProgressUpdate($input: ProgressUpdate!) {\n  progressUpdate(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation ProgressUpdate($input: ProgressUpdate!) {\n  progressUpdate(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RegerateUserSummary {\n  regenerateUserSummary {\n    id\n  }\n}"): (typeof documents)["mutation RegerateUserSummary {\n  regenerateUserSummary {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}"): (typeof documents)["mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ToggleMediaInCollection($input: ToggleMediaInCollection!) {\n  toggleMediaInCollection(input: $input)\n}"): (typeof documents)["mutation ToggleMediaInCollection($input: ToggleMediaInCollection!) {\n  toggleMediaInCollection(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query AudioBooksSearch($input: SearchInput!) {\n  audioBooksSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"): (typeof documents)["query AudioBooksSearch($input: SearchInput!) {\n  audioBooksSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query BooksSearch($input: SearchInput!) {\n  booksSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"): (typeof documents)["query BooksSearch($input: SearchInput!) {\n  booksSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Collections {\n  collections {\n    collectionDetails {\n      id\n      createdOn\n      name\n    }\n    mediaDetails {\n      identifier\n      lot\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"): (typeof documents)["query Collections {\n  collections {\n    collectionDetails {\n      id\n      createdOn\n      name\n    }\n    mediaDetails {\n      identifier\n      lot\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CoreDetails {\n  coreDetails {\n    version\n    authorName\n  }\n}"): (typeof documents)["query CoreDetails {\n  coreDetails {\n    version\n    authorName\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    name\n    enabled\n  }\n}"): (typeof documents)["query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    name\n    enabled\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    description\n    type\n    creators\n    type\n    posterImages\n    backdropImages\n    publishYear\n    publishDate\n    genres\n    audioBookSpecifics {\n      source\n    }\n    bookSpecifics {\n      pages\n      source\n    }\n    movieSpecifics {\n      runtime\n      source\n    }\n    showSpecifics {\n      source\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n        }\n      }\n    }\n    videoGameSpecifics {\n      source\n    }\n  }\n}"): (typeof documents)["query MediaDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    description\n    type\n    creators\n    type\n    posterImages\n    backdropImages\n    publishYear\n    publishDate\n    genres\n    audioBookSpecifics {\n      source\n    }\n    bookSpecifics {\n      pages\n      source\n    }\n    movieSpecifics {\n      runtime\n      source\n    }\n    showSpecifics {\n      source\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n        }\n      }\n    }\n    videoGameSpecifics {\n      source\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaImportReports {\n  mediaImportReports {\n    id\n    source\n    startedOn\n    finishedOn\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n      }\n    }\n  }\n}"): (typeof documents)["query MediaImportReports {\n  mediaImportReports {\n    id\n    source\n    startedOn\n    finishedOn\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaInProgress {\n  mediaInProgress {\n    identifier\n    title\n    posterImages\n    publishYear\n    lot\n  }\n}"): (typeof documents)["query MediaInProgress {\n  mediaInProgress {\n    identifier\n    title\n    posterImages\n    publishYear\n    lot\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaItemReviews($metadataId: Int!) {\n  mediaItemReviews(metadataId: $metadataId) {\n    id\n    rating\n    text\n    spoiler\n    visibility\n    seasonNumber\n    episodeNumber\n    postedOn\n    postedBy {\n      id\n      name\n    }\n  }\n}"): (typeof documents)["query MediaItemReviews($metadataId: Int!) {\n  mediaItemReviews(metadataId: $metadataId) {\n    id\n    rating\n    text\n    spoiler\n    visibility\n    seasonNumber\n    episodeNumber\n    postedOn\n    postedBy {\n      id\n      name\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"): (typeof documents)["query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MoviesSearch($input: SearchInput!) {\n  moviesSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"): (typeof documents)["query MoviesSearch($input: SearchInput!) {\n  moviesSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query SeenHistory($metadataId: Int!) {\n  seenHistory(metadataId: $metadataId) {\n    id\n    progress\n    startedOn\n    finishedOn\n    lastUpdatedOn\n    showInformation {\n      episode\n      season\n    }\n  }\n}"): (typeof documents)["query SeenHistory($metadataId: Int!) {\n  seenHistory(metadataId: $metadataId) {\n    id\n    progress\n    startedOn\n    finishedOn\n    lastUpdatedOn\n    showInformation {\n      episode\n      season\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ShowsSearch($input: SearchInput!) {\n  showSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"): (typeof documents)["query ShowsSearch($input: SearchInput!) {\n  showSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n    }\n  }\n}"): (typeof documents)["query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserSummary {\n  userSummary {\n    books {\n      pages\n      read\n    }\n    movies {\n      runtime\n      watched\n    }\n    videoGames {\n      played\n    }\n    shows {\n      runtime\n      watchedEpisodes\n      watchedShows\n    }\n    audioBooks {\n      runtime\n      played\n    }\n  }\n}"): (typeof documents)["query UserSummary {\n  userSummary {\n    books {\n      pages\n      read\n    }\n    movies {\n      runtime\n      watched\n    }\n    videoGames {\n      played\n    }\n    shows {\n      runtime\n      watchedEpisodes\n      watchedShows\n    }\n    audioBooks {\n      runtime\n      played\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query VideoGamesSearch($input: SearchInput!) {\n  videoGamesSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"): (typeof documents)["query VideoGamesSearch($input: SearchInput!) {\n  videoGamesSearch(input: $input) {\n    total\n    items {\n      identifier\n      title\n      posterImages\n      publishYear\n    }\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;