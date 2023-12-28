/* eslint-disable */
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
  defaultCredentials: Scalars['Boolean']['output'];
  deployAdminJobsAllowed: Scalars['Boolean']['output'];
  docsLink: Scalars['String']['output'];
  itemDetailsHeight: Scalars['Int']['output'];
  pageLimit: Scalars['Int']['output'];
  passwordChangeAllowed: Scalars['Boolean']['output'];
  preferencesChangeAllowed: Scalars['Boolean']['output'];
  repositoryLink: Scalars['String']['output'];
  reviewsDisabled: Scalars['Boolean']['output'];
  timezone: Scalars['String']['output'];
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

export type DeployGoodreadsImportInput = {
  rssUrl: Scalars['String']['input'];
};

export type DeployImportJobInput = {
  goodreads?: InputMaybe<DeployGoodreadsImportInput>;
  mal?: InputMaybe<DeployMalImportInput>;
  mediaJson?: InputMaybe<DeployMediaJsonImportInput>;
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
  Goodreads = 'GOODREADS',
  Mal = 'MAL',
  MediaJson = 'MEDIA_JSON',
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
  workoutsRecorded: Scalars['Int']['output'];
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
  reps?: Maybe<Scalars['Int']['output']>;
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
