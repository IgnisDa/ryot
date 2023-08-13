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
  /** A scalar that can represent any JSON Object value. */
  JSONObject: any;
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
};

export type AddMediaToCollection = {
  collectionName: Scalars['String'];
  mediaId: Scalars['Int'];
};

export type AnimeSpecifics = {
  episodes?: Maybe<Scalars['Int']>;
};

export type AnimeSpecificsInput = {
  episodes?: InputMaybe<Scalars['Int']>;
};

export type AnimeSummary = {
  episodes: Scalars['Int'];
  watched: Scalars['Int'];
};

export type AudioBookSpecifics = {
  runtime?: Maybe<Scalars['Int']>;
};

export type AudioBookSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']>;
};

export type AudioBooksSummary = {
  played: Scalars['Int'];
  runtime: Scalars['Int'];
};

export type BookSpecifics = {
  pages?: Maybe<Scalars['Int']>;
};

export type BookSpecificsInput = {
  pages?: InputMaybe<Scalars['Int']>;
};

export type BooksSummary = {
  pages: Scalars['Int'];
  read: Scalars['Int'];
};

export type Collection = {
  createdOn: Scalars['DateTime'];
  description?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  name: Scalars['String'];
  visibility: Visibility;
};

export type CollectionContents = {
  details: Collection;
  results: MediaCollectionContentsResults;
  user: User;
};

export type CollectionContentsInput = {
  collectionId: Scalars['Int'];
  page?: InputMaybe<Scalars['Int']>;
  take?: InputMaybe<Scalars['Int']>;
};

export type CollectionInput = {
  name?: InputMaybe<Scalars['String']>;
};

export type CollectionItem = {
  description?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  name: Scalars['String'];
  numItems: Scalars['Int'];
  visibility: Visibility;
};

export type CoreDetails = {
  authorName: Scalars['String'];
  defaultCredentials: Scalars['Boolean'];
  docsLink: Scalars['String'];
  itemDetailsHeight: Scalars['Int'];
  passwordChangeAllowed: Scalars['Boolean'];
  preferencesChangeAllowed: Scalars['Boolean'];
  repositoryLink: Scalars['String'];
  reviewsDisabled: Scalars['Boolean'];
  /** Whether an upgrade is required */
  upgrade?: Maybe<UpgradeType>;
  usernameChangeAllowed: Scalars['Boolean'];
  version: Scalars['String'];
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
  creators?: InputMaybe<Array<Scalars['String']>>;
  description?: InputMaybe<Scalars['String']>;
  genres?: InputMaybe<Array<Scalars['String']>>;
  images?: InputMaybe<Array<Scalars['String']>>;
  lot: MetadataLot;
  mangaSpecifics?: InputMaybe<MangaSpecificsInput>;
  movieSpecifics?: InputMaybe<MovieSpecificsInput>;
  podcastSpecifics?: InputMaybe<PodcastSpecificsInput>;
  publishYear?: InputMaybe<Scalars['Int']>;
  showSpecifics?: InputMaybe<ShowSpecificsInput>;
  title: Scalars['String'];
  videoGameSpecifics?: InputMaybe<VideoGameSpecificsInput>;
};

export type CreateCustomMediaResult = CreateCustomMediaError | IdObject;

export type CreateMediaReminderInput = {
  message: Scalars['String'];
  metadataId: Scalars['Int'];
  remindOn: Scalars['NaiveDate'];
};

export type CreateOrUpdateCollectionInput = {
  description?: InputMaybe<Scalars['String']>;
  name: Scalars['String'];
  updateId?: InputMaybe<Scalars['Int']>;
  visibility?: InputMaybe<Visibility>;
};

export type CreateUserNotificationPlatformInput = {
  apiToken?: InputMaybe<Scalars['String']>;
  baseUrl?: InputMaybe<Scalars['String']>;
  lot: UserNotificationSettingKind;
  priority?: InputMaybe<Scalars['Int']>;
};

export type CreateUserSinkIntegrationInput = {
  lot: UserSinkIntegrationSettingKind;
};

export type CreateUserYankIntegrationInput = {
  baseUrl: Scalars['String'];
  lot: UserYankIntegrationSettingKind;
  token: Scalars['String'];
};

export type Creator = {
  extraInformation: CreatorExtraInformation;
  id: Scalars['Int'];
  image?: Maybe<Scalars['String']>;
  name: Scalars['String'];
};

export type CreatorDetails = {
  contents: Array<CreatorDetailsGroupedByRole>;
  details: Creator;
};

export type CreatorDetailsGroupedByRole = {
  /** The media items in which this role was performed. */
  items: Array<MediaSearchItem>;
  /** The name of the role performed. */
  name: Scalars['String'];
};

export type CreatorExtraInformation = {
  active: Scalars['Boolean'];
};

export type DeployGoodreadsImportInput = {
  rssUrl: Scalars['String'];
};

export type DeployImportJobInput = {
  goodreads?: InputMaybe<DeployGoodreadsImportInput>;
  lot: ImportLot;
  mediaJson?: InputMaybe<DeployMediaJsonImportInput>;
  mediaTracker?: InputMaybe<DeployMediaTrackerImportInput>;
  movary?: InputMaybe<DeployMovaryImportInput>;
  source: ImportSource;
  storyGraph?: InputMaybe<DeployStoryGraphImportInput>;
  trakt?: InputMaybe<DeployTraktImportInput>;
};

export type DeployMediaJsonImportInput = {
  export: Scalars['String'];
};

export type DeployMediaTrackerImportInput = {
  /** An application token generated by an admin */
  apiKey: Scalars['String'];
  /** The base url where the resource is present at */
  apiUrl: Scalars['String'];
};

export type DeployMovaryImportInput = {
  history: Scalars['String'];
  ratings: Scalars['String'];
};

export type DeployStoryGraphImportInput = {
  export: Scalars['String'];
};

export type DeployTraktImportInput = {
  username: Scalars['String'];
};

export type Exercise = {
  attributes: ExerciseAttributes;
  id: Scalars['Int'];
  identifier: Scalars['String'];
  name: Scalars['String'];
};

export type ExerciseAttributes = {
  category: ExerciseCategory;
  equipment?: Maybe<ExerciseEquipment>;
  force?: Maybe<ExerciseForce>;
  images: Array<Scalars['String']>;
  instructions: Array<Scalars['String']>;
  level: ExerciseLevel;
  mechanic?: Maybe<ExerciseMechanic>;
  primaryMuscles: Array<ExerciseMuscle>;
  secondaryMuscles: Array<ExerciseMuscle>;
};

export enum ExerciseCategory {
  Cardio = 'CARDIO',
  OlympicWeightlifting = 'OLYMPIC_WEIGHTLIFTING',
  Plyometrics = 'PLYOMETRICS',
  Powerlifting = 'POWERLIFTING',
  Strength = 'STRENGTH',
  Stretching = 'STRETCHING',
  Strongman = 'STRONGMAN'
}

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

export type ExerciseSearchResults = {
  items: Array<Exercise>;
  nextPage?: Maybe<Scalars['Int']>;
  total: Scalars['Int'];
};

export type ExercisesListInput = {
  page: Scalars['Int'];
  query?: InputMaybe<Scalars['String']>;
};

export type GeneralFeatures = {
  fileStorage: Scalars['Boolean'];
  signupAllowed: Scalars['Boolean'];
};

export type GraphqlMediaDetails = {
  animeSpecifics?: Maybe<AnimeSpecifics>;
  audioBookSpecifics?: Maybe<AudioBookSpecifics>;
  backdropImages: Array<Scalars['String']>;
  bookSpecifics?: Maybe<BookSpecifics>;
  creators: Array<MetadataCreatorGroupedByRole>;
  description?: Maybe<Scalars['String']>;
  genres: Array<Scalars['String']>;
  id: Scalars['Int'];
  identifier: Scalars['String'];
  lot: MetadataLot;
  mangaSpecifics?: Maybe<MangaSpecifics>;
  movieSpecifics?: Maybe<MovieSpecifics>;
  podcastSpecifics?: Maybe<PodcastSpecifics>;
  posterImages: Array<Scalars['String']>;
  productionStatus: Scalars['String'];
  publishDate?: Maybe<Scalars['NaiveDate']>;
  publishYear?: Maybe<Scalars['Int']>;
  showSpecifics?: Maybe<ShowSpecifics>;
  source: MetadataSource;
  sourceUrl?: Maybe<Scalars['String']>;
  title: Scalars['String'];
  videoGameSpecifics?: Maybe<VideoGameSpecifics>;
};

export type GraphqlUserIntegration = {
  description: Scalars['String'];
  id: Scalars['Int'];
  lot: UserIntegrationLot;
  timestamp: Scalars['DateTime'];
};

export type GraphqlUserNotificationPlatform = {
  description: Scalars['String'];
  id: Scalars['Int'];
  timestamp: Scalars['DateTime'];
};

export type IdObject = {
  id: Scalars['Int'];
};

export type ImportDetails = {
  total: Scalars['Int'];
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
  error?: Maybe<Scalars['String']>;
  identifier: Scalars['String'];
  lot: MetadataLot;
  step: ImportFailStep;
};

export enum ImportLot {
  Exercise = 'EXERCISE',
  Media = 'MEDIA'
}

export type ImportReport = {
  details?: Maybe<ImportResultResponse>;
  finishedOn?: Maybe<Scalars['DateTime']>;
  id: Scalars['Int'];
  source: ImportSource;
  startedOn: Scalars['DateTime'];
  success?: Maybe<Scalars['Boolean']>;
  userId: Scalars['Int'];
};

export type ImportResultResponse = {
  failedItems: Array<ImportFailedItem>;
  import: ImportDetails;
};

export enum ImportSource {
  Goodreads = 'GOODREADS',
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
  MutexError = 'MUTEX_ERROR',
  UsernameDoesNotExist = 'USERNAME_DOES_NOT_EXIST'
}

export type LoginResponse = {
  apiKey: Scalars['String'];
};

export type LoginResult = LoginError | LoginResponse;

export type MangaSpecifics = {
  chapters?: Maybe<Scalars['Int']>;
  volumes?: Maybe<Scalars['Int']>;
};

export type MangaSpecificsInput = {
  chapters?: InputMaybe<Scalars['Int']>;
  volumes?: InputMaybe<Scalars['Int']>;
};

export type MangaSummary = {
  chapters: Scalars['Int'];
  read: Scalars['Int'];
};

export type MediaCollectionContentsResults = {
  items: Array<MediaSearchItem>;
  nextPage?: Maybe<Scalars['Int']>;
  total: Scalars['Int'];
};

export type MediaCreatorSearchItem = {
  id: Scalars['Int'];
  image?: Maybe<Scalars['String']>;
  mediaCount: Scalars['Int'];
  name: Scalars['String'];
};

export type MediaCreatorSearchResults = {
  items: Array<MediaCreatorSearchItem>;
  nextPage?: Maybe<Scalars['Int']>;
  total: Scalars['Int'];
};

export type MediaFilter = {
  collection?: InputMaybe<Scalars['Int']>;
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
  page: Scalars['Int'];
  query?: InputMaybe<Scalars['String']>;
  sort?: InputMaybe<MediaSortInput>;
};

export type MediaListItem = {
  averageRating?: Maybe<Scalars['Decimal']>;
  data: MediaSearchItem;
};

export type MediaListResults = {
  items: Array<MediaListItem>;
  nextPage?: Maybe<Scalars['Int']>;
  total: Scalars['Int'];
};

export type MediaSearchItem = {
  identifier: Scalars['String'];
  image?: Maybe<Scalars['String']>;
  lot: MetadataLot;
  publishYear?: Maybe<Scalars['Int']>;
  title: Scalars['String'];
};

export type MediaSearchItemResponse = {
  databaseId?: Maybe<Scalars['Int']>;
  item: MediaSearchItem;
};

export type MediaSearchResults = {
  items: Array<MediaSearchItemResponse>;
  nextPage?: Maybe<Scalars['Int']>;
  total: Scalars['Int'];
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
  name: Scalars['String'];
};

export enum MetadataLot {
  Anime = 'ANIME',
  AudioBook = 'AUDIO_BOOK',
  Book = 'BOOK',
  Manga = 'MANGA',
  Movie = 'MOVIE',
  Podcast = 'PODCAST',
  Show = 'SHOW',
  VideoGame = 'VIDEO_GAME'
}

export enum MetadataSource {
  Anilist = 'ANILIST',
  Audible = 'AUDIBLE',
  Custom = 'CUSTOM',
  GoogleBooks = 'GOOGLE_BOOKS',
  Igdb = 'IGDB',
  Itunes = 'ITUNES',
  Listennotes = 'LISTENNOTES',
  Openlibrary = 'OPENLIBRARY',
  Tmdb = 'TMDB'
}

export type MovieSpecifics = {
  runtime?: Maybe<Scalars['Int']>;
};

export type MovieSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']>;
};

export type MoviesSummary = {
  runtime: Scalars['Int'];
  watched: Scalars['Int'];
};

export type MutationRoot = {
  /** Add a media item to a collection if it is not there, otherwise do nothing. */
  addMediaToCollection: Scalars['Boolean'];
  /** Update progress in bulk. */
  bulkProgressUpdate: Scalars['Boolean'];
  /** Fetch details about a media and create a media item in the database. */
  commitMedia: IdObject;
  /** Create a custom media item. */
  createCustomMedia: CreateCustomMediaResult;
  /** Create or update a reminder on a media for a user. */
  createMediaReminder: Scalars['Boolean'];
  /** Create a new collection for the logged in user or edit details of an existing one. */
  createOrUpdateCollection: IdObject;
  /** Create a user measurement. */
  createUserMeasurement: Scalars['DateTime'];
  /** Add a notification platform for the currently logged in user. */
  createUserNotificationPlatform: Scalars['Int'];
  /** Create a sink based integrations for the currently logged in user. */
  createUserSinkIntegration: Scalars['Int'];
  /** Create a yank based integrations for the currently logged in user. */
  createUserYankIntegration: Scalars['Int'];
  /** Delete a collection. */
  deleteCollection: Scalars['Boolean'];
  /** Delete a reminder on a media for a user if it exists. */
  deleteMediaReminder: Scalars['Boolean'];
  /** Delete a review if it belongs to the currently logged in user. */
  deleteReview: Scalars['Boolean'];
  /** Delete a seen item from a user's history. */
  deleteSeenItem: IdObject;
  /** Delete a user. The account making the user must an `Admin`. */
  deleteUser: Scalars['Boolean'];
  /** Delete an auth token for the currently logged in user. */
  deleteUserAuthToken: Scalars['Boolean'];
  /** Delete an integration for the currently logged in user. */
  deleteUserIntegration: Scalars['Boolean'];
  /** Delete a user measurement. */
  deleteUserMeasurement: Scalars['Boolean'];
  /** Delete a notification platform for the currently logged in user. */
  deleteUserNotificationPlatform: Scalars['Boolean'];
  /** Add job to import data from various sources. */
  deployImportJob: Scalars['String'];
  /** Deploy a job to download and update the exercise library. */
  deployUpdateExerciseLibraryJob: Scalars['Int'];
  /** Deploy a job to update a media item's metadata. */
  deployUpdateMetadataJob: Scalars['String'];
  /** Generate an auth token without any expiry. */
  generateApplicationToken: Scalars['String'];
  /** Login a user using their username and password and return an auth token. */
  loginUser: LoginResult;
  /** Logout a user from the server and delete their login token. */
  logoutUser: Scalars['Boolean'];
  /**
   * Merge a media item into another. This will move all `seen` and `review`
   * items with the new user and then delete the old media item completely.
   */
  mergeMetadata: Scalars['Boolean'];
  /** Create or update a review. */
  postReview: IdObject;
  /** Mark a user's progress on a specific media item. */
  progressUpdate: ProgressUpdateResultUnion;
  /** Delete all summaries for the currently logged in user and then generate one from scratch. */
  regenerateUserSummary: Scalars['Boolean'];
  /**
   * Create a new user for the service. Also set their `lot` as admin if
   * they are the first user.
   */
  registerUser: RegisterResult;
  /** Remove a media item from a collection if it is not there, otherwise do nothing. */
  removeMediaFromCollection: IdObject;
  /** Test all notification platforms for the currently logged in user. */
  testUserNotificationPlatforms: Scalars['Boolean'];
  /** Toggle the monitor on a media for a user. */
  toggleMediaMonitor: Scalars['Boolean'];
  /** Deploy jobs to update all media item's metadata. */
  updateAllMetadata: Scalars['Boolean'];
  /** Update a user's profile details. */
  updateUser: IdObject;
  /** Change a user's preferences. */
  updateUserPreference: Scalars['Boolean'];
  /** Yank data from all integrations for the currently logged in user. */
  yankIntegrationData: Scalars['Int'];
};


export type MutationRootAddMediaToCollectionArgs = {
  input: AddMediaToCollection;
};


export type MutationRootBulkProgressUpdateArgs = {
  input: Array<ProgressUpdateInput>;
};


export type MutationRootCommitMediaArgs = {
  identifier: Scalars['String'];
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


export type MutationRootCreateUserMeasurementArgs = {
  input: UserMeasurementInput;
};


export type MutationRootCreateUserNotificationPlatformArgs = {
  input: CreateUserNotificationPlatformInput;
};


export type MutationRootCreateUserSinkIntegrationArgs = {
  input: CreateUserSinkIntegrationInput;
};


export type MutationRootCreateUserYankIntegrationArgs = {
  input: CreateUserYankIntegrationInput;
};


export type MutationRootDeleteCollectionArgs = {
  collectionName: Scalars['String'];
};


export type MutationRootDeleteMediaReminderArgs = {
  metadataId: Scalars['Int'];
};


export type MutationRootDeleteReviewArgs = {
  reviewId: Scalars['Int'];
};


export type MutationRootDeleteSeenItemArgs = {
  seenId: Scalars['Int'];
};


export type MutationRootDeleteUserArgs = {
  toDeleteUserId: Scalars['Int'];
};


export type MutationRootDeleteUserAuthTokenArgs = {
  token: Scalars['String'];
};


export type MutationRootDeleteUserIntegrationArgs = {
  integrationId: Scalars['Int'];
  integrationLot: UserIntegrationLot;
};


export type MutationRootDeleteUserMeasurementArgs = {
  timestamp: Scalars['DateTime'];
};


export type MutationRootDeleteUserNotificationPlatformArgs = {
  notificationId: Scalars['Int'];
};


export type MutationRootDeployImportJobArgs = {
  input: DeployImportJobInput;
};


export type MutationRootDeployUpdateMetadataJobArgs = {
  metadataId: Scalars['Int'];
};


export type MutationRootLoginUserArgs = {
  input: UserInput;
};


export type MutationRootMergeMetadataArgs = {
  mergeFrom: Scalars['Int'];
  mergeInto: Scalars['Int'];
};


export type MutationRootPostReviewArgs = {
  input: PostReviewInput;
};


export type MutationRootProgressUpdateArgs = {
  input: ProgressUpdateInput;
};


export type MutationRootRegisterUserArgs = {
  input: UserInput;
};


export type MutationRootRemoveMediaFromCollectionArgs = {
  collectionName: Scalars['String'];
  metadataId: Scalars['Int'];
};


export type MutationRootToggleMediaMonitorArgs = {
  toMonitorMetadataId: Scalars['Int'];
};


export type MutationRootUpdateUserArgs = {
  input: UpdateUserInput;
};


export type MutationRootUpdateUserPreferenceArgs = {
  input: UpdateUserPreferenceInput;
};

export type PodcastEpisode = {
  id: Scalars['String'];
  number: Scalars['Int'];
  overview?: Maybe<Scalars['String']>;
  publishDate: Scalars['Int'];
  runtime?: Maybe<Scalars['Int']>;
  thumbnail?: Maybe<Scalars['String']>;
  title: Scalars['String'];
};

export type PodcastEpisodeInput = {
  id: Scalars['String'];
  number: Scalars['Int'];
  overview?: InputMaybe<Scalars['String']>;
  publishDate: Scalars['Int'];
  runtime?: InputMaybe<Scalars['Int']>;
  thumbnail?: InputMaybe<Scalars['String']>;
  title: Scalars['String'];
};

export type PodcastSpecifics = {
  episodes: Array<PodcastEpisode>;
  totalEpisodes: Scalars['Int'];
};

export type PodcastSpecificsInput = {
  episodes: Array<PodcastEpisodeInput>;
  totalEpisodes: Scalars['Int'];
};

export type PodcastsSummary = {
  played: Scalars['Int'];
  playedEpisodes: Scalars['Int'];
  runtime: Scalars['Int'];
};

export type PostReviewInput = {
  creatorId?: InputMaybe<Scalars['Int']>;
  date?: InputMaybe<Scalars['DateTime']>;
  metadataId?: InputMaybe<Scalars['Int']>;
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']>;
  rating?: InputMaybe<Scalars['Decimal']>;
  /** ID of the review if this is an update to an existing review */
  reviewId?: InputMaybe<Scalars['Int']>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']>;
  spoiler?: InputMaybe<Scalars['Boolean']>;
  text?: InputMaybe<Scalars['String']>;
  visibility?: InputMaybe<Visibility>;
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
  date?: InputMaybe<Scalars['NaiveDate']>;
  metadataId: Scalars['Int'];
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']>;
  progress?: InputMaybe<Scalars['Int']>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']>;
};

export type ProgressUpdateResultUnion = IdObject | ProgressUpdateError;

export type ProviderLanguageInformation = {
  default: Scalars['String'];
  source: MetadataSource;
  supported: Array<Scalars['String']>;
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
  /** Get information about an exercise. */
  exercise: Exercise;
  /** Get a paginated list of exercises in the database. */
  exercisesList: ExerciseSearchResults;
  /** Get a presigned URL (valid for 90 minutes) for a given key. */
  getPresignedUrl: Scalars['String'];
  /** Get all the import jobs deployed by the user. */
  importReports: Array<ImportReport>;
  /** Get a summary of all the media items that have been consumed by this user. */
  latestUserSummary: UserSummary;
  /** Get details about a media present in the database. */
  mediaDetails: GraphqlMediaDetails;
  /** Check if a media with the given metadata and identifier exists in the database. */
  mediaExistsInDatabase?: Maybe<IdObject>;
  /** Get all the media items related to a user for a specific media type. */
  mediaList: MediaListResults;
  /** Search for a list of media for a given type. */
  mediaSearch: MediaSearchResults;
  /** Get all the metadata sources possible for a lot. */
  mediaSourcesForLot: Array<MetadataSource>;
  /** Get all languages supported by all the providers. */
  providersLanguageInformation: Array<ProviderLanguageInformation>;
  /** Get a review by its ID. */
  reviewById: ReviewItem;
  /** Get all the auth tokens issued to the currently logged in user. */
  userAuthTokens: Array<UserAuthToken>;
  /** Get details that can be displayed to a user for a creator. */
  userCreatorDetails: UserCreatorDetails;
  /** Get details about the currently logged in user. */
  userDetails: UserDetailsResult;
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
  creatorId: Scalars['Int'];
};


export type QueryRootCreatorsListArgs = {
  input: SearchInput;
};


export type QueryRootExerciseArgs = {
  exerciseId: Scalars['Int'];
};


export type QueryRootExercisesListArgs = {
  input: ExercisesListInput;
};


export type QueryRootGetPresignedUrlArgs = {
  key: Scalars['String'];
};


export type QueryRootMediaDetailsArgs = {
  metadataId: Scalars['Int'];
};


export type QueryRootMediaExistsInDatabaseArgs = {
  identifier: Scalars['String'];
  lot: MetadataLot;
  source: MetadataSource;
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


export type QueryRootReviewByIdArgs = {
  reviewId: Scalars['Int'];
};


export type QueryRootUserCreatorDetailsArgs = {
  creatorId: Scalars['Int'];
};


export type QueryRootUserMediaDetailsArgs = {
  metadataId: Scalars['Int'];
};

export type RegisterError = {
  error: RegisterErrorVariant;
};

export enum RegisterErrorVariant {
  Disabled = 'DISABLED',
  UsernameAlreadyExists = 'USERNAME_ALREADY_EXISTS'
}

export type RegisterResult = IdObject | RegisterError;

export type ReviewItem = {
  id: Scalars['Int'];
  podcastEpisode?: Maybe<Scalars['Int']>;
  postedBy: ReviewPostedBy;
  postedOn: Scalars['DateTime'];
  rating?: Maybe<Scalars['Decimal']>;
  showEpisode?: Maybe<Scalars['Int']>;
  showSeason?: Maybe<Scalars['Int']>;
  spoiler: Scalars['Boolean'];
  text?: Maybe<Scalars['String']>;
  visibility: Visibility;
};

export type ReviewPostedBy = {
  id: Scalars['Int'];
  name: Scalars['String'];
};

export type SearchInput = {
  page?: InputMaybe<Scalars['Int']>;
  query?: InputMaybe<Scalars['String']>;
};

export type Seen = {
  finishedOn?: Maybe<Scalars['NaiveDate']>;
  id: Scalars['Int'];
  lastUpdatedOn: Scalars['DateTime'];
  metadataId: Scalars['Int'];
  podcastInformation?: Maybe<SeenPodcastExtraInformation>;
  progress: Scalars['Int'];
  showInformation?: Maybe<SeenShowExtraInformation>;
  startedOn?: Maybe<Scalars['NaiveDate']>;
  state: SeenState;
  userId: Scalars['Int'];
};

export type SeenPodcastExtraInformation = {
  episode: Scalars['Int'];
};

export type SeenShowExtraInformation = {
  episode: Scalars['Int'];
  season: Scalars['Int'];
};

export enum SeenState {
  Completed = 'COMPLETED',
  Dropped = 'DROPPED',
  InProgress = 'IN_PROGRESS',
  OnAHold = 'ON_A_HOLD'
}

export type ShowEpisode = {
  episodeNumber: Scalars['Int'];
  id: Scalars['Int'];
  name: Scalars['String'];
  overview?: Maybe<Scalars['String']>;
  posterImages: Array<Scalars['String']>;
  publishDate?: Maybe<Scalars['NaiveDate']>;
  runtime?: Maybe<Scalars['Int']>;
};

export type ShowEpisodeSpecificsInput = {
  episodeNumber: Scalars['Int'];
  id: Scalars['Int'];
  name: Scalars['String'];
  overview?: InputMaybe<Scalars['String']>;
  posterImages: Array<Scalars['String']>;
  publishDate?: InputMaybe<Scalars['NaiveDate']>;
  runtime?: InputMaybe<Scalars['Int']>;
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

export type ShowSeasonSpecificsInput = {
  backdropImages: Array<Scalars['String']>;
  episodes: Array<ShowEpisodeSpecificsInput>;
  id: Scalars['Int'];
  name: Scalars['String'];
  overview?: InputMaybe<Scalars['String']>;
  posterImages: Array<Scalars['String']>;
  publishDate?: InputMaybe<Scalars['NaiveDate']>;
  seasonNumber: Scalars['Int'];
};

export type ShowSpecifics = {
  seasons: Array<ShowSeason>;
};

export type ShowSpecificsInput = {
  seasons: Array<ShowSeasonSpecificsInput>;
};

export type ShowsSummary = {
  runtime: Scalars['Int'];
  watched: Scalars['Int'];
  watchedEpisodes: Scalars['Int'];
  watchedSeasons: Scalars['Int'];
};

export type UpdateUserInput = {
  email?: InputMaybe<Scalars['String']>;
  password?: InputMaybe<Scalars['String']>;
  username?: InputMaybe<Scalars['String']>;
};

export type UpdateUserPreferenceInput = {
  property: Scalars['String'];
  value: Scalars['String'];
};

export enum UpgradeType {
  Major = 'MAJOR',
  Minor = 'MINOR'
}

export type User = {
  email?: Maybe<Scalars['String']>;
  id: Scalars['Int'];
  lot: UserLot;
  name: Scalars['String'];
};

export type UserAuthToken = {
  lastUsedOn: Scalars['DateTime'];
  token: Scalars['String'];
};

export type UserCreatorDetails = {
  reviews: Array<ReviewItem>;
};

export type UserCustomMeasurement = {
  dataType: UserCustomMeasurementDataType;
  name: Scalars['String'];
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

export type UserExercisePreferences = {
  saveHistory: Scalars['Int'];
  weightUnit: UserWeightUnit;
};

export type UserFeaturesEnabledPreferences = {
  media: UserMediaFeaturesEnabledPreferences;
};

export type UserFitnessPreferences = {
  exercises: UserExercisePreferences;
  measurements: UserMeasurementsPreferences;
};

export type UserFitnessSummary = {
  measurementsRecorded: Scalars['Int'];
};

export type UserInput = {
  password: Scalars['String'];
  username: Scalars['String'];
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
  comment?: Maybe<Scalars['String']>;
  name?: Maybe<Scalars['String']>;
  stats: UserMeasurementStats;
  timestamp: Scalars['DateTime'];
};

export type UserMeasurementDataInput = {
  abdominalSkinfold?: InputMaybe<Scalars['Decimal']>;
  basalMetabolicRate?: InputMaybe<Scalars['Decimal']>;
  bicepsCircumference?: InputMaybe<Scalars['Decimal']>;
  bodyFat?: InputMaybe<Scalars['Decimal']>;
  bodyFatCaliper?: InputMaybe<Scalars['Decimal']>;
  bodyMassIndex?: InputMaybe<Scalars['Decimal']>;
  boneMass?: InputMaybe<Scalars['Decimal']>;
  calories?: InputMaybe<Scalars['Decimal']>;
  chestCircumference?: InputMaybe<Scalars['Decimal']>;
  chestSkinfold?: InputMaybe<Scalars['Decimal']>;
  custom?: InputMaybe<Scalars['JSONObject']>;
  hipCircumference?: InputMaybe<Scalars['Decimal']>;
  leanBodyMass?: InputMaybe<Scalars['Decimal']>;
  muscle?: InputMaybe<Scalars['Decimal']>;
  neckCircumference?: InputMaybe<Scalars['Decimal']>;
  thighCircumference?: InputMaybe<Scalars['Decimal']>;
  thighSkinfold?: InputMaybe<Scalars['Decimal']>;
  totalBodyWater?: InputMaybe<Scalars['Decimal']>;
  totalDailyEnergyExpenditure?: InputMaybe<Scalars['Decimal']>;
  visceralFat?: InputMaybe<Scalars['Decimal']>;
  waistCircumference?: InputMaybe<Scalars['Decimal']>;
  waistToHeightRatio?: InputMaybe<Scalars['Decimal']>;
  waistToHipRatio?: InputMaybe<Scalars['Decimal']>;
  weight?: InputMaybe<Scalars['Decimal']>;
};

export type UserMeasurementInput = {
  comment?: InputMaybe<Scalars['String']>;
  name?: InputMaybe<Scalars['String']>;
  stats: UserMeasurementDataInput;
  timestamp: Scalars['DateTime'];
};

export type UserMeasurementStats = {
  abdominalSkinfold?: Maybe<Scalars['Decimal']>;
  basalMetabolicRate?: Maybe<Scalars['Decimal']>;
  bicepsCircumference?: Maybe<Scalars['Decimal']>;
  bodyFat?: Maybe<Scalars['Decimal']>;
  bodyFatCaliper?: Maybe<Scalars['Decimal']>;
  bodyMassIndex?: Maybe<Scalars['Decimal']>;
  boneMass?: Maybe<Scalars['Decimal']>;
  calories?: Maybe<Scalars['Decimal']>;
  chestCircumference?: Maybe<Scalars['Decimal']>;
  chestSkinfold?: Maybe<Scalars['Decimal']>;
  custom?: Maybe<Scalars['JSONObject']>;
  hipCircumference?: Maybe<Scalars['Decimal']>;
  leanBodyMass?: Maybe<Scalars['Decimal']>;
  muscle?: Maybe<Scalars['Decimal']>;
  neckCircumference?: Maybe<Scalars['Decimal']>;
  thighCircumference?: Maybe<Scalars['Decimal']>;
  thighSkinfold?: Maybe<Scalars['Decimal']>;
  totalBodyWater?: Maybe<Scalars['Decimal']>;
  totalDailyEnergyExpenditure?: Maybe<Scalars['Decimal']>;
  visceralFat?: Maybe<Scalars['Decimal']>;
  waistCircumference?: Maybe<Scalars['Decimal']>;
  waistToHeightRatio?: Maybe<Scalars['Decimal']>;
  waistToHipRatio?: Maybe<Scalars['Decimal']>;
  weight?: Maybe<Scalars['Decimal']>;
};

export type UserMeasurementsInBuiltPreferences = {
  abdominalSkinfold: Scalars['Boolean'];
  basalMetabolicRate: Scalars['Boolean'];
  bicepsCircumference: Scalars['Boolean'];
  bodyFat: Scalars['Boolean'];
  bodyFatCaliper: Scalars['Boolean'];
  bodyMassIndex: Scalars['Boolean'];
  boneMass: Scalars['Boolean'];
  calories: Scalars['Boolean'];
  chestCircumference: Scalars['Boolean'];
  chestSkinfold: Scalars['Boolean'];
  hipCircumference: Scalars['Boolean'];
  leanBodyMass: Scalars['Boolean'];
  muscle: Scalars['Boolean'];
  neckCircumference: Scalars['Boolean'];
  thighCircumference: Scalars['Boolean'];
  thighSkinfold: Scalars['Boolean'];
  totalBodyWater: Scalars['Boolean'];
  totalDailyEnergyExpenditure: Scalars['Boolean'];
  visceralFat: Scalars['Boolean'];
  waistCircumference: Scalars['Boolean'];
  waistToHeightRatio: Scalars['Boolean'];
  waistToHipRatio: Scalars['Boolean'];
  weight: Scalars['Boolean'];
};

export type UserMeasurementsPreferences = {
  custom: Array<UserCustomMeasurement>;
  inbuilt: UserMeasurementsInBuiltPreferences;
};

export type UserMediaDetails = {
  /** The collections in which this media is present. */
  collections: Array<Collection>;
  /** The seen history of this media. */
  history: Array<Seen>;
  /** The seen item if it is in progress. */
  inProgress?: Maybe<Seen>;
  /** Whether the user is monitoring this media. */
  isMonitored: Scalars['Boolean'];
  /** The next episode of this media. */
  nextEpisode?: Maybe<UserMediaNextEpisode>;
  /** The reminder that the user has set for this media. */
  reminder?: Maybe<UserMediaReminder>;
  /** The public reviews of this media. */
  reviews: Array<ReviewItem>;
  /** The number of users who have seen this media */
  seenBy: Scalars['Int'];
};

export type UserMediaFeaturesEnabledPreferences = {
  anime: Scalars['Boolean'];
  audioBooks: Scalars['Boolean'];
  books: Scalars['Boolean'];
  manga: Scalars['Boolean'];
  movies: Scalars['Boolean'];
  podcasts: Scalars['Boolean'];
  shows: Scalars['Boolean'];
  videoGames: Scalars['Boolean'];
};

export type UserMediaNextEpisode = {
  episodeNumber?: Maybe<Scalars['Int']>;
  seasonNumber?: Maybe<Scalars['Int']>;
};

export type UserMediaReminder = {
  message: Scalars['String'];
  remindOn: Scalars['NaiveDate'];
};

export type UserMediaSummary = {
  anime: AnimeSummary;
  audioBooks: AudioBooksSummary;
  books: BooksSummary;
  creatorsInteractedWith: Scalars['Int'];
  manga: MangaSummary;
  movies: MoviesSummary;
  podcasts: PodcastsSummary;
  reviewsPosted: Scalars['Int'];
  shows: ShowsSummary;
  videoGames: VideoGamesSummary;
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
  episodeReleased: Scalars['Boolean'];
  numberOfSeasonsChanged: Scalars['Boolean'];
  releaseDateChanged: Scalars['Boolean'];
  statusChanged: Scalars['Boolean'];
};

export type UserPreferences = {
  featuresEnabled: UserFeaturesEnabledPreferences;
  fitness: UserFitnessPreferences;
  notifications: UserNotificationsPreferences;
};

export enum UserSinkIntegrationSettingKind {
  Jellyfin = 'JELLYFIN'
}

export type UserSummary = {
  calculatedOn: Scalars['DateTime'];
  fitness: UserFitnessSummary;
  media: UserMediaSummary;
};

export enum UserWeightUnit {
  Kilogram = 'KILOGRAM',
  Pound = 'POUND'
}

export enum UserYankIntegrationSettingKind {
  Audiobookshelf = 'AUDIOBOOKSHELF'
}

export type VideoGameSpecifics = {
  platforms: Array<Scalars['String']>;
};

export type VideoGameSpecificsInput = {
  platforms: Array<Scalars['String']>;
};

export type VideoGamesSummary = {
  played: Scalars['Int'];
};

export enum Visibility {
  Private = 'PRIVATE',
  Public = 'PUBLIC'
}

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
  identifier: Scalars['String'];
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

export type CreateUserYankIntegrationMutationVariables = Exact<{
  input: CreateUserYankIntegrationInput;
}>;


export type CreateUserYankIntegrationMutation = { createUserYankIntegration: number };

export type DeleteCollectionMutationVariables = Exact<{
  collectionName: Scalars['String'];
}>;


export type DeleteCollectionMutation = { deleteCollection: boolean };

export type DeleteMediaReminderMutationVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type DeleteMediaReminderMutation = { deleteMediaReminder: boolean };

export type DeleteReviewMutationVariables = Exact<{
  reviewId: Scalars['Int'];
}>;


export type DeleteReviewMutation = { deleteReview: boolean };

export type DeleteSeenItemMutationVariables = Exact<{
  seenId: Scalars['Int'];
}>;


export type DeleteSeenItemMutation = { deleteSeenItem: { id: number } };

export type DeleteUserMutationVariables = Exact<{
  toDeleteUserId: Scalars['Int'];
}>;


export type DeleteUserMutation = { deleteUser: boolean };

export type DeleteUserAuthTokenMutationVariables = Exact<{
  token: Scalars['String'];
}>;


export type DeleteUserAuthTokenMutation = { deleteUserAuthToken: boolean };

export type DeleteUserIntegrationMutationVariables = Exact<{
  integrationId: Scalars['Int'];
  integrationLot: UserIntegrationLot;
}>;


export type DeleteUserIntegrationMutation = { deleteUserIntegration: boolean };

export type DeleteUserMeasurementMutationVariables = Exact<{
  timestamp: Scalars['DateTime'];
}>;


export type DeleteUserMeasurementMutation = { deleteUserMeasurement: boolean };

export type DeleteUserNotificationPlatformMutationVariables = Exact<{
  notificationId: Scalars['Int'];
}>;


export type DeleteUserNotificationPlatformMutation = { deleteUserNotificationPlatform: boolean };

export type DeployImportJobMutationVariables = Exact<{
  input: DeployImportJobInput;
}>;


export type DeployImportJobMutation = { deployImportJob: string };

export type DeployUpdateMetadataJobMutationVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type DeployUpdateMetadataJobMutation = { deployUpdateMetadataJob: string };

export type GenerateApplicationTokenMutationVariables = Exact<{ [key: string]: never; }>;


export type GenerateApplicationTokenMutation = { generateApplicationToken: string };

export type LoginUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type LoginUserMutation = { loginUser: { __typename: 'LoginError', error: LoginErrorVariant } | { __typename: 'LoginResponse', apiKey: string } };

export type LogoutUserMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutUserMutation = { logoutUser: boolean };

export type MergeMetadataMutationVariables = Exact<{
  mergeFrom: Scalars['Int'];
  mergeInto: Scalars['Int'];
}>;


export type MergeMetadataMutation = { mergeMetadata: boolean };

export type PostReviewMutationVariables = Exact<{
  input: PostReviewInput;
}>;


export type PostReviewMutation = { postReview: { id: number } };

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
  metadataId: Scalars['Int'];
  collectionName: Scalars['String'];
}>;


export type RemoveMediaFromCollectionMutation = { removeMediaFromCollection: { id: number } };

export type TestUserNotificationPlatformsMutationVariables = Exact<{ [key: string]: never; }>;


export type TestUserNotificationPlatformsMutation = { testUserNotificationPlatforms: boolean };

export type ToggleMediaMonitorMutationVariables = Exact<{
  toMonitorMetadataId: Scalars['Int'];
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


export type CollectionContentsQuery = { collectionContents: { user: { name: string }, results: { total: number, nextPage?: number | null, items: Array<{ identifier: string, lot: MetadataLot, title: string, image?: string | null, publishYear?: number | null }> }, details: { name: string, description?: string | null, visibility: Visibility, createdOn: Date } } };

export type CollectionsQueryVariables = Exact<{
  input?: InputMaybe<CollectionInput>;
}>;


export type CollectionsQuery = { collections: Array<{ id: number, name: string, description?: string | null, visibility: Visibility, numItems: number }> };

export type CoreDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreDetailsQuery = { coreDetails: { version: string, authorName: string, repositoryLink: string, docsLink: string, defaultCredentials: boolean, passwordChangeAllowed: boolean, preferencesChangeAllowed: boolean, usernameChangeAllowed: boolean, itemDetailsHeight: number, reviewsDisabled: boolean, upgrade?: UpgradeType | null } };

export type CoreEnabledFeaturesQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreEnabledFeaturesQuery = { coreEnabledFeatures: { fileStorage: boolean, signupAllowed: boolean } };

export type CreatorDetailsQueryVariables = Exact<{
  creatorId: Scalars['Int'];
}>;


export type CreatorDetailsQuery = { creatorDetails: { details: { id: number, name: string, image?: string | null }, contents: Array<{ name: string, items: Array<{ identifier: string, lot: MetadataLot, title: string, image?: string | null, publishYear?: number | null }> }> } };

export type CreatorsListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type CreatorsListQuery = { creatorsList: { total: number, nextPage?: number | null, items: Array<{ id: number, name: string, image?: string | null, mediaCount: number }> } };

export type ExerciseQueryVariables = Exact<{
  exerciseId: Scalars['Int'];
}>;


export type ExerciseQuery = { exercise: { name: string, attributes: { force?: ExerciseForce | null, level: ExerciseLevel, mechanic?: ExerciseMechanic | null, equipment?: ExerciseEquipment | null, primaryMuscles: Array<ExerciseMuscle>, secondaryMuscles: Array<ExerciseMuscle>, category: ExerciseCategory, instructions: Array<string>, images: Array<string> } } };

export type ExercisesListQueryVariables = Exact<{
  input: ExercisesListInput;
}>;


export type ExercisesListQuery = { exercisesList: { total: number, nextPage?: number | null, items: Array<{ id: number, name: string, attributes: { primaryMuscles: Array<ExerciseMuscle>, images: Array<string> } }> } };

export type GetPresignedUrlQueryVariables = Exact<{
  key: Scalars['String'];
}>;


export type GetPresignedUrlQuery = { getPresignedUrl: string };

export type ImportReportsQueryVariables = Exact<{ [key: string]: never; }>;


export type ImportReportsQuery = { importReports: Array<{ id: number, source: ImportSource, startedOn: Date, finishedOn?: Date | null, success?: boolean | null, details?: { import: { total: number }, failedItems: Array<{ lot: MetadataLot, step: ImportFailStep, identifier: string, error?: string | null }> } | null }> };

export type LatestUserSummaryQueryVariables = Exact<{ [key: string]: never; }>;


export type LatestUserSummaryQuery = { latestUserSummary: { calculatedOn: Date, fitness: { measurementsRecorded: number }, media: { reviewsPosted: number, creatorsInteractedWith: number, manga: { chapters: number, read: number }, books: { pages: number, read: number }, movies: { runtime: number, watched: number }, anime: { episodes: number, watched: number }, podcasts: { runtime: number, played: number, playedEpisodes: number }, videoGames: { played: number }, shows: { runtime: number, watchedEpisodes: number, watchedSeasons: number, watched: number }, audioBooks: { runtime: number, played: number } } } };

export type MediaDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type MediaDetailsQuery = { mediaDetails: { title: string, description?: string | null, identifier: string, lot: MetadataLot, source: MetadataSource, posterImages: Array<string>, backdropImages: Array<string>, publishYear?: number | null, publishDate?: any | null, genres: Array<string>, sourceUrl?: string | null, creators: Array<{ name: string, items: Array<{ id: number, name: string, image?: string | null }> }>, animeSpecifics?: { episodes?: number | null } | null, audioBookSpecifics?: { runtime?: number | null } | null, bookSpecifics?: { pages?: number | null } | null, movieSpecifics?: { runtime?: number | null } | null, mangaSpecifics?: { volumes?: number | null, chapters?: number | null } | null, podcastSpecifics?: { totalEpisodes: number, episodes: Array<{ title: string, overview?: string | null, thumbnail?: string | null, number: number, runtime?: number | null }> } | null, showSpecifics?: { seasons: Array<{ seasonNumber: number, name: string, overview?: string | null, backdropImages: Array<string>, posterImages: Array<string>, episodes: Array<{ id: number, name: string, posterImages: Array<string>, episodeNumber: number, publishDate?: any | null, overview?: string | null, runtime?: number | null }> }> } | null, videoGameSpecifics?: { platforms: Array<string> } | null } };

export type MediaDetailsPartFragment = { title: string, description?: string | null, identifier: string, lot: MetadataLot, source: MetadataSource, posterImages: Array<string>, backdropImages: Array<string>, publishYear?: number | null, publishDate?: any | null, genres: Array<string>, sourceUrl?: string | null, creators: Array<{ name: string, items: Array<{ id: number, name: string, image?: string | null }> }>, animeSpecifics?: { episodes?: number | null } | null, audioBookSpecifics?: { runtime?: number | null } | null, bookSpecifics?: { pages?: number | null } | null, movieSpecifics?: { runtime?: number | null } | null, mangaSpecifics?: { volumes?: number | null, chapters?: number | null } | null, podcastSpecifics?: { totalEpisodes: number, episodes: Array<{ title: string, overview?: string | null, thumbnail?: string | null, number: number, runtime?: number | null }> } | null, showSpecifics?: { seasons: Array<{ seasonNumber: number, name: string, overview?: string | null, backdropImages: Array<string>, posterImages: Array<string>, episodes: Array<{ id: number, name: string, posterImages: Array<string>, episodeNumber: number, publishDate?: any | null, overview?: string | null, runtime?: number | null }> }> } | null, videoGameSpecifics?: { platforms: Array<string> } | null };

export type MediaListQueryVariables = Exact<{
  input: MediaListInput;
}>;


export type MediaListQuery = { mediaList: { total: number, nextPage?: number | null, items: Array<{ averageRating?: any | null, data: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> } };

export type MediaSearchQueryVariables = Exact<{
  lot: MetadataLot;
  source: MetadataSource;
  input: SearchInput;
}>;


export type MediaSearchQuery = { mediaSearch: { total: number, nextPage?: number | null, items: Array<{ databaseId?: number | null, item: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> } };

export type MediaSourcesForLotQueryVariables = Exact<{
  lot: MetadataLot;
}>;


export type MediaSourcesForLotQuery = { mediaSourcesForLot: Array<MetadataSource> };

export type ProvidersLanguageInformationQueryVariables = Exact<{ [key: string]: never; }>;


export type ProvidersLanguageInformationQuery = { providersLanguageInformation: Array<{ supported: Array<string>, default: string, source: MetadataSource }> };

export type ReviewByIdQueryVariables = Exact<{
  reviewId: Scalars['Int'];
}>;


export type ReviewByIdQuery = { reviewById: { rating?: any | null, text?: string | null, visibility: Visibility, spoiler: boolean, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null } };

export type UserAuthTokensQueryVariables = Exact<{ [key: string]: never; }>;


export type UserAuthTokensQuery = { userAuthTokens: Array<{ lastUsedOn: Date, token: string }> };

export type UserCreatorDetailsQueryVariables = Exact<{
  creatorId: Scalars['Int'];
}>;


export type UserCreatorDetailsQuery = { userCreatorDetails: { reviews: Array<{ id: number, rating?: any | null, text?: string | null, spoiler: boolean, visibility: Visibility, postedOn: Date, postedBy: { id: number, name: string } }> } };

export type UserDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserDetailsQuery = { userDetails: { __typename: 'User', id: number, email?: string | null, name: string, lot: UserLot } | { __typename: 'UserDetailsError' } };

export type UserIntegrationsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserIntegrationsQuery = { userIntegrations: Array<{ id: number, lot: UserIntegrationLot, description: string, timestamp: Date }> };

export type UserMeasurementsListQueryVariables = Exact<{ [key: string]: never; }>;


export type UserMeasurementsListQuery = { userMeasurementsList: Array<{ timestamp: Date, name?: string | null, comment?: string | null, stats: { weight?: any | null, bodyMassIndex?: any | null, totalBodyWater?: any | null, muscle?: any | null, leanBodyMass?: any | null, bodyFat?: any | null, boneMass?: any | null, visceralFat?: any | null, waistCircumference?: any | null, waistToHeightRatio?: any | null, hipCircumference?: any | null, waistToHipRatio?: any | null, chestCircumference?: any | null, thighCircumference?: any | null, bicepsCircumference?: any | null, neckCircumference?: any | null, bodyFatCaliper?: any | null, chestSkinfold?: any | null, abdominalSkinfold?: any | null, thighSkinfold?: any | null, basalMetabolicRate?: any | null, totalDailyEnergyExpenditure?: any | null, calories?: any | null, custom?: any | null } }> };

export type SeenPartFragment = { id: number, progress: number, state: SeenState, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null };

export type UserMediaDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int'];
}>;


export type UserMediaDetailsQuery = { userMediaDetails: { isMonitored: boolean, seenBy: number, collections: Array<{ id: number, name: string }>, inProgress?: { id: number, progress: number, state: SeenState, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null } | null, history: Array<{ id: number, progress: number, state: SeenState, startedOn?: any | null, finishedOn?: any | null, lastUpdatedOn: Date, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null }>, reviews: Array<{ id: number, rating?: any | null, text?: string | null, spoiler: boolean, visibility: Visibility, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null, postedOn: Date, postedBy: { id: number, name: string } }>, reminder?: { remindOn: any, message: string } | null, nextEpisode?: { seasonNumber?: number | null, episodeNumber?: number | null } | null } };

export type UserNotificationPlatformsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserNotificationPlatformsQuery = { userNotificationPlatforms: Array<{ id: number, description: string, timestamp: Date }> };

export type UserPreferencesQueryVariables = Exact<{ [key: string]: never; }>;


export type UserPreferencesQuery = { userPreferences: { fitness: { measurements: { custom: Array<{ name: string, dataType: UserCustomMeasurementDataType }>, inbuilt: { weight: boolean, bodyMassIndex: boolean, totalBodyWater: boolean, muscle: boolean, leanBodyMass: boolean, bodyFat: boolean, boneMass: boolean, visceralFat: boolean, waistCircumference: boolean, waistToHeightRatio: boolean, hipCircumference: boolean, waistToHipRatio: boolean, chestCircumference: boolean, thighCircumference: boolean, bicepsCircumference: boolean, neckCircumference: boolean, bodyFatCaliper: boolean, chestSkinfold: boolean, abdominalSkinfold: boolean, thighSkinfold: boolean, basalMetabolicRate: boolean, totalDailyEnergyExpenditure: boolean, calories: boolean } }, exercises: { saveHistory: number, weightUnit: UserWeightUnit } }, notifications: { episodeReleased: boolean, statusChanged: boolean, releaseDateChanged: boolean, numberOfSeasonsChanged: boolean }, featuresEnabled: { media: { anime: boolean, audioBooks: boolean, books: boolean, manga: boolean, movies: boolean, podcasts: boolean, shows: boolean, videoGames: boolean } } } };

export type UsersListQueryVariables = Exact<{ [key: string]: never; }>;


export type UsersListQuery = { usersList: Array<{ id: number, name: string, lot: UserLot }> };

export const MediaDetailsPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlMediaDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"creators"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"genres"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"animeSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movieSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volumes"}},{"kind":"Field","name":{"kind":"Name","value":"chapters"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"thumbnail"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGameSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platforms"}}]}}]}}]} as unknown as DocumentNode<MediaDetailsPartFragment, unknown>;
export const SeenPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]}}]} as unknown as DocumentNode<SeenPartFragment, unknown>;
export const AddMediaToCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddMediaToCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AddMediaToCollection"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addMediaToCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<AddMediaToCollectionMutation, AddMediaToCollectionMutationVariables>;
export const BulkProgressUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"BulkProgressUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdateInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bulkProgressUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<BulkProgressUpdateMutation, BulkProgressUpdateMutationVariables>;
export const CommitMediaDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitMedia"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"source"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataSource"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitMedia"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}},{"kind":"Argument","name":{"kind":"Name","value":"source"},"value":{"kind":"Variable","name":{"kind":"Name","value":"source"}}},{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitMediaMutation, CommitMediaMutationVariables>;
export const CreateCustomMediaDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCustomMedia"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCustomMediaInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomMedia"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCustomMediaError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]}}]} as unknown as DocumentNode<CreateCustomMediaMutation, CreateCustomMediaMutationVariables>;
export const CreateMediaReminderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateMediaReminder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateMediaReminderInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createMediaReminder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateMediaReminderMutation, CreateMediaReminderMutationVariables>;
export const CreateOrUpdateCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrUpdateCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateOrUpdateCollectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrUpdateCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateOrUpdateCollectionMutation, CreateOrUpdateCollectionMutationVariables>;
export const CreateUserMeasurementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserMeasurement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMeasurementInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserMeasurement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserMeasurementMutation, CreateUserMeasurementMutationVariables>;
export const CreateUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateUserNotificationPlatformInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserNotificationPlatformMutation, CreateUserNotificationPlatformMutationVariables>;
export const CreateUserSinkIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserSinkIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateUserSinkIntegrationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserSinkIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserSinkIntegrationMutation, CreateUserSinkIntegrationMutationVariables>;
export const CreateUserYankIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserYankIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateUserYankIntegrationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserYankIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserYankIntegrationMutation, CreateUserYankIntegrationMutationVariables>;
export const DeleteCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"collectionName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}}}]}]}}]} as unknown as DocumentNode<DeleteCollectionMutation, DeleteCollectionMutationVariables>;
export const DeleteMediaReminderDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteMediaReminder"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteMediaReminder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}]}]}}]} as unknown as DocumentNode<DeleteMediaReminderMutation, DeleteMediaReminderMutationVariables>;
export const DeleteReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"reviewId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}}}]}]}}]} as unknown as DocumentNode<DeleteReviewMutation, DeleteReviewMutationVariables>;
export const DeleteSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"seenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSeenItemMutation, DeleteSeenItemMutationVariables>;
export const DeleteUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"toDeleteUserId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMutation, DeleteUserMutationVariables>;
export const DeleteUserAuthTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserAuthToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"token"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserAuthToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"token"},"value":{"kind":"Variable","name":{"kind":"Name","value":"token"}}}]}]}}]} as unknown as DocumentNode<DeleteUserAuthTokenMutation, DeleteUserAuthTokenMutationVariables>;
export const DeleteUserIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"integrationLot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserIntegrationLot"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"integrationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"integrationLot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"integrationLot"}}}]}]}}]} as unknown as DocumentNode<DeleteUserIntegrationMutation, DeleteUserIntegrationMutationVariables>;
export const DeleteUserMeasurementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserMeasurement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DateTime"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserMeasurement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"timestamp"},"value":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMeasurementMutation, DeleteUserMeasurementMutationVariables>;
export const DeleteUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"notificationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserNotificationPlatformMutation, DeleteUserNotificationPlatformMutationVariables>;
export const DeployImportJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployImportJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeployImportJobInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployImportJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployImportJobMutation, DeployImportJobMutationVariables>;
export const DeployUpdateMetadataJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployUpdateMetadataJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployUpdateMetadataJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}]}]}}]} as unknown as DocumentNode<DeployUpdateMetadataJobMutation, DeployUpdateMetadataJobMutationVariables>;
export const GenerateApplicationTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GenerateApplicationToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateApplicationToken"}}]}}]} as unknown as DocumentNode<GenerateApplicationTokenMutation, GenerateApplicationTokenMutationVariables>;
export const LoginUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LoginUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"loginUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}}]}}]}}]}}]} as unknown as DocumentNode<LoginUserMutation, LoginUserMutationVariables>;
export const LogoutUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LogoutUser"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logoutUser"}}]}}]} as unknown as DocumentNode<LogoutUserMutation, LogoutUserMutationVariables>;
export const MergeMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MergeMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mergeMetadata"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mergeFrom"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}}},{"kind":"Argument","name":{"kind":"Name","value":"mergeInto"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}}}]}]}}]} as unknown as DocumentNode<MergeMetadataMutation, MergeMetadataMutationVariables>;
export const PostReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PostReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PostReviewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"postReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<PostReviewMutation, PostReviewMutationVariables>;
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
export const CollectionContentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CollectionContents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CollectionContentsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collectionContents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"results"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}}]}}]}}]}}]} as unknown as DocumentNode<CollectionContentsQuery, CollectionContentsQueryVariables>;
export const CollectionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Collections"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"CollectionInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"numItems"}}]}}]}}]} as unknown as DocumentNode<CollectionsQuery, CollectionsQueryVariables>;
export const CoreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"authorName"}},{"kind":"Field","name":{"kind":"Name","value":"repositoryLink"}},{"kind":"Field","name":{"kind":"Name","value":"docsLink"}},{"kind":"Field","name":{"kind":"Name","value":"defaultCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"passwordChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"preferencesChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"usernameChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"itemDetailsHeight"}},{"kind":"Field","name":{"kind":"Name","value":"reviewsDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"upgrade"}}]}}]}}]} as unknown as DocumentNode<CoreDetailsQuery, CoreDetailsQueryVariables>;
export const CoreEnabledFeaturesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fileStorage"}},{"kind":"Field","name":{"kind":"Name","value":"signupAllowed"}}]}}]}}]} as unknown as DocumentNode<CoreEnabledFeaturesQuery, CoreEnabledFeaturesQueryVariables>;
export const CreatorDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CreatorDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"creatorDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"creatorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]}}]} as unknown as DocumentNode<CreatorDetailsQuery, CreatorDetailsQueryVariables>;
export const CreatorsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CreatorsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"creatorsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"mediaCount"}}]}}]}}]}}]} as unknown as DocumentNode<CreatorsListQuery, CreatorsListQueryVariables>;
export const ExerciseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Exercise"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exercise"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"exerciseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"mechanic"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"primaryMuscles"}},{"kind":"Field","name":{"kind":"Name","value":"secondaryMuscles"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"instructions"}},{"kind":"Field","name":{"kind":"Name","value":"images"}}]}}]}}]}}]} as unknown as DocumentNode<ExerciseQuery, ExerciseQueryVariables>;
export const ExercisesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExercisesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExercisesListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exercisesList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"primaryMuscles"}},{"kind":"Field","name":{"kind":"Name","value":"images"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ExercisesListQuery, ExercisesListQueryVariables>;
export const GetPresignedUrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetPresignedUrl"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"getPresignedUrl"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<GetPresignedUrlQuery, GetPresignedUrlQueryVariables>;
export const ImportReportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ImportReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"importReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"success"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"import"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}}]}},{"kind":"Field","name":{"kind":"Name","value":"failedItems"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"step"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ImportReportsQuery, ImportReportsQueryVariables>;
export const LatestUserSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LatestUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"latestUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"calculatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"measurementsRecorded"}}]}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviewsPosted"}},{"kind":"Field","name":{"kind":"Name","value":"creatorsInteractedWith"}},{"kind":"Field","name":{"kind":"Name","value":"manga"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"chapters"}},{"kind":"Field","name":{"kind":"Name","value":"read"}}]}},{"kind":"Field","name":{"kind":"Name","value":"books"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}},{"kind":"Field","name":{"kind":"Name","value":"read"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movies"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"anime"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcasts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"played"}},{"kind":"Field","name":{"kind":"Name","value":"playedEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGames"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"played"}}]}},{"kind":"Field","name":{"kind":"Name","value":"shows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watchedEpisodes"}},{"kind":"Field","name":{"kind":"Name","value":"watchedSeasons"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBooks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"played"}}]}}]}}]}}]}}]} as unknown as DocumentNode<LatestUserSummaryQuery, LatestUserSummaryQueryVariables>;
export const MediaDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaDetailsPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlMediaDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"creators"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"genres"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"animeSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movieSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volumes"}},{"kind":"Field","name":{"kind":"Name","value":"chapters"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"thumbnail"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGameSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platforms"}}]}}]}}]} as unknown as DocumentNode<MediaDetailsQuery, MediaDetailsQueryVariables>;
export const MediaListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaListQuery, MediaListQueryVariables>;
export const MediaSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"source"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataSource"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}},{"kind":"Argument","name":{"kind":"Name","value":"source"},"value":{"kind":"Variable","name":{"kind":"Name","value":"source"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"databaseId"}},{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaSearchQuery, MediaSearchQueryVariables>;
export const MediaSourcesForLotDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaSourcesForLot"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaSourcesForLot"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}}]}]}}]} as unknown as DocumentNode<MediaSourcesForLotQuery, MediaSourcesForLotQueryVariables>;
export const ProvidersLanguageInformationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProvidersLanguageInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providersLanguageInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"supported"}},{"kind":"Field","name":{"kind":"Name","value":"default"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<ProvidersLanguageInformationQuery, ProvidersLanguageInformationQueryVariables>;
export const ReviewByIdDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ReviewById"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviewById"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"reviewId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}}]}}]}}]} as unknown as DocumentNode<ReviewByIdQuery, ReviewByIdQueryVariables>;
export const UserAuthTokensDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserAuthTokens"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userAuthTokens"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lastUsedOn"}},{"kind":"Field","name":{"kind":"Name","value":"token"}}]}}]}}]} as unknown as DocumentNode<UserAuthTokensQuery, UserAuthTokensQueryVariables>;
export const UserCreatorDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserCreatorDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userCreatorDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"creatorId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"creatorId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserCreatorDetailsQuery, UserCreatorDetailsQueryVariables>;
export const UserDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]}}]} as unknown as DocumentNode<UserDetailsQuery, UserDetailsQueryVariables>;
export const UserIntegrationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<UserIntegrationsQuery, UserIntegrationsQueryVariables>;
export const UserMeasurementsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMeasurementsList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMeasurementsList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"stats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMassIndex"}},{"kind":"Field","name":{"kind":"Name","value":"totalBodyWater"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"leanBodyMass"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFat"}},{"kind":"Field","name":{"kind":"Name","value":"boneMass"}},{"kind":"Field","name":{"kind":"Name","value":"visceralFat"}},{"kind":"Field","name":{"kind":"Name","value":"waistCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHeightRatio"}},{"kind":"Field","name":{"kind":"Name","value":"hipCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHipRatio"}},{"kind":"Field","name":{"kind":"Name","value":"chestCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"thighCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bicepsCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"neckCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFatCaliper"}},{"kind":"Field","name":{"kind":"Name","value":"chestSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"abdominalSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"thighSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"basalMetabolicRate"}},{"kind":"Field","name":{"kind":"Name","value":"totalDailyEnergyExpenditure"}},{"kind":"Field","name":{"kind":"Name","value":"calories"}},{"kind":"Field","name":{"kind":"Name","value":"custom"}}]}}]}}]}}]} as unknown as DocumentNode<UserMeasurementsListQuery, UserMeasurementsListQueryVariables>;
export const UserMediaDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMediaDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"reminder"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"remindOn"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isMonitored"}},{"kind":"Field","name":{"kind":"Name","value":"seenBy"}},{"kind":"Field","name":{"kind":"Name","value":"nextEpisode"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]}}]} as unknown as DocumentNode<UserMediaDetailsQuery, UserMediaDetailsQueryVariables>;
export const UserNotificationPlatformsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<UserNotificationPlatformsQuery, UserNotificationPlatformsQueryVariables>;
export const UserPreferencesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserPreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userPreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"measurements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"custom"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inbuilt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMassIndex"}},{"kind":"Field","name":{"kind":"Name","value":"totalBodyWater"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"leanBodyMass"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFat"}},{"kind":"Field","name":{"kind":"Name","value":"boneMass"}},{"kind":"Field","name":{"kind":"Name","value":"visceralFat"}},{"kind":"Field","name":{"kind":"Name","value":"waistCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHeightRatio"}},{"kind":"Field","name":{"kind":"Name","value":"hipCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHipRatio"}},{"kind":"Field","name":{"kind":"Name","value":"chestCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"thighCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bicepsCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"neckCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFatCaliper"}},{"kind":"Field","name":{"kind":"Name","value":"chestSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"abdominalSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"thighSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"basalMetabolicRate"}},{"kind":"Field","name":{"kind":"Name","value":"totalDailyEnergyExpenditure"}},{"kind":"Field","name":{"kind":"Name","value":"calories"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"saveHistory"}},{"kind":"Field","name":{"kind":"Name","value":"weightUnit"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodeReleased"}},{"kind":"Field","name":{"kind":"Name","value":"statusChanged"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDateChanged"}},{"kind":"Field","name":{"kind":"Name","value":"numberOfSeasonsChanged"}}]}},{"kind":"Field","name":{"kind":"Name","value":"featuresEnabled"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"anime"}},{"kind":"Field","name":{"kind":"Name","value":"audioBooks"}},{"kind":"Field","name":{"kind":"Name","value":"books"}},{"kind":"Field","name":{"kind":"Name","value":"manga"}},{"kind":"Field","name":{"kind":"Name","value":"movies"}},{"kind":"Field","name":{"kind":"Name","value":"podcasts"}},{"kind":"Field","name":{"kind":"Name","value":"shows"}},{"kind":"Field","name":{"kind":"Name","value":"videoGames"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserPreferencesQuery, UserPreferencesQueryVariables>;
export const UsersListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UsersList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"usersList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]} as unknown as DocumentNode<UsersListQuery, UsersListQueryVariables>;