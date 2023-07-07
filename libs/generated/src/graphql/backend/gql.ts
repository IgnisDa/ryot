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
    "mutation AddMediaToCollection($input: AddMediaToCollection!) {\n  addMediaToCollection(input: $input)\n}": types.AddMediaToCollectionDocument,
    "mutation CommitMedia($lot: MetadataLot!, $source: MetadataSource!, $identifier: String!) {\n  commitMedia(lot: $lot, source: $source, identifier: $identifier) {\n    id\n  }\n}": types.CommitMediaDocument,
    "mutation CreateCollection($input: CreateCollectionInput!) {\n  createCollection(input: $input) {\n    id\n  }\n}": types.CreateCollectionDocument,
    "mutation CreateCustomMedia($input: CreateCustomMediaInput!) {\n  createCustomMedia(input: $input) {\n    __typename\n    ... on IdObject {\n      id\n    }\n    ... on CreateCustomMediaError {\n      error\n    }\n  }\n}": types.CreateCustomMediaDocument,
    "mutation CreateUserYankIntegration($input: CreateUserYankIntegrationInput!) {\n  createUserYankIntegration(input: $input)\n}": types.CreateUserYankIntegrationDocument,
    "mutation DeleteCollection($collectionName: String!) {\n  deleteCollection(collectionName: $collectionName)\n}": types.DeleteCollectionDocument,
    "mutation DeleteReview($reviewId: Identifier!) {\n  deleteReview(reviewId: $reviewId)\n}": types.DeleteReviewDocument,
    "mutation DeleteSeenItem($seenId: Identifier!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}": types.DeleteSeenItemDocument,
    "mutation DeleteUserYankIntegration($yankIntegrationId: Int!) {\n  deleteUserYankIntegration(yankIntegrationId: $yankIntegrationId)\n}": types.DeleteUserYankIntegrationDocument,
    "mutation DeployImport($input: DeployImportInput!) {\n  deployImport(input: $input)\n}": types.DeployImportDocument,
    "mutation DeployUpdateMetadataJob($metadataId: Identifier!) {\n  deployUpdateMetadataJob(metadataId: $metadataId)\n}": types.DeployUpdateMetadataJobDocument,
    "mutation GenerateApplicationToken {\n  generateApplicationToken\n}": types.GenerateApplicationTokenDocument,
    "mutation LoginUser($input: UserInput!) {\n  loginUser(input: $input) {\n    __typename\n    ... on LoginError {\n      error\n    }\n    ... on LoginResponse {\n      apiKey\n    }\n  }\n}": types.LoginUserDocument,
    "mutation LogoutUser {\n  logoutUser\n}": types.LogoutUserDocument,
    "mutation MergeMetadata($mergeFrom: Identifier!, $mergeInto: Identifier!) {\n  mergeMetadata(mergeFrom: $mergeFrom, mergeInto: $mergeInto)\n}": types.MergeMetadataDocument,
    "mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}": types.PostReviewDocument,
    "mutation ProgressUpdate($input: ProgressUpdateInput!) {\n  progressUpdate(input: $input) {\n    id\n  }\n}": types.ProgressUpdateDocument,
    "mutation RegenerateUserSummary {\n  regenerateUserSummary\n}": types.RegenerateUserSummaryDocument,
    "mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}": types.RegisterUserDocument,
    "mutation RemoveMediaFromCollection($metadataId: Identifier!, $collectionName: String!) {\n  removeMediaFromCollection(\n    metadataId: $metadataId\n    collectionName: $collectionName\n  ) {\n    id\n  }\n}": types.RemoveMediaFromCollectionDocument,
    "mutation UpdateAllMetadata {\n  updateAllMetadata\n}": types.UpdateAllMetadataDocument,
    "mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}": types.UpdateUserDocument,
    "mutation UpdateUserFeaturePreference($input: UpdateUserFeaturePreferenceInput!) {\n  updateUserFeaturePreference(input: $input)\n}": types.UpdateUserFeaturePreferenceDocument,
    "mutation YankIntegrationData {\n  yankIntegrationData\n}": types.YankIntegrationDataDocument,
    "query Collections($limit: Int) {\n  collections(limit: $limit) {\n    collectionDetails {\n      id\n      name\n    }\n    mediaDetails {\n      identifier\n      lot\n      title\n      image\n      publishYear\n    }\n  }\n}": types.CollectionsDocument,
    "query CoreDetails {\n  coreDetails {\n    version\n    authorName\n    repositoryLink\n    usernameChangeAllowed\n  }\n}": types.CoreDetailsDocument,
    "query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    fileStorage\n    signupAllowed\n  }\n}": types.CoreEnabledFeaturesDocument,
    "query ExercisesList($input: ExercisesListInput!) {\n  exercisesList(input: $input) {\n    id\n    name\n    attributes {\n      force\n      level\n      mechanic\n      equipment\n      primaryMuscles\n      secondaryMuscles\n      category\n      instructions\n      images\n      alternateNames\n    }\n  }\n}": types.ExercisesListDocument,
    "query GetPresignedUrl($key: String!) {\n  getPresignedUrl(key: $key)\n}": types.GetPresignedUrlDocument,
    "query MediaDetails($metadataId: Identifier!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    description\n    identifier\n    lot\n    source\n    creators {\n      name\n      role\n    }\n    posterImages\n    backdropImages\n    publishYear\n    publishDate\n    genres\n    sourceUrl\n    seenBy\n    animeSpecifics {\n      episodes\n    }\n    audioBookSpecifics {\n      runtime\n    }\n    bookSpecifics {\n      pages\n    }\n    movieSpecifics {\n      runtime\n    }\n    mangaSpecifics {\n      volumes\n      chapters\n    }\n    podcastSpecifics {\n      episodes {\n        title\n        overview\n        thumbnail\n        number\n        runtime\n      }\n      totalEpisodes\n    }\n    showSpecifics {\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n          runtime\n        }\n      }\n    }\n    videoGameSpecifics {\n      platforms\n    }\n  }\n}": types.MediaDetailsDocument,
    "query MediaImportReports {\n  mediaImportReports {\n    id\n    source\n    startedOn\n    finishedOn\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n      }\n    }\n  }\n}": types.MediaImportReportsDocument,
    "query MediaItemReviews($metadataId: Identifier!) {\n  mediaItemReviews(metadataId: $metadataId) {\n    id\n    rating\n    text\n    spoiler\n    visibility\n    seasonNumber\n    episodeNumber\n    postedOn\n    postedBy {\n      id\n      name\n    }\n  }\n}": types.MediaItemReviewsDocument,
    "query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    total\n    nextPage\n    items {\n      averageRating\n      data {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}": types.MediaListDocument,
    "query MediaSearch($lot: MetadataLot!, $source: MetadataSource!, $input: SearchInput!) {\n  mediaSearch(lot: $lot, source: $source, input: $input) {\n    total\n    nextPage\n    items {\n      databaseId\n      item {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}": types.MediaSearchDocument,
    "query MediaSourcesForLot($lot: MetadataLot!) {\n  mediaSourcesForLot(lot: $lot)\n}": types.MediaSourcesForLotDocument,
    "query PartialCollections {\n  collections {\n    collectionDetails {\n      id\n      name\n      numItems\n    }\n  }\n}": types.PartialCollectionsDocument,
    "query ProvidersLanguageInformation {\n  providersLanguageInformation {\n    supported\n    default\n    source\n  }\n}": types.ProvidersLanguageInformationDocument,
    "query ReviewById($reviewId: Identifier!) {\n  reviewById(reviewId: $reviewId) {\n    rating\n    text\n    visibility\n    spoiler\n  }\n}": types.ReviewByIdDocument,
    "query SeenHistory($metadataId: Identifier!) {\n  seenHistory(metadataId: $metadataId) {\n    id\n    progress\n    dropped\n    startedOn\n    finishedOn\n    lastUpdatedOn\n    showInformation {\n      episode\n      season\n    }\n    podcastInformation {\n      episode\n    }\n  }\n}": types.SeenHistoryDocument,
    "query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n      lot\n    }\n  }\n}": types.UserDetailsDocument,
    "query UserPreferences {\n  userPreferences {\n    featuresEnabled {\n      anime\n      audioBooks\n      books\n      manga\n      movies\n      podcasts\n      shows\n      videoGames\n    }\n  }\n}": types.UserPreferencesDocument,
    "query UserSummary {\n  userSummary {\n    calculatedOn\n    media {\n      manga {\n        chapters\n        read\n      }\n      books {\n        pages\n        read\n      }\n      movies {\n        runtime\n        watched\n      }\n      anime {\n        episodes\n        watched\n      }\n      podcasts {\n        runtime\n        played\n        playedEpisodes\n      }\n      videoGames {\n        played\n      }\n      shows {\n        runtime\n        watchedEpisodes\n        watchedSeasons\n        watched\n      }\n      audioBooks {\n        runtime\n        played\n      }\n    }\n  }\n}": types.UserSummaryDocument,
    "query UserYankIntegrations {\n  userYankIntegrations {\n    id\n    lot\n    description\n    timestamp\n  }\n}": types.UserYankIntegrationsDocument,
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
export function graphql(source: "mutation AddMediaToCollection($input: AddMediaToCollection!) {\n  addMediaToCollection(input: $input)\n}"): (typeof documents)["mutation AddMediaToCollection($input: AddMediaToCollection!) {\n  addMediaToCollection(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CommitMedia($lot: MetadataLot!, $source: MetadataSource!, $identifier: String!) {\n  commitMedia(lot: $lot, source: $source, identifier: $identifier) {\n    id\n  }\n}"): (typeof documents)["mutation CommitMedia($lot: MetadataLot!, $source: MetadataSource!, $identifier: String!) {\n  commitMedia(lot: $lot, source: $source, identifier: $identifier) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateCollection($input: CreateCollectionInput!) {\n  createCollection(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation CreateCollection($input: CreateCollectionInput!) {\n  createCollection(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateCustomMedia($input: CreateCustomMediaInput!) {\n  createCustomMedia(input: $input) {\n    __typename\n    ... on IdObject {\n      id\n    }\n    ... on CreateCustomMediaError {\n      error\n    }\n  }\n}"): (typeof documents)["mutation CreateCustomMedia($input: CreateCustomMediaInput!) {\n  createCustomMedia(input: $input) {\n    __typename\n    ... on IdObject {\n      id\n    }\n    ... on CreateCustomMediaError {\n      error\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateUserYankIntegration($input: CreateUserYankIntegrationInput!) {\n  createUserYankIntegration(input: $input)\n}"): (typeof documents)["mutation CreateUserYankIntegration($input: CreateUserYankIntegrationInput!) {\n  createUserYankIntegration(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteCollection($collectionName: String!) {\n  deleteCollection(collectionName: $collectionName)\n}"): (typeof documents)["mutation DeleteCollection($collectionName: String!) {\n  deleteCollection(collectionName: $collectionName)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteReview($reviewId: Identifier!) {\n  deleteReview(reviewId: $reviewId)\n}"): (typeof documents)["mutation DeleteReview($reviewId: Identifier!) {\n  deleteReview(reviewId: $reviewId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteSeenItem($seenId: Identifier!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}"): (typeof documents)["mutation DeleteSeenItem($seenId: Identifier!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteUserYankIntegration($yankIntegrationId: Int!) {\n  deleteUserYankIntegration(yankIntegrationId: $yankIntegrationId)\n}"): (typeof documents)["mutation DeleteUserYankIntegration($yankIntegrationId: Int!) {\n  deleteUserYankIntegration(yankIntegrationId: $yankIntegrationId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployImport($input: DeployImportInput!) {\n  deployImport(input: $input)\n}"): (typeof documents)["mutation DeployImport($input: DeployImportInput!) {\n  deployImport(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployUpdateMetadataJob($metadataId: Identifier!) {\n  deployUpdateMetadataJob(metadataId: $metadataId)\n}"): (typeof documents)["mutation DeployUpdateMetadataJob($metadataId: Identifier!) {\n  deployUpdateMetadataJob(metadataId: $metadataId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation GenerateApplicationToken {\n  generateApplicationToken\n}"): (typeof documents)["mutation GenerateApplicationToken {\n  generateApplicationToken\n}"];
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
export function graphql(source: "mutation MergeMetadata($mergeFrom: Identifier!, $mergeInto: Identifier!) {\n  mergeMetadata(mergeFrom: $mergeFrom, mergeInto: $mergeInto)\n}"): (typeof documents)["mutation MergeMetadata($mergeFrom: Identifier!, $mergeInto: Identifier!) {\n  mergeMetadata(mergeFrom: $mergeFrom, mergeInto: $mergeInto)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ProgressUpdate($input: ProgressUpdateInput!) {\n  progressUpdate(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation ProgressUpdate($input: ProgressUpdateInput!) {\n  progressUpdate(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RegenerateUserSummary {\n  regenerateUserSummary\n}"): (typeof documents)["mutation RegenerateUserSummary {\n  regenerateUserSummary\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}"): (typeof documents)["mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RemoveMediaFromCollection($metadataId: Identifier!, $collectionName: String!) {\n  removeMediaFromCollection(\n    metadataId: $metadataId\n    collectionName: $collectionName\n  ) {\n    id\n  }\n}"): (typeof documents)["mutation RemoveMediaFromCollection($metadataId: Identifier!, $collectionName: String!) {\n  removeMediaFromCollection(\n    metadataId: $metadataId\n    collectionName: $collectionName\n  ) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateAllMetadata {\n  updateAllMetadata\n}"): (typeof documents)["mutation UpdateAllMetadata {\n  updateAllMetadata\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateUserFeaturePreference($input: UpdateUserFeaturePreferenceInput!) {\n  updateUserFeaturePreference(input: $input)\n}"): (typeof documents)["mutation UpdateUserFeaturePreference($input: UpdateUserFeaturePreferenceInput!) {\n  updateUserFeaturePreference(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation YankIntegrationData {\n  yankIntegrationData\n}"): (typeof documents)["mutation YankIntegrationData {\n  yankIntegrationData\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Collections($limit: Int) {\n  collections(limit: $limit) {\n    collectionDetails {\n      id\n      name\n    }\n    mediaDetails {\n      identifier\n      lot\n      title\n      image\n      publishYear\n    }\n  }\n}"): (typeof documents)["query Collections($limit: Int) {\n  collections(limit: $limit) {\n    collectionDetails {\n      id\n      name\n    }\n    mediaDetails {\n      identifier\n      lot\n      title\n      image\n      publishYear\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CoreDetails {\n  coreDetails {\n    version\n    authorName\n    repositoryLink\n    usernameChangeAllowed\n  }\n}"): (typeof documents)["query CoreDetails {\n  coreDetails {\n    version\n    authorName\n    repositoryLink\n    usernameChangeAllowed\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    fileStorage\n    signupAllowed\n  }\n}"): (typeof documents)["query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    fileStorage\n    signupAllowed\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ExercisesList($input: ExercisesListInput!) {\n  exercisesList(input: $input) {\n    id\n    name\n    attributes {\n      force\n      level\n      mechanic\n      equipment\n      primaryMuscles\n      secondaryMuscles\n      category\n      instructions\n      images\n      alternateNames\n    }\n  }\n}"): (typeof documents)["query ExercisesList($input: ExercisesListInput!) {\n  exercisesList(input: $input) {\n    id\n    name\n    attributes {\n      force\n      level\n      mechanic\n      equipment\n      primaryMuscles\n      secondaryMuscles\n      category\n      instructions\n      images\n      alternateNames\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetPresignedUrl($key: String!) {\n  getPresignedUrl(key: $key)\n}"): (typeof documents)["query GetPresignedUrl($key: String!) {\n  getPresignedUrl(key: $key)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaDetails($metadataId: Identifier!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    description\n    identifier\n    lot\n    source\n    creators {\n      name\n      role\n    }\n    posterImages\n    backdropImages\n    publishYear\n    publishDate\n    genres\n    sourceUrl\n    seenBy\n    animeSpecifics {\n      episodes\n    }\n    audioBookSpecifics {\n      runtime\n    }\n    bookSpecifics {\n      pages\n    }\n    movieSpecifics {\n      runtime\n    }\n    mangaSpecifics {\n      volumes\n      chapters\n    }\n    podcastSpecifics {\n      episodes {\n        title\n        overview\n        thumbnail\n        number\n        runtime\n      }\n      totalEpisodes\n    }\n    showSpecifics {\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n          runtime\n        }\n      }\n    }\n    videoGameSpecifics {\n      platforms\n    }\n  }\n}"): (typeof documents)["query MediaDetails($metadataId: Identifier!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    description\n    identifier\n    lot\n    source\n    creators {\n      name\n      role\n    }\n    posterImages\n    backdropImages\n    publishYear\n    publishDate\n    genres\n    sourceUrl\n    seenBy\n    animeSpecifics {\n      episodes\n    }\n    audioBookSpecifics {\n      runtime\n    }\n    bookSpecifics {\n      pages\n    }\n    movieSpecifics {\n      runtime\n    }\n    mangaSpecifics {\n      volumes\n      chapters\n    }\n    podcastSpecifics {\n      episodes {\n        title\n        overview\n        thumbnail\n        number\n        runtime\n      }\n      totalEpisodes\n    }\n    showSpecifics {\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n          runtime\n        }\n      }\n    }\n    videoGameSpecifics {\n      platforms\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaImportReports {\n  mediaImportReports {\n    id\n    source\n    startedOn\n    finishedOn\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n      }\n    }\n  }\n}"): (typeof documents)["query MediaImportReports {\n  mediaImportReports {\n    id\n    source\n    startedOn\n    finishedOn\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaItemReviews($metadataId: Identifier!) {\n  mediaItemReviews(metadataId: $metadataId) {\n    id\n    rating\n    text\n    spoiler\n    visibility\n    seasonNumber\n    episodeNumber\n    postedOn\n    postedBy {\n      id\n      name\n    }\n  }\n}"): (typeof documents)["query MediaItemReviews($metadataId: Identifier!) {\n  mediaItemReviews(metadataId: $metadataId) {\n    id\n    rating\n    text\n    spoiler\n    visibility\n    seasonNumber\n    episodeNumber\n    postedOn\n    postedBy {\n      id\n      name\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    total\n    nextPage\n    items {\n      averageRating\n      data {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}"): (typeof documents)["query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    total\n    nextPage\n    items {\n      averageRating\n      data {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaSearch($lot: MetadataLot!, $source: MetadataSource!, $input: SearchInput!) {\n  mediaSearch(lot: $lot, source: $source, input: $input) {\n    total\n    nextPage\n    items {\n      databaseId\n      item {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}"): (typeof documents)["query MediaSearch($lot: MetadataLot!, $source: MetadataSource!, $input: SearchInput!) {\n  mediaSearch(lot: $lot, source: $source, input: $input) {\n    total\n    nextPage\n    items {\n      databaseId\n      item {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaSourcesForLot($lot: MetadataLot!) {\n  mediaSourcesForLot(lot: $lot)\n}"): (typeof documents)["query MediaSourcesForLot($lot: MetadataLot!) {\n  mediaSourcesForLot(lot: $lot)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query PartialCollections {\n  collections {\n    collectionDetails {\n      id\n      name\n      numItems\n    }\n  }\n}"): (typeof documents)["query PartialCollections {\n  collections {\n    collectionDetails {\n      id\n      name\n      numItems\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ProvidersLanguageInformation {\n  providersLanguageInformation {\n    supported\n    default\n    source\n  }\n}"): (typeof documents)["query ProvidersLanguageInformation {\n  providersLanguageInformation {\n    supported\n    default\n    source\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ReviewById($reviewId: Identifier!) {\n  reviewById(reviewId: $reviewId) {\n    rating\n    text\n    visibility\n    spoiler\n  }\n}"): (typeof documents)["query ReviewById($reviewId: Identifier!) {\n  reviewById(reviewId: $reviewId) {\n    rating\n    text\n    visibility\n    spoiler\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query SeenHistory($metadataId: Identifier!) {\n  seenHistory(metadataId: $metadataId) {\n    id\n    progress\n    dropped\n    startedOn\n    finishedOn\n    lastUpdatedOn\n    showInformation {\n      episode\n      season\n    }\n    podcastInformation {\n      episode\n    }\n  }\n}"): (typeof documents)["query SeenHistory($metadataId: Identifier!) {\n  seenHistory(metadataId: $metadataId) {\n    id\n    progress\n    dropped\n    startedOn\n    finishedOn\n    lastUpdatedOn\n    showInformation {\n      episode\n      season\n    }\n    podcastInformation {\n      episode\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n      lot\n    }\n  }\n}"): (typeof documents)["query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n      lot\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserPreferences {\n  userPreferences {\n    featuresEnabled {\n      anime\n      audioBooks\n      books\n      manga\n      movies\n      podcasts\n      shows\n      videoGames\n    }\n  }\n}"): (typeof documents)["query UserPreferences {\n  userPreferences {\n    featuresEnabled {\n      anime\n      audioBooks\n      books\n      manga\n      movies\n      podcasts\n      shows\n      videoGames\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserSummary {\n  userSummary {\n    calculatedOn\n    media {\n      manga {\n        chapters\n        read\n      }\n      books {\n        pages\n        read\n      }\n      movies {\n        runtime\n        watched\n      }\n      anime {\n        episodes\n        watched\n      }\n      podcasts {\n        runtime\n        played\n        playedEpisodes\n      }\n      videoGames {\n        played\n      }\n      shows {\n        runtime\n        watchedEpisodes\n        watchedSeasons\n        watched\n      }\n      audioBooks {\n        runtime\n        played\n      }\n    }\n  }\n}"): (typeof documents)["query UserSummary {\n  userSummary {\n    calculatedOn\n    media {\n      manga {\n        chapters\n        read\n      }\n      books {\n        pages\n        read\n      }\n      movies {\n        runtime\n        watched\n      }\n      anime {\n        episodes\n        watched\n      }\n      podcasts {\n        runtime\n        played\n        playedEpisodes\n      }\n      videoGames {\n        played\n      }\n      shows {\n        runtime\n        watchedEpisodes\n        watchedSeasons\n        watched\n      }\n      audioBooks {\n        runtime\n        played\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserYankIntegrations {\n  userYankIntegrations {\n    id\n    lot\n    description\n    timestamp\n  }\n}"): (typeof documents)["query UserYankIntegrations {\n  userYankIntegrations {\n    id\n    lot\n    description\n    timestamp\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;