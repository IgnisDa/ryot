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
  DateTime: { input: string; output: string; }
  Decimal: { input: string; output: string; }
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
  NaiveDate: { input: string; output: string; }
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

export enum BackgroundJob {
  CalculateSummary = 'CALCULATE_SUMMARY',
  EvaluateWorkouts = 'EVALUATE_WORKOUTS',
  RecalculateCalendarEvents = 'RECALCULATE_CALENDAR_EVENTS',
  UpdateAllExercises = 'UPDATE_ALL_EXERCISES',
  UpdateAllMetadata = 'UPDATE_ALL_METADATA',
  YankIntegrationsData = 'YANK_INTEGRATIONS_DATA'
}

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

export type ChangeCollectionToEntityInput = {
  collectionName: Scalars['String']['input'];
  entityId: Scalars['String']['input'];
  entityLot: EntityLot;
};

export type Collection = {
  createdOn: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  lastUpdatedOn: Scalars['DateTime']['output'];
  name: Scalars['String']['output'];
  visibility: Visibility;
};

export type CollectionContents = {
  details: Collection;
  results: MediaCollectionContentsResults;
  reviews: Array<ReviewItem>;
  user: User;
};

export type CollectionContentsFilter = {
  entityType?: InputMaybe<EntityLot>;
  metadataLot?: InputMaybe<MetadataLot>;
};

export type CollectionContentsInput = {
  collectionId: Scalars['Int']['input'];
  filter?: InputMaybe<CollectionContentsFilter>;
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<CollectionContentsSortInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export enum CollectionContentsSortBy {
  Date = 'DATE',
  LastUpdatedOn = 'LAST_UPDATED_ON',
  Title = 'TITLE'
}

export type CollectionContentsSortInput = {
  by?: CollectionContentsSortBy;
  order?: GraphqlSortOrder;
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
  credentialsChangeAllowed: Scalars['Boolean']['output'];
  defaultCredentials: Scalars['Boolean']['output'];
  deployAdminJobsAllowed: Scalars['Boolean']['output'];
  docsLink: Scalars['String']['output'];
  itemDetailsHeight: Scalars['Int']['output'];
  pageLimit: Scalars['Int']['output'];
  preferencesChangeAllowed: Scalars['Boolean']['output'];
  repositoryLink: Scalars['String']['output'];
  reviewsDisabled: Scalars['Boolean']['output'];
  timezone: Scalars['String']['output'];
  upgrade?: Maybe<UpgradeType>;
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
  authHeader?: InputMaybe<Scalars['String']['input']>;
  baseUrl?: InputMaybe<Scalars['String']['input']>;
  lot: UserNotificationSettingKind;
  priority?: InputMaybe<Scalars['Int']['input']>;
};

export type CreateUserSinkIntegrationInput = {
  lot: UserSinkIntegrationSettingKind;
  username?: InputMaybe<Scalars['String']['input']>;
};

export type CreateUserYankIntegrationInput = {
  baseUrl: Scalars['String']['input'];
  lot: UserYankIntegrationSettingKind;
  token: Scalars['String']['input'];
};

export type CreatorDetails = {
  contents: Array<CreatorDetailsGroupedByRole>;
  details: Person;
  sourceUrl?: Maybe<Scalars['String']['output']>;
};

export type CreatorDetailsGroupedByRole = {
  /** The media items in which this role was performed. */
  items: Array<PartialMetadata>;
  /** The name of the role performed. */
  name: Scalars['String']['output'];
};

export enum DashboardElementLot {
  Actions = 'ACTIONS',
  InProgress = 'IN_PROGRESS',
  Summary = 'SUMMARY',
  Upcoming = 'UPCOMING'
}

export type DeployGenericJsonImportInput = {
  export: Scalars['String']['input'];
};

export type DeployGoodreadsImportInput = {
  csvPath: Scalars['String']['input'];
};

export type DeployImportJobInput = {
  genericJson?: InputMaybe<DeployGenericJsonImportInput>;
  goodreads?: InputMaybe<DeployGoodreadsImportInput>;
  mal?: InputMaybe<DeployMalImportInput>;
  mediaTracker?: InputMaybe<DeployMediaTrackerImportInput>;
  movary?: InputMaybe<DeployMovaryImportInput>;
  source: ImportSource;
  storyGraph?: InputMaybe<DeployStoryGraphImportInput>;
  strongApp?: InputMaybe<DeployStrongAppImportInput>;
  trakt?: InputMaybe<DeployTraktImportInput>;
};

export type DeployMalImportInput = {
  /** The anime export file path (uploaded via temporary upload). */
  animePath: Scalars['String']['input'];
  /** The manga export file path (uploaded via temporary upload). */
  mangaPath: Scalars['String']['input'];
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

export type DeployStrongAppImportInput = {
  exportPath: Scalars['String']['input'];
  mapping: Array<StrongAppImportMapping>;
};

export type DeployTraktImportInput = {
  username: Scalars['String']['input'];
};

export type EditSeenItemInput = {
  finishedOn?: InputMaybe<Scalars['NaiveDate']['input']>;
  seenId: Scalars['Int']['input'];
  startedOn?: InputMaybe<Scalars['NaiveDate']['input']>;
};

export type EditUserWorkoutInput = {
  endTime?: InputMaybe<Scalars['DateTime']['input']>;
  id: Scalars['String']['input'];
  startTime?: InputMaybe<Scalars['DateTime']['input']>;
};

/** The assets that were uploaded for an entity. */
export type EntityAssets = {
  /** The keys of the S3 images. */
  images: Array<Scalars['String']['output']>;
  /** The keys of the S3 videos. */
  videos: Array<Scalars['String']['output']>;
};

/** The assets that were uploaded for an entity. */
export type EntityAssetsInput = {
  /** The keys of the S3 images. */
  images: Array<Scalars['String']['input']>;
  /** The keys of the S3 videos. */
  videos: Array<Scalars['String']['input']>;
};

export enum EntityLot {
  Collection = 'COLLECTION',
  Exercise = 'EXERCISE',
  Media = 'MEDIA',
  MediaGroup = 'MEDIA_GROUP',
  Person = 'PERSON'
}

export type Exercise = {
  attributes: ExerciseAttributes;
  equipment?: Maybe<ExerciseEquipment>;
  force?: Maybe<ExerciseForce>;
  id: Scalars['String']['output'];
  level: ExerciseLevel;
  lot: ExerciseLot;
  mechanic?: Maybe<ExerciseMechanic>;
  muscles: Array<ExerciseMuscle>;
  source: ExerciseSource;
};

export type ExerciseAttributes = {
  images: Array<Scalars['String']['output']>;
  instructions: Array<Scalars['String']['output']>;
};

export type ExerciseAttributesInput = {
  images: Array<Scalars['String']['input']>;
  instructions: Array<Scalars['String']['input']>;
};

export type ExerciseBestSetRecord = {
  data: WorkoutSetRecord;
  exerciseIdx: Scalars['Int']['output'];
  setIdx: Scalars['Int']['output'];
  workoutDoneOn: Scalars['DateTime']['output'];
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

export type ExerciseInput = {
  attributes: ExerciseAttributesInput;
  equipment?: InputMaybe<ExerciseEquipment>;
  force?: InputMaybe<ExerciseForce>;
  id: Scalars['String']['input'];
  level: ExerciseLevel;
  lot: ExerciseLot;
  mechanic?: InputMaybe<ExerciseMechanic>;
  muscles: Array<ExerciseMuscle>;
  source: ExerciseSource;
};

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

export type ExerciseListItem = {
  id: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  lastUpdatedOn?: Maybe<Scalars['DateTime']['output']>;
  lot: ExerciseLot;
  muscle?: Maybe<ExerciseMuscle>;
  numTimesInteracted?: Maybe<Scalars['Int']['output']>;
};

export type ExerciseListResults = {
  details: SearchDetails;
  items: Array<ExerciseListItem>;
};

/** The different types of exercises that can be done. */
export enum ExerciseLot {
  DistanceAndDuration = 'DISTANCE_AND_DURATION',
  Duration = 'DURATION',
  Reps = 'REPS',
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

export enum ExerciseSortBy {
  LastPerformed = 'LAST_PERFORMED',
  Name = 'NAME',
  NumTimesPerformed = 'NUM_TIMES_PERFORMED'
}

export enum ExerciseSource {
  Custom = 'CUSTOM',
  Github = 'GITHUB'
}

export type ExercisesListInput = {
  filter?: InputMaybe<ExerciseListFilter>;
  search: SearchInput;
  sortBy?: InputMaybe<ExerciseSortBy>;
};

export enum ExportItem {
  Measurements = 'MEASUREMENTS',
  Media = 'MEDIA',
  People = 'PEOPLE',
  Workouts = 'WORKOUTS'
}

export type ExportJob = {
  endedAt: Scalars['DateTime']['output'];
  exported: Array<ExportItem>;
  startedAt: Scalars['DateTime']['output'];
  url: Scalars['String']['output'];
};

export type GeneralFeatures = {
  fileStorage: Scalars['Boolean']['output'];
  signupAllowed: Scalars['Boolean']['output'];
};

export type GenreDetails = {
  contents: MediaCollectionContentsResults;
  details: GenreListItem;
};

export type GenreDetailsInput = {
  genreId: Scalars['Int']['input'];
  page?: InputMaybe<Scalars['Int']['input']>;
};

export type GenreListItem = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  numItems?: Maybe<Scalars['Int']['output']>;
};

export type GenreListResults = {
  details: SearchDetails;
  items: Array<GenreListItem>;
};

export type GraphqlCalendarEvent = {
  calendarEventId: Scalars['Int']['output'];
  date: Scalars['NaiveDate']['output'];
  metadataId: Scalars['Int']['output'];
  metadataImage?: Maybe<Scalars['String']['output']>;
  metadataLot: MetadataLot;
  metadataTitle: Scalars['String']['output'];
  podcastEpisodeNumber?: Maybe<Scalars['Int']['output']>;
  showEpisodeNumber?: Maybe<Scalars['Int']['output']>;
  showSeasonNumber?: Maybe<Scalars['Int']['output']>;
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
  genres: Array<GenreListItem>;
  group?: Maybe<GraphqlMediaGroup>;
  id: Scalars['Int']['output'];
  identifier: Scalars['String']['output'];
  isNsfw?: Maybe<Scalars['Boolean']['output']>;
  lot: MetadataLot;
  mangaSpecifics?: Maybe<MangaSpecifics>;
  movieSpecifics?: Maybe<MovieSpecifics>;
  originalLanguage?: Maybe<Scalars['String']['output']>;
  podcastSpecifics?: Maybe<PodcastSpecifics>;
  productionStatus?: Maybe<Scalars['String']['output']>;
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

export enum GraphqlSortOrder {
  Asc = 'ASC',
  Desc = 'DESC'
}

export type GraphqlUserIntegration = {
  description: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  lot: UserIntegrationLot;
  slug?: Maybe<Scalars['String']['output']>;
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

export type GroupedCalendarEvent = {
  date: Scalars['NaiveDate']['output'];
  events: Array<GraphqlCalendarEvent>;
};

export type IdAndNamedObject = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
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

/** Comments left in replies to posted reviews. */
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
  GenericJson = 'GENERIC_JSON',
  Goodreads = 'GOODREADS',
  Mal = 'MAL',
  MediaTracker = 'MEDIA_TRACKER',
  Movary = 'MOVARY',
  StoryGraph = 'STORY_GRAPH',
  StrongApp = 'STRONG_APP',
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
  validFor: Scalars['Int']['output'];
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
  Owned = 'OWNED',
  Rated = 'RATED',
  Unrated = 'UNRATED',
  Unseen = 'UNSEEN'
}

export type MediaListInput = {
  filter?: InputMaybe<MediaFilter>;
  lot: MetadataLot;
  search: SearchInput;
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
  /** Whether the user has interacted with this media item. */
  hasInteracted: Scalars['Boolean']['output'];
  item: MediaSearchItem;
};

export type MediaSearchItemWithLot = {
  details: MediaSearchItem;
  entityLot: EntityLot;
  metadataLot?: Maybe<MetadataLot>;
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
  order?: GraphqlSortOrder;
};

export type MetadataCreator = {
  character?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['Int']['output']>;
  image?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type MetadataCreatorGroupedByRole = {
  items: Array<MetadataCreator>;
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

/** The different types of media that can be stored. */
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

/** The different sources (or providers) from which data can be obtained from. */
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
  /** Add a entity to a collection if it is not there, otherwise do nothing. */
  addEntityToCollection: Scalars['Boolean']['output'];
  /** Fetch details about a media and create a media item in the database. */
  commitMedia: IdObject;
  /** Create a custom exercise. */
  createCustomExercise: Scalars['String']['output'];
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
  /** Delete an S3 object by the given key. */
  deleteS3Object: Scalars['Boolean']['output'];
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
  /** Delete a workout and remove all exercise associations. */
  deleteUserWorkout: Scalars['Boolean']['output'];
  /** Start a background job. */
  deployBackgroundJob: Scalars['Boolean']['output'];
  /** Deploy job to update progress of media items in bulk. */
  deployBulkProgressUpdate: Scalars['Boolean']['output'];
  /** Deploy a job to export data for a user. */
  deployExportJob: Scalars['Boolean']['output'];
  /** Add job to import data from various sources. */
  deployImportJob: Scalars['String']['output'];
  /** Deploy a job to update a media item's metadata. */
  deployUpdateMetadataJob: Scalars['String']['output'];
  /** Edit the start/end date of a seen item. */
  editSeenItem: Scalars['Boolean']['output'];
  /** Change the details about a user's workout. */
  editUserWorkout: Scalars['Boolean']['output'];
  /** Generate an auth token without any expiry. */
  generateAuthToken: Scalars['String']['output'];
  /** Login a user using their username and password and return an auth token. */
  loginUser: LoginResult;
  /**
   * Merge a media item into another. This will move all `seen`, `collection`
   * and `review` associations with the new user and then delete the old media
   * item completely.
   */
  mergeMetadata: Scalars['Boolean']['output'];
  /** Create or update a review. */
  postReview: IdObject;
  /** Get a presigned URL (valid for 10 minutes) for a given file name. */
  presignedPutS3Url: PresignedPutUrlResponse;
  /**
   * Create a new user for the service. Also set their `lot` as admin if
   * they are the first user.
   */
  registerUser: RegisterResult;
  /** Remove an entity from a collection if it is not there, otherwise do nothing. */
  removeEntityFromCollection: IdObject;
  /** Test all notification platforms for the currently logged in user. */
  testUserNotificationPlatforms: Scalars['Boolean']['output'];
  /** Toggle the monitor on a media for a user. */
  toggleMediaMonitor: Scalars['Boolean']['output'];
  /** Mark media as owned or remove ownership. */
  toggleMediaOwnership: Scalars['Boolean']['output'];
  /** Update a user's profile details. */
  updateUser: IdObject;
  /** Change a user's preferences. */
  updateUserPreference: Scalars['Boolean']['output'];
};


export type MutationRootAddEntityToCollectionArgs = {
  input: ChangeCollectionToEntityInput;
};


export type MutationRootCommitMediaArgs = {
  identifier: Scalars['String']['input'];
  lot: MetadataLot;
  source: MetadataSource;
};


export type MutationRootCreateCustomExerciseArgs = {
  input: ExerciseInput;
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


export type MutationRootDeleteS3ObjectArgs = {
  key: Scalars['String']['input'];
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


export type MutationRootDeleteUserWorkoutArgs = {
  workoutId: Scalars['String']['input'];
};


export type MutationRootDeployBackgroundJobArgs = {
  jobName: BackgroundJob;
};


export type MutationRootDeployBulkProgressUpdateArgs = {
  input: Array<ProgressUpdateInput>;
};


export type MutationRootDeployExportJobArgs = {
  toExport: Array<ExportItem>;
};


export type MutationRootDeployImportJobArgs = {
  input: DeployImportJobInput;
};


export type MutationRootDeployUpdateMetadataJobArgs = {
  metadataId: Scalars['Int']['input'];
};


export type MutationRootEditSeenItemArgs = {
  input: EditSeenItemInput;
};


export type MutationRootEditUserWorkoutArgs = {
  input: EditUserWorkoutInput;
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


export type MutationRootPresignedPutS3UrlArgs = {
  input: PresignedPutUrlInput;
};


export type MutationRootRegisterUserArgs = {
  input: UserInput;
};


export type MutationRootRemoveEntityFromCollectionArgs = {
  input: ChangeCollectionToEntityInput;
};


export type MutationRootToggleMediaMonitorArgs = {
  metadataId: Scalars['Int']['input'];
};


export type MutationRootToggleMediaOwnershipArgs = {
  metadataId: Scalars['Int']['input'];
  ownedOn?: InputMaybe<Scalars['NaiveDate']['input']>;
};


export type MutationRootUpdateUserArgs = {
  input: UpdateUserInput;
};


export type MutationRootUpdateUserPreferenceArgs = {
  input: UpdateUserPreferenceInput;
};

export type PartialMetadata = {
  id: Scalars['Int']['output'];
  identifier: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  lot: MetadataLot;
  source: MetadataSource;
  title: Scalars['String']['output'];
};

export type PeopleListInput = {
  search: SearchInput;
  sort?: InputMaybe<PersonSortInput>;
};

export type Person = {
  birthDate?: Maybe<Scalars['NaiveDate']['output']>;
  createdOn: Scalars['DateTime']['output'];
  deathDate?: Maybe<Scalars['NaiveDate']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  displayImages: Array<Scalars['String']['output']>;
  gender?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  identifier: Scalars['String']['output'];
  lastUpdatedOn: Scalars['DateTime']['output'];
  name: Scalars['String']['output'];
  place?: Maybe<Scalars['String']['output']>;
  source: MetadataSource;
  website?: Maybe<Scalars['String']['output']>;
};

export enum PersonSortBy {
  MediaItems = 'MEDIA_ITEMS',
  Name = 'NAME'
}

export type PersonSortInput = {
  by?: PersonSortBy;
  order?: GraphqlSortOrder;
};

export type PodcastEpisode = {
  id: Scalars['String']['output'];
  number: Scalars['Int']['output'];
  overview?: Maybe<Scalars['String']['output']>;
  publishDate: Scalars['NaiveDate']['output'];
  runtime?: Maybe<Scalars['Int']['output']>;
  thumbnail?: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
};

export type PodcastEpisodeInput = {
  id: Scalars['String']['input'];
  number: Scalars['Int']['input'];
  overview?: InputMaybe<Scalars['String']['input']>;
  publishDate: Scalars['NaiveDate']['input'];
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
  collectionId?: InputMaybe<Scalars['Int']['input']>;
  date?: InputMaybe<Scalars['DateTime']['input']>;
  metadataGroupId?: InputMaybe<Scalars['Int']['input']>;
  metadataId?: InputMaybe<Scalars['Int']['input']>;
  personId?: InputMaybe<Scalars['Int']['input']>;
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

export type PresignedPutUrlInput = {
  fileName: Scalars['String']['input'];
  prefix: Scalars['String']['input'];
};

export type PresignedPutUrlResponse = {
  key: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

/** An exercise that has been processed and committed to the database. */
export type ProcessedExercise = {
  assets: EntityAssets;
  lot: ExerciseLot;
  name: Scalars['String']['output'];
  notes: Array<Scalars['String']['output']>;
  restTime?: Maybe<Scalars['Int']['output']>;
  sets: Array<WorkoutSetRecord>;
  /** The indices of the exercises with which this has been superset with. */
  supersetWith: Array<Scalars['Int']['output']>;
  total: WorkoutOrExerciseTotals;
};

export type ProgressUpdateInput = {
  changeState?: InputMaybe<SeenState>;
  date?: InputMaybe<Scalars['NaiveDate']['input']>;
  metadataId: Scalars['Int']['input'];
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  progress?: InputMaybe<Scalars['Int']['input']>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
};

export type ProviderLanguageInformation = {
  default: Scalars['String']['output'];
  source: MetadataSource;
  supported: Array<Scalars['String']['output']>;
};

export type PublicCollectionItem = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  username: Scalars['String']['output'];
};

export type PublicCollectionsListResults = {
  details: SearchDetails;
  items: Array<PublicCollectionItem>;
};

export type QueryRoot = {
  /** Get the contents of a collection and respect visibility. */
  collectionContents: CollectionContents;
  /** Get some primary information about the service. */
  coreDetails: CoreDetails;
  /** Get all the features that are enabled for the service */
  coreEnabledFeatures: GeneralFeatures;
  /** Get details about an exercise. */
  exerciseDetails: Exercise;
  /** Get all the parameters related to exercises. */
  exerciseParameters: ExerciseParameters;
  /** Get a paginated list of exercises in the database. */
  exercisesList: ExerciseListResults;
  /** Get details about a genre present in the database. */
  genreDetails: GenreDetails;
  /** Get paginated list of genres. */
  genresList: GenreListResults;
  /** Get a presigned URL (valid for 90 minutes) for a given key. */
  getPresignedS3Url: Scalars['String']['output'];
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
  /** Get paginated list of people. */
  peopleList: MediaCreatorSearchResults;
  /** Get details about a creator present in the database. */
  personDetails: CreatorDetails;
  /** Get all languages supported by all the providers. */
  providersLanguageInformation: Array<ProviderLanguageInformation>;
  /** Get a list of publicly visible collections. */
  publicCollectionsList: PublicCollectionsListResults;
  /** Get a review by its ID. */
  review: ReviewItem;
  /** Get calendar events for a user between a given date range. */
  userCalendarEvents: Array<GroupedCalendarEvent>;
  /** Get all collections for the currently logged in user. */
  userCollectionsList: Array<CollectionItem>;
  /** Get details about the currently logged in user. */
  userDetails: UserDetailsResult;
  /** Get information about an exercise for a user. */
  userExerciseDetails: UserExerciseDetails;
  /** Get all the export jobs for the current user. */
  userExports: Array<ExportJob>;
  /** Get all the integrations for the currently logged in user. */
  userIntegrations: Array<GraphqlUserIntegration>;
  /** Get all the measurements for a user. */
  userMeasurementsList: Array<UserMeasurement>;
  /** Get details that can be displayed to a user for a media. */
  userMediaDetails: UserMediaDetails;
  /** Get details that can be displayed to a user for a metadata group. */
  userMetadataGroupDetails: UserMetadataGroupDetails;
  /** Get all the notification platforms for the currently logged in user. */
  userNotificationPlatforms: Array<GraphqlUserNotificationPlatform>;
  /** Get details that can be displayed to a user for a creator. */
  userPersonDetails: UserCreatorDetails;
  /** Get a user's preferences. */
  userPreferences: UserPreferences;
  /** Get upcoming calendar events for the given filter. */
  userUpcomingCalendarEvents: Array<GraphqlCalendarEvent>;
  /** Get a paginated list of workouts done by the user. */
  userWorkoutList: WorkoutListResults;
  /** Get details about all the users in the service. */
  usersList: Array<User>;
  /** Get details about a workout. */
  workoutDetails: Workout;
};


export type QueryRootCollectionContentsArgs = {
  input: CollectionContentsInput;
};


export type QueryRootExerciseDetailsArgs = {
  exerciseId: Scalars['String']['input'];
};


export type QueryRootExercisesListArgs = {
  input: ExercisesListInput;
};


export type QueryRootGenreDetailsArgs = {
  input: GenreDetailsInput;
};


export type QueryRootGenresListArgs = {
  input: SearchInput;
};


export type QueryRootGetPresignedS3UrlArgs = {
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


export type QueryRootPeopleListArgs = {
  input: PeopleListInput;
};


export type QueryRootPersonDetailsArgs = {
  personId: Scalars['Int']['input'];
};


export type QueryRootPublicCollectionsListArgs = {
  input: SearchInput;
};


export type QueryRootReviewArgs = {
  reviewId: Scalars['Int']['input'];
};


export type QueryRootUserCalendarEventsArgs = {
  input: UserCalendarEventInput;
};


export type QueryRootUserCollectionsListArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
};


export type QueryRootUserExerciseDetailsArgs = {
  input: UserExerciseDetailsInput;
};


export type QueryRootUserMeasurementsListArgs = {
  input: UserMeasurementsListInput;
};


export type QueryRootUserMediaDetailsArgs = {
  metadataId: Scalars['Int']['input'];
};


export type QueryRootUserMetadataGroupDetailsArgs = {
  metadataGroupId: Scalars['Int']['input'];
};


export type QueryRootUserPersonDetailsArgs = {
  personId: Scalars['Int']['input'];
};


export type QueryRootUserUpcomingCalendarEventsArgs = {
  input: UserUpcomingCalendarEventInput;
};


export type QueryRootUserWorkoutListArgs = {
  input: SearchInput;
};


export type QueryRootWorkoutDetailsArgs = {
  workoutId: Scalars['String']['input'];
};

export type RegisterError = {
  error: RegisterErrorVariant;
};

export enum RegisterErrorVariant {
  Disabled = 'DISABLED',
  UsernameAlreadyExists = 'USERNAME_ALREADY_EXISTS'
}

export type RegisterResult = IdObject | RegisterError;

/** A user that has commented on a review. */
export type ReviewCommentUser = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
};

export type ReviewItem = {
  comments: Array<ImportOrExportItemReviewComment>;
  id: Scalars['Int']['output'];
  podcastEpisode?: Maybe<Scalars['Int']['output']>;
  postedBy: IdAndNamedObject;
  postedOn: Scalars['DateTime']['output'];
  rating?: Maybe<Scalars['Decimal']['output']>;
  showEpisode?: Maybe<Scalars['Int']['output']>;
  showSeason?: Maybe<Scalars['Int']['output']>;
  spoiler: Scalars['Boolean']['output'];
  text?: Maybe<Scalars['String']['output']>;
  visibility: Visibility;
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
  numTimesUpdated?: Maybe<Scalars['Int']['output']>;
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

/** The types of set (mostly characterized by exertion level). */
export enum SetLot {
  Drop = 'DROP',
  Failure = 'FAILURE',
  Normal = 'NORMAL',
  WarmUp = 'WARM_UP'
}

/** Details about the statistics of the set performed. */
export type SetStatisticInput = {
  distance?: InputMaybe<Scalars['Decimal']['input']>;
  duration?: InputMaybe<Scalars['Decimal']['input']>;
  oneRm?: InputMaybe<Scalars['Decimal']['input']>;
  pace?: InputMaybe<Scalars['Decimal']['input']>;
  reps?: InputMaybe<Scalars['Int']['input']>;
  volume?: InputMaybe<Scalars['Decimal']['input']>;
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

export type StrongAppImportMapping = {
  multiplier?: InputMaybe<Scalars['Decimal']['input']>;
  sourceName: Scalars['String']['input'];
  targetName: Scalars['String']['input'];
};

export type UpdateUserInput = {
  email?: InputMaybe<Scalars['String']['input']>;
  password?: InputMaybe<Scalars['String']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserPreferenceInput = {
  /**
   * Dot delimited path to the property that needs to be changed. Setting it\
   * to empty resets the preferences to default.
   */
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

export type UserCalendarEventInput = {
  month: Scalars['Int']['input'];
  year: Scalars['Int']['input'];
};

export type UserCreatorDetails = {
  collections: Array<Collection>;
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

export type UserExerciseDetails = {
  collections: Array<Collection>;
  details?: Maybe<UserToEntity>;
  history?: Maybe<Array<UserExerciseHistoryInformation>>;
};

export type UserExerciseDetailsInput = {
  exerciseId: Scalars['String']['input'];
  /** The number of elements to return in the history. */
  takeHistory?: InputMaybe<Scalars['Int']['input']>;
};

export type UserExerciseHistoryInformation = {
  index: Scalars['Int']['output'];
  sets: Array<WorkoutSetRecord>;
  workoutId: Scalars['String']['output'];
  workoutName: Scalars['String']['output'];
  workoutTime: Scalars['DateTime']['output'];
};

export type UserExerciseInput = {
  assets: EntityAssetsInput;
  exerciseId: Scalars['String']['input'];
  notes: Array<Scalars['String']['input']>;
  restTime?: InputMaybe<Scalars['Int']['input']>;
  sets: Array<UserWorkoutSetRecord>;
  supersetWith: Array<Scalars['Int']['input']>;
};

export type UserExercisePreferences = {
  defaultTimer?: Maybe<Scalars['Int']['output']>;
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
  workouts: Scalars['Boolean']['output'];
};

export type UserFitnessPreferences = {
  exercises: UserExercisePreferences;
  measurements: UserMeasurementsPreferences;
};

export type UserFitnessSummary = {
  exercisesInteractedWith: Scalars['Int']['output'];
  measurementsRecorded: Scalars['Int']['output'];
  workouts: UserFitnessWorkoutSummary;
};

export type UserFitnessWorkoutSummary = {
  duration: Scalars['Int']['output'];
  recorded: Scalars['Int']['output'];
  weight: Scalars['Decimal']['output'];
};

export type UserGeneralDashboardElement = {
  hidden: Scalars['Boolean']['output'];
  numElements?: Maybe<Scalars['Int']['output']>;
  section: DashboardElementLot;
};

export type UserGeneralPreferences = {
  dashboard: Array<UserGeneralDashboardElement>;
  disableYankIntegrations: Scalars['Boolean']['output'];
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

/** An export of a measurement taken at a point in time. */
export type UserMeasurement = {
  /** Any comment associated entered by the user. */
  comment?: Maybe<Scalars['String']['output']>;
  /** The name given to this measurement by the user. */
  name?: Maybe<Scalars['String']['output']>;
  /** The contents of the actual measurement. */
  stats: UserMeasurementStats;
  /** The date and time this measurement was made. */
  timestamp: Scalars['DateTime']['output'];
};

/** The actual statistics that were logged in a user measurement. */
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

/** An export of a measurement taken at a point in time. */
export type UserMeasurementInput = {
  /** Any comment associated entered by the user. */
  comment?: InputMaybe<Scalars['String']['input']>;
  /** The name given to this measurement by the user. */
  name?: InputMaybe<Scalars['String']['input']>;
  /** The contents of the actual measurement. */
  stats: UserMeasurementDataInput;
  /** The date and time this measurement was made. */
  timestamp: Scalars['DateTime']['input'];
};

/** The actual statistics that were logged in a user measurement. */
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
  /** The ownership status of the media. */
  ownership?: Maybe<UserMediaOwnership>;
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

export type UserMediaOwnership = {
  markedOn: Scalars['DateTime']['output'];
  ownedOn?: Maybe<Scalars['NaiveDate']['output']>;
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
  mediaInteractedWith: Scalars['Int']['output'];
  movies: MoviesSummary;
  podcasts: PodcastsSummary;
  reviewsPosted: Scalars['Int']['output'];
  shows: ShowsSummary;
  videoGames: VideoGamesSummary;
  visualNovels: VisualNovelsSummary;
};

export type UserMetadataGroupDetails = {
  collections: Array<Collection>;
  reviews: Array<ReviewItem>;
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
  episodeImagesChanged: Scalars['Boolean']['output'];
  episodeNameChanged: Scalars['Boolean']['output'];
  episodeReleased: Scalars['Boolean']['output'];
  newReviewPosted: Scalars['Boolean']['output'];
  numberOfChaptersOrEpisodesChanged: Scalars['Boolean']['output'];
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

export type UserToEntity = {
  exerciseExtraInformation?: Maybe<UserToExerciseExtraInformation>;
  exerciseId?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  lastUpdatedOn: Scalars['DateTime']['output'];
  metadataId?: Maybe<Scalars['Int']['output']>;
  metadataMonitored?: Maybe<Scalars['Boolean']['output']>;
  metadataOwnership?: Maybe<UserMediaOwnership>;
  metadataReminder?: Maybe<UserMediaReminder>;
  numTimesInteracted: Scalars['Int']['output'];
  userId: Scalars['Int']['output'];
};

export type UserToExerciseBestSetExtraInformation = {
  lot: WorkoutSetPersonalBest;
  sets: Array<ExerciseBestSetRecord>;
};

export type UserToExerciseExtraInformation = {
  history: Array<UserToExerciseHistoryExtraInformation>;
  lifetimeStats: WorkoutOrExerciseTotals;
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

export type UserUpcomingCalendarEventInput = {
  nextDays?: InputMaybe<Scalars['Int']['input']>;
  nextMedia?: InputMaybe<Scalars['Int']['input']>;
};

export type UserWorkoutInput = {
  assets: EntityAssetsInput;
  comment?: InputMaybe<Scalars['String']['input']>;
  endTime: Scalars['DateTime']['input'];
  exercises: Array<UserExerciseInput>;
  name: Scalars['String']['input'];
  repeatedFrom?: InputMaybe<Scalars['String']['input']>;
  startTime: Scalars['DateTime']['input'];
};

export type UserWorkoutSetRecord = {
  confirmedAt?: InputMaybe<Scalars['DateTime']['input']>;
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

/** A workout that was completed by the user. */
export type Workout = {
  comment?: Maybe<Scalars['String']['output']>;
  endTime: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  information: WorkoutInformation;
  name: Scalars['String']['output'];
  repeatedFrom?: Maybe<Scalars['String']['output']>;
  startTime: Scalars['DateTime']['output'];
  summary: WorkoutSummary;
};

/** Information about a workout done. */
export type WorkoutInformation = {
  assets: EntityAssets;
  exercises: Array<ProcessedExercise>;
};

export type WorkoutListItem = {
  endTime: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  startTime: Scalars['DateTime']['output'];
  summary: WorkoutSummary;
};

export type WorkoutListResults = {
  details: SearchDetails;
  items: Array<WorkoutListItem>;
};

/** The totals of a workout and the different bests achieved. */
export type WorkoutOrExerciseTotals = {
  distance: Scalars['Decimal']['output'];
  duration: Scalars['Decimal']['output'];
  /** The number of personal bests achieved. */
  personalBestsAchieved: Scalars['Int']['output'];
  reps: Scalars['Int']['output'];
  /** The total seconds that were logged in the rest timer. */
  restTime: Scalars['Int']['output'];
  weight: Scalars['Decimal']['output'];
};

/** The different types of personal bests that can be achieved on a set. */
export enum WorkoutSetPersonalBest {
  OneRm = 'ONE_RM',
  Pace = 'PACE',
  Reps = 'REPS',
  Time = 'TIME',
  Volume = 'VOLUME',
  Weight = 'WEIGHT'
}

/** Details about the set performed. */
export type WorkoutSetRecord = {
  confirmedAt?: Maybe<Scalars['DateTime']['output']>;
  lot: SetLot;
  personalBests: Array<WorkoutSetPersonalBest>;
  statistic: WorkoutSetStatistic;
  totals: WorkoutSetTotals;
};

/** Details about the statistics of the set performed. */
export type WorkoutSetStatistic = {
  distance?: Maybe<Scalars['Decimal']['output']>;
  duration?: Maybe<Scalars['Decimal']['output']>;
  oneRm?: Maybe<Scalars['Decimal']['output']>;
  pace?: Maybe<Scalars['Decimal']['output']>;
  reps?: Maybe<Scalars['Int']['output']>;
  volume?: Maybe<Scalars['Decimal']['output']>;
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type WorkoutSetTotals = {
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type WorkoutSummary = {
  exercises: Array<WorkoutSummaryExercise>;
  total: WorkoutOrExerciseTotals;
};

/** The summary about an exercise done in a workout. */
export type WorkoutSummaryExercise = {
  bestSet: WorkoutSetRecord;
  id: Scalars['String']['output'];
  lot: ExerciseLot;
  numSets: Scalars['Int']['output'];
};

export type AddEntityToCollectionMutationVariables = Exact<{
  input: ChangeCollectionToEntityInput;
}>;


export type AddEntityToCollectionMutation = { addEntityToCollection: boolean };

export type CommitMediaMutationVariables = Exact<{
  lot: MetadataLot;
  source: MetadataSource;
  identifier: Scalars['String']['input'];
}>;


export type CommitMediaMutation = { commitMedia: { id: number } };

export type CreateCustomExerciseMutationVariables = Exact<{
  input: ExerciseInput;
}>;


export type CreateCustomExerciseMutation = { createCustomExercise: string };

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


export type CreateUserMeasurementMutation = { createUserMeasurement: string };

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

export type DeleteS3ObjectMutationVariables = Exact<{
  key: Scalars['String']['input'];
}>;


export type DeleteS3ObjectMutation = { deleteS3Object: boolean };

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

export type DeleteUserWorkoutMutationVariables = Exact<{
  workoutId: Scalars['String']['input'];
}>;


export type DeleteUserWorkoutMutation = { deleteUserWorkout: boolean };

export type DeployBackgroundJobMutationVariables = Exact<{
  jobName: BackgroundJob;
}>;


export type DeployBackgroundJobMutation = { deployBackgroundJob: boolean };

export type DeployBulkProgressUpdateMutationVariables = Exact<{
  input: Array<ProgressUpdateInput> | ProgressUpdateInput;
}>;


export type DeployBulkProgressUpdateMutation = { deployBulkProgressUpdate: boolean };

export type DeployExportJobMutationVariables = Exact<{
  toExport: Array<ExportItem> | ExportItem;
}>;


export type DeployExportJobMutation = { deployExportJob: boolean };

export type DeployImportJobMutationVariables = Exact<{
  input: DeployImportJobInput;
}>;


export type DeployImportJobMutation = { deployImportJob: string };

export type DeployUpdateMetadataJobMutationVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type DeployUpdateMetadataJobMutation = { deployUpdateMetadataJob: string };

export type EditSeenItemMutationVariables = Exact<{
  input: EditSeenItemInput;
}>;


export type EditSeenItemMutation = { editSeenItem: boolean };

export type EditUserWorkoutMutationVariables = Exact<{
  input: EditUserWorkoutInput;
}>;


export type EditUserWorkoutMutation = { editUserWorkout: boolean };

export type GenerateAuthTokenMutationVariables = Exact<{ [key: string]: never; }>;


export type GenerateAuthTokenMutation = { generateAuthToken: string };

export type LoginUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type LoginUserMutation = { loginUser: { __typename: 'LoginError', error: LoginErrorVariant } | { __typename: 'LoginResponse', apiKey: string, validFor: number } };

export type MergeMetadataMutationVariables = Exact<{
  mergeFrom: Scalars['Int']['input'];
  mergeInto: Scalars['Int']['input'];
}>;


export type MergeMetadataMutation = { mergeMetadata: boolean };

export type PostReviewMutationVariables = Exact<{
  input: PostReviewInput;
}>;


export type PostReviewMutation = { postReview: { id: number } };

export type PresignedPutS3UrlMutationVariables = Exact<{
  input: PresignedPutUrlInput;
}>;


export type PresignedPutS3UrlMutation = { presignedPutS3Url: { key: string, uploadUrl: string } };

export type RegisterUserMutationVariables = Exact<{
  input: UserInput;
}>;


export type RegisterUserMutation = { registerUser: { __typename: 'IdObject', id: number } | { __typename: 'RegisterError', error: RegisterErrorVariant } };

export type RemoveEntityFromCollectionMutationVariables = Exact<{
  input: ChangeCollectionToEntityInput;
}>;


export type RemoveEntityFromCollectionMutation = { removeEntityFromCollection: { id: number } };

export type TestUserNotificationPlatformsMutationVariables = Exact<{ [key: string]: never; }>;


export type TestUserNotificationPlatformsMutation = { testUserNotificationPlatforms: boolean };

export type ToggleMediaMonitorMutationVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type ToggleMediaMonitorMutation = { toggleMediaMonitor: boolean };

export type ToggleMediaOwnershipMutationVariables = Exact<{
  metadataId: Scalars['Int']['input'];
  ownedOn?: InputMaybe<Scalars['NaiveDate']['input']>;
}>;


export type ToggleMediaOwnershipMutation = { toggleMediaOwnership: boolean };

export type UpdateUserMutationVariables = Exact<{
  input: UpdateUserInput;
}>;


export type UpdateUserMutation = { updateUser: { id: number } };

export type UpdateUserPreferenceMutationVariables = Exact<{
  input: UpdateUserPreferenceInput;
}>;


export type UpdateUserPreferenceMutation = { updateUserPreference: boolean };

export type CollectionContentsQueryVariables = Exact<{
  input: CollectionContentsInput;
}>;


export type CollectionContentsQuery = { collectionContents: { user: { name: string }, reviews: Array<{ id: number, rating?: string | null, text?: string | null, spoiler: boolean, visibility: Visibility, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null, postedOn: string, postedBy: { id: number, name: string }, comments: Array<{ id: string, text: string, createdOn: string, likedBy: Array<number>, user: { id: number, name: string } }> }>, results: { details: { total: number, nextPage?: number | null }, items: Array<{ metadataLot?: MetadataLot | null, entityLot: EntityLot, details: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> }, details: { name: string, description?: string | null, visibility: Visibility, createdOn: string } } };

export type CoreDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreDetailsQuery = { coreDetails: { version: string, timezone: string, authorName: string, repositoryLink: string, docsLink: string, defaultCredentials: boolean, credentialsChangeAllowed: boolean, preferencesChangeAllowed: boolean, itemDetailsHeight: number, reviewsDisabled: boolean, videosDisabled: boolean, upgrade?: UpgradeType | null, pageLimit: number, deployAdminJobsAllowed: boolean } };

export type CoreEnabledFeaturesQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreEnabledFeaturesQuery = { coreEnabledFeatures: { fileStorage: boolean, signupAllowed: boolean } };

export type ExerciseDetailsQueryVariables = Exact<{
  exerciseId: Scalars['String']['input'];
}>;


export type ExerciseDetailsQuery = { exerciseDetails: { id: string, lot: ExerciseLot, source: ExerciseSource, level: ExerciseLevel, force?: ExerciseForce | null, mechanic?: ExerciseMechanic | null, equipment?: ExerciseEquipment | null, muscles: Array<ExerciseMuscle>, attributes: { instructions: Array<string>, images: Array<string> } } };

export type ExerciseParametersQueryVariables = Exact<{ [key: string]: never; }>;


export type ExerciseParametersQuery = { exerciseParameters: { downloadRequired: boolean, filters: { type: Array<ExerciseLot>, level: Array<ExerciseLevel>, force: Array<ExerciseForce>, mechanic: Array<ExerciseMechanic>, equipment: Array<ExerciseEquipment>, muscle: Array<ExerciseMuscle> } } };

export type ExercisesListQueryVariables = Exact<{
  input: ExercisesListInput;
}>;


export type ExercisesListQuery = { exercisesList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: string, lot: ExerciseLot, image?: string | null, muscle?: ExerciseMuscle | null, numTimesInteracted?: number | null, lastUpdatedOn?: string | null }> } };

export type GenreDetailsQueryVariables = Exact<{
  input: GenreDetailsInput;
}>;


export type GenreDetailsQuery = { genreDetails: { details: { id: number, name: string, numItems?: number | null }, contents: { details: { total: number, nextPage?: number | null }, items: Array<{ metadataLot?: MetadataLot | null, details: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> } } };

export type GenresListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type GenresListQuery = { genresList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: number, name: string, numItems?: number | null }> } };

export type GetPresignedS3UrlQueryVariables = Exact<{
  key: Scalars['String']['input'];
}>;


export type GetPresignedS3UrlQuery = { getPresignedS3Url: string };

export type ImportReportsQueryVariables = Exact<{ [key: string]: never; }>;


export type ImportReportsQuery = { importReports: Array<{ id: number, source: ImportSource, startedOn: string, finishedOn?: string | null, success?: boolean | null, details?: { import: { total: number }, failedItems: Array<{ lot: MetadataLot, step: ImportFailStep, identifier: string, error?: string | null }> } | null }> };

export type LatestUserSummaryQueryVariables = Exact<{ [key: string]: never; }>;


export type LatestUserSummaryQuery = { latestUserSummary: { calculatedOn: string, fitness: { measurementsRecorded: number, exercisesInteractedWith: number, workouts: { recorded: number, duration: number, weight: string } }, media: { reviewsPosted: number, creatorsInteractedWith: number, mediaInteractedWith: number, manga: { chapters: number, read: number }, books: { pages: number, read: number }, movies: { runtime: number, watched: number }, anime: { episodes: number, watched: number }, podcasts: { runtime: number, played: number, playedEpisodes: number }, visualNovels: { played: number, runtime: number }, videoGames: { played: number }, shows: { runtime: number, watchedEpisodes: number, watchedSeasons: number, watched: number }, audioBooks: { runtime: number, played: number } } } };

export type MediaAdditionalDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type MediaAdditionalDetailsQuery = { mediaDetails: { lot: MetadataLot, creators: Array<{ name: string, items: Array<{ id?: number | null, name: string, image?: string | null, character?: string | null }> }>, assets: { images: Array<string>, videos: Array<{ videoId: string, source: MetadataVideoSource }> }, suggestions: Array<{ id: number, lot: MetadataLot, source: MetadataSource, identifier: string, title: string, image?: string | null }>, animeSpecifics?: { episodes?: number | null } | null, audioBookSpecifics?: { runtime?: number | null } | null, bookSpecifics?: { pages?: number | null } | null, movieSpecifics?: { runtime?: number | null } | null, mangaSpecifics?: { volumes?: number | null, chapters?: number | null } | null, podcastSpecifics?: { totalEpisodes: number, episodes: Array<{ title: string, overview?: string | null, thumbnail?: string | null, number: number, runtime?: number | null, publishDate: string }> } | null, showSpecifics?: { seasons: Array<{ seasonNumber: number, name: string, overview?: string | null, backdropImages: Array<string>, posterImages: Array<string>, episodes: Array<{ id: number, name: string, posterImages: Array<string>, episodeNumber: number, publishDate?: string | null, overview?: string | null, runtime?: number | null }> }> } | null, visualNovelSpecifics?: { length?: number | null } | null, videoGameSpecifics?: { platforms: Array<string> } | null } };

export type MediaListQueryVariables = Exact<{
  input: MediaListInput;
}>;


export type MediaListQuery = { mediaList: { details: { total: number, nextPage?: number | null }, items: Array<{ averageRating?: string | null, data: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> } };

export type MediaMainDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type MediaMainDetailsQuery = { mediaDetails: { title: string, lot: MetadataLot, source: MetadataSource, isNsfw?: boolean | null, sourceUrl?: string | null, identifier: string, description?: string | null, publishYear?: number | null, publishDate?: string | null, providerRating?: string | null, productionStatus?: string | null, originalLanguage?: string | null, genres: Array<{ id: number, name: string }>, group?: { id: number, name: string, part: number } | null } };

export type MediaSearchQueryVariables = Exact<{
  lot: MetadataLot;
  source: MetadataSource;
  input: SearchInput;
}>;


export type MediaSearchQuery = { mediaSearch: { details: { total: number, nextPage?: number | null }, items: Array<{ databaseId?: number | null, hasInteracted: boolean, item: { identifier: string, title: string, image?: string | null, publishYear?: number | null } }> } };

export type MediaSourcesForLotQueryVariables = Exact<{
  lot: MetadataLot;
}>;


export type MediaSourcesForLotQuery = { mediaSourcesForLot: Array<MetadataSource> };

export type MetadataGroupDetailsQueryVariables = Exact<{
  metadataGroupId: Scalars['Int']['input'];
}>;


export type MetadataGroupDetailsQuery = { metadataGroupDetails: { sourceUrl?: string | null, details: { id: number, title: string, lot: MetadataLot, source: MetadataSource, displayImages: Array<string>, parts: number }, contents: Array<{ id: number, lot: MetadataLot, source: MetadataSource, identifier: string, title: string, image?: string | null }> } };

export type MetadataGroupsListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type MetadataGroupsListQuery = { metadataGroupsList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: number, title: string, lot: MetadataLot, parts: number, image?: string | null }> } };

export type PersonDetailsQueryVariables = Exact<{
  personId: Scalars['Int']['input'];
}>;


export type PersonDetailsQuery = { personDetails: { sourceUrl?: string | null, details: { id: number, name: string, source: MetadataSource, description?: string | null, birthDate?: string | null, deathDate?: string | null, place?: string | null, website?: string | null, gender?: string | null, displayImages: Array<string> }, contents: Array<{ name: string, items: Array<{ id: number, title: string, image?: string | null }> }> } };

export type PeopleListQueryVariables = Exact<{
  input: PeopleListInput;
}>;


export type PeopleListQuery = { peopleList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: number, name: string, image?: string | null, mediaCount: number }> } };

export type ProvidersLanguageInformationQueryVariables = Exact<{ [key: string]: never; }>;


export type ProvidersLanguageInformationQuery = { providersLanguageInformation: Array<{ supported: Array<string>, default: string, source: MetadataSource }> };

export type PublicCollectionsListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type PublicCollectionsListQuery = { publicCollectionsList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: number, name: string, username: string }> } };

export type ReviewQueryVariables = Exact<{
  reviewId: Scalars['Int']['input'];
}>;


export type ReviewQuery = { review: { rating?: string | null, text?: string | null, visibility: Visibility, spoiler: boolean, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null } };

export type UserCalendarEventsQueryVariables = Exact<{
  input: UserCalendarEventInput;
}>;


export type UserCalendarEventsQuery = { userCalendarEvents: Array<{ date: string, events: Array<{ calendarEventId: number, metadataId: number, metadataTitle: string, metadataLot: MetadataLot, metadataImage?: string | null, date: string, showSeasonNumber?: number | null, showEpisodeNumber?: number | null, podcastEpisodeNumber?: number | null }> }> };

export type UserCollectionsListQueryVariables = Exact<{
  name?: InputMaybe<Scalars['String']['input']>;
}>;


export type UserCollectionsListQuery = { userCollectionsList: Array<{ id: number, name: string, description?: string | null, visibility: Visibility, numItems: number }> };

export type UserDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserDetailsQuery = { userDetails: { __typename: 'User', id: number, email?: string | null, name: string, lot: UserLot } | { __typename: 'UserDetailsError' } };

export type UserExerciseDetailsQueryVariables = Exact<{
  input: UserExerciseDetailsInput;
}>;


export type UserExerciseDetailsQuery = { userExerciseDetails: { collections: Array<{ id: number, name: string }>, history?: Array<{ workoutId: string, workoutName: string, workoutTime: string, index: number, sets: Array<{ lot: SetLot, statistic: { duration?: string | null, distance?: string | null, reps?: number | null, weight?: string | null, oneRm?: string | null, pace?: string | null, volume?: string | null } }> }> | null, details?: { exerciseId?: string | null, numTimesInteracted: number, lastUpdatedOn: string, exerciseExtraInformation?: { lifetimeStats: { weight: string, reps: number, distance: string, duration: string, personalBestsAchieved: number }, personalBests: Array<{ lot: WorkoutSetPersonalBest, sets: Array<{ workoutId: string, workoutDoneOn: string, exerciseIdx: number, setIdx: number, data: { lot: SetLot, statistic: { duration?: string | null, distance?: string | null, reps?: number | null, weight?: string | null, oneRm?: string | null, pace?: string | null, volume?: string | null } } }> }> } | null } | null } };

export type UserExportsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserExportsQuery = { userExports: Array<{ startedAt: string, endedAt: string, url: string, exported: Array<ExportItem> }> };

export type UserIntegrationsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserIntegrationsQuery = { userIntegrations: Array<{ id: number, lot: UserIntegrationLot, description: string, timestamp: string, slug?: string | null }> };

export type UserMeasurementsListQueryVariables = Exact<{
  input: UserMeasurementsListInput;
}>;


export type UserMeasurementsListQuery = { userMeasurementsList: Array<{ timestamp: string, name?: string | null, comment?: string | null, stats: { weight?: string | null, bodyMassIndex?: string | null, totalBodyWater?: string | null, muscle?: string | null, leanBodyMass?: string | null, bodyFat?: string | null, boneMass?: string | null, visceralFat?: string | null, waistCircumference?: string | null, waistToHeightRatio?: string | null, hipCircumference?: string | null, waistToHipRatio?: string | null, chestCircumference?: string | null, thighCircumference?: string | null, bicepsCircumference?: string | null, neckCircumference?: string | null, bodyFatCaliper?: string | null, chestSkinfold?: string | null, abdominalSkinfold?: string | null, thighSkinfold?: string | null, basalMetabolicRate?: string | null, totalDailyEnergyExpenditure?: string | null, calories?: string | null, custom?: any | null } }> };

export type UserMediaDetailsQueryVariables = Exact<{
  metadataId: Scalars['Int']['input'];
}>;


export type UserMediaDetailsQuery = { userMediaDetails: { averageRating?: string | null, isMonitored: boolean, seenBy: number, collections: Array<{ id: number, name: string }>, inProgress?: { id: number, progress: number, state: SeenState, startedOn?: string | null, finishedOn?: string | null, lastUpdatedOn: string, numTimesUpdated?: number | null, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null } | null, history: Array<{ id: number, progress: number, state: SeenState, startedOn?: string | null, finishedOn?: string | null, lastUpdatedOn: string, numTimesUpdated?: number | null, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null }>, reviews: Array<{ id: number, rating?: string | null, text?: string | null, spoiler: boolean, visibility: Visibility, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null, postedOn: string, postedBy: { id: number, name: string }, comments: Array<{ id: string, text: string, createdOn: string, likedBy: Array<number>, user: { id: number, name: string } }> }>, reminder?: { remindOn: string, message: string } | null, ownership?: { markedOn: string, ownedOn?: string | null } | null, nextEpisode?: { seasonNumber?: number | null, episodeNumber?: number | null } | null } };

export type UserMetadataGroupDetailsQueryVariables = Exact<{
  metadataGroupId: Scalars['Int']['input'];
}>;


export type UserMetadataGroupDetailsQuery = { userMetadataGroupDetails: { reviews: Array<{ id: number, rating?: string | null, text?: string | null, spoiler: boolean, visibility: Visibility, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null, postedOn: string, postedBy: { id: number, name: string }, comments: Array<{ id: string, text: string, createdOn: string, likedBy: Array<number>, user: { id: number, name: string } }> }>, collections: Array<{ id: number, name: string }> } };

export type UserNotificationPlatformsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserNotificationPlatformsQuery = { userNotificationPlatforms: Array<{ id: number, description: string, timestamp: string }> };

export type UserPersonDetailsQueryVariables = Exact<{
  personId: Scalars['Int']['input'];
}>;


export type UserPersonDetailsQuery = { userPersonDetails: { collections: Array<{ id: number, name: string }>, reviews: Array<{ id: number, rating?: string | null, text?: string | null, spoiler: boolean, visibility: Visibility, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null, postedOn: string, postedBy: { id: number, name: string }, comments: Array<{ id: string, text: string, createdOn: string, likedBy: Array<number>, user: { id: number, name: string } }> }> } };

export type UserPreferencesQueryVariables = Exact<{ [key: string]: never; }>;


export type UserPreferencesQuery = { userPreferences: { general: { reviewScale: UserReviewScale, displayNsfw: boolean, disableYankIntegrations: boolean, dashboard: Array<{ section: DashboardElementLot, hidden: boolean, numElements?: number | null }> }, fitness: { measurements: { custom: Array<{ name: string, dataType: UserCustomMeasurementDataType }>, inbuilt: { weight: boolean, bodyMassIndex: boolean, totalBodyWater: boolean, muscle: boolean, leanBodyMass: boolean, bodyFat: boolean, boneMass: boolean, visceralFat: boolean, waistCircumference: boolean, waistToHeightRatio: boolean, hipCircumference: boolean, waistToHipRatio: boolean, chestCircumference: boolean, thighCircumference: boolean, bicepsCircumference: boolean, neckCircumference: boolean, bodyFatCaliper: boolean, chestSkinfold: boolean, abdominalSkinfold: boolean, thighSkinfold: boolean, basalMetabolicRate: boolean, totalDailyEnergyExpenditure: boolean, calories: boolean } }, exercises: { saveHistory: number, defaultTimer?: number | null, unitSystem: UserUnitSystem } }, notifications: { episodeReleased: boolean, episodeNameChanged: boolean, episodeImagesChanged: boolean, statusChanged: boolean, releaseDateChanged: boolean, numberOfSeasonsChanged: boolean, numberOfChaptersOrEpisodesChanged: boolean, newReviewPosted: boolean }, featuresEnabled: { fitness: { enabled: boolean, workouts: boolean, measurements: boolean }, media: { enabled: boolean, anime: boolean, audioBook: boolean, book: boolean, manga: boolean, movie: boolean, podcast: boolean, show: boolean, videoGame: boolean, visualNovel: boolean } } } };

export type UserUpcomingCalendarEventsQueryVariables = Exact<{
  input: UserUpcomingCalendarEventInput;
}>;


export type UserUpcomingCalendarEventsQuery = { userUpcomingCalendarEvents: Array<{ calendarEventId: number, metadataId: number, metadataTitle: string, metadataLot: MetadataLot, metadataImage?: string | null, date: string, showSeasonNumber?: number | null, showEpisodeNumber?: number | null, podcastEpisodeNumber?: number | null }> };

export type UserWorkoutListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type UserWorkoutListQuery = { userWorkoutList: { details: { total: number, nextPage?: number | null }, items: Array<{ id: string, name?: string | null, startTime: string, endTime: string, summary: { total: { personalBestsAchieved: number, weight: string, reps: number, distance: string, duration: string, restTime: number }, exercises: Array<{ numSets: number, id: string, lot: ExerciseLot, bestSet: { lot: SetLot, personalBests: Array<WorkoutSetPersonalBest>, statistic: { duration?: string | null, distance?: string | null, reps?: number | null, weight?: string | null, oneRm?: string | null, pace?: string | null, volume?: string | null } } }> } }> } };

export type UsersListQueryVariables = Exact<{ [key: string]: never; }>;


export type UsersListQuery = { usersList: Array<{ id: number, name: string, lot: UserLot }> };

export type WorkoutDetailsQueryVariables = Exact<{
  workoutId: Scalars['String']['input'];
}>;


export type WorkoutDetailsQuery = { workoutDetails: { id: string, name: string, comment?: string | null, startTime: string, endTime: string, summary: { total: { personalBestsAchieved: number, weight: string, reps: number, distance: string, duration: string, restTime: number }, exercises: Array<{ numSets: number, id: string, lot: ExerciseLot, bestSet: { lot: SetLot, personalBests: Array<WorkoutSetPersonalBest>, statistic: { duration?: string | null, distance?: string | null, reps?: number | null, weight?: string | null, oneRm?: string | null, pace?: string | null, volume?: string | null } } }> }, information: { assets: { images: Array<string>, videos: Array<string> }, exercises: Array<{ name: string, lot: ExerciseLot, notes: Array<string>, restTime?: number | null, supersetWith: Array<number>, total: { personalBestsAchieved: number, weight: string, reps: number, distance: string, duration: string, restTime: number }, assets: { images: Array<string>, videos: Array<string> }, sets: Array<{ lot: SetLot, personalBests: Array<WorkoutSetPersonalBest>, confirmedAt?: string | null, statistic: { duration?: string | null, distance?: string | null, reps?: number | null, weight?: string | null, oneRm?: string | null, pace?: string | null, volume?: string | null } }> }> } } };

export type CalendarEventPartFragment = { calendarEventId: number, metadataId: number, metadataTitle: string, metadataLot: MetadataLot, metadataImage?: string | null, date: string, showSeasonNumber?: number | null, showEpisodeNumber?: number | null, podcastEpisodeNumber?: number | null };

export type SeenPartFragment = { id: number, progress: number, state: SeenState, startedOn?: string | null, finishedOn?: string | null, lastUpdatedOn: string, numTimesUpdated?: number | null, showInformation?: { episode: number, season: number } | null, podcastInformation?: { episode: number } | null };

export type MediaSearchItemPartFragment = { identifier: string, title: string, image?: string | null, publishYear?: number | null };

export type PartialMetadataPartFragment = { id: number, lot: MetadataLot, source: MetadataSource, identifier: string, title: string, image?: string | null };

export type WorkoutOrExerciseTotalsPartFragment = { personalBestsAchieved: number, weight: string, reps: number, distance: string, duration: string, restTime: number };

export type EntityAssetsPartFragment = { images: Array<string>, videos: Array<string> };

export type WorkoutSetStatisticPartFragment = { duration?: string | null, distance?: string | null, reps?: number | null, weight?: string | null, oneRm?: string | null, pace?: string | null, volume?: string | null };

export type WorkoutSummaryPartFragment = { total: { personalBestsAchieved: number, weight: string, reps: number, distance: string, duration: string, restTime: number }, exercises: Array<{ numSets: number, id: string, lot: ExerciseLot, bestSet: { lot: SetLot, personalBests: Array<WorkoutSetPersonalBest>, statistic: { duration?: string | null, distance?: string | null, reps?: number | null, weight?: string | null, oneRm?: string | null, pace?: string | null, volume?: string | null } } }> };

export type CollectionPartFragment = { id: number, name: string };

export type ReviewItemPartFragment = { id: number, rating?: string | null, text?: string | null, spoiler: boolean, visibility: Visibility, showSeason?: number | null, showEpisode?: number | null, podcastEpisode?: number | null, postedOn: string, postedBy: { id: number, name: string }, comments: Array<{ id: string, text: string, createdOn: string, likedBy: Array<number>, user: { id: number, name: string } }> };

export const CalendarEventPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CalendarEventPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCalendarEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"calendarEventId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataTitle"}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}},{"kind":"Field","name":{"kind":"Name","value":"metadataImage"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"showSeasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisodeNumber"}}]}}]} as unknown as DocumentNode<CalendarEventPartFragment, unknown>;
export const SeenPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"numTimesUpdated"}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]}}]} as unknown as DocumentNode<SeenPartFragment, unknown>;
export const MediaSearchItemPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSearchItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MediaSearchItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]} as unknown as DocumentNode<MediaSearchItemPartFragment, unknown>;
export const PartialMetadataPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PartialMetadataPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PartialMetadata"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]} as unknown as DocumentNode<PartialMetadataPartFragment, unknown>;
export const EntityAssetsPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"images"}},{"kind":"Field","name":{"kind":"Name","value":"videos"}}]}}]} as unknown as DocumentNode<EntityAssetsPartFragment, unknown>;
export const WorkoutOrExerciseTotalsPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}}]}}]} as unknown as DocumentNode<WorkoutOrExerciseTotalsPartFragment, unknown>;
export const WorkoutSetStatisticPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}}]}}]} as unknown as DocumentNode<WorkoutSetStatisticPartFragment, unknown>;
export const WorkoutSummaryPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSummaryPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"numSets"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"bestSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}}]}}]} as unknown as DocumentNode<WorkoutSummaryPartFragment, unknown>;
export const CollectionPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Collection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<CollectionPartFragment, unknown>;
export const ReviewItemPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}}]}}]}}]} as unknown as DocumentNode<ReviewItemPartFragment, unknown>;
export const AddEntityToCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddEntityToCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeCollectionToEntityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"addEntityToCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<AddEntityToCollectionMutation, AddEntityToCollectionMutationVariables>;
export const CommitMediaDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CommitMedia"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"source"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataSource"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"commitMedia"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}},{"kind":"Argument","name":{"kind":"Name","value":"source"},"value":{"kind":"Variable","name":{"kind":"Name","value":"source"}}},{"kind":"Argument","name":{"kind":"Name","value":"identifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"identifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CommitMediaMutation, CommitMediaMutationVariables>;
export const CreateCustomExerciseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCustomExercise"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExerciseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomExercise"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateCustomExerciseMutation, CreateCustomExerciseMutationVariables>;
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
export const DeleteS3ObjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteS3Object"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteS3Object"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<DeleteS3ObjectMutation, DeleteS3ObjectMutationVariables>;
export const DeleteSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"seenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSeenItemMutation, DeleteSeenItemMutationVariables>;
export const DeleteUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"toDeleteUserId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMutation, DeleteUserMutationVariables>;
export const DeleteUserIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"integrationLot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserIntegrationLot"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"integrationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}}},{"kind":"Argument","name":{"kind":"Name","value":"integrationLot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"integrationLot"}}}]}]}}]} as unknown as DocumentNode<DeleteUserIntegrationMutation, DeleteUserIntegrationMutationVariables>;
export const DeleteUserMeasurementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserMeasurement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DateTime"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserMeasurement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"timestamp"},"value":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMeasurementMutation, DeleteUserMeasurementMutationVariables>;
export const DeleteUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"notificationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserNotificationPlatformMutation, DeleteUserNotificationPlatformMutationVariables>;
export const DeleteUserWorkoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserWorkout"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserWorkout"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"workoutId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserWorkoutMutation, DeleteUserWorkoutMutationVariables>;
export const DeployBackgroundJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployBackgroundJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"jobName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BackgroundJob"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployBackgroundJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"jobName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"jobName"}}}]}]}}]} as unknown as DocumentNode<DeployBackgroundJobMutation, DeployBackgroundJobMutationVariables>;
export const DeployBulkProgressUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployBulkProgressUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProgressUpdateInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployBulkProgressUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployBulkProgressUpdateMutation, DeployBulkProgressUpdateMutationVariables>;
export const DeployExportJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployExportJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toExport"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExportItem"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployExportJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"toExport"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toExport"}}}]}]}}]} as unknown as DocumentNode<DeployExportJobMutation, DeployExportJobMutationVariables>;
export const DeployImportJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployImportJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeployImportJobInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployImportJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployImportJobMutation, DeployImportJobMutationVariables>;
export const DeployUpdateMetadataJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployUpdateMetadataJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployUpdateMetadataJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}]}]}}]} as unknown as DocumentNode<DeployUpdateMetadataJobMutation, DeployUpdateMetadataJobMutationVariables>;
export const EditSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EditSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EditSeenItemInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"editSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<EditSeenItemMutation, EditSeenItemMutationVariables>;
export const EditUserWorkoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EditUserWorkout"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EditUserWorkoutInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"editUserWorkout"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<EditUserWorkoutMutation, EditUserWorkoutMutationVariables>;
export const GenerateAuthTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GenerateAuthToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateAuthToken"}}]}}]} as unknown as DocumentNode<GenerateAuthTokenMutation, GenerateAuthTokenMutationVariables>;
export const LoginUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LoginUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"loginUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}},{"kind":"Field","name":{"kind":"Name","value":"validFor"}}]}}]}}]}}]} as unknown as DocumentNode<LoginUserMutation, LoginUserMutationVariables>;
export const MergeMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MergeMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mergeMetadata"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mergeFrom"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}}},{"kind":"Argument","name":{"kind":"Name","value":"mergeInto"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}}}]}]}}]} as unknown as DocumentNode<MergeMetadataMutation, MergeMetadataMutationVariables>;
export const PostReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PostReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PostReviewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"postReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<PostReviewMutation, PostReviewMutationVariables>;
export const PresignedPutS3UrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PresignedPutS3Url"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PresignedPutUrlInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presignedPutS3Url"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"uploadUrl"}}]}}]}}]} as unknown as DocumentNode<PresignedPutS3UrlMutation, PresignedPutS3UrlMutationVariables>;
export const RegisterUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RegisterUserMutation, RegisterUserMutationVariables>;
export const RemoveEntityFromCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RemoveEntityFromCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeCollectionToEntityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeEntityFromCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<RemoveEntityFromCollectionMutation, RemoveEntityFromCollectionMutationVariables>;
export const TestUserNotificationPlatformsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TestUserNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"testUserNotificationPlatforms"}}]}}]} as unknown as DocumentNode<TestUserNotificationPlatformsMutation, TestUserNotificationPlatformsMutationVariables>;
export const ToggleMediaMonitorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ToggleMediaMonitor"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"toggleMediaMonitor"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}]}]}}]} as unknown as DocumentNode<ToggleMediaMonitorMutation, ToggleMediaMonitorMutationVariables>;
export const ToggleMediaOwnershipDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ToggleMediaOwnership"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ownedOn"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"NaiveDate"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"toggleMediaOwnership"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}},{"kind":"Argument","name":{"kind":"Name","value":"ownedOn"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ownedOn"}}}]}]}}]} as unknown as DocumentNode<ToggleMediaOwnershipMutation, ToggleMediaOwnershipMutationVariables>;
export const UpdateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<UpdateUserMutation, UpdateUserMutationVariables>;
export const UpdateUserPreferenceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUserPreference"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserPreferenceInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUserPreference"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateUserPreferenceMutation, UpdateUserPreferenceMutationVariables>;
export const CollectionContentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CollectionContents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CollectionContentsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collectionContents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"results"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}},{"kind":"Field","name":{"kind":"Name","value":"entityLot"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSearchItemPart"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSearchItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MediaSearchItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]} as unknown as DocumentNode<CollectionContentsQuery, CollectionContentsQueryVariables>;
export const CoreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"timezone"}},{"kind":"Field","name":{"kind":"Name","value":"authorName"}},{"kind":"Field","name":{"kind":"Name","value":"repositoryLink"}},{"kind":"Field","name":{"kind":"Name","value":"docsLink"}},{"kind":"Field","name":{"kind":"Name","value":"defaultCredentials"}},{"kind":"Field","name":{"kind":"Name","value":"credentialsChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"preferencesChangeAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"itemDetailsHeight"}},{"kind":"Field","name":{"kind":"Name","value":"reviewsDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"videosDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"upgrade"}},{"kind":"Field","name":{"kind":"Name","value":"pageLimit"}},{"kind":"Field","name":{"kind":"Name","value":"deployAdminJobsAllowed"}}]}}]}}]} as unknown as DocumentNode<CoreDetailsQuery, CoreDetailsQueryVariables>;
export const CoreEnabledFeaturesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreEnabledFeatures"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fileStorage"}},{"kind":"Field","name":{"kind":"Name","value":"signupAllowed"}}]}}]}}]} as unknown as DocumentNode<CoreEnabledFeaturesQuery, CoreEnabledFeaturesQueryVariables>;
export const ExerciseDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExerciseDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"exerciseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"mechanic"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"muscles"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"instructions"}},{"kind":"Field","name":{"kind":"Name","value":"images"}}]}}]}}]}}]} as unknown as DocumentNode<ExerciseDetailsQuery, ExerciseDetailsQueryVariables>;
export const ExerciseParametersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExerciseParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"filters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"mechanic"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}}]}},{"kind":"Field","name":{"kind":"Name","value":"downloadRequired"}}]}}]}}]} as unknown as DocumentNode<ExerciseParametersQuery, ExerciseParametersQueryVariables>;
export const ExercisesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExercisesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExercisesListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exercisesList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"numTimesInteracted"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}}]}}]}}]}}]} as unknown as DocumentNode<ExercisesListQuery, ExercisesListQueryVariables>;
export const GenreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GenreDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"GenreDetailsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"genreDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"numItems"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSearchItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSearchItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MediaSearchItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]} as unknown as DocumentNode<GenreDetailsQuery, GenreDetailsQueryVariables>;
export const GenresListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GenresList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"genresList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"numItems"}}]}}]}}]}}]} as unknown as DocumentNode<GenresListQuery, GenresListQueryVariables>;
export const GetPresignedS3UrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetPresignedS3Url"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"getPresignedS3Url"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<GetPresignedS3UrlQuery, GetPresignedS3UrlQueryVariables>;
export const ImportReportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ImportReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"importReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"success"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"import"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}}]}},{"kind":"Field","name":{"kind":"Name","value":"failedItems"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"step"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"error"}}]}}]}}]}}]}}]} as unknown as DocumentNode<ImportReportsQuery, ImportReportsQueryVariables>;
export const LatestUserSummaryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LatestUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"latestUserSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"calculatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"measurementsRecorded"}},{"kind":"Field","name":{"kind":"Name","value":"exercisesInteractedWith"}},{"kind":"Field","name":{"kind":"Name","value":"workouts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"recorded"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviewsPosted"}},{"kind":"Field","name":{"kind":"Name","value":"creatorsInteractedWith"}},{"kind":"Field","name":{"kind":"Name","value":"mediaInteractedWith"}},{"kind":"Field","name":{"kind":"Name","value":"manga"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"chapters"}},{"kind":"Field","name":{"kind":"Name","value":"read"}}]}},{"kind":"Field","name":{"kind":"Name","value":"books"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}},{"kind":"Field","name":{"kind":"Name","value":"read"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movies"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"anime"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcasts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"played"}},{"kind":"Field","name":{"kind":"Name","value":"playedEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"visualNovels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"played"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGames"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"played"}}]}},{"kind":"Field","name":{"kind":"Name","value":"shows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watchedEpisodes"}},{"kind":"Field","name":{"kind":"Name","value":"watchedSeasons"}},{"kind":"Field","name":{"kind":"Name","value":"watched"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBooks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"played"}}]}}]}}]}}]}}]} as unknown as DocumentNode<LatestUserSummaryQuery, LatestUserSummaryQueryVariables>;
export const MediaAdditionalDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaAdditionalDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"creators"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"character"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"images"}},{"kind":"Field","name":{"kind":"Name","value":"videos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"videoId"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"suggestions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PartialMetadataPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movieSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volumes"}},{"kind":"Field","name":{"kind":"Name","value":"chapters"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"thumbnail"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"visualNovelSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"length"}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGameSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platforms"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PartialMetadataPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PartialMetadata"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]} as unknown as DocumentNode<MediaAdditionalDetailsQuery, MediaAdditionalDetailsQueryVariables>;
export const MediaListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MediaListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MediaSearchItemPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSearchItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MediaSearchItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]} as unknown as DocumentNode<MediaListQuery, MediaListQueryVariables>;
export const MediaMainDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaMainDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"isNsfw"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"providerRating"}},{"kind":"Field","name":{"kind":"Name","value":"productionStatus"}},{"kind":"Field","name":{"kind":"Name","value":"originalLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"group"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"part"}}]}}]}}]}}]} as unknown as DocumentNode<MediaMainDetailsQuery, MediaMainDetailsQueryVariables>;
export const MediaSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"source"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataSource"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}},{"kind":"Argument","name":{"kind":"Name","value":"source"},"value":{"kind":"Variable","name":{"kind":"Name","value":"source"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"databaseId"}},{"kind":"Field","name":{"kind":"Name","value":"hasInteracted"}},{"kind":"Field","name":{"kind":"Name","value":"item"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaSearchQuery, MediaSearchQueryVariables>;
export const MediaSourcesForLotDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MediaSourcesForLot"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"lot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLot"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaSourcesForLot"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"lot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"lot"}}}]}]}}]} as unknown as DocumentNode<MediaSourcesForLotQuery, MediaSourcesForLotQueryVariables>;
export const MetadataGroupDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataGroupDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataGroupDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataGroupId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"displayImages"}},{"kind":"Field","name":{"kind":"Name","value":"parts"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"contents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PartialMetadataPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PartialMetadataPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PartialMetadata"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]} as unknown as DocumentNode<MetadataGroupDetailsQuery, MetadataGroupDetailsQueryVariables>;
export const MetadataGroupsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataGroupsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataGroupsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"parts"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}}]}}]} as unknown as DocumentNode<MetadataGroupsListQuery, MetadataGroupsListQueryVariables>;
export const PersonDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PersonDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"personId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"personDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"personId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"personId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"birthDate"}},{"kind":"Field","name":{"kind":"Name","value":"deathDate"}},{"kind":"Field","name":{"kind":"Name","value":"place"}},{"kind":"Field","name":{"kind":"Name","value":"website"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"displayImages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"image"}}]}}]}}]}}]}}]} as unknown as DocumentNode<PersonDetailsQuery, PersonDetailsQueryVariables>;
export const PeopleListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PeopleList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PeopleListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"peopleList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"mediaCount"}}]}}]}}]}}]} as unknown as DocumentNode<PeopleListQuery, PeopleListQueryVariables>;
export const ProvidersLanguageInformationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProvidersLanguageInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"providersLanguageInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"supported"}},{"kind":"Field","name":{"kind":"Name","value":"default"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<ProvidersLanguageInformationQuery, ProvidersLanguageInformationQueryVariables>;
export const PublicCollectionsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PublicCollectionsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"publicCollectionsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"username"}}]}}]}}]}}]} as unknown as DocumentNode<PublicCollectionsListQuery, PublicCollectionsListQueryVariables>;
export const ReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Review"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"review"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"reviewId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}}]}}]}}]} as unknown as DocumentNode<ReviewQuery, ReviewQueryVariables>;
export const UserCalendarEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserCalendarEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserCalendarEventInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userCalendarEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"events"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CalendarEventPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CalendarEventPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCalendarEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"calendarEventId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataTitle"}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}},{"kind":"Field","name":{"kind":"Name","value":"metadataImage"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"showSeasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisodeNumber"}}]}}]} as unknown as DocumentNode<UserCalendarEventsQuery, UserCalendarEventsQueryVariables>;
export const UserCollectionsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserCollectionsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userCollectionsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"numItems"}}]}}]}}]} as unknown as DocumentNode<UserCollectionsListQuery, UserCollectionsListQueryVariables>;
export const UserDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"User"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]}}]} as unknown as DocumentNode<UserDetailsQuery, UserDetailsQueryVariables>;
export const UserExerciseDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserExerciseDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserExerciseDetailsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userExerciseDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workoutId"}},{"kind":"Field","name":{"kind":"Name","value":"workoutName"}},{"kind":"Field","name":{"kind":"Name","value":"workoutTime"}},{"kind":"Field","name":{"kind":"Name","value":"index"}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseId"}},{"kind":"Field","name":{"kind":"Name","value":"numTimesInteracted"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"exerciseExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lifetimeStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}}]}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workoutId"}},{"kind":"Field","name":{"kind":"Name","value":"workoutDoneOn"}},{"kind":"Field","name":{"kind":"Name","value":"exerciseIdx"}},{"kind":"Field","name":{"kind":"Name","value":"setIdx"}},{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Collection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}}]}}]} as unknown as DocumentNode<UserExerciseDetailsQuery, UserExerciseDetailsQueryVariables>;
export const UserExportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserExports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userExports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"exported"}}]}}]}}]} as unknown as DocumentNode<UserExportsQuery, UserExportsQueryVariables>;
export const UserIntegrationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}}]}}]}}]} as unknown as DocumentNode<UserIntegrationsQuery, UserIntegrationsQueryVariables>;
export const UserMeasurementsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMeasurementsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMeasurementsListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMeasurementsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"stats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMassIndex"}},{"kind":"Field","name":{"kind":"Name","value":"totalBodyWater"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"leanBodyMass"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFat"}},{"kind":"Field","name":{"kind":"Name","value":"boneMass"}},{"kind":"Field","name":{"kind":"Name","value":"visceralFat"}},{"kind":"Field","name":{"kind":"Name","value":"waistCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHeightRatio"}},{"kind":"Field","name":{"kind":"Name","value":"hipCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHipRatio"}},{"kind":"Field","name":{"kind":"Name","value":"chestCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"thighCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bicepsCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"neckCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFatCaliper"}},{"kind":"Field","name":{"kind":"Name","value":"chestSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"abdominalSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"thighSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"basalMetabolicRate"}},{"kind":"Field","name":{"kind":"Name","value":"totalDailyEnergyExpenditure"}},{"kind":"Field","name":{"kind":"Name","value":"calories"}},{"kind":"Field","name":{"kind":"Name","value":"custom"}}]}}]}}]}}]} as unknown as DocumentNode<UserMeasurementsListQuery, UserMeasurementsListQueryVariables>;
export const UserMediaDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMediaDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMediaDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reminder"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"remindOn"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"Field","name":{"kind":"Name","value":"ownership"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markedOn"}},{"kind":"Field","name":{"kind":"Name","value":"ownedOn"}}]}},{"kind":"Field","name":{"kind":"Name","value":"isMonitored"}},{"kind":"Field","name":{"kind":"Name","value":"seenBy"}},{"kind":"Field","name":{"kind":"Name","value":"nextEpisode"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Collection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"numTimesUpdated"}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}}]}}]}}]} as unknown as DocumentNode<UserMediaDetailsQuery, UserMediaDetailsQueryVariables>;
export const UserMetadataGroupDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMetadataGroupDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMetadataGroupDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataGroupId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Collection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<UserMetadataGroupDetailsQuery, UserMetadataGroupDetailsQueryVariables>;
export const UserNotificationPlatformsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}}]}}]}}]} as unknown as DocumentNode<UserNotificationPlatformsQuery, UserNotificationPlatformsQueryVariables>;
export const UserPersonDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserPersonDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"personId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userPersonDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"personId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"personId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Collection"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"spoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"showSeason"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisode"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}}]}}]}}]} as unknown as DocumentNode<UserPersonDetailsQuery, UserPersonDetailsQueryVariables>;
export const UserPreferencesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserPreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userPreferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"general"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviewScale"}},{"kind":"Field","name":{"kind":"Name","value":"displayNsfw"}},{"kind":"Field","name":{"kind":"Name","value":"disableYankIntegrations"}},{"kind":"Field","name":{"kind":"Name","value":"dashboard"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"section"}},{"kind":"Field","name":{"kind":"Name","value":"hidden"}},{"kind":"Field","name":{"kind":"Name","value":"numElements"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"measurements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"custom"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"dataType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inbuilt"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"bodyMassIndex"}},{"kind":"Field","name":{"kind":"Name","value":"totalBodyWater"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"leanBodyMass"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFat"}},{"kind":"Field","name":{"kind":"Name","value":"boneMass"}},{"kind":"Field","name":{"kind":"Name","value":"visceralFat"}},{"kind":"Field","name":{"kind":"Name","value":"waistCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHeightRatio"}},{"kind":"Field","name":{"kind":"Name","value":"hipCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"waistToHipRatio"}},{"kind":"Field","name":{"kind":"Name","value":"chestCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"thighCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bicepsCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"neckCircumference"}},{"kind":"Field","name":{"kind":"Name","value":"bodyFatCaliper"}},{"kind":"Field","name":{"kind":"Name","value":"chestSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"abdominalSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"thighSkinfold"}},{"kind":"Field","name":{"kind":"Name","value":"basalMetabolicRate"}},{"kind":"Field","name":{"kind":"Name","value":"totalDailyEnergyExpenditure"}},{"kind":"Field","name":{"kind":"Name","value":"calories"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"saveHistory"}},{"kind":"Field","name":{"kind":"Name","value":"defaultTimer"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"notifications"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodeReleased"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNameChanged"}},{"kind":"Field","name":{"kind":"Name","value":"episodeImagesChanged"}},{"kind":"Field","name":{"kind":"Name","value":"statusChanged"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDateChanged"}},{"kind":"Field","name":{"kind":"Name","value":"numberOfSeasonsChanged"}},{"kind":"Field","name":{"kind":"Name","value":"numberOfChaptersOrEpisodesChanged"}},{"kind":"Field","name":{"kind":"Name","value":"newReviewPosted"}}]}},{"kind":"Field","name":{"kind":"Name","value":"featuresEnabled"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"workouts"}},{"kind":"Field","name":{"kind":"Name","value":"measurements"}}]}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"anime"}},{"kind":"Field","name":{"kind":"Name","value":"audioBook"}},{"kind":"Field","name":{"kind":"Name","value":"book"}},{"kind":"Field","name":{"kind":"Name","value":"manga"}},{"kind":"Field","name":{"kind":"Name","value":"movie"}},{"kind":"Field","name":{"kind":"Name","value":"podcast"}},{"kind":"Field","name":{"kind":"Name","value":"show"}},{"kind":"Field","name":{"kind":"Name","value":"videoGame"}},{"kind":"Field","name":{"kind":"Name","value":"visualNovel"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserPreferencesQuery, UserPreferencesQueryVariables>;
export const UserUpcomingCalendarEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserUpcomingCalendarEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserUpcomingCalendarEventInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userUpcomingCalendarEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CalendarEventPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CalendarEventPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCalendarEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"calendarEventId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataTitle"}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}},{"kind":"Field","name":{"kind":"Name","value":"metadataImage"}},{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"showSeasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"showEpisodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"podcastEpisodeNumber"}}]}}]} as unknown as DocumentNode<UserUpcomingCalendarEventsQuery, UserUpcomingCalendarEventsQueryVariables>;
export const UserWorkoutListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserWorkoutList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userWorkoutList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"nextPage"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"startTime"}},{"kind":"Field","name":{"kind":"Name","value":"endTime"}},{"kind":"Field","name":{"kind":"Name","value":"summary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSummaryPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSummaryPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"numSets"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"bestSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}}]}}]}}]}}]} as unknown as DocumentNode<UserWorkoutListQuery, UserWorkoutListQueryVariables>;
export const UsersListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UsersList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"usersList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}}]}}]}}]} as unknown as DocumentNode<UsersListQuery, UsersListQueryVariables>;
export const WorkoutDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"WorkoutDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workoutDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"workoutId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"startTime"}},{"kind":"Field","name":{"kind":"Name","value":"endTime"}},{"kind":"Field","name":{"kind":"Name","value":"summary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSummaryPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"information"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"notes"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"supersetWith"}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedAt"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSummaryPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"numSets"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"bestSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"images"}},{"kind":"Field","name":{"kind":"Name","value":"videos"}}]}}]} as unknown as DocumentNode<WorkoutDetailsQuery, WorkoutDetailsQueryVariables>;