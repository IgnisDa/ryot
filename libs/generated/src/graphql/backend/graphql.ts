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

export type BookSearchInput = {
  offset?: InputMaybe<Scalars['Int']>;
  query: Scalars['String'];
};

export type BookSpecifics = {
  pages?: Maybe<Scalars['Int']>;
};

export type CoreDetails = {
  authorName: Scalars['String'];
  version: Scalars['String'];
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

export type MediaConsumedInput = {
  identifier: Scalars['String'];
  lot: MetadataLot;
};

export type MediaDetails = {
  backdropImages: Array<Scalars['String']>;
  bookSpecifics?: Maybe<BookSpecifics>;
  creators: Array<Scalars['String']>;
  description?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  movieSpecifics?: Maybe<MovieSpecifics>;
  posterImages: Array<Scalars['String']>;
  publishDate?: Maybe<Scalars['NaiveDate']>;
  publishYear?: Maybe<Scalars['Int']>;
  showSpecifics?: Maybe<ShowSpecifics>;
  title: Scalars['String'];
  type: MetadataLot;
};

export type MediaListInput = {
  lot: MetadataLot;
  page: Scalars['Int'];
};

export type MediaSearchItem = {
  authorNames: Array<Scalars['String']>;
  backdropImages: Array<Scalars['String']>;
  bookSpecifics?: Maybe<BookSpecifics>;
  description?: Maybe<Scalars['String']>;
  identifier: Scalars['String'];
  movieSpecifics?: Maybe<MovieSpecifics>;
  posterImages: Array<Scalars['String']>;
  publishDate?: Maybe<Scalars['NaiveDate']>;
  publishYear?: Maybe<Scalars['Int']>;
  showSpecifics?: Maybe<ShowSpecifics>;
  title: Scalars['String'];
};

export type MediaSearchResults = {
  items: Array<MediaSearchItem>;
  total: Scalars['Int'];
};

export type MediaSeen = {
  identifier: Scalars['String'];
  seen: SeenStatus;
};

export enum MetadataLot {
  AudioBook = 'AUDIO_BOOK',
  Book = 'BOOK',
  Episode = 'EPISODE',
  Movie = 'MOVIE',
  Season = 'SEASON',
  Show = 'SHOW',
  VideoGame = 'VIDEO_GAME'
}

export type Model = {
  finishedOn?: Maybe<Scalars['NaiveDate']>;
  id: Scalars['Int'];
  lastUpdatedOn: Scalars['DateTime'];
  metadataId: Scalars['Int'];
  progress: Scalars['Int'];
  startedOn?: Maybe<Scalars['NaiveDate']>;
  userId: Scalars['Int'];
};

export type MovieSpecifics = {
  runtime?: Maybe<Scalars['Int']>;
};

export type MoviesSearchInput = {
  page?: InputMaybe<Scalars['Int']>;
  query: Scalars['String'];
};

export type MutationRoot = {
  /** Fetch details about a book and create a media item in the database */
  commitBook: IdObject;
  /** Fetch details about a movie and create a media item in the database */
  commitMovie: IdObject;
  /** Fetch details about a show and create a media item in the database */
  commitShow: IdObject;
  /** Delete a seen item from a user's history */
  deleteSeenItem: IdObject;
  /** Login a user using their username and password and return an API key. */
  loginUser: LoginResult;
  /** Logout a user from the server, deleting their login token */
  logoutUser: Scalars['Boolean'];
  /** Mark a user's progress on a specific media item */
  progressUpdate: IdObject;
  /**
   * Create a new user for the service. Also set their `lot` as admin if
   * they are the first user.
   */
  registerUser: RegisterResult;
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


export type MutationRootDeleteSeenItemArgs = {
  seenId: Scalars['Int'];
};


export type MutationRootLoginUserArgs = {
  input: UserInput;
};


export type MutationRootProgressUpdateArgs = {
  input: ProgressUpdate;
};


export type MutationRootRegisterUserArgs = {
  input: UserInput;
};

export type ProgressUpdate = {
  action: ProgressUpdateAction;
  date?: InputMaybe<Scalars['NaiveDate']>;
  metadataId: Scalars['Int'];
  progress?: InputMaybe<Scalars['Int']>;
};

export enum ProgressUpdateAction {
  InThePast = 'IN_THE_PAST',
  JustStarted = 'JUST_STARTED',
  Now = 'NOW',
  Update = 'UPDATE'
}

export type QueryRoot = {
  /** Search for a list of books by a particular search query and an offset. */
  booksSearch: MediaSearchResults;
  /** Get some primary information about the service */
  coreDetails: CoreDetails;
  /** Check whether a media item has been consumed before */
  mediaConsumed: MediaSeen;
  /** Get details about a media present in the database */
  mediaDetails: MediaDetails;
  /** Get all the media items for a specific media type */
  mediaList: MediaSearchResults;
  /** Search for a list of movies by a particular search query and a given page. */
  moviesSearch: MediaSearchResults;
  /** Get the user's seen history for a particular media item */
  seenHistory: Array<Model>;
  /** Search for a list of show by a particular search query and a given page. */
  showSearch: MediaSearchResults;
};


export type QueryRootBooksSearchArgs = {
  input: BookSearchInput;
};


export type QueryRootMediaConsumedArgs = {
  input: MediaConsumedInput;
};


export type QueryRootMediaDetailsArgs = {
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

export type RegisterError = {
  error: RegisterErrorVariant;
};

export enum RegisterErrorVariant {
  UsernameAlreadyExists = 'USERNAME_ALREADY_EXISTS'
}

export type RegisterResult = IdObject | RegisterError;

export enum SeenStatus {
  ConsumedAtleastOnce = 'CONSUMED_ATLEAST_ONCE',
  CurrentlyUnderway = 'CURRENTLY_UNDERWAY',
  NotConsumed = 'NOT_CONSUMED',
  NotInDatabase = 'NOT_IN_DATABASE',
  Undetermined = 'UNDETERMINED'
}

export type ShowEpisode = {
  episodeNumber: Scalars['Int'];
  id: Scalars['Int'];
  name: Scalars['String'];
  overview?: Maybe<Scalars['String']>;
  publishDate?: Maybe<Scalars['NaiveDate']>;
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

export type UserInput = {
  password: Scalars['String'];
  username: Scalars['String'];
};

export type RegisterUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type RegisterUserMutation = { registerUser: { __typename: 'IdObject', id: number } | { __typename: 'RegisterError', error: RegisterErrorVariant } };

export type LoginUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type LoginUserMutation = { loginUser: { __typename: 'LoginError', error: LoginErrorVariant } | { __typename: 'LoginResponse', apiKey: string } };

export type LogoutUserMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutUserMutation = { logoutUser: boolean };

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

export type ProgressUpdateMutationVariables = Exact<{
  input: ProgressUpdate;
}>;


export type ProgressUpdateMutation = { progressUpdate: { id: number } };

export type DeleteSeenItemMutationVariables = Exact<{
  seenId: Scalars['Int'];
}>;


export type DeleteSeenItemMutation = { deleteSeenItem: { id: number } };

export type BooksSearchQueryVariables = Exact<{
  input: BookSearchInput;
}>;


export type BooksSearchQuery = { booksSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type MoviesSearchQueryVariables = Exact<{
  input: MoviesSearchInput;
}>;


export type MoviesSearchQuery = { moviesSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type ShowsSearchQueryVariables = Exact<{
  input: ShowSearchInput;
}>;


export type ShowsSearchQuery = { showSearch: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, publishYear?: number | null }> } };

export type CoreDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreDetailsQuery = { coreDetails: { version: string, authorName: string } };

export type MediaDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type MediaDetailsQuery = { mediaDetails: { title: string, description?: string | null, type: MetadataLot, creators: Array<string>, posterImages: Array<string>, backdropImages: Array<string>, publishYear?: number | null, publishDate?: any | null, movieSpecifics?: { runtime?: number | null } | null, bookSpecifics?: { pages?: number | null } | null, showSpecifics?: { seasons: Array<{ seasonNumber: number, name: string, overview?: string | null, backdropImages: Array<string>, posterImages: Array<string>, episodes: Array<{ id: number, name: string, episodeNumber: number, publishDate?: any | null, overview?: string | null }> }> } | null } };

export type SeenHistoryQueryVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type SeenHistoryQuery = { seenHistory: Array<{ id: number, progress: number, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date }> };

export type MediaConsumedQueryVariables = Exact<{
  input: MediaConsumedInput;
}>;


export type MediaConsumedQuery = { mediaConsumed: { seen: SeenStatus } };

export type MediaListQueryVariables = Exact<{
  input: MediaListInput;
}>;


export type MediaListQuery = { mediaList: { total: number, items: Array<{ identifier: string, title: string, posterImages: Array<string>, backdropImages: Array<string>, publishYear?: number | null }> } };


export const RegisterUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RegisterUserMutation, RegisterUserMutationVariables>;
export const LoginUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LoginUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"loginUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}}]}}]}}]}}]} as unknown as DocumentNode<LoginUserMutation, LoginUserMutationVariables>;
export const LogoutUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LogoutUser"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logoutUser"}}]}}]} as unknown as DocumentNode<LogoutUserMutation, LogoutUserMutationVariables>;
export const CommitBookDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitBook"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BookSearchInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"index"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitBook"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"index"},"value":{"kind":"Variable","name":{"kind":"Name","value":"index"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitBookMutation, CommitBookMutationVariables>;
export const CommitMovieDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitMovie"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitMovie"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitMovieMutation, CommitMovieMutationVariables>;
export const CommitShowDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitShow"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitShow"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitShowMutation, CommitShowMutationVariables>;
export const ProgressUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ProgressUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdate"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"progressUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<ProgressUpdateMutation, ProgressUpdateMutationVariables>;
export const DeleteSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"seenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSeenItemMutation, DeleteSeenItemMutationVariables>;
export const BooksSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BooksSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BookSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"booksSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<BooksSearchQuery, BooksSearchQueryVariables>;
export const MoviesSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MoviesSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MoviesSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"moviesSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<MoviesSearchQuery, MoviesSearchQueryVariables>;
export const ShowsSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ShowsSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ShowSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"showSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<ShowsSearchQuery, ShowsSearchQueryVariables>;
export const CoreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"authorName"}}]}}]}}]} as unknown as DocumentNode<CoreDetailsQuery, CoreDetailsQueryVariables>;
export const MediaDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"creators"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"movieSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaDetailsQuery, MediaDetailsQueryVariables>;
export const SeenHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SeenHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seenHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}}]}}]}}]} as unknown as DocumentNode<SeenHistoryQuery, SeenHistoryQueryVariables>;
export const MediaConsumedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaConsumed"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaConsumedInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaConsumed"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seen"}}]}}]}}]} as unknown as DocumentNode<MediaConsumedQuery, MediaConsumedQueryVariables>;
export const MediaListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]} as unknown as DocumentNode<MediaListQuery, MediaListQueryVariables>;