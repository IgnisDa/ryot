/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  /**
   * Implement the DateTime<Utc> scalar
   *
   * The input/output is a string in RFC3339 format.
   */
  DateTime: Date;
  Decimal: any;
  /**
   * ISO 8601 calendar date without timezone.
   * Format: %Y-%m-%d
   *
   * # Examples
   *
   * * `1994-11-13`
   * * `2000-02-24`
   */
  NaiveDate: any;
  /**
   * A UUID is a unique 128-bit number, stored as 16 octets. UUIDs are parsed as
   * Strings within GraphQL. UUIDs are used to assign unique identifiers to
   * entities without requiring a central allocating authority.
   *
   * # References
   *
   * * [Wikipedia: Universally Unique Identifier](http://en.wikipedia.org/wiki/Universally_unique_identifier)
   * * [RFC4122: A Universally Unique IDentifier (UUID) URN Namespace](http://tools.ietf.org/html/rfc4122)
   */
  UUID: string;
};

export type AudioBookSearchInput = {
  page?: InputMaybe<Scalars['Int']>;
  query: Scalars['String'];
};

export type AudioBookSpecifics = {
  runtime?: Maybe<Scalars['Int']>;
};

export type AudioBooksSummary = {
  played: Scalars['Int'];
  runtime: Scalars['Int'];
};

export type BookSearchInput = {
  offset?: InputMaybe<Scalars['Int']>;
  query: Scalars['String'];
};

export type BookSpecifics = {
  pages?: Maybe<Scalars['Int']>;
};

export type BooksSummary = {
  pages: Scalars['Int'];
  read: Scalars['Int'];
};

export type Collection = {
  createdOn: Scalars['DateTime'];
  id: Scalars['Int'];
  name: Scalars['String'];
};

export type CollectionItem = {
  collectionDetails: Collection;
  mediaDetails: Array<MediaSearchItem>;
};

export type CoreDetails = {
  authorName: Scalars['String'];
  version: Scalars['String'];
};

export type CoreFeatureEnabled = {
  enabled: Scalars['Boolean'];
  name: MetadataLot;
};

export type DatabaseMediaDetails = {
  audioBooksSpecifics?: Maybe<AudioBookSpecifics>;
  backdropImages: Array<Scalars['String']>;
  bookSpecifics?: Maybe<BookSpecifics>;
  collections: Array<Scalars['String']>;
  creators: Array<Scalars['String']>;
  description?: Maybe<Scalars['String']>;
  genres: Array<Scalars['String']>;
  id: Scalars['Int'];
  movieSpecifics?: Maybe<MovieSpecifics>;
  posterImages: Array<Scalars['String']>;
  publishDate?: Maybe<Scalars['NaiveDate']>;
  publishYear?: Maybe<Scalars['Int']>;
  showSpecifics?: Maybe<ShowSpecifics>;
  title: Scalars['String'];
  type: MetadataLot;
  videoGameSpecifics?: Maybe<VideoGameSpecifics>;
};

export type IdObject = {
  id: Scalars['Int'];
};

export type LoginError = {
  error: LoginErrorVariant;
};

export enum LoginErrorVariant {
  CredentialsMismatch = 'CREDENTIALS_MISMATCH',
  UsernameDoesNotExist = 'USERNAME_DOES_NOT_EXIST'
}

export type LoginResponse = {
  apiKey: Scalars['UUID'];
};

export type LoginResult = LoginError | LoginResponse;

export type MediaListInput = {
  lot: MetadataLot;
  page: Scalars['Int'];
};

export type MediaSearchItem = {
  identifier: Scalars['String'];
  lot: MetadataLot;
  posterImages: Array<Scalars['String']>;
  publishYear?: Maybe<Scalars['Int']>;
  title: Scalars['String'];
};

export type MediaSearchResults = {
  items: Array<MediaSearchItem>;
  total: Scalars['Int'];
};

export enum MetadataLot {
  AudioBook = 'AUDIO_BOOK',
  Book = 'BOOK',
  Movie = 'MOVIE',
  Show = 'SHOW',
  VideoGame = 'VIDEO_GAME'
}

export type MovieSpecifics = {
  runtime?: Maybe<Scalars['Int']>;
};

export type MoviesSearchInput = {
  page?: InputMaybe<Scalars['Int']>;
  query: Scalars['String'];
};

export type MoviesSummary = {
  runtime: Scalars['Int'];
  watched: Scalars['Int'];
};

export type MutationRoot = {
  /** Fetch details about a audio book and create a media item in the database */
  commitAudioBook: IdObject;
  /** Fetch details about a book and create a media item in the database */
  commitBook: IdObject;
  /** Fetch details about a movie and create a media item in the database */
  commitMovie: IdObject;
  /** Fetch details about a show and create a media item in the database */
  commitShow: IdObject;
  /** Fetch details about a game and create a media item in the database */
  commitVideoGame: IdObject;
  /** Create a new collection for the logged in user */
  createCollection: IdObject;
  /** Delete a seen item from a user's history */
  deleteSeenItem: IdObject;
  /** Login a user using their username and password and return an API key. */
  loginUser: LoginResult;
  /** Logout a user from the server, deleting their login token */
  logoutUser: Scalars['Boolean'];
  /** Create or update a review */
  postReview: IdObject;
  /** Mark a user's progress on a specific media item */
  progressUpdate: IdObject;
  /** Generate a summary for the currently logged in user */
  regenerateUserSummary: IdObject;
  /**
   * Create a new user for the service. Also set their `lot` as admin if
   * they are the first user.
   */
  registerUser: RegisterResult;
  /** Add a media item to a collection if it is not there, otherwise remove it. */
  toggleMediaInCollection: Scalars['Boolean'];
};


export type MutationRootCommitAudioBookArgs = {
  identifier: Scalars['String'];
};


export type MutationRootCommitBookArgs = {
  identifier: Scalars['String'];
  index: Scalars['Int'];
  input: BookSearchInput;
};


export type MutationRootCommitMovieArgs = {
  identifier: Scalars['String'];
};


export type MutationRootCommitShowArgs = {
  identifier: Scalars['String'];
};


export type MutationRootCommitVideoGameArgs = {
  identifier: Scalars['String'];
};


export type MutationRootCreateCollectionArgs = {
  input: NamedObjectInput;
};


export type MutationRootDeleteSeenItemArgs = {
  seenId: Scalars['Int'];
};


export type MutationRootLoginUserArgs = {
  input: UserInput;
};


export type MutationRootPostReviewArgs = {
  input: PostReviewInput;
};


export type MutationRootProgressUpdateArgs = {
  input: ProgressUpdate;
};


export type MutationRootRegisterUserArgs = {
  input: UserInput;
};


export type MutationRootToggleMediaInCollectionArgs = {
  input: ToggleMediaInCollection;
};

export type NamedObjectInput = {
  name: Scalars['String'];
};

export type PostReviewInput = {
  episodeNumber?: InputMaybe<Scalars['Int']>;
  metadataId: Scalars['Int'];
  rating?: InputMaybe<Scalars['Decimal']>;
  /** ID of the review if this is an update to an existing review */
  reviewId?: InputMaybe<Scalars['Int']>;
  seasonNumber?: InputMaybe<Scalars['Int']>;
  spoiler?: InputMaybe<Scalars['Boolean']>;
  text?: InputMaybe<Scalars['String']>;
  visibility?: InputMaybe<ReviewVisibility>;
};

export type ProgressUpdate = {
  action: ProgressUpdateAction;
  date?: InputMaybe<Scalars['NaiveDate']>;
  episodeNumber?: InputMaybe<Scalars['Int']>;
  metadataId: Scalars['Int'];
  progress?: InputMaybe<Scalars['Int']>;
  seasonNumber?: InputMaybe<Scalars['Int']>;
};

export enum ProgressUpdateAction {
  InThePast = 'IN_THE_PAST',
  JustStarted = 'JUST_STARTED',
  Now = 'NOW',
  Update = 'UPDATE'
}

export type QueryRoot = {
  /** Search for a list of audio books by a particular search query and a given page. */
  audioBooksSearch: MediaSearchResults;
  /** Search for a list of books by a particular search query and an offset. */
  booksSearch: MediaSearchResults;
  /** Get all collections for the currently logged in user */
  collections: Array<CollectionItem>;
  /** Get some primary information about the service */
  coreDetails: CoreDetails;
  /** Get all the features that are enabled for the service */
  coreEnabledFeatures: Array<CoreFeatureEnabled>;
  /** Get details about a media present in the database */
  mediaDetails: DatabaseMediaDetails;
  /** Get all the media items which are in progress for the currently logged in user */
  mediaInProgress: Array<MediaSearchItem>;
  /** Get all the public reviews for a media item. */
  mediaItemReviews: Array<ReviewItem>;
  /** Get all the media items for a specific media type */
  mediaList: MediaSearchResults;
  /** Search for a list of movies by a particular search query and a given page. */
  moviesSearch: MediaSearchResults;
  /** Get the user's seen history for a particular media item */
  seenHistory: Array<Seen>;
  /** Search for a list of show by a particular search query and a given page. */
  showSearch: MediaSearchResults;
  /** Get details about the currently logged in user */
  userDetails: UserDetailsResult;
  /** Get a summary of all the media items that have beem consumed by this user */
  userSummary: UserSummary;
  /** Search for a list of games by a particular search query and a given page. */
  videoGamesSearch: MediaSearchResults;
};


export type QueryRootAudioBooksSearchArgs = {
  input: AudioBookSearchInput;
};


export type QueryRootBooksSearchArgs = {
  input: BookSearchInput;
};


export type QueryRootMediaDetailsArgs = {
  metadataId: Scalars['Int'];
};


export type QueryRootMediaItemReviewsArgs = {
  metadataId: Scalars['Int'];
};


export type QueryRootMediaListArgs = {
  input: MediaListInput;
};


export type QueryRootMoviesSearchArgs = {
  input: MoviesSearchInput;
};


export type QueryRootSeenHistoryArgs = {
  metadataId: Scalars['Int'];
};


export type QueryRootShowSearchArgs = {
  input: ShowSearchInput;
};


export type QueryRootVideoGamesSearchArgs = {
  input: VideoGamesSearchInput;
};

export type RegisterError = {
  error: RegisterErrorVariant;
};

export enum RegisterErrorVariant {
  UsernameAlreadyExists = 'USERNAME_ALREADY_EXISTS'
}

export type RegisterResult = IdObject | RegisterError;

export type ReviewItem = {
  episodeNumber?: Maybe<Scalars['Int']>;
  id: Scalars['Int'];
  postedBy: ReviewPostedBy;
  postedOn: Scalars['DateTime'];
  rating?: Maybe<Scalars['Decimal']>;
  seasonNumber?: Maybe<Scalars['Int']>;
  spoiler: Scalars['Boolean'];
  text?: Maybe<Scalars['String']>;
  visibility: ReviewVisibility;
};

export type ReviewPostedBy = {
  id: Scalars['Int'];
  name: Scalars['String'];
};

export enum ReviewVisibility {
  Private = 'PRIVATE',
  Public = 'PUBLIC'
}

export type Seen = {
  finishedOn?: Maybe<Scalars['NaiveDate']>;
  id: Scalars['Int'];
  lastUpdatedOn: Scalars['DateTime'];
  metadataId: Scalars['Int'];
  progress: Scalars['Int'];
  showInformation?: Maybe<SeenSeasonExtraInformation>;
  startedOn?: Maybe<Scalars['NaiveDate']>;
  userId: Scalars['Int'];
};

export type SeenSeasonExtraInformation = {
  episode: Scalars['Int'];
  season: Scalars['Int'];
};

export type ShowEpisode = {
  episodeNumber: Scalars['Int'];
  id: Scalars['Int'];
  name: Scalars['String'];
  overview?: Maybe<Scalars['String']>;
  posterImages: Array<Scalars['String']>;
  publishDate?: Maybe<Scalars['NaiveDate']>;
  runtime?: Maybe<Scalars['Int']>;
};

export type ShowSearchInput = {
  page?: InputMaybe<Scalars['Int']>;
  query: Scalars['String'];
};

export type ShowSeason = {
  backdropImages: Array<Scalars['String']>;
  episodes: Array<ShowEpisode>;
  id: Scalars['Int'];
  name: Scalars['String'];
  overview?: Maybe<Scalars['String']>;
  posterImages: Array<Scalars['String']>;
  publishDate?: Maybe<Scalars['NaiveDate']>;
  seasonNumber: Scalars['Int'];
};

export type ShowSpecifics = {
  seasons: Array<ShowSeason>;
};

export type ShowsSummary = {
  runtime: Scalars['Int'];
  watchedEpisodes: Scalars['Int'];
  watchedShows: Scalars['Int'];
};

export type ToggleMediaInCollection = {
  collectionId: Scalars['Int'];
  mediaId: Scalars['Int'];
};

export type User = {
  email?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  lot: UserLot;
  name: Scalars['String'];
};

export type UserDetailsError = {
  error: UserDetailsErrorVariant;
};

export enum UserDetailsErrorVariant {
  AuthTokenInvalid = 'AUTH_TOKEN_INVALID'
}

export type UserDetailsResult = User | UserDetailsError;

export type UserInput = {
  password: Scalars['String'];
  username: Scalars['String'];
};

export enum UserLot {
  Admin = 'ADMIN',
  Normal = 'NORMAL'
}

export type UserSummary = {
  audioBooks: AudioBooksSummary;
  books: BooksSummary;
  movies: MoviesSummary;
  shows: ShowsSummary;
  videoGames: VideoGamesSummary;
};

export type VideoGameSpecifics = {
  rating?: Maybe<Scalars['Float']>;
};

export type VideoGamesSearchInput = {
  page?: InputMaybe<Scalars['Int']>;
  query: Scalars['String'];
};

export type VideoGamesSummary = {
  played: Scalars['Int'];
};

export type CommitAudioBookMutationVariables = Exact<{
  identifier: Scalars['String'];
}>;


export type CommitAudioBookMutation = { commitAudioBook: { id: number } };

export type CommitBookMutationVariables = Exact<{
  identifier: Scalars['String'];
  input: BookSearchInput;
  index: Scalars['Int'];
}>;


export type CommitBookMutation = { commitBook: { id: number } };

export type CommitMovieMutationVariables = Exact<{
  identifier: Scalars['String'];
}>;


export type CommitMovieMutation = { commitMovie: { id: number } };

export type CommitShowMutationVariables = Exact<{
  identifier: Scalars['String'];
}>;


export type CommitShowMutation = { commitShow: { id: number } };

export type CommitVideoGameMutationVariables = Exact<{
  identifier: Scalars['String'];
}>;


export type CommitVideoGameMutation = { commitVideoGame: { id: number } };

export type CreateCollectionMutationVariables = Exact<{
  input: NamedObjectInput;
}>;


export type CreateCollectionMutation = { createCollection: { id: number } };

export type DeleteSeenItemMutationVariables = Exact<{
  seenId: Scalars['Int'];
}>;


export type DeleteSeenItemMutation = { deleteSeenItem: { id: number } };

export type LoginUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type LoginUserMutation = { loginUser: { __typename: 'LoginError', error: LoginErrorVariant } | { __typename: 'LoginResponse', apiKey: string } };

export type LogoutUserMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutUserMutation = { logoutUser: boolean };

export type PostReviewMutationVariables = Exact<{
  input: PostReviewInput;
}>;


export type PostReviewMutation = { postReview: { id: number } };

export type ProgressUpdateMutationVariables = Exact<{
  input: ProgressUpdate;
}>;


export type ProgressUpdateMutation = { progressUpdate: { id: number } };

export type RegerateUserSummaryMutationVariables = Exact<{ [key: string]: never; }>;


export type RegerateUserSummaryMutation = { regenerateUserSummary: { id: number } };

export type RegisterUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type RegisterUserMutation = { registerUser: { __typename: 'IdObject', id: number } | { __typename: 'RegisterError', error: RegisterErrorVariant } };

export type ToggleMediaInCollectionMutationVariables = Exact<{
  input: ToggleMediaInCollection;
}>;


export type ToggleMediaInCollectionMutation = { toggleMediaInCollection: boolean };

export type AudioBooksSearchQueryVariables = Exact<{
  input: AudioBookSearchInput;
}>;


export type AudioBooksSearchQuery = { audioBooksSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type BooksSearchQueryVariables = Exact<{
  input: BookSearchInput;
}>;


export type BooksSearchQuery = { booksSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type CollectionsQueryVariables = Exact<{ [key: string]: never; }>;


export type CollectionsQuery = { collections: Array<{ collectionDetails: { id: number, createdOn: Date, name: string }, mediaDetails: Array<{ identifier: string, lot: MetadataLot, title: string, posterImages: Array<string>, publishYear?: number | null }> }> };

export type CoreDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreDetailsQuery = { coreDetails: { version: string, authorName: string } };

export type CoreEnabledFeaturesQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreEnabledFeaturesQuery = { coreEnabledFeatures: Array<{ name: MetadataLot, enabled: boolean }> };

export type MediaDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type MediaDetailsQuery = { mediaDetails: { title: string, description?: string | null, type: MetadataLot, creators: Array<string>, posterImages: Array<string>, backdropImages: Array<string>, publishYear?: number | null, publishDate?: any | null, genres: Array<string>, collections: Array<string>, movieSpecifics?: { runtime?: number | null } | null, bookSpecifics?: { pages?: number | null } | null, showSpecifics?: { seasons: Array<{ seasonNumber: number, name: string, overview?: string | null, backdropImages: Array<string>, posterImages: Array<string>, episodes: Array<{ id: number, name: string, posterImages: Array<string>, episodeNumber: number, publishDate?: any | null, overview?: string | null }> }> } | null } };

export type MediaInProgressQueryVariables = Exact<{ [key: string]: never; }>;


export type MediaInProgressQuery = { mediaInProgress: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null, lot: MetadataLot }> };

export type MediaItemReviewsQueryVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type MediaItemReviewsQuery = { mediaItemReviews: Array<{ id: number, rating?: any | null, text?: string | null, spoiler: boolean, visibility: ReviewVisibility, seasonNumber?: number | null, episodeNumber?: number | null, postedOn: Date, postedBy: { id: number, name: string } }> };

export type MediaListQueryVariables = Exact<{
  input: MediaListInput;
}>;


export type MediaListQuery = { mediaList: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type MoviesSearchQueryVariables = Exact<{
  input: MoviesSearchInput;
}>;


export type MoviesSearchQuery = { moviesSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type SeenHistoryQueryVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type SeenHistoryQuery = { seenHistory: Array<{ id: number, progress: number, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date, showInformation?: { episode: number, season: number } | null }> };

export type ShowsSearchQueryVariables = Exact<{
  input: ShowSearchInput;
}>;


export type ShowsSearchQuery = { showSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type UserDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserDetailsQuery = { userDetails: { __typename: 'User', id: number, email?: string | null, name: string } | { __typename: 'UserDetailsError' } };

export type UserSummaryQueryVariables = Exact<{ [key: string]: never; }>;


export type UserSummaryQuery = { userSummary: { books: { pages: number, read: number }, movies: { runtime: number, watched: number }, videoGames: { played: number }, shows: { runtime: number, watchedEpisodes: number, watchedShows: number }, audioBooks: { runtime: number, played: number } } };

export type VideoGamesSearchQueryVariables = Exact<{
  input: VideoGamesSearchInput;
}>;


export type VideoGamesSearchQuery = { videoGamesSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };


export const CommitAudioBookDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitAudioBook"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitAudioBook"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitAudioBookMutation, CommitAudioBookMutationVariables>;
export const CommitBookDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitBook"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BookSearchInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"index"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitBook"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"index"},"value":{"kind":"Variable","name":{"kind":"Name","value":"index"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitBookMutation, CommitBookMutationVariables>;
export const CommitMovieDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitMovie"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitMovie"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitMovieMutation, CommitMovieMutationVariables>;
export const CommitShowDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitShow"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitShow"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitShowMutation, CommitShowMutationVariables>;
export const CommitVideoGameDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitVideoGame"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitVideoGame"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitVideoGameMutation, CommitVideoGameMutationVariables>;
export const CreateCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"NamedObjectInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateCollectionMutation, CreateCollectionMutationVariables>;
export const DeleteSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"seenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSeenItemMutation, DeleteSeenItemMutationVariables>;
export const LoginUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LoginUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"loginUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}}]}}]}}]}}]} as unknown as DocumentNode<LoginUserMutation, LoginUserMutationVariables>;
export const LogoutUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LogoutUser"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logoutUser"}}]}}]} as unknown as DocumentNode<LogoutUserMutation, LogoutUserMutationVariables>;
export const PostReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PostReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PostReviewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"postReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<PostReviewMutation, PostReviewMutationVariables>;
export const ProgressUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ProgressUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdate"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"progressUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ProgressUpdateMutation, ProgressUpdateMutationVariables>;
export const RegerateUserSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegerateUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"regenerateUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RegerateUserSummaryMutation, RegerateUserSummaryMutationVariables>;
export const RegisterUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RegisterUserMutation, RegisterUserMutationVariables>;
export const ToggleMediaInCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ToggleMediaInCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ToggleMediaInCollection"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"toggleMediaInCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<ToggleMediaInCollectionMutation, ToggleMediaInCollectionMutationVariables>;
export const AudioBooksSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AudioBooksSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AudioBookSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"audioBooksSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<AudioBooksSearchQuery, AudioBooksSearchQueryVariables>;
export const BooksSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BooksSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BookSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"booksSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<BooksSearchQuery, BooksSearchQueryVariables>;
export const CollectionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collectionDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mediaDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<CollectionsQuery, CollectionsQueryVariables>;
export const CoreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"authorName"}}]}}]}}]} as unknown as DocumentNode<CoreDetailsQuery, CoreDetailsQueryVariables>;
export const CoreEnabledFeaturesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}}]}}]} as unknown as DocumentNode<CoreEnabledFeaturesQuery, CoreEnabledFeaturesQueryVariables>;
export const MediaDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"creators"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"genres"}},{"kind":"Field","name":{"kind":"Name","value":"collections"}},{"kind":"Field","name":{"kind":"Name","value":"movieSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaDetailsQuery, MediaDetailsQueryVariables>;
export const MediaInProgressDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaInProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaInProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]} as unknown as DocumentNode<MediaInProgressQuery, MediaInProgressQueryVariables>;
export const MediaItemReviewsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaItemReviews"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaItemReviews"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<MediaItemReviewsQuery, MediaItemReviewsQueryVariables>;
export const MediaListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<MediaListQuery, MediaListQueryVariables>;
export const MoviesSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MoviesSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MoviesSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"moviesSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<MoviesSearchQuery, MoviesSearchQueryVariables>;
export const SeenHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SeenHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seenHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}}]}}]}}]} as unknown as DocumentNode<SeenHistoryQuery, SeenHistoryQueryVariables>;
export const ShowsSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ShowsSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ShowSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"showSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<ShowsSearchQuery, ShowsSearchQueryVariables>;
export const UserDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<UserDetailsQuery, UserDetailsQueryVariables>;
export const UserSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"books"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}},{"kind":"Field","name":{"kind":"Name","value":"read"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movies"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGames"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"played"}}]}},{"kind":"Field","name":{"kind":"Name","value":"shows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watchedEpisodes"}},{"kind":"Field","name":{"kind":"Name","value":"watchedShows"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBooks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"played"}}]}}]}}]}}]} as unknown as DocumentNode<UserSummaryQuery, UserSummaryQueryVariables>;
export const VideoGamesSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"VideoGamesSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"VideoGamesSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"videoGamesSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<VideoGamesSearchQuery, VideoGamesSearchQueryVariables>;