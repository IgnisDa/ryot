/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /**
   * Implement the DateTime<Utc> scalar
   *
   * The input/output is a string in RFC3339 format.
   */
  DateTime: { input: Date; output: Date; }
  Decimal: { input: any; output: any; }
  /** A scalar that can represent any JSON Object value. */
  JSONObject: { input: any; output: any; }
  /**
   * ISO 8601 calendar date without timezone.
   * Format: %Y-%m-%d
   *
   * # Examples
   *
   * * `1994-11-13`
   * * `2000-02-24`
   */
  NaiveDate: { input: any; output: any; }
};

export type AddMediaToCollection = {
  collectionName: Scalars['String']['input'];
  mediaId: Scalars['Int']['input'];
};

export type AnimeSpecifics = {
  episodes?: Maybe<Scalars['Int']['output']>;
};

export type AnimeSpecificsInput = {
  episodes?: InputMaybe<Scalars['Int']['input']>;
};

export type AnimeSummary = {
  episodes: Scalars['Int']['output'];
  watched: Scalars['Int']['output'];
};

export type AudioBookSpecifics = {
  runtime?: Maybe<Scalars['Int']['output']>;
};

export type AudioBookSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']['input']>;
};

export type AudioBooksSummary = {
  played: Scalars['Int']['output'];
  runtime: Scalars['Int']['output'];
};

export type BookSpecifics = {
  pages?: Maybe<Scalars['Int']['output']>;
};

export type BookSpecificsInput = {
  pages?: InputMaybe<Scalars['Int']['input']>;
};

export type BooksSummary = {
  pages: Scalars['Int']['output'];
  read: Scalars['Int']['output'];
};

export type Collection = {
  createdOn: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  visibility: Visibility;
};

export type CollectionContents = {
  details: Collection;
  results: MediaCollectionContentsResults;
  user: User;
};

export type CollectionContentsInput = {
  collectionId: Scalars['Int']['input'];
  page?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type CollectionInput = {
  name?: InputMaybe<Scalars['String']['input']>;
};

export type CollectionItem = {
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  numItems: Scalars['Int']['output'];
  visibility: Visibility;
};

export type CoreDetails = {
  authorName: Scalars['String']['output'];
  defaultCredentials: Scalars['Boolean']['output'];
  deployUpdateAllMetadataJobAllowed: Scalars['Boolean']['output'];
  docsLink: Scalars['String']['output'];
  itemDetailsHeight: Scalars['Int']['output'];
  pageLimit: Scalars['Int']['output'];
  passwordChangeAllowed: Scalars['Boolean']['output'];
  preferencesChangeAllowed: Scalars['Boolean']['output'];
  repositoryLink: Scalars['String']['output'];
  reviewsDisabled: Scalars['Boolean']['output'];
  upgrade?: Maybe<UpgradeType>;
  usernameChangeAllowed: Scalars['Boolean']['output'];
  version: Scalars['String']['output'];
  videosDisabled: Scalars['Boolean']['output'];
};

export type CreateCustomMediaError = {
  error: CreateCustomMediaErrorVariant;
};

export enum CreateCustomMediaErrorVariant {
  LotDoesNotMatchSpecifics = 'LOT_DOES_NOT_MATCH_SPECIFICS'
}

export type CreateCustomMediaInput = {
  animeSpecifics?: InputMaybe<AnimeSpecificsInput>;
  audioBookSpecifics?: InputMaybe<AudioBookSpecificsInput>;
  bookSpecifics?: InputMaybe<BookSpecificsInput>;
  creators?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  genres?: InputMaybe<Array<Scalars['String']['input']>>;
  images?: InputMaybe<Array<Scalars['String']['input']>>;
  isNsfw?: InputMaybe<Scalars['Boolean']['input']>;
  lot: MetadataLot;
  mangaSpecifics?: InputMaybe<MangaSpecificsInput>;
  movieSpecifics?: InputMaybe<MovieSpecificsInput>;
  podcastSpecifics?: InputMaybe<PodcastSpecificsInput>;
  publishYear?: InputMaybe<Scalars['Int']['input']>;
  showSpecifics?: InputMaybe<ShowSpecificsInput>;
  title: Scalars['String']['input'];
  videoGameSpecifics?: InputMaybe<VideoGameSpecificsInput>;
  videos?: InputMaybe<Array<Scalars['String']['input']>>;
  visualNovelSpecifics?: InputMaybe<VisualNovelSpecificsInput>;
};

export type CreateCustomMediaResult = CreateCustomMediaError | IdObject;

export type CreateMediaReminderInput = {
  message: Scalars['String']['input'];
  metadataId: Scalars['Int']['input'];
  remindOn: Scalars['NaiveDate']['input'];
};

export type CreateOrUpdateCollectionInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  updateId?: InputMaybe<Scalars['Int']['input']>;
  visibility?: InputMaybe<Visibility>;
};

export type CreateReviewCommentInput = {
  commentId?: InputMaybe<Scalars['String']['input']>;
  decrementLikes?: InputMaybe<Scalars['Boolean']['input']>;
  incrementLikes?: InputMaybe<Scalars['Boolean']['input']>;
  /** The review this comment belongs to. */
  reviewId: Scalars['Int']['input'];
  shouldDelete?: InputMaybe<Scalars['Boolean']['input']>;
  text?: InputMaybe<Scalars['String']['input']>;
};

export type CreateUserNotificationPlatformInput = {
  apiToken?: InputMaybe<Scalars['String']['input']>;
  baseUrl?: InputMaybe<Scalars['String']['input']>;
  lot: UserNotificationSettingKind;
  priority?: InputMaybe<Scalars['Int']['input']>;
};

export type CreateUserSinkIntegrationInput = {
  lot: UserSinkIntegrationSettingKind;
};

export type CreateUserYankIntegrationInput = {
  baseUrl: Scalars['String']['input'];
  lot: UserYankIntegrationSettingKind;
  token: Scalars['String']['input'];
};

export type Creator = {
  extraInformation: CreatorExtraInformation;
  id: Scalars['Int']['output'];
  image?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type CreatorDetails = {
  contents: Array<CreatorDetailsGroupedByRole>;
  details: Creator;
};

export type CreatorDetailsGroupedByRole = {
  /** The media items in which this role was performed. */
  items: Array<PartialMetadata>;
  /** The name of the role performed. */
  name: Scalars['String']['output'];
};

export type CreatorExtraInformation = {
  active: Scalars['Boolean']['output'];
};

export type DeployGoodreadsImportInput = {
  rssUrl: Scalars['String']['input'];
};

export type DeployImportJobInput = {
  goodreads?: InputMaybe<DeployGoodreadsImportInput>;
  lot: ImportLot;
  mal?: InputMaybe<DeployMalImportInput>;
  mediaJson?: InputMaybe<DeployMediaJsonImportInput>;
  mediaTracker?: InputMaybe<DeployMediaTrackerImportInput>;
  movary?: InputMaybe<DeployMovaryImportInput>;
  source: ImportSource;
  storyGraph?: InputMaybe<DeployStoryGraphImportInput>;
  trakt?: InputMaybe<DeployTraktImportInput>;
};

export type DeployMalImportInput = {
  /** The anime export file path (uploaded via temporary upload). */
  animePath: Scalars['String']['input'];
  /** The manga export file path (uploaded via temporary upload). */
  mangaPath: Scalars['String']['input'];
};

export type DeployMediaJsonImportInput = {
  export: Scalars['String']['input'];
};

export type DeployMediaTrackerImportInput = {
  /** An application token generated by an admin */
  apiKey: Scalars['String']['input'];
  /** The base url where the resource is present at */
  apiUrl: Scalars['String']['input'];
};

export type DeployMovaryImportInput = {
  history: Scalars['String']['input'];
  ratings: Scalars['String']['input'];
  watchlist: Scalars['String']['input'];
};

export type DeployStoryGraphImportInput = {
  export: Scalars['String']['input'];
};

export type DeployTraktImportInput = {
  username: Scalars['String']['input'];
};

export type Exercise = {
  attributes: ExerciseAttributes;
  equipment?: Maybe<ExerciseEquipment>;
  force?: Maybe<ExerciseForce>;
  id: Scalars['Int']['output'];
  identifier: Scalars['String']['output'];
  level: ExerciseLevel;
  lot: ExerciseLot;
  mechanic?: Maybe<ExerciseMechanic>;
  name: Scalars['String']['output'];
};

export type ExerciseAttributes = {
  images: Array<Scalars['String']['output']>;
  instructions: Array<Scalars['String']['output']>;
  muscles: Array<ExerciseMuscle>;
};

export type ExerciseBestSetRecord = {
  data: WorkoutSetRecord;
  setIdx: Scalars['Int']['output'];
  workoutId: Scalars['String']['output'];
};

export enum ExerciseEquipment {
  Bands = 'BANDS',
  Barbell = 'BARBELL',
  BodyOnly = 'BODY_ONLY',
  Cable = 'CABLE',
  Dumbbell = 'DUMBBELL',
  ExerciseBall = 'EXERCISE_BALL',
  EzCurlBar = 'EZ_CURL_BAR',
  FoamRoll = 'FOAM_ROLL',
  Kettlebells = 'KETTLEBELLS',
  Machine = 'MACHINE',
  MedicineBall = 'MEDICINE_BALL',
  Other = 'OTHER'
}

export type ExerciseFilters = {
  equipment: Array<ExerciseEquipment>;
  force: Array<ExerciseForce>;
  level: Array<ExerciseLevel>;
  mechanic: Array<ExerciseMechanic>;
  muscle: Array<ExerciseMuscle>;
  type: Array<ExerciseLot>;
};

export enum ExerciseForce {
  Pull = 'PULL',
  Push = 'PUSH',
  Static = 'STATIC'
}

export enum ExerciseLevel {
  Beginner = 'BEGINNER',
  Expert = 'EXPERT',
  Intermediate = 'INTERMEDIATE'
}

export type ExerciseListFilter = {
  equipment?: InputMaybe<ExerciseEquipment>;
  force?: InputMaybe<ExerciseForce>;
  level?: InputMaybe<ExerciseLevel>;
  mechanic?: InputMaybe<ExerciseMechanic>;
  muscle?: InputMaybe<ExerciseMuscle>;
  type?: InputMaybe<ExerciseLot>;
};

export enum ExerciseLot {
  DistanceAndDuration = 'DISTANCE_AND_DURATION',
  Duration = 'DURATION',
  RepsAndWeight = 'REPS_AND_WEIGHT'
}

export enum ExerciseMechanic {
  Compound = 'COMPOUND',
  Isolation = 'ISOLATION'
}

export enum ExerciseMuscle {
  Abdominals = 'ABDOMINALS',
  Abductors = 'ABDUCTORS',
  Adductors = 'ADDUCTORS',
  Biceps = 'BICEPS',
  Calves = 'CALVES',
  Chest = 'CHEST',
  Forearms = 'FOREARMS',
  Glutes = 'GLUTES',
  Hamstrings = 'HAMSTRINGS',
  Lats = 'LATS',
  LowerBack = 'LOWER_BACK',
  MiddleBack = 'MIDDLE_BACK',
  Neck = 'NECK',
  Quadriceps = 'QUADRICEPS',
  Shoulders = 'SHOULDERS',
  Traps = 'TRAPS',
  Triceps = 'TRICEPS'
}

export type ExerciseParameters = {
  downloadRequired: Scalars['Boolean']['output'];
  /** All filters applicable to an exercises query. */
  filters: ExerciseFilters;
};

export type ExerciseSearchResults = {
  details: SearchDetails;
  items: Array<Exercise>;
};

export type ExercisesListInput = {
  filter?: InputMaybe<ExerciseListFilter>;
  page: Scalars['Int']['input'];
  query?: InputMaybe<Scalars['String']['input']>;
};

export type GeneralFeatures = {
  fileStorage: Scalars['Boolean']['output'];
  signupAllowed: Scalars['Boolean']['output'];
};

export type GraphqlMediaAssets = {
  images: Array<Scalars['String']['output']>;
  videos: Array<GraphqlVideoAsset>;
};

export type GraphqlMediaDetails = {
  animeSpecifics?: Maybe<AnimeSpecifics>;
  assets: GraphqlMediaAssets;
  audioBookSpecifics?: Maybe<AudioBookSpecifics>;
  bookSpecifics?: Maybe<BookSpecifics>;
  creators: Array<MetadataCreatorGroupedByRole>;
  description?: Maybe<Scalars['String']['output']>;
  genres: Array<Scalars['String']['output']>;
  group?: Maybe<GraphqlMediaGroup>;
  id: Scalars['Int']['output'];
  identifier: Scalars['String']['output'];
  isNsfw: Scalars['Boolean']['output'];
  lot: MetadataLot;
  mangaSpecifics?: Maybe<MangaSpecifics>;
  movieSpecifics?: Maybe<MovieSpecifics>;
  podcastSpecifics?: Maybe<PodcastSpecifics>;
  productionStatus: Scalars['String']['output'];
  providerRating?: Maybe<Scalars['Decimal']['output']>;
  publishDate?: Maybe<Scalars['NaiveDate']['output']>;
  publishYear?: Maybe<Scalars['Int']['output']>;
  showSpecifics?: Maybe<ShowSpecifics>;
  source: MetadataSource;
  sourceUrl?: Maybe<Scalars['String']['output']>;
  suggestions: Array<PartialMetadata>;
  title: Scalars['String']['output'];
  videoGameSpecifics?: Maybe<VideoGameSpecifics>;
  visualNovelSpecifics?: Maybe<VisualNovelSpecifics>;
};

export type GraphqlMediaGroup = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  part: Scalars['Int']['output'];
};

export type GraphqlUserIntegration = {
  description: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  lot: UserIntegrationLot;
  timestamp: Scalars['DateTime']['output'];
};

export type GraphqlUserNotificationPlatform = {
  description: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  timestamp: Scalars['DateTime']['output'];
};

export type GraphqlVideoAsset = {
  source: MetadataVideoSource;
  videoId: Scalars['String']['output'];
};

export type IdObject = {
  id: Scalars['Int']['output'];
};

export type ImportDetails = {
  total: Scalars['Int']['output'];
};

/** The various steps in which media importing can fail */
export enum ImportFailStep {
  /** Failed to transform the data into the required format */
  InputTransformation = 'INPUT_TRANSFORMATION',
  /** Failed to get details from the source itself (for eg: MediaTracker, Goodreads etc.) */
  ItemDetailsFromSource = 'ITEM_DETAILS_FROM_SOURCE',
  /** Failed to get metadata from the provider (for eg: Openlibrary, IGDB etc.) */
  MediaDetailsFromProvider = 'MEDIA_DETAILS_FROM_PROVIDER',
  /** Failed to save a review/rating item */
  ReviewConversion = 'REVIEW_CONVERSION',
  /** Failed to save a seen history item */
  SeenHistoryConversion = 'SEEN_HISTORY_CONVERSION'
}

export type ImportFailedItem = {
  error?: Maybe<Scalars['String']['output']>;
  identifier: Scalars['String']['output'];
  lot: MetadataLot;
  step: ImportFailStep;
};

export enum ImportLot {
  Exercise = 'EXERCISE',
  Media = 'MEDIA'
}

export type ImportOrExportItemReviewComment = {
  createdOn: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  /** The user ids of all those who liked it. */
  likedBy: Array<Scalars['Int']['output']>;
  text: Scalars['String']['output'];
  user: ReviewCommentUser;
};

export type ImportReport = {
  details?: Maybe<ImportResultResponse>;
  finishedOn?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['Int']['output'];
  source: ImportSource;
  startedOn: Scalars['DateTime']['output'];
  success?: Maybe<Scalars['Boolean']['output']>;
  userId: Scalars['Int']['output'];
};

export type ImportResultResponse = {
  failedItems: Array<ImportFailedItem>;
  import: ImportDetails;
};

export enum ImportSource {
  Goodreads = 'GOODREADS',
  Mal = 'MAL',
  MediaJson = 'MEDIA_JSON',
  MediaTracker = 'MEDIA_TRACKER',
  Movary = 'MOVARY',
  StoryGraph = 'STORY_GRAPH',
  Trakt = 'TRAKT'
}

export type LoginError = {
  error: LoginErrorVariant;
};

export enum LoginErrorVariant {
  CredentialsMismatch = 'CREDENTIALS_MISMATCH',
  UsernameDoesNotExist = 'USERNAME_DOES_NOT_EXIST'
}

export type LoginResponse = {
  apiKey: Scalars['String']['output'];
};

export type LoginResult = LoginError | LoginResponse;

export type MangaSpecifics = {
  chapters?: Maybe<Scalars['Int']['output']>;
  url?: Maybe<Scalars['String']['output']>;
  volumes?: Maybe<Scalars['Int']['output']>;
};

export type MangaSpecificsInput = {
  chapters?: InputMaybe<Scalars['Int']['input']>;
  url?: InputMaybe<Scalars['String']['input']>;
  volumes?: InputMaybe<Scalars['Int']['input']>;
};

export type MangaSummary = {
  chapters: Scalars['Int']['output'];
  read: Scalars['Int']['output'];
};

export type MediaCollectionContentsResults = {
  details: SearchDetails;
  items: Array<MediaSearchItemWithLot>;
};

export type MediaCreatorSearchItem = {
  id: Scalars['Int']['output'];
  image?: Maybe<Scalars['String']['output']>;
  mediaCount: Scalars['Int']['output'];
  name: Scalars['String']['output'];
};

export type MediaCreatorSearchResults = {
  details: SearchDetails;
  items: Array<MediaCreatorSearchItem>;
};

export type MediaFilter = {
  collection?: InputMaybe<Scalars['Int']['input']>;
  general?: InputMaybe<MediaGeneralFilter>;
};

export enum MediaGeneralFilter {
  All = 'ALL',
  Completed = 'COMPLETED',
  Dropped = 'DROPPED',
  ExplicitlyMonitored = 'EXPLICITLY_MONITORED',
  InProgress = 'IN_PROGRESS',
  OnAHold = 'ON_A_HOLD',
  Rated = 'RATED',
  Unrated = 'UNRATED',
  Unseen = 'UNSEEN'
}

export type MediaListInput = {
  filter?: InputMaybe<MediaFilter>;
  lot: MetadataLot;
  page: Scalars['Int']['input'];
  query?: InputMaybe<Scalars['String']['input']>;
  sort?: InputMaybe<MediaSortInput>;
};

export type MediaListItem = {
  averageRating?: Maybe<Scalars['Decimal']['output']>;
  data: MediaSearchItem;
};

export type MediaListResults = {
  details: SearchDetails;
  items: Array<MediaListItem>;
};

export type MediaSearchItem = {
  identifier: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  publishYear?: Maybe<Scalars['Int']['output']>;
  title: Scalars['String']['output'];
};

export type MediaSearchItemResponse = {
  databaseId?: Maybe<Scalars['Int']['output']>;
  item: MediaSearchItem;
};

export type MediaSearchItemWithLot = {
  details: MediaSearchItem;
  lot: MetadataLot;
};

export type MediaSearchResults = {
  details: SearchDetails;
  items: Array<MediaSearchItemResponse>;
};

export enum MediaSortBy {
  LastSeen = 'LAST_SEEN',
  LastUpdated = 'LAST_UPDATED',
  Rating = 'RATING',
  ReleaseDate = 'RELEASE_DATE',
  Title = 'TITLE'
}

export type MediaSortInput = {
  by?: MediaSortBy;
  order?: MediaSortOrder;
};

export enum MediaSortOrder {
  Asc = 'ASC',
  Desc = 'DESC'
}

export type MetadataCreatorGroupedByRole = {
  items: Array<Creator>;
  name: Scalars['String']['output'];
};

export type MetadataGroup = {
  description?: Maybe<Scalars['String']['output']>;
  displayImages: Array<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  identifier: Scalars['String']['output'];
  lot: MetadataLot;
  parts: Scalars['Int']['output'];
  source: MetadataSource;
  title: Scalars['String']['output'];
};

export type MetadataGroupDetails = {
  contents: Array<PartialMetadata>;
  details: MetadataGroup;
  sourceUrl?: Maybe<Scalars['String']['output']>;
};

export type MetadataGroupListItem = {
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  image?: Maybe<Scalars['String']['output']>;
  lot: MetadataLot;
  parts: Scalars['Int']['output'];
  title: Scalars['String']['output'];
};

export type MetadataGroupListResults = {
  details: SearchDetails;
  items: Array<MetadataGroupListItem>;
};

export enum MetadataLot {
  Anime = 'ANIME',
  AudioBook = 'AUDIO_BOOK',
  Book = 'BOOK',
  Manga = 'MANGA',
  Movie = 'MOVIE',
  Podcast = 'PODCAST',
  Show = 'SHOW',
  VideoGame = 'VIDEO_GAME',
  VisualNovel = 'VISUAL_NOVEL'
}

export enum MetadataSource {
  Anilist = 'ANILIST',
  Audible = 'AUDIBLE',
  Custom = 'CUSTOM',
  GoogleBooks = 'GOOGLE_BOOKS',
  Igdb = 'IGDB',
  Itunes = 'ITUNES',
  Listennotes = 'LISTENNOTES',
  Mal = 'MAL',
  MangaUpdates = 'MANGA_UPDATES',
  Openlibrary = 'OPENLIBRARY',
  Tmdb = 'TMDB',
  Vndb = 'VNDB'
}

export enum MetadataVideoSource {
  Custom = 'CUSTOM',
  Dailymotion = 'DAILYMOTION',
  Youtube = 'YOUTUBE'
}

export type MovieSpecifics = {
  runtime?: Maybe<Scalars['Int']['output']>;
};

export type MovieSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']['input']>;
};

export type MoviesSummary = {
  runtime: Scalars['Int']['output'];
  watched: Scalars['Int']['output'];
};

export type MutationRoot = {
  /** Add a media item to a collection if it is not there, otherwise do nothing. */
  addMediaToCollection: Scalars['Boolean']['output'];
  /** Update progress in bulk. */
  bulkProgressUpdate: Scalars['Boolean']['output'];
  /** Fetch details about a media and create a media item in the database. */
  commitMedia: IdObject;
  /** Create a custom media item. */
  createCustomMedia: CreateCustomMediaResult;
  /** Create or update a reminder on a media for a user. */
  createMediaReminder: Scalars['Boolean']['output'];
  /** Create a new collection for the logged in user or edit details of an existing one. */
  createOrUpdateCollection: IdObject;
  /** Create, like or delete a comment on a review. */
  createReviewComment: Scalars['Boolean']['output'];
  /** Create a user measurement. */
  createUserMeasurement: Scalars['DateTime']['output'];
  /** Add a notification platform for the currently logged in user. */
  createUserNotificationPlatform: Scalars['Int']['output'];
  /** Create a sink based integrations for the currently logged in user. */
  createUserSinkIntegration: Scalars['Int']['output'];
  /** Take a user workout, process it and commit it to database. */
  createUserWorkout: Scalars['String']['output'];
  /** Create a yank based integrations for the currently logged in user. */
  createUserYankIntegration: Scalars['Int']['output'];
  /** Delete a collection. */
  deleteCollection: Scalars['Boolean']['output'];
  /** Delete a reminder on a media for a user if it exists. */
  deleteMediaReminder: Scalars['Boolean']['output'];
  /** Delete a review if it belongs to the currently logged in user. */
  deleteReview: Scalars['Boolean']['output'];
  /** Delete a seen item from a user's history. */
  deleteSeenItem: IdObject;
  /** Delete a user. The account making the user must an `Admin`. */
  deleteUser: Scalars['Boolean']['output'];
  /** Delete an integration for the currently logged in user. */
  deleteUserIntegration: Scalars['Boolean']['output'];
  /** Delete a user measurement. */
  deleteUserMeasurement: Scalars['Boolean']['output'];
  /** Delete a notification platform for the currently logged in user. */
  deleteUserNotificationPlatform: Scalars['Boolean']['output'];
  /** Add job to import data from various sources. */
  deployImportJob: Scalars['String']['output'];
  /** Deploy a job to download and update the exercise library. */
  deployUpdateExerciseLibraryJob: Scalars['Int']['output'];
  /** Deploy a job to update a media item's metadata. */
  deployUpdateMetadataJob: Scalars['String']['output'];
  /** Generate an auth token without any expiry. */
  generateAuthToken: Scalars['String']['output'];
  /** Login a user using their username and password and return an auth token. */
  loginUser: LoginResult;
  /** Logout a user from the server and delete their login token. */
  logoutUser: Scalars['Boolean']['output'];
  /**
   * Merge a media item into another. This will move all `seen`, `collection`
   * and `review` associations with the new user and then delete the old media
   * item completely.
   */
  mergeMetadata: Scalars['Boolean']['output'];
  /** Create or update a review. */
  postReview: IdObject;
  /** Get a presigned URL (valid for 10 minutes) for a given file name. */
  presignedPutUrl: PresignedPutUrlResponse;
  /** Mark a user's progress on a specific media item. */
  progressUpdate: ProgressUpdateResultUnion;
  /** Delete all summaries for the currently logged in user and then generate one from scratch. */
  regenerateUserSummary: Scalars['Boolean']['output'];
  /**
   * Create a new user for the service. Also set their `lot` as admin if
   * they are the first user.
   */
  registerUser: RegisterResult;
  /** Remove a media item from a collection if it is not there, otherwise do nothing. */
  removeMediaFromCollection: IdObject;
  /** Test all notification platforms for the currently logged in user. */
  testUserNotificationPlatforms: Scalars['Boolean']['output'];
  /** Toggle the monitor on a media for a user. */
  toggleMediaMonitor: Scalars['Boolean']['output'];
  /** Deploy jobs to update all media item's metadata. */
  updateAllMetadata: Scalars['Boolean']['output'];
  /** Update a user's profile details. */
  updateUser: IdObject;
  /** Change a user's preferences. */
  updateUserPreference: Scalars['Boolean']['output'];
  /** Yank data from all integrations for the currently logged in user. */
  yankIntegrationData: Scalars['Int']['output'];
};


export type MutationRootAddMediaToCollectionArgs = {
  input: AddMediaToCollection;
};


export type MutationRootBulkProgressUpdateArgs = {
  input: Array<ProgressUpdateInput>;
};


export type MutationRootCommitMediaArgs = {
  identifier: Scalars['String']['input'];
  lot: MetadataLot;
  source: MetadataSource;
};


export type MutationRootCreateCustomMediaArgs = {
  input: CreateCustomMediaInput;
};


export type MutationRootCreateMediaReminderArgs = {
  input: CreateMediaReminderInput;
};


export type MutationRootCreateOrUpdateCollectionArgs = {
  input: CreateOrUpdateCollectionInput;
};


export type MutationRootCreateReviewCommentArgs = {
  input: CreateReviewCommentInput;
};


export type MutationRootCreateUserMeasurementArgs = {
  input: UserMeasurementInput;
};


export type MutationRootCreateUserNotificationPlatformArgs = {
  input: CreateUserNotificationPlatformInput;
};


export type MutationRootCreateUserSinkIntegrationArgs = {
  input: CreateUserSinkIntegrationInput;
};


export type MutationRootCreateUserWorkoutArgs = {
  input: UserWorkoutInput;
};


export type MutationRootCreateUserYankIntegrationArgs = {
  input: CreateUserYankIntegrationInput;
};


export type MutationRootDeleteCollectionArgs = {
  collectionName: Scalars['String']['input'];
};


export type MutationRootDeleteMediaReminderArgs = {
  metadataId: Scalars['Int']['input'];
};


export type MutationRootDeleteReviewArgs = {
  reviewId: Scalars['Int']['input'];
};


export type MutationRootDeleteSeenItemArgs = {
  seenId: Scalars['Int']['input'];
};


export type MutationRootDeleteUserArgs = {
  toDeleteUserId: Scalars['Int']['input'];
};


export type MutationRootDeleteUserIntegrationArgs = {
  integrationId: Scalars['Int']['input'];
  integrationLot: UserIntegrationLot;
};


export type MutationRootDeleteUserMeasurementArgs = {
  timestamp: Scalars['DateTime']['input'];
};


export type MutationRootDeleteUserNotificationPlatformArgs = {
  notificationId: Scalars['Int']['input'];
};


export type MutationRootDeployImportJobArgs = {
  input: DeployImportJobInput;
};


export type MutationRootDeployUpdateMetadataJobArgs = {
  metadataId: Scalars['Int']['input'];
};


export type MutationRootLoginUserArgs = {
  input: UserInput;
};


export type MutationRootMergeMetadataArgs = {
  mergeFrom: Scalars['Int']['input'];
  mergeInto: Scalars['Int']['input'];
};


export type MutationRootPostReviewArgs = {
  input: PostReviewInput;
};


export type MutationRootPresignedPutUrlArgs = {
  fileName: Scalars['String']['input'];
};


export type MutationRootProgressUpdateArgs = {
  input: ProgressUpdateInput;
};


export type MutationRootRegisterUserArgs = {
  input: UserInput;
};


export type MutationRootRemoveMediaFromCollectionArgs = {
  collectionName: Scalars['String']['input'];
  metadataId: Scalars['Int']['input'];
};


export type MutationRootToggleMediaMonitorArgs = {
  toMonitorMetadataId: Scalars['Int']['input'];
};


export type MutationRootUpdateUserArgs = {
  input: UpdateUserInput;
};


export type MutationRootUpdateUserPreferenceArgs = {
  input: UpdateUserPreferenceInput;
};

export type PartialMetadata = {
  identifier: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  lot: MetadataLot;
  metadataId?: Maybe<Scalars['Int']['output']>;
  source: MetadataSource;
  title: Scalars['String']['output'];
};

export type PodcastEpisode = {
  id: Scalars['String']['output'];
  number: Scalars['Int']['output'];
  overview?: Maybe<Scalars['String']['output']>;
  publishDate: Scalars['Int']['output'];
  runtime?: Maybe<Scalars['Int']['output']>;
  thumbnail?: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
};

export type PodcastEpisodeInput = {
  id: Scalars['String']['input'];
  number: Scalars['Int']['input'];
  overview?: InputMaybe<Scalars['String']['input']>;
  publishDate: Scalars['Int']['input'];
  runtime?: InputMaybe<Scalars['Int']['input']>;
  thumbnail?: InputMaybe<Scalars['String']['input']>;
  title: Scalars['String']['input'];
};

export type PodcastSpecifics = {
  episodes: Array<PodcastEpisode>;
  totalEpisodes: Scalars['Int']['output'];
};

export type PodcastSpecificsInput = {
  episodes: Array<PodcastEpisodeInput>;
  totalEpisodes: Scalars['Int']['input'];
};

export type PodcastsSummary = {
  played: Scalars['Int']['output'];
  playedEpisodes: Scalars['Int']['output'];
  runtime: Scalars['Int']['output'];
};

export type PostReviewInput = {
  creatorId?: InputMaybe<Scalars['Int']['input']>;
  date?: InputMaybe<Scalars['DateTime']['input']>;
  metadataId?: InputMaybe<Scalars['Int']['input']>;
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  rating?: InputMaybe<Scalars['Decimal']['input']>;
  /** ID of the review if this is an update to an existing review */
  reviewId?: InputMaybe<Scalars['Int']['input']>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
  spoiler?: InputMaybe<Scalars['Boolean']['input']>;
  text?: InputMaybe<Scalars['String']['input']>;
  visibility?: InputMaybe<Visibility>;
};

export type PresignedPutUrlResponse = {
  key: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

export type ProgressUpdateError = {
  error: ProgressUpdateErrorVariant;
};

export enum ProgressUpdateErrorVariant {
  AlreadySeen = 'ALREADY_SEEN',
  InvalidUpdate = 'INVALID_UPDATE',
  NoSeenInProgress = 'NO_SEEN_IN_PROGRESS'
}

export type ProgressUpdateInput = {
  changeState?: InputMaybe<SeenState>;
  date?: InputMaybe<Scalars['NaiveDate']['input']>;
  metadataId: Scalars['Int']['input'];
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  progress?: InputMaybe<Scalars['Int']['input']>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
};

export type ProgressUpdateResultUnion = IdObject | ProgressUpdateError;

export type ProviderLanguageInformation = {
  default: Scalars['String']['output'];
  source: MetadataSource;
  supported: Array<Scalars['String']['output']>;
};

export type QueryRoot = {
  /** Get the contents of a collection and respect visibility. */
  collectionContents: CollectionContents;
  /** Get all collections for the currently logged in user. */
  collections: Array<CollectionItem>;
  /** Get some primary information about the service. */
  coreDetails: CoreDetails;
  /** Get all the features that are enabled for the service */
  coreEnabledFeatures: GeneralFeatures;
  /** Get details about a creator present in the database. */
  creatorDetails: CreatorDetails;
  /** Get paginated list of creators. */
  creatorsList: MediaCreatorSearchResults;
  /** Get details about an exercise. */
  exerciseDetails: Exercise;
  /** Get all the parameters related to exercises. */
  exerciseParameters: ExerciseParameters;
  /** Get a paginated list of exercises in the database. */
  exercisesList: ExerciseSearchResults;
  /** Get a presigned URL (valid for 90 minutes) for a given key. */
  getPresignedUrl: Scalars['String']['output'];
  /** Get all the import jobs deployed by the user. */
  importReports: Array<ImportReport>;
  /** Get a summary of all the media items that have been consumed by this user. */
  latestUserSummary: UserSummary;
  /** Get details about a media present in the database. */
  mediaDetails: GraphqlMediaDetails;
  /** Get all the media items related to a user for a specific media type. */
  mediaList: MediaListResults;
  /** Search for a list of media for a given type. */
  mediaSearch: MediaSearchResults;
  /** Get all the metadata sources possible for a lot. */
  mediaSourcesForLot: Array<MetadataSource>;
  /** Get details about a metadata group present in the database. */
  metadataGroupDetails: MetadataGroupDetails;
  /** Get paginated list of metadata groups. */
  metadataGroupsList: MetadataGroupListResults;
  /** Get all languages supported by all the providers. */
  providersLanguageInformation: Array<ProviderLanguageInformation>;
  /** Get a review by its ID. */
  review: ReviewItem;
  /** Get details that can be displayed to a user for a creator. */
  userCreatorDetails: UserCreatorDetails;
  /** Get details about the currently logged in user. */
  userDetails: UserDetailsResult;
  /** Get information about an exercise for a user. */
  userExerciseDetails?: Maybe<UserExerciseInformation>;
  /** Get all the integrations for the currently logged in user. */
  userIntegrations: Array<GraphqlUserIntegration>;
  /** Get all the measurements for a user. */
  userMeasurementsList: Array<UserMeasurement>;
  /** Get details that can be displayed to a user for a media. */
  userMediaDetails: UserMediaDetails;
  /** Get all the notification platforms for the currently logged in user. */
  userNotificationPlatforms: Array<GraphqlUserNotificationPlatform>;
  /** Get a user's preferences. */
  userPreferences: UserPreferences;
  /** Get details about all the users in the service. */
  usersList: Array<User>;
};


export type QueryRootCollectionContentsArgs = {
  input: CollectionContentsInput;
};


export type QueryRootCollectionsArgs = {
  input?: InputMaybe<CollectionInput>;
};


export type QueryRootCreatorDetailsArgs = {
  creatorId: Scalars['Int']['input'];
};


export type QueryRootCreatorsListArgs = {
  input: SearchInput;
};


export type QueryRootExerciseDetailsArgs = {
  exerciseId: Scalars['Int']['input'];
};


export type QueryRootExercisesListArgs = {
  input: ExercisesListInput;
};


export type QueryRootGetPresignedUrlArgs = {
  key: Scalars['String']['input'];
};


export type QueryRootMediaDetailsArgs = {
  metadataId: Scalars['Int']['input'];
};


export type QueryRootMediaListArgs = {
  input: MediaListInput;
};


export type QueryRootMediaSearchArgs = {
  input: SearchInput;
  lot: MetadataLot;
  source: MetadataSource;
};


export type QueryRootMediaSourcesForLotArgs = {
  lot: MetadataLot;
};


export type QueryRootMetadataGroupDetailsArgs = {
  metadataGroupId: Scalars['Int']['input'];
};


export type QueryRootMetadataGroupsListArgs = {
  input: SearchInput;
};


export type QueryRootReviewArgs = {
  reviewId: Scalars['Int']['input'];
};


export type QueryRootUserCreatorDetailsArgs = {
  creatorId: Scalars['Int']['input'];
};


export type QueryRootUserExerciseDetailsArgs = {
  exerciseId: Scalars['Int']['input'];
};


export type QueryRootUserMeasurementsListArgs = {
  input: UserMeasurementsListInput;
};


export type QueryRootUserMediaDetailsArgs = {
  metadataId: Scalars['Int']['input'];
};

export type RegisterError = {
  error: RegisterErrorVariant;
};

export enum RegisterErrorVariant {
  Disabled = 'DISABLED',
  UsernameAlreadyExists = 'USERNAME_ALREADY_EXISTS'
}

export type RegisterResult = IdObject | RegisterError;

export type ReviewCommentUser = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
};

export type ReviewItem = {
  comments: Array<ImportOrExportItemReviewComment>;
  id: Scalars['Int']['output'];
  podcastEpisode?: Maybe<Scalars['Int']['output']>;
  postedBy: ReviewPostedBy;
  postedOn: Scalars['DateTime']['output'];
  rating?: Maybe<Scalars['Decimal']['output']>;
  showEpisode?: Maybe<Scalars['Int']['output']>;
  showSeason?: Maybe<Scalars['Int']['output']>;
  spoiler: Scalars['Boolean']['output'];
  text?: Maybe<Scalars['String']['output']>;
  visibility: Visibility;
};

export type ReviewPostedBy = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
};

export type SearchDetails = {
  nextPage?: Maybe<Scalars['Int']['output']>;
  total: Scalars['Int']['output'];
};

export type SearchInput = {
  page?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
};

export type Seen = {
  finishedOn?: Maybe<Scalars['NaiveDate']['output']>;
  id: Scalars['Int']['output'];
  lastUpdatedOn: Scalars['DateTime']['output'];
  metadataId: Scalars['Int']['output'];
  podcastInformation?: Maybe<SeenPodcastExtraInformation>;
  progress: Scalars['Int']['output'];
  showInformation?: Maybe<SeenShowExtraInformation>;
  startedOn?: Maybe<Scalars['NaiveDate']['output']>;
  state: SeenState;
  userId: Scalars['Int']['output'];
};

export type SeenPodcastExtraInformation = {
  episode: Scalars['Int']['output'];
};

export type SeenShowExtraInformation = {
  episode: Scalars['Int']['output'];
  season: Scalars['Int']['output'];
};

export enum SeenState {
  Completed = 'COMPLETED',
  Dropped = 'DROPPED',
  InProgress = 'IN_PROGRESS',
  OnAHold = 'ON_A_HOLD'
}

export enum SetLot {
  Drop = 'DROP',
  Failure = 'FAILURE',
  Normal = 'NORMAL',
  WarmUp = 'WARM_UP'
}

export type SetStatistic = {
  distance?: Maybe<Scalars['Decimal']['output']>;
  duration?: Maybe<Scalars['Decimal']['output']>;
  reps?: Maybe<Scalars['Int']['output']>;
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type SetStatisticInput = {
  distance?: InputMaybe<Scalars['Decimal']['input']>;
  duration?: InputMaybe<Scalars['Decimal']['input']>;
  reps?: InputMaybe<Scalars['Int']['input']>;
  weight?: InputMaybe<Scalars['Decimal']['input']>;
};

export type ShowEpisode = {
  episodeNumber: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  overview?: Maybe<Scalars['String']['output']>;
  posterImages: Array<Scalars['String']['output']>;
  publishDate?: Maybe<Scalars['NaiveDate']['output']>;
  runtime?: Maybe<Scalars['Int']['output']>;
};

export type ShowEpisodeSpecificsInput = {
  episodeNumber: Scalars['Int']['input'];
  id: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  overview?: InputMaybe<Scalars['String']['input']>;
  posterImages: Array<Scalars['String']['input']>;
  publishDate?: InputMaybe<Scalars['NaiveDate']['input']>;
  runtime?: InputMaybe<Scalars['Int']['input']>;
};

export type ShowSeason = {
  backdropImages: Array<Scalars['String']['output']>;
  episodes: Array<ShowEpisode>;
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  overview?: Maybe<Scalars['String']['output']>;
  posterImages: Array<Scalars['String']['output']>;
  publishDate?: Maybe<Scalars['NaiveDate']['output']>;
  seasonNumber: Scalars['Int']['output'];
};

export type ShowSeasonSpecificsInput = {
  backdropImages: Array<Scalars['String']['input']>;
  episodes: Array<ShowEpisodeSpecificsInput>;
  id: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  overview?: InputMaybe<Scalars['String']['input']>;
  posterImages: Array<Scalars['String']['input']>;
  publishDate?: InputMaybe<Scalars['NaiveDate']['input']>;
  seasonNumber: Scalars['Int']['input'];
};

export type ShowSpecifics = {
  seasons: Array<ShowSeason>;
};

export type ShowSpecificsInput = {
  seasons: Array<ShowSeasonSpecificsInput>;
};

export type ShowsSummary = {
  runtime: Scalars['Int']['output'];
  watched: Scalars['Int']['output'];
  watchedEpisodes: Scalars['Int']['output'];
  watchedSeasons: Scalars['Int']['output'];
};

export type TotalMeasurement = {
  distance: Scalars['Decimal']['output'];
  duration: Scalars['Decimal']['output'];
  /** The number of personal bests achieved. */
  personalBestsAchieved: Scalars['Int']['output'];
  reps: Scalars['Int']['output'];
  weight: Scalars['Decimal']['output'];
};

export type UpdateUserInput = {
  email?: InputMaybe<Scalars['String']['input']>;
  password?: InputMaybe<Scalars['String']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserPreferenceInput = {
  property: Scalars['String']['input'];
  value: Scalars['String']['input'];
};

export enum UpgradeType {
  Major = 'MAJOR',
  Minor = 'MINOR'
}

export type User = {
  email?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  lot: UserLot;
  name: Scalars['String']['output'];
};

export type UserCreatorDetails = {
  reviews: Array<ReviewItem>;
};

export type UserCustomMeasurement = {
  dataType: UserCustomMeasurementDataType;
  name: Scalars['String']['output'];
};

export enum UserCustomMeasurementDataType {
  Decimal = 'DECIMAL'
}

export type UserDetailsError = {
  error: UserDetailsErrorVariant;
};

export enum UserDetailsErrorVariant {
  AuthTokenInvalid = 'AUTH_TOKEN_INVALID'
}

export type UserDetailsResult = User | UserDetailsError;

export type UserExerciseHistoryInformation = {
  sets: Array<WorkoutSetRecord>;
  workoutId: Scalars['String']['output'];
  workoutName?: Maybe<Scalars['String']['output']>;
  workoutTime: Scalars['DateTime']['output'];
};

export type UserExerciseInformation = {
  details: UserToExercise;
  history: Array<UserExerciseHistoryInformation>;
};

export type UserExerciseInput = {
  exerciseId: Scalars['Int']['input'];
  notes: Array<Scalars['String']['input']>;
  restTime?: InputMaybe<Scalars['Int']['input']>;
  sets: Array<UserWorkoutSetRecord>;
};

export type UserExercisePreferences = {
  saveHistory: Scalars['Int']['output'];
  unitSystem: UserUnitSystem;
};

export type UserFeaturesEnabledPreferences = {
  fitness: UserFitnessFeaturesEnabledPreferences;
  media: UserMediaFeaturesEnabledPreferences;
};

export type UserFitnessFeaturesEnabledPreferences = {
  enabled: Scalars['Boolean']['output'];
  measurements: Scalars['Boolean']['output'];
};

export type UserFitnessPreferences = {
  exercises: UserExercisePreferences;
  measurements: UserMeasurementsPreferences;
};

export type UserFitnessSummary = {
  measurementsRecorded: Scalars['Int']['output'];
  workoutsRecorded: Scalars['Int']['output'];
};

export type UserGeneralPreferences = {
  displayNsfw: Scalars['Boolean']['output'];
  reviewScale: UserReviewScale;
};

export type UserInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export enum UserIntegrationLot {
  Sink = 'SINK',
  Yank = 'YANK'
}

export enum UserLot {
  Admin = 'ADMIN',
  Normal = 'NORMAL'
}

export type UserMeasurement = {
  comment?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  stats: UserMeasurementStats;
  timestamp: Scalars['DateTime']['output'];
};

export type UserMeasurementDataInput = {
  abdominalSkinfold?: InputMaybe<Scalars['Decimal']['input']>;
  basalMetabolicRate?: InputMaybe<Scalars['Decimal']['input']>;
  bicepsCircumference?: InputMaybe<Scalars['Decimal']['input']>;
  bodyFat?: InputMaybe<Scalars['Decimal']['input']>;
  bodyFatCaliper?: InputMaybe<Scalars['Decimal']['input']>;
  bodyMassIndex?: InputMaybe<Scalars['Decimal']['input']>;
  boneMass?: InputMaybe<Scalars['Decimal']['input']>;
  calories?: InputMaybe<Scalars['Decimal']['input']>;
  chestCircumference?: InputMaybe<Scalars['Decimal']['input']>;
  chestSkinfold?: InputMaybe<Scalars['Decimal']['input']>;
  custom?: InputMaybe<Scalars['JSONObject']['input']>;
  hipCircumference?: InputMaybe<Scalars['Decimal']['input']>;
  leanBodyMass?: InputMaybe<Scalars['Decimal']['input']>;
  muscle?: InputMaybe<Scalars['Decimal']['input']>;
  neckCircumference?: InputMaybe<Scalars['Decimal']['input']>;
  thighCircumference?: InputMaybe<Scalars['Decimal']['input']>;
  thighSkinfold?: InputMaybe<Scalars['Decimal']['input']>;
  totalBodyWater?: InputMaybe<Scalars['Decimal']['input']>;
  totalDailyEnergyExpenditure?: InputMaybe<Scalars['Decimal']['input']>;
  visceralFat?: InputMaybe<Scalars['Decimal']['input']>;
  waistCircumference?: InputMaybe<Scalars['Decimal']['input']>;
  waistToHeightRatio?: InputMaybe<Scalars['Decimal']['input']>;
  waistToHipRatio?: InputMaybe<Scalars['Decimal']['input']>;
  weight?: InputMaybe<Scalars['Decimal']['input']>;
};

export type UserMeasurementInput = {
  comment?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  stats: UserMeasurementDataInput;
  timestamp: Scalars['DateTime']['input'];
};

export type UserMeasurementStats = {
  abdominalSkinfold?: Maybe<Scalars['Decimal']['output']>;
  basalMetabolicRate?: Maybe<Scalars['Decimal']['output']>;
  bicepsCircumference?: Maybe<Scalars['Decimal']['output']>;
  bodyFat?: Maybe<Scalars['Decimal']['output']>;
  bodyFatCaliper?: Maybe<Scalars['Decimal']['output']>;
  bodyMassIndex?: Maybe<Scalars['Decimal']['output']>;
  boneMass?: Maybe<Scalars['Decimal']['output']>;
  calories?: Maybe<Scalars['Decimal']['output']>;
  chestCircumference?: Maybe<Scalars['Decimal']['output']>;
  chestSkinfold?: Maybe<Scalars['Decimal']['output']>;
  custom?: Maybe<Scalars['JSONObject']['output']>;
  hipCircumference?: Maybe<Scalars['Decimal']['output']>;
  leanBodyMass?: Maybe<Scalars['Decimal']['output']>;
  muscle?: Maybe<Scalars['Decimal']['output']>;
  neckCircumference?: Maybe<Scalars['Decimal']['output']>;
  thighCircumference?: Maybe<Scalars['Decimal']['output']>;
  thighSkinfold?: Maybe<Scalars['Decimal']['output']>;
  totalBodyWater?: Maybe<Scalars['Decimal']['output']>;
  totalDailyEnergyExpenditure?: Maybe<Scalars['Decimal']['output']>;
  visceralFat?: Maybe<Scalars['Decimal']['output']>;
  waistCircumference?: Maybe<Scalars['Decimal']['output']>;
  waistToHeightRatio?: Maybe<Scalars['Decimal']['output']>;
  waistToHipRatio?: Maybe<Scalars['Decimal']['output']>;
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type UserMeasurementsInBuiltPreferences = {
  abdominalSkinfold: Scalars['Boolean']['output'];
  basalMetabolicRate: Scalars['Boolean']['output'];
  bicepsCircumference: Scalars['Boolean']['output'];
  bodyFat: Scalars['Boolean']['output'];
  bodyFatCaliper: Scalars['Boolean']['output'];
  bodyMassIndex: Scalars['Boolean']['output'];
  boneMass: Scalars['Boolean']['output'];
  calories: Scalars['Boolean']['output'];
  chestCircumference: Scalars['Boolean']['output'];
  chestSkinfold: Scalars['Boolean']['output'];
  hipCircumference: Scalars['Boolean']['output'];
  leanBodyMass: Scalars['Boolean']['output'];
  muscle: Scalars['Boolean']['output'];
  neckCircumference: Scalars['Boolean']['output'];
  thighCircumference: Scalars['Boolean']['output'];
  thighSkinfold: Scalars['Boolean']['output'];
  totalBodyWater: Scalars['Boolean']['output'];
  totalDailyEnergyExpenditure: Scalars['Boolean']['output'];
  visceralFat: Scalars['Boolean']['output'];
  waistCircumference: Scalars['Boolean']['output'];
  waistToHeightRatio: Scalars['Boolean']['output'];
  waistToHipRatio: Scalars['Boolean']['output'];
  weight: Scalars['Boolean']['output'];
};

export type UserMeasurementsListInput = {
  endTime?: InputMaybe<Scalars['DateTime']['input']>;
  startTime?: InputMaybe<Scalars['DateTime']['input']>;
};

export type UserMeasurementsPreferences = {
  custom: Array<UserCustomMeasurement>;
  inbuilt: UserMeasurementsInBuiltPreferences;
};

export type UserMediaDetails = {
  /** The average rating of this media in this service. */
  averageRating?: Maybe<Scalars['Decimal']['output']>;
  /** The collections in which this media is present. */
  collections: Array<Collection>;
  /** The seen history of this media. */
  history: Array<Seen>;
  /** The seen item if it is in progress. */
  inProgress?: Maybe<Seen>;
  /** Whether the user is monitoring this media. */
  isMonitored: Scalars['Boolean']['output'];
  /** The next episode of this media. */
  nextEpisode?: Maybe<UserMediaNextEpisode>;
  /** The reminder that the user has set for this media. */
  reminder?: Maybe<UserMediaReminder>;
  /** The public reviews of this media. */
  reviews: Array<ReviewItem>;
  /** The number of users who have seen this media. */
  seenBy: Scalars['Int']['output'];
};

export type UserMediaFeaturesEnabledPreferences = {
  anime: Scalars['Boolean']['output'];
  audioBook: Scalars['Boolean']['output'];
  book: Scalars['Boolean']['output'];
  enabled: Scalars['Boolean']['output'];
  manga: Scalars['Boolean']['output'];
  movie: Scalars['Boolean']['output'];
  podcast: Scalars['Boolean']['output'];
  show: Scalars['Boolean']['output'];
  videoGame: Scalars['Boolean']['output'];
  visualNovel: Scalars['Boolean']['output'];
};

export type UserMediaNextEpisode = {
  episodeNumber?: Maybe<Scalars['Int']['output']>;
  seasonNumber?: Maybe<Scalars['Int']['output']>;
};

export type UserMediaReminder = {
  message: Scalars['String']['output'];
  remindOn: Scalars['NaiveDate']['output'];
};

export type UserMediaSummary = {
  anime: AnimeSummary;
  audioBooks: AudioBooksSummary;
  books: BooksSummary;
  creatorsInteractedWith: Scalars['Int']['output'];
  manga: MangaSummary;
  movies: MoviesSummary;
  podcasts: PodcastsSummary;
  reviewsPosted: Scalars['Int']['output'];
  shows: ShowsSummary;
  videoGames: VideoGamesSummary;
  visualNovels: VisualNovelsSummary;
};

export enum UserNotificationSettingKind {
  Apprise = 'APPRISE',
  Discord = 'DISCORD',
  Gotify = 'GOTIFY',
  Ntfy = 'NTFY',
  PushBullet = 'PUSH_BULLET',
  PushOver = 'PUSH_OVER',
  PushSafer = 'PUSH_SAFER'
}

export type UserNotificationsPreferences = {
  episodeNameChanged: Scalars['Boolean']['output'];
  episodeReleased: Scalars['Boolean']['output'];
  numberOfSeasonsChanged: Scalars['Boolean']['output'];
  releaseDateChanged: Scalars['Boolean']['output'];
  statusChanged: Scalars['Boolean']['output'];
};

export type UserPreferences = {
  featuresEnabled: UserFeaturesEnabledPreferences;
  fitness: UserFitnessPreferences;
  general: UserGeneralPreferences;
  notifications: UserNotificationsPreferences;
};

export enum UserReviewScale {
  OutOfFive = 'OUT_OF_FIVE',
  OutOfHundred = 'OUT_OF_HUNDRED'
}

export enum UserSinkIntegrationSettingKind {
  Jellyfin = 'JELLYFIN',
  Kodi = 'KODI',
  Plex = 'PLEX'
}

export type UserSummary = {
  calculatedOn: Scalars['DateTime']['output'];
  fitness: UserFitnessSummary;
  media: UserMediaSummary;
};

export type UserToExercise = {
  exerciseId: Scalars['Int']['output'];
  extraInformation: UserToExerciseExtraInformation;
  lastUpdatedOn: Scalars['DateTime']['output'];
  numTimesPerformed: Scalars['Int']['output'];
};

export type UserToExerciseBestSetExtraInformation = {
  lot: WorkoutSetPersonalBest;
  sets: Array<ExerciseBestSetRecord>;
};

export type UserToExerciseExtraInformation = {
  history: Array<UserToExerciseHistoryExtraInformation>;
  lifetimeStats: TotalMeasurement;
  personalBests: Array<UserToExerciseBestSetExtraInformation>;
};

export type UserToExerciseHistoryExtraInformation = {
  idx: Scalars['Int']['output'];
  workoutId: Scalars['String']['output'];
};

export enum UserUnitSystem {
  Imperial = 'IMPERIAL',
  Metric = 'METRIC'
}

export type UserWorkoutInput = {
  comment?: InputMaybe<Scalars['String']['input']>;
  endTime: Scalars['DateTime']['input'];
  exercises: Array<UserExerciseInput>;
  name?: InputMaybe<Scalars['String']['input']>;
  startTime: Scalars['DateTime']['input'];
  supersets: Array<Array<Scalars['Int']['input']>>;
};

export type UserWorkoutSetRecord = {
  lot: SetLot;
  statistic: SetStatisticInput;
};

export enum UserYankIntegrationSettingKind {
  Audiobookshelf = 'AUDIOBOOKSHELF'
}

export type VideoGameSpecifics = {
  platforms: Array<Scalars['String']['output']>;
};

export type VideoGameSpecificsInput = {
  platforms: Array<Scalars['String']['input']>;
};

export type VideoGamesSummary = {
  played: Scalars['Int']['output'];
};

export enum Visibility {
  Private = 'PRIVATE',
  Public = 'PUBLIC'
}

export type VisualNovelSpecifics = {
  length?: Maybe<Scalars['Int']['output']>;
};

export type VisualNovelSpecificsInput = {
  length?: InputMaybe<Scalars['Int']['input']>;
};

export type VisualNovelsSummary = {
  played: Scalars['Int']['output'];
  runtime: Scalars['Int']['output'];
};

export enum WorkoutSetPersonalBest {
  OneRm = 'ONE_RM',
  Pace = 'PACE',
  Time = 'TIME',
  Volume = 'VOLUME',
  Weight = 'WEIGHT'
}

export type WorkoutSetRecord = {
  lot: SetLot;
  personalBests: Array<WorkoutSetPersonalBest>;
  statistic: SetStatistic;
};

export type AddMediaToCollectionMutationVariables = Exact<{
  input: AddMediaToCollection;
}>;


export type AddMediaToCollectionMutation = { addMediaToCollection: boolean };

export type BulkProgressUpdateMutationVariables = Exact<{
  input: Array<ProgressUpdateInput> | ProgressUpdateInput;
}>;


export type BulkProgressUpdateMutation = { bulkProgressUpdate: boolean };

export type CommitMediaMutationVariables = Exact<{
  lot: MetadataLot;
  source: MetadataSource;
  identifier: Scalars['String']['input'];
}>;


export type CommitMediaMutation = { commitMedia: { id: number } };

export type CreateCustomMediaMutationVariables = Exact<{
  input: CreateCustomMediaInput;
}>;


export type CreateCustomMediaMutation = { createCustomMedia: { __typename: 'CreateCustomMediaError', error: CreateCustomMediaErrorVariant } | { __typename: 'IdObject', id: number } };

export type CreateMediaReminderMutationVariables = Exact<{
  input: CreateMediaReminderInput;
}>;


export type CreateMediaReminderMutation = { createMediaReminder: boolean };

export type CreateOrUpdateCollectionMutationVariables = Exact<{
  input: CreateOrUpdateCollectionInput;
}>;


export type CreateOrUpdateCollectionMutation = { createOrUpdateCollection: { id: number } };

export type CreateReviewCommentMutationVariables = Exact<{
  input: CreateReviewCommentInput;
}>;


export type CreateReviewCommentMutation = { createReviewComment: boolean };

export type CreateUserMeasurementMutationVariables = Exact<{
  input: UserMeasurementInput;
}>;


export type CreateUserMeasurementMutation = { createUserMeasurement: Date };

export type CreateUserNotificationPlatformMutationVariables = Exact<{
  input: CreateUserNotificationPlatformInput;
}>;


export type CreateUserNotificationPlatformMutation = { createUserNotificationPlatform: number };

export type CreateUserSinkIntegrationMutationVariables = Exact<{
  input: CreateUserSinkIntegrationInput;
}>;


export type CreateUserSinkIntegrationMutation = { createUserSinkIntegration: number };

export type CreateUserWorkoutMutationVariables = Exact<{
  input: UserWorkoutInput;
}>;


export type CreateUserWorkoutMutation = { createUserWorkout: string };

export type CreateUserYankIntegrationMutationVariables = Exact<{
  input: CreateUserYankIntegrationInput;
}>;


export type CreateUserYankIntegrationMutation = { createUserYankIntegration: number };

export type DeleteCollectionMutationVariables = Exact<{
  collectionName: Scalars['String']['input'];
}>;


export type DeleteCollectionMutation = { deleteCollection: boolean };

export type DeleteMediaReminderMutationVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type DeleteMediaReminderMutation = { deleteMediaReminder: boolean };

export type DeleteReviewMutationVariables = Exact<{
  reviewId: Scalars['Int']['input'];
}>;


export type DeleteReviewMutation = { deleteReview: boolean };

export type DeleteSeenItemMutationVariables = Exact<{
  seenId: Scalars['Int']['input'];
}>;


export type DeleteSeenItemMutation = { deleteSeenItem: { id: number } };

export type DeleteUserMutationVariables = Exact<{
  toDeleteUserId: Scalars['Int']['input'];
}>;


export type DeleteUserMutation = { deleteUser: boolean };

export type DeleteUserIntegrationMutationVariables = Exact<{
  integrationId: Scalars['Int']['input'];
  integrationLot: UserIntegrationLot;
}>;


export type DeleteUserIntegrationMutation = { deleteUserIntegration: boolean };

export type DeleteUserMeasurementMutationVariables = Exact<{
  timestamp: Scalars['DateTime']['input'];
}>;


export type DeleteUserMeasurementMutation = { deleteUserMeasurement: boolean };

export type DeleteUserNotificationPlatformMutationVariables = Exact<{
  notificationId: Scalars['Int']['input'];
}>;


export type DeleteUserNotificationPlatformMutation = { deleteUserNotificationPlatform: boolean };

export type DeployImportJobMutationVariables = Exact<{
  input: DeployImportJobInput;
}>;


export type DeployImportJobMutation = { deployImportJob: string };

export type DeployUpdateMetadataJobMutationVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type DeployUpdateMetadataJobMutation = { deployUpdateMetadataJob: string };

export type GenerateAuthTokenMutationVariables = Exact<{ [key: string]: never; }>;


export type GenerateAuthTokenMutation = { generateAuthToken: string };

export type LoginUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type LoginUserMutation = { loginUser: { __typename: 'LoginError', error: LoginErrorVariant } | { __typename: 'LoginResponse', apiKey: string } };

export type LogoutUserMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutUserMutation = { logoutUser: boolean };

export type MergeMetadataMutationVariables = Exact<{
  mergeFrom: Scalars['Int']['input'];
  mergeInto: Scalars['Int']['input'];
}>;


export type MergeMetadataMutation = { mergeMetadata: boolean };

export type PostReviewMutationVariables = Exact<{
  input: PostReviewInput;
}>;


export type PostReviewMutation = { postReview: { id: number } };

export type PresignedPutUrlMutationVariables = Exact<{
  fileName: Scalars['String']['input'];
}>;


export type PresignedPutUrlMutation = { presignedPutUrl: { key: string, uploadUrl: string } };

export type ProgressUpdateMutationVariables = Exact<{
  input: ProgressUpdateInput;
}>;


export type ProgressUpdateMutation = { progressUpdate: { id: number } | { error: ProgressUpdateErrorVariant } };

export type RegenerateUserSummaryMutationVariables = Exact<{ [key: string]: never; }>;


export type RegenerateUserSummaryMutation = { regenerateUserSummary: boolean };

export type RegisterUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type RegisterUserMutation = { registerUser: { __typename: 'IdObject', id: number } | { __typename: 'RegisterError', error: RegisterErrorVariant } };

export type RemoveMediaFromCollectionMutationVariables = Exact<{
  metadataId: Scalars['Int']['input'];
  collectionName: Scalars['String']['input'];
}>;


export type RemoveMediaFromCollectionMutation = { removeMediaFromCollection: { id: number } };

export type TestUserNotificationPlatformsMutationVariables = Exact<{ [key: string]: never; }>;


export type TestUserNotificationPlatformsMutation = { testUserNotificationPlatforms: boolean };

export type ToggleMediaMonitorMutationVariables = Exact<{
  toMonitorMetadataId: Scalars['Int']['input'];
}>;


export type ToggleMediaMonitorMutation = { toggleMediaMonitor: boolean };

export type UpdateAllMetadataMutationVariables = Exact<{ [key: string]: never; }>;


export type UpdateAllMetadataMutation = { updateAllMetadata: boolean };

export type UpdateUserMutationVariables = Exact<{
  input: UpdateUserInput;
}>;


export type UpdateUserMutation = { updateUser: { id: number } };

export type UpdateUserPreferenceMutationVariables = Exact<{
  input: UpdateUserPreferenceInput;
}>;


export type UpdateUserPreferenceMutation = { updateUserPreference: boolean };

export type YankIntegrationDataMutationVariables = Exact<{ [key: string]: never; }>;


export type YankIntegrationDataMutation = { yankIntegrationData: number };

export type CollectionContentsQueryVariables = Exact<{
  input: CollectionContentsInput;
}>;


export type CollectionContentsQuery = { collectionContents: { user: { name: string }, results: { details: { total: number, nextPage?: number | null }, items: Array<{ lot: MetadataLot, details: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> }, details: { name: string, description?: string | null, visibility: Visibility, createdOn: Date } } };

export type CollectionsQueryVariables = Exact<{
  input?: InputMaybe<CollectionInput>;
}>;


export type CollectionsQuery = { collections: Array<{ id: number, name: string, description?: string | null, visibility: Visibility, numItems: number }> };

export type CoreDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreDetailsQuery = { coreDetails: { version: string, authorName: string, repositoryLink: string, docsLink: string, defaultCredentials: boolean, passwordChangeAllowed: boolean, preferencesChangeAllowed: boolean, usernameChangeAllowed: boolean, itemDetailsHeight: number, reviewsDisabled: boolean, videosDisabled: boolean, upgrade?: UpgradeType | null, pageLimit: number, deployUpdateAllMetadataJobAllowed: boolean } };

export type CoreEnabledFeaturesQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreEnabledFeaturesQuery = { coreEnabledFeatures: { fileStorage: boolean, signupAllowed: boolean } };

export type CreatorDetailsQueryVariables = Exact<{
  creatorId: Scalars['Int']['input'];
}>;


export type CreatorDetailsQuery = { creatorDetails: { details: { id: number, name: string, image?: string | null }, contents: Array<{ name: string, items: Array<{ metadataId?: number | null, title: string, image?: string | null }> }> } };

export type CreatorsListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type CreatorsListQuery = { creatorsList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: number, name: string, image?: string | null, mediaCount: number }> } };

export type ExerciseDetailsQueryVariables = Exact<{
  exerciseId: Scalars['Int']['input'];
}>;


export type ExerciseDetailsQuery = { exerciseDetails: { name: string, lot: ExerciseLot, level: ExerciseLevel, force?: ExerciseForce | null, mechanic?: ExerciseMechanic | null, equipment?: ExerciseEquipment | null, attributes: { instructions: Array<string>, images: Array<string>, muscles: Array<ExerciseMuscle> } } };

export type ExerciseParametersQueryVariables = Exact<{ [key: string]: never; }>;


export type ExerciseParametersQuery = { exerciseParameters: { downloadRequired: boolean, filters: { type: Array<ExerciseLot>, level: Array<ExerciseLevel>, force: Array<ExerciseForce>, mechanic: Array<ExerciseMechanic>, equipment: Array<ExerciseEquipment>, muscle: Array<ExerciseMuscle> } } };

export type ExercisesListQueryVariables = Exact<{
  input: ExercisesListInput;
}>;


export type ExercisesListQuery = { exercisesList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: number, name: string, lot: ExerciseLot, attributes: { images: Array<string>, muscles: Array<ExerciseMuscle> } }> } };

export type GetPresignedUrlQueryVariables = Exact<{
  key: Scalars['String']['input'];
}>;


export type GetPresignedUrlQuery = { getPresignedUrl: string };

export type ImportReportsQueryVariables = Exact<{ [key: string]: never; }>;


export type ImportReportsQuery = { importReports: Array<{ id: number, source: ImportSource, startedOn: Date, finishedOn?: Date | null, success?: boolean | null, details?: { import: { total: number }, failedItems: Array<{ lot: MetadataLot, step: ImportFailStep, identifier: string, error?: string | null }> } | null }> };

export type LatestUserSummaryQueryVariables = Exact<{ [key: string]: never; }>;


export type LatestUserSummaryQuery = { latestUserSummary: { calculatedOn: Date, fitness: { measurementsRecorded: number, workoutsRecorded: number }, media: { reviewsPosted: number, creatorsInteractedWith: number, manga: { chapters: number, read: number }, books: { pages: number, read: number }, movies: { runtime: number, watched: number }, anime: { episodes: number, watched: number }, podcasts: { runtime: number, played: number, playedEpisodes: number }, visualNovels: { played: number, runtime: number }, videoGames: { played: number }, shows: { runtime: number, watchedEpisodes: number, watchedSeasons: number, watched: number }, audioBooks: { runtime: number, played: number } } } };

export type MediaDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type MediaDetailsQuery = { mediaDetails: { title: string, description?: string | null, identifier: string, lot: MetadataLot, source: MetadataSource, isNsfw: boolean, providerRating?: any | null, publishYear?: number | null, publishDate?: any | null, genres: Array<string>, sourceUrl?: string | null, creators: Array<{ name: string, items: Array<{ id: number, name: string, image?: string | null }> }>, assets: { images: Array<string>, videos: Array<{ videoId: string, source: MetadataVideoSource }> }, group?: { id: number, name: string, part: number } | null, suggestions: Array<{ lot: MetadataLot, source: MetadataSource, identifier: string, title: string, image?: string | null, metadataId?: number | null }>, animeSpecifics?: { episodes?: number | null } | null, audioBookSpecifics?: { runtime?: number | null } | null, bookSpecifics?: { pages?: number | null } | null, movieSpecifics?: { runtime?: number | null } | null, mangaSpecifics?: { volumes?: number | null, chapters?: number | null } | null, podcastSpecifics?: { totalEpisodes: number, episodes: Array<{ title: string, overview?: string | null, thumbnail?: string | null, number: number, runtime?: number | null }> } | null, showSpecifics?: { seasons: Array<{ seasonNumber: number, name: string, overview?: string | null, backdropImages: Array<string>, posterImages: Array<string>, episodes: Array<{ id: number, name: string, posterImages: Array<string>, episodeNumber: number, publishDate?: any | null, overview?: string | null, runtime?: number | null }> }> } | null, visualNovelSpecifics?: { length?: number | null } | null, videoGameSpecifics?: { platforms: Array<string> } | null } };

export type MediaListQueryVariables = Exact<{
  input: MediaListInput;
}>;


export type MediaListQuery = { mediaList: { details: { total: number, nextPage?: number | null }, items: Array<{ averageRating?: any | null, data: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> } };

export type MediaSearchQueryVariables = Exact<{
  lot: MetadataLot;
  source: MetadataSource;
  input: SearchInput;
}>;


export type MediaSearchQuery = { mediaSearch: { details: { total: number, nextPage?: number | null }, items: Array<{ databaseId?: number | null, item: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> } };

export type MediaSourcesForLotQueryVariables = Exact<{
  lot: MetadataLot;
}>;


export type MediaSourcesForLotQuery = { mediaSourcesForLot: Array<MetadataSource> };

export type MetadataGroupDetailsQueryVariables = Exact<{
  metadataGroupId: Scalars['Int']['input'];
}>;


export type MetadataGroupDetailsQuery = { metadataGroupDetails: { sourceUrl?: string | null, details: { id: number, title: string, lot: MetadataLot, source: MetadataSource, displayImages: Array<string>, parts: number }, contents: Array<{ identifier: string, title: string, image?: string | null, metadataId?: number | null, lot: MetadataLot, source: MetadataSource }> } };

export type MetadataGroupsListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type MetadataGroupsListQuery = { metadataGroupsList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: number, title: string, lot: MetadataLot, parts: number, image?: string | null }> } };

export type ProvidersLanguageInformationQueryVariables = Exact<{ [key: string]: never; }>;


export type ProvidersLanguageInformationQuery = { providersLanguageInformation: Array<{ supported: Array<string>, default: string, source: MetadataSource }> };

export type ReviewQueryVariables = Exact<{
  reviewId: Scalars['Int']['input'];
}>;


export type ReviewQuery = { review: { rating?: any | null, text?: string | null, visibility: Visibility, spoiler: boolean, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null } };

export type UserCreatorDetailsQueryVariables = Exact<{
  creatorId: Scalars['Int']['input'];
}>;


export type UserCreatorDetailsQuery = { userCreatorDetails: { reviews: Array<{ id: number, rating?: any | null, text?: string | null, spoiler: boolean, visibility: Visibility, postedOn: Date, postedBy: { id: number, name: string }, comments: Array<{ id: string, text: string, createdOn: Date, likedBy: Array<number>, user: { id: number, name: string } }> }> } };

export type UserDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserDetailsQuery = { userDetails: { __typename: 'User', id: number, email?: string | null, name: string, lot: UserLot } | { __typename: 'UserDetailsError' } };

export type UserExerciseDetailsQueryVariables = Exact<{
  exerciseId: Scalars['Int']['input'];
}>;


export type UserExerciseDetailsQuery = { userExerciseDetails?: { history: Array<{ workoutId: string, workoutName?: string | null, workoutTime: Date, sets: Array<{ lot: SetLot, statistic: { duration?: any | null, distance?: any | null, reps?: number | null, weight?: any | null } }> }>, details: { exerciseId: number, numTimesPerformed: number, lastUpdatedOn: Date, extraInformation: { lifetimeStats: { weight: any, reps: number, distance: any, duration: any }, personalBests: Array<{ lot: WorkoutSetPersonalBest, sets: Array<{ workoutId: string, setIdx: number, data: { lot: SetLot, personalBests: Array<WorkoutSetPersonalBest>, statistic: { duration?: any | null, distance?: any | null, reps?: number | null, weight?: any | null } } }> }> } } } | null };

export type UserIntegrationsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserIntegrationsQuery = { userIntegrations: Array<{ id: number, lot: UserIntegrationLot, description: string, timestamp: Date }> };

export type UserMeasurementsListQueryVariables = Exact<{
  input: UserMeasurementsListInput;
}>;


export type UserMeasurementsListQuery = { userMeasurementsList: Array<{ timestamp: Date, name?: string | null, comment?: string | null, stats: { weight?: any | null, bodyMassIndex?: any | null, totalBodyWater?: any | null, muscle?: any | null, leanBodyMass?: any | null, bodyFat?: any | null, boneMass?: any | null, visceralFat?: any | null, waistCircumference?: any | null, waistToHeightRatio?: any | null, hipCircumference?: any | null, waistToHipRatio?: any | null, chestCircumference?: any | null, thighCircumference?: any | null, bicepsCircumference?: any | null, neckCircumference?: any | null, bodyFatCaliper?: any | null, chestSkinfold?: any | null, abdominalSkinfold?: any | null, thighSkinfold?: any | null, basalMetabolicRate?: any | null, totalDailyEnergyExpenditure?: any | null, calories?: any | null, custom?: any | null } }> };

export type SeenPartFragment = { id: number, progress: number, state: SeenState, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null };

export type UserMediaDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type UserMediaDetailsQuery = { userMediaDetails: { averageRating?: any | null, isMonitored: boolean, seenBy: number, collections: Array<{ id: number, name: string }>, inProgress?: { id: number, progress: number, state: SeenState, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null } | null, history: Array<{ id: number, progress: number, state: SeenState, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null }>, reviews: Array<{ id: number, rating?: any | null, text?: string | null, spoiler: boolean, visibility: Visibility, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null, postedOn: Date, postedBy: { id: number, name: string }, comments: Array<{ id: string, text: string, createdOn: Date, likedBy: Array<number>, user: { id: number, name: string } }> }>, reminder?: { remindOn: any, message: string } | null, nextEpisode?: { seasonNumber?: number | null, episodeNumber?: number | null } | null } };

export type UserNotificationPlatformsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserNotificationPlatformsQuery = { userNotificationPlatforms: Array<{ id: number, description: string, timestamp: Date }> };

export type UserPreferencesQueryVariables = Exact<{ [key: string]: never; }>;


export type UserPreferencesQuery = { userPreferences: { general: { reviewScale: UserReviewScale, displayNsfw: boolean }, fitness: { measurements: { custom: Array<{ name: string, dataType: UserCustomMeasurementDataType }>, inbuilt: { weight: boolean, bodyMassIndex: boolean, totalBodyWater: boolean, muscle: boolean, leanBodyMass: boolean, bodyFat: boolean, boneMass: boolean, visceralFat: boolean, waistCircumference: boolean, waistToHeightRatio: boolean, hipCircumference: boolean, waistToHipRatio: boolean, chestCircumference: boolean, thighCircumference: boolean, bicepsCircumference: boolean, neckCircumference: boolean, bodyFatCaliper: boolean, chestSkinfold: boolean, abdominalSkinfold: boolean, thighSkinfold: boolean, basalMetabolicRate: boolean, totalDailyEnergyExpenditure: boolean, calories: boolean } }, exercises: { saveHistory: number, unitSystem: UserUnitSystem } }, notifications: { episodeReleased: boolean, episodeNameChanged: boolean, statusChanged: boolean, releaseDateChanged: boolean, numberOfSeasonsChanged: boolean }, featuresEnabled: { fitness: { enabled: boolean, measurements: boolean }, media: { enabled: boolean, anime: boolean, audioBook: boolean, book: boolean, manga: boolean, movie: boolean, podcast: boolean, show: boolean, videoGame: boolean, visualNovel: boolean } } } };

export type UsersListQueryVariables = Exact<{ [key: string]: never; }>;


export type UsersListQuery = { usersList: Array<{ id: number, name: string, lot: UserLot }> };

export const SeenPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]}}]} as unknown as DocumentNode<SeenPartFragment, unknown>;
export const AddMediaToCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddMediaToCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddMediaToCollection"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addMediaToCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<AddMediaToCollectionMutation, AddMediaToCollectionMutationVariables>;
export const BulkProgressUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"BulkProgressUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdateInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bulkProgressUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<BulkProgressUpdateMutation, BulkProgressUpdateMutationVariables>;
export const CommitMediaDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitMedia"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"source"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataSource"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitMedia"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}},{"kind":"Argument","name":{"kind":"Name","value":"source"},"value":{"kind":"Variable","name":{"kind":"Name","value":"source"}}},{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitMediaMutation, CommitMediaMutationVariables>;
export const CreateCustomMediaDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCustomMedia"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCustomMediaInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomMedia"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCustomMediaError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]}}]} as unknown as DocumentNode<CreateCustomMediaMutation, CreateCustomMediaMutationVariables>;
export const CreateMediaReminderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateMediaReminder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateMediaReminderInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createMediaReminder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateMediaReminderMutation, CreateMediaReminderMutationVariables>;
export const CreateOrUpdateCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrUpdateCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateOrUpdateCollectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrUpdateCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateOrUpdateCollectionMutation, CreateOrUpdateCollectionMutationVariables>;
export const CreateReviewCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateReviewComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateReviewCommentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createReviewComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateReviewCommentMutation, CreateReviewCommentMutationVariables>;
export const CreateUserMeasurementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserMeasurement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMeasurementInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserMeasurement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserMeasurementMutation, CreateUserMeasurementMutationVariables>;
export const CreateUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateUserNotificationPlatformInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserNotificationPlatformMutation, CreateUserNotificationPlatformMutationVariables>;
export const CreateUserSinkIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserSinkIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateUserSinkIntegrationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserSinkIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserSinkIntegrationMutation, CreateUserSinkIntegrationMutationVariables>;
export const CreateUserWorkoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserWorkout"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserWorkoutInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserWorkout"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserWorkoutMutation, CreateUserWorkoutMutationVariables>;
export const CreateUserYankIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserYankIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateUserYankIntegrationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserYankIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserYankIntegrationMutation, CreateUserYankIntegrationMutationVariables>;
export const DeleteCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"collectionName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}}}]}]}}]} as unknown as DocumentNode<DeleteCollectionMutation, DeleteCollectionMutationVariables>;
export const DeleteMediaReminderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteMediaReminder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteMediaReminder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}]}]}}]} as unknown as DocumentNode<DeleteMediaReminderMutation, DeleteMediaReminderMutationVariables>;
export const DeleteReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"reviewId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}}}]}]}}]} as unknown as DocumentNode<DeleteReviewMutation, DeleteReviewMutationVariables>;
export const DeleteSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"seenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSeenItemMutation, DeleteSeenItemMutationVariables>;
export const DeleteUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"toDeleteUserId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMutation, DeleteUserMutationVariables>;
export const DeleteUserIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"integrationLot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserIntegrationLot"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"integrationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"integrationLot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"integrationLot"}}}]}]}}]} as unknown as DocumentNode<DeleteUserIntegrationMutation, DeleteUserIntegrationMutationVariables>;
export const DeleteUserMeasurementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserMeasurement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DateTime"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserMeasurement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"timestamp"},"value":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMeasurementMutation, DeleteUserMeasurementMutationVariables>;
export const DeleteUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"notificationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserNotificationPlatformMutation, DeleteUserNotificationPlatformMutationVariables>;
export const DeployImportJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployImportJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeployImportJobInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployImportJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployImportJobMutation, DeployImportJobMutationVariables>;
export const DeployUpdateMetadataJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployUpdateMetadataJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployUpdateMetadataJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}]}]}}]} as unknown as DocumentNode<DeployUpdateMetadataJobMutation, DeployUpdateMetadataJobMutationVariables>;
export const GenerateAuthTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GenerateAuthToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateAuthToken"}}]}}]} as unknown as DocumentNode<GenerateAuthTokenMutation, GenerateAuthTokenMutationVariables>;
export const LoginUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LoginUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"loginUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}}]}}]}}]}}]} as unknown as DocumentNode<LoginUserMutation, LoginUserMutationVariables>;
export const LogoutUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LogoutUser"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logoutUser"}}]}}]} as unknown as DocumentNode<LogoutUserMutation, LogoutUserMutationVariables>;
export const MergeMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MergeMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mergeMetadata"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mergeFrom"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}}},{"kind":"Argument","name":{"kind":"Name","value":"mergeInto"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}}}]}]}}]} as unknown as DocumentNode<MergeMetadataMutation, MergeMetadataMutationVariables>;
export const PostReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PostReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PostReviewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"postReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<PostReviewMutation, PostReviewMutationVariables>;
export const PresignedPutUrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PresignedPutUrl"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"fileName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presignedPutUrl"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"fileName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"fileName"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"uploadUrl"}}]}}]}}]} as unknown as DocumentNode<PresignedPutUrlMutation, PresignedPutUrlMutationVariables>;
export const ProgressUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ProgressUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"progressUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdateError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]}}]} as unknown as DocumentNode<ProgressUpdateMutation, ProgressUpdateMutationVariables>;
export const RegenerateUserSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegenerateUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"regenerateUserSummary"}}]}}]} as unknown as DocumentNode<RegenerateUserSummaryMutation, RegenerateUserSummaryMutationVariables>;
export const RegisterUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RegisterUserMutation, RegisterUserMutationVariables>;
export const RemoveMediaFromCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveMediaFromCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeMediaFromCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}},{"kind":"Argument","name":{"kind":"Name","value":"collectionName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveMediaFromCollectionMutation, RemoveMediaFromCollectionMutationVariables>;
export const TestUserNotificationPlatformsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TestUserNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"testUserNotificationPlatforms"}}]}}]} as unknown as DocumentNode<TestUserNotificationPlatformsMutation, TestUserNotificationPlatformsMutationVariables>;
export const ToggleMediaMonitorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ToggleMediaMonitor"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toMonitorMetadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"toggleMediaMonitor"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"toMonitorMetadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toMonitorMetadataId"}}}]}]}}]} as unknown as DocumentNode<ToggleMediaMonitorMutation, ToggleMediaMonitorMutationVariables>;
export const UpdateAllMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateAllMetadata"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAllMetadata"}}]}}]} as unknown as DocumentNode<UpdateAllMetadataMutation, UpdateAllMetadataMutationVariables>;
export const UpdateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<UpdateUserMutation, UpdateUserMutationVariables>;
export const UpdateUserPreferenceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUserPreference"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserPreferenceInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUserPreference"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateUserPreferenceMutation, UpdateUserPreferenceMutationVariables>;
export const YankIntegrationDataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"YankIntegrationData"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"yankIntegrationData"}}]}}]} as unknown as DocumentNode<YankIntegrationDataMutation, YankIntegrationDataMutationVariables>;
export const CollectionContentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CollectionContents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CollectionContentsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collectionContents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"results"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}}]}}]}}]}}]} as unknown as DocumentNode<CollectionContentsQuery, CollectionContentsQueryVariables>;
export const CollectionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Collections"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"CollectionInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"numItems"}}]}}]}}]} as unknown as DocumentNode<CollectionsQuery, CollectionsQueryVariables>;
export const CoreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"authorName"}},{"kind":"Field","name":{"kind":"Name","value":"repositoryLink"}},{"kind":"Field","name":{"kind":"Name","value":"docsLink"}},{"kind":"Field","name":{"kind":"Name","value":"defaultCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"passwordChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"preferencesChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"usernameChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"itemDetailsHeight"}},{"kind":"Field","name":{"kind":"Name","value":"reviewsDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"videosDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"upgrade"}},{"kind":"Field","name":{"kind":"Name","value":"pageLimit"}},{"kind":"Field","name":{"kind":"Name","value":"deployUpdateAllMetadataJobAllowed"}}]}}]}}]} as unknown as DocumentNode<CoreDetailsQuery, CoreDetailsQueryVariables>;
export const CoreEnabledFeaturesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fileStorage"}},{"kind":"Field","name":{"kind":"Name","value":"signupAllowed"}}]}}]}}]} as unknown as DocumentNode<CoreEnabledFeaturesQuery, CoreEnabledFeaturesQueryVariables>;
export const CreatorDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CreatorDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"creatorDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"creatorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}}]}}]}}]} as unknown as DocumentNode<CreatorDetailsQuery, CreatorDetailsQueryVariables>;
export const CreatorsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CreatorsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"creatorsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"mediaCount"}}]}}]}}]}}]} as unknown as DocumentNode<CreatorsListQuery, CreatorsListQueryVariables>;
export const ExerciseDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExerciseDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"exerciseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"mechanic"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"instructions"}},{"kind":"Field","name":{"kind":"Name","value":"images"}},{"kind":"Field","name":{"kind":"Name","value":"muscles"}}]}}]}}]}}]} as unknown as DocumentNode<ExerciseDetailsQuery, ExerciseDetailsQueryVariables>;
export const ExerciseParametersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExerciseParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"mechanic"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}}]}},{"kind":"Field","name":{"kind":"Name","value":"downloadRequired"}}]}}]}}]} as unknown as DocumentNode<ExerciseParametersQuery, ExerciseParametersQueryVariables>;
export const ExercisesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExercisesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExercisesListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exercisesList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"images"}},{"kind":"Field","name":{"kind":"Name","value":"muscles"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ExercisesListQuery, ExercisesListQueryVariables>;
export const GetPresignedUrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetPresignedUrl"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"getPresignedUrl"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<GetPresignedUrlQuery, GetPresignedUrlQueryVariables>;
export const ImportReportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ImportReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"importReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"success"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"import"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}}]}},{"kind":"Field","name":{"kind":"Name","value":"failedItems"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"step"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ImportReportsQuery, ImportReportsQueryVariables>;
export const LatestUserSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LatestUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"latestUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"calculatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"measurementsRecorded"}},{"kind":"Field","name":{"kind":"Name","value":"workoutsRecorded"}}]}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviewsPosted"}},{"kind":"Field","name":{"kind":"Name","value":"creatorsInteractedWith"}},{"kind":"Field","name":{"kind":"Name","value":"manga"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"chapters"}},{"kind":"Field","name":{"kind":"Name","value":"read"}}]}},{"kind":"Field","name":{"kind":"Name","value":"books"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}},{"kind":"Field","name":{"kind":"Name","value":"read"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movies"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"anime"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcasts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"played"}},{"kind":"Field","name":{"kind":"Name","value":"playedEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"visualNovels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"played"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGames"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"played"}}]}},{"kind":"Field","name":{"kind":"Name","value":"shows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watchedEpisodes"}},{"kind":"Field","name":{"kind":"Name","value":"watchedSeasons"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBooks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"played"}}]}}]}}]}}]}}]} as unknown as DocumentNode<LatestUserSummaryQuery, LatestUserSummaryQueryVariables>;
export const MediaDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"isNsfw"}},{"kind":"Field","name":{"kind":"Name","value":"creators"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"images"}},{"kind":"Field","name":{"kind":"Name","value":"videos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"videoId"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"providerRating"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"genres"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"group"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"part"}}]}},{"kind":"Field","name":{"kind":"Name","value":"suggestions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movieSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volumes"}},{"kind":"Field","name":{"kind":"Name","value":"chapters"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"thumbnail"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"visualNovelSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"length"}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGameSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platforms"}}]}}]}}]}}]} as unknown as DocumentNode<MediaDetailsQuery, MediaDetailsQueryVariables>;
export const MediaListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaListQuery, MediaListQueryVariables>;
export const MediaSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"source"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataSource"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}},{"kind":"Argument","name":{"kind":"Name","value":"source"},"value":{"kind":"Variable","name":{"kind":"Name","value":"source"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"databaseId"}},{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaSearchQuery, MediaSearchQueryVariables>;
export const MediaSourcesForLotDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaSourcesForLot"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaSourcesForLot"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}}]}]}}]} as unknown as DocumentNode<MediaSourcesForLotQuery, MediaSourcesForLotQueryVariables>;
export const MetadataGroupDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataGroupDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataGroupDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataGroupId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"displayImages"}},{"kind":"Field","name":{"kind":"Name","value":"parts"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"contents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]}}]} as unknown as DocumentNode<MetadataGroupDetailsQuery, MetadataGroupDetailsQueryVariables>;
export const MetadataGroupsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataGroupsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataGroupsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"parts"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}}]}}]} as unknown as DocumentNode<MetadataGroupsListQuery, MetadataGroupsListQueryVariables>;
export const ProvidersLanguageInformationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProvidersLanguageInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providersLanguageInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"supported"}},{"kind":"Field","name":{"kind":"Name","value":"default"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<ProvidersLanguageInformationQuery, ProvidersLanguageInformationQueryVariables>;
export const ReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Review"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"review"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"reviewId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}}]}}]}}]} as unknown as DocumentNode<ReviewQuery, ReviewQueryVariables>;
export const UserCreatorDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserCreatorDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userCreatorDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"creatorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserCreatorDetailsQuery, UserCreatorDetailsQueryVariables>;
export const UserDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]}}]} as unknown as DocumentNode<UserDetailsQuery, UserDetailsQueryVariables>;
export const UserExerciseDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserExerciseDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userExerciseDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"exerciseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workoutId"}},{"kind":"Field","name":{"kind":"Name","value":"workoutName"}},{"kind":"Field","name":{"kind":"Name","value":"workoutTime"}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseId"}},{"kind":"Field","name":{"kind":"Name","value":"numTimesPerformed"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"extraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lifetimeStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}}]}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workoutId"}},{"kind":"Field","name":{"kind":"Name","value":"setIdx"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}}]}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserExerciseDetailsQuery, UserExerciseDetailsQueryVariables>;
export const UserIntegrationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<UserIntegrationsQuery, UserIntegrationsQueryVariables>;
export const UserMeasurementsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMeasurementsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMeasurementsListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMeasurementsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"stats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMassIndex"}},{"kind":"Field","name":{"kind":"Name","value":"totalBodyWater"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"leanBodyMass"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFat"}},{"kind":"Field","name":{"kind":"Name","value":"boneMass"}},{"kind":"Field","name":{"kind":"Name","value":"visceralFat"}},{"kind":"Field","name":{"kind":"Name","value":"waistCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHeightRatio"}},{"kind":"Field","name":{"kind":"Name","value":"hipCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHipRatio"}},{"kind":"Field","name":{"kind":"Name","value":"chestCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"thighCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bicepsCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"neckCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFatCaliper"}},{"kind":"Field","name":{"kind":"Name","value":"chestSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"abdominalSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"thighSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"basalMetabolicRate"}},{"kind":"Field","name":{"kind":"Name","value":"totalDailyEnergyExpenditure"}},{"kind":"Field","name":{"kind":"Name","value":"calories"}},{"kind":"Field","name":{"kind":"Name","value":"custom"}}]}}]}}]}}]} as unknown as DocumentNode<UserMeasurementsListQuery, UserMeasurementsListQueryVariables>;
export const UserMediaDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMediaDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"reminder"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"remindOn"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isMonitored"}},{"kind":"Field","name":{"kind":"Name","value":"seenBy"}},{"kind":"Field","name":{"kind":"Name","value":"nextEpisode"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]}}]} as unknown as DocumentNode<UserMediaDetailsQuery, UserMediaDetailsQueryVariables>;
export const UserNotificationPlatformsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<UserNotificationPlatformsQuery, UserNotificationPlatformsQueryVariables>;
export const UserPreferencesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserPreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userPreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"general"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviewScale"}},{"kind":"Field","name":{"kind":"Name","value":"displayNsfw"}}]}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"measurements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"custom"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inbuilt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMassIndex"}},{"kind":"Field","name":{"kind":"Name","value":"totalBodyWater"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"leanBodyMass"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFat"}},{"kind":"Field","name":{"kind":"Name","value":"boneMass"}},{"kind":"Field","name":{"kind":"Name","value":"visceralFat"}},{"kind":"Field","name":{"kind":"Name","value":"waistCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHeightRatio"}},{"kind":"Field","name":{"kind":"Name","value":"hipCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHipRatio"}},{"kind":"Field","name":{"kind":"Name","value":"chestCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"thighCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bicepsCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"neckCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFatCaliper"}},{"kind":"Field","name":{"kind":"Name","value":"chestSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"abdominalSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"thighSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"basalMetabolicRate"}},{"kind":"Field","name":{"kind":"Name","value":"totalDailyEnergyExpenditure"}},{"kind":"Field","name":{"kind":"Name","value":"calories"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"saveHistory"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodeReleased"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNameChanged"}},{"kind":"Field","name":{"kind":"Name","value":"statusChanged"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDateChanged"}},{"kind":"Field","name":{"kind":"Name","value":"numberOfSeasonsChanged"}}]}},{"kind":"Field","name":{"kind":"Name","value":"featuresEnabled"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"measurements"}}]}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"anime"}},{"kind":"Field","name":{"kind":"Name","value":"audioBook"}},{"kind":"Field","name":{"kind":"Name","value":"book"}},{"kind":"Field","name":{"kind":"Name","value":"manga"}},{"kind":"Field","name":{"kind":"Name","value":"movie"}},{"kind":"Field","name":{"kind":"Name","value":"podcast"}},{"kind":"Field","name":{"kind":"Name","value":"show"}},{"kind":"Field","name":{"kind":"Name","value":"videoGame"}},{"kind":"Field","name":{"kind":"Name","value":"visualNovel"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserPreferencesQuery, UserPreferencesQueryVariables>;
export const UsersListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UsersList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"usersList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]} as unknown as DocumentNode<UsersListQuery, UsersListQueryVariables>;