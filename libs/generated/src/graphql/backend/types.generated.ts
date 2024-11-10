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
  DateTime: { input: string; output: string; }
  Decimal: { input: string; output: string; }
  JSON: { input: any; output: any; }
  JSONObject: { input: any; output: any; }
  NaiveDate: { input: string; output: string; }
  NaiveDateTime: { input: any; output: any; }
};

export type AccessLink = {
  __typename?: 'AccessLink';
  createdOn: Scalars['DateTime']['output'];
  expiresOn?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  isAccountDefault?: Maybe<Scalars['Boolean']['output']>;
  isDemo?: Maybe<Scalars['Boolean']['output']>;
  isMutationAllowed?: Maybe<Scalars['Boolean']['output']>;
  isRevoked?: Maybe<Scalars['Boolean']['output']>;
  maximumUses?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  redirectTo?: Maybe<Scalars['String']['output']>;
  timesUsed: Scalars['Int']['output'];
};

export type AnimeAiringScheduleSpecifics = {
  __typename?: 'AnimeAiringScheduleSpecifics';
  airingAt: Scalars['NaiveDateTime']['output'];
  episode: Scalars['Int']['output'];
};

export type AnimeAiringScheduleSpecificsInput = {
  airingAt: Scalars['NaiveDateTime']['input'];
  episode: Scalars['Int']['input'];
};

export type AnimeSpecifics = {
  __typename?: 'AnimeSpecifics';
  airingSchedule?: Maybe<Array<AnimeAiringScheduleSpecifics>>;
  episodes?: Maybe<Scalars['Int']['output']>;
};

export type AnimeSpecificsInput = {
  airingSchedule?: InputMaybe<Array<AnimeAiringScheduleSpecificsInput>>;
  episodes?: InputMaybe<Scalars['Int']['input']>;
};

export type AudioBookSpecifics = {
  __typename?: 'AudioBookSpecifics';
  runtime?: Maybe<Scalars['Int']['output']>;
};

export type AudioBookSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']['input']>;
};

export type AuthUserInput = {
  oidc?: InputMaybe<OidcUserInput>;
  password?: InputMaybe<PasswordUserInput>;
};

export enum BackendError {
  AdminOnlyAction = 'ADMIN_ONLY_ACTION',
  MutationNotAllowed = 'MUTATION_NOT_ALLOWED',
  NoAuthToken = 'NO_AUTH_TOKEN',
  NoUserId = 'NO_USER_ID',
  SessionExpired = 'SESSION_EXPIRED'
}

export enum BackgroundJob {
  CalculateUserActivitiesAndSummary = 'CALCULATE_USER_ACTIVITIES_AND_SUMMARY',
  PerformBackgroundTasks = 'PERFORM_BACKGROUND_TASKS',
  RecalculateCalendarEvents = 'RECALCULATE_CALENDAR_EVENTS',
  ReEvaluateUserWorkouts = 'RE_EVALUATE_USER_WORKOUTS',
  SyncIntegrationsData = 'SYNC_INTEGRATIONS_DATA',
  UpdateAllExercises = 'UPDATE_ALL_EXERCISES',
  UpdateAllMetadata = 'UPDATE_ALL_METADATA'
}

export type BookSpecifics = {
  __typename?: 'BookSpecifics';
  pages?: Maybe<Scalars['Int']['output']>;
};

export type BookSpecificsInput = {
  pages?: InputMaybe<Scalars['Int']['input']>;
};

export type ChangeCollectionToEntityInput = {
  collectionName: Scalars['String']['input'];
  creatorUserId: Scalars['String']['input'];
  entityId: Scalars['String']['input'];
  entityLot: EntityLot;
  information?: InputMaybe<Scalars['JSON']['input']>;
};

export type Collection = {
  __typename?: 'Collection';
  createdOn: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  informationTemplate?: Maybe<Array<CollectionExtraInformation>>;
  lastUpdatedOn: Scalars['DateTime']['output'];
  name: Scalars['String']['output'];
  userId: Scalars['String']['output'];
};

export type CollectionContents = {
  __typename?: 'CollectionContents';
  details: Collection;
  results: MediaCollectionContentsResults;
  reviews: Array<ReviewItem>;
  user: User;
};

export type CollectionContentsFilter = {
  entityLot?: InputMaybe<EntityLot>;
  metadataLot?: InputMaybe<MediaLot>;
};

export type CollectionContentsInput = {
  collectionId: Scalars['String']['input'];
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

export type CollectionExtraInformation = {
  __typename?: 'CollectionExtraInformation';
  defaultValue?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  lot: CollectionExtraInformationLot;
  name: Scalars['String']['output'];
  required?: Maybe<Scalars['Boolean']['output']>;
};

export type CollectionExtraInformationInput = {
  defaultValue?: InputMaybe<Scalars['String']['input']>;
  description: Scalars['String']['input'];
  lot: CollectionExtraInformationLot;
  name: Scalars['String']['input'];
  required?: InputMaybe<Scalars['Boolean']['input']>;
};

export enum CollectionExtraInformationLot {
  Date = 'DATE',
  DateTime = 'DATE_TIME',
  Number = 'NUMBER',
  String = 'STRING',
  StringArray = 'STRING_ARRAY'
}

export type CollectionItem = {
  __typename?: 'CollectionItem';
  collaborators: Array<IdAndNamedObject>;
  count: Scalars['Int']['output'];
  creator: IdAndNamedObject;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  informationTemplate?: Maybe<Array<CollectionExtraInformation>>;
  isDefault: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

export type CommitMediaInput = {
  forceUpdate?: InputMaybe<Scalars['Boolean']['input']>;
  identifier: Scalars['String']['input'];
  lot: MediaLot;
  source: MediaSource;
};

export type CommitPersonInput = {
  identifier: Scalars['String']['input'];
  name: Scalars['String']['input'];
  source: MediaSource;
  sourceSpecifics?: InputMaybe<PersonSourceSpecificsInput>;
};

export type CoreDetails = {
  __typename?: 'CoreDetails';
  backendErrors: Array<BackendError>;
  disableTelemetry: Scalars['Boolean']['output'];
  docsLink: Scalars['String']['output'];
  fileStorageEnabled: Scalars['Boolean']['output'];
  frontend: FrontendConfig;
  isPro: Scalars['Boolean']['output'];
  localAuthDisabled: Scalars['Boolean']['output'];
  oidcEnabled: Scalars['Boolean']['output'];
  pageSize: Scalars['Int']['output'];
  repositoryLink: Scalars['String']['output'];
  signupAllowed: Scalars['Boolean']['output'];
  smtpEnabled: Scalars['Boolean']['output'];
  tokenValidForDays: Scalars['Int']['output'];
  version: Scalars['String']['output'];
  websiteUrl: Scalars['String']['output'];
};

export type CreateAccessLinkInput = {
  expiresOn?: InputMaybe<Scalars['DateTime']['input']>;
  isAccountDefault?: InputMaybe<Scalars['Boolean']['input']>;
  isMutationAllowed?: InputMaybe<Scalars['Boolean']['input']>;
  maximumUses?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
  redirectTo?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCustomMetadataInput = {
  animeSpecifics?: InputMaybe<AnimeSpecificsInput>;
  audioBookSpecifics?: InputMaybe<AudioBookSpecificsInput>;
  bookSpecifics?: InputMaybe<BookSpecificsInput>;
  creators?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  genres?: InputMaybe<Array<Scalars['String']['input']>>;
  images?: InputMaybe<Array<Scalars['String']['input']>>;
  isNsfw?: InputMaybe<Scalars['Boolean']['input']>;
  lot: MediaLot;
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

export type CreateOrUpdateCollectionInput = {
  collaborators?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  informationTemplate?: InputMaybe<Array<CollectionExtraInformationInput>>;
  name: Scalars['String']['input'];
  updateId?: InputMaybe<Scalars['String']['input']>;
};

export type CreateOrUpdateReviewInput = {
  animeEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  date?: InputMaybe<Scalars['DateTime']['input']>;
  entityId: Scalars['String']['input'];
  entityLot: EntityLot;
  isSpoiler?: InputMaybe<Scalars['Boolean']['input']>;
  mangaChapterNumber?: InputMaybe<Scalars['Decimal']['input']>;
  mangaVolumeNumber?: InputMaybe<Scalars['Int']['input']>;
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  rating?: InputMaybe<Scalars['Decimal']['input']>;
  /** ID of the review if this is an update to an existing review */
  reviewId?: InputMaybe<Scalars['String']['input']>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
  text?: InputMaybe<Scalars['String']['input']>;
  visibility?: InputMaybe<Visibility>;
};

export type CreateReviewCommentInput = {
  commentId?: InputMaybe<Scalars['String']['input']>;
  decrementLikes?: InputMaybe<Scalars['Boolean']['input']>;
  incrementLikes?: InputMaybe<Scalars['Boolean']['input']>;
  /** The review this comment belongs to. */
  reviewId: Scalars['String']['input'];
  shouldDelete?: InputMaybe<Scalars['Boolean']['input']>;
  text?: InputMaybe<Scalars['String']['input']>;
};

export type CreateUserIntegrationInput = {
  maximumProgress?: InputMaybe<Scalars['Decimal']['input']>;
  minimumProgress?: InputMaybe<Scalars['Decimal']['input']>;
  provider: IntegrationProvider;
  providerSpecifics?: InputMaybe<IntegrationSourceSpecificsInput>;
  syncToOwnedCollection?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CreateUserNotificationPlatformInput = {
  apiToken?: InputMaybe<Scalars['String']['input']>;
  authHeader?: InputMaybe<Scalars['String']['input']>;
  baseUrl?: InputMaybe<Scalars['String']['input']>;
  chatId?: InputMaybe<Scalars['String']['input']>;
  lot: NotificationPlatformLot;
  priority?: InputMaybe<Scalars['Int']['input']>;
};

export type DailyUserActivitiesInput = {
  endDate?: InputMaybe<Scalars['NaiveDate']['input']>;
  groupBy?: InputMaybe<DailyUserActivitiesResponseGroupedBy>;
  startDate?: InputMaybe<Scalars['NaiveDate']['input']>;
};

export type DailyUserActivitiesResponse = {
  __typename?: 'DailyUserActivitiesResponse';
  groupedBy: DailyUserActivitiesResponseGroupedBy;
  itemCount: Scalars['Int']['output'];
  items: Array<DailyUserActivityItem>;
  totalCount: Scalars['Int']['output'];
  totalDuration: Scalars['Int']['output'];
};

export enum DailyUserActivitiesResponseGroupedBy {
  Day = 'DAY',
  Millennium = 'MILLENNIUM',
  Month = 'MONTH',
  Year = 'YEAR'
}

export type DailyUserActivityItem = {
  __typename?: 'DailyUserActivityItem';
  animeCount: Scalars['Int']['output'];
  audioBookCount: Scalars['Int']['output'];
  bookCount: Scalars['Int']['output'];
  day: Scalars['NaiveDate']['output'];
  mangaCount: Scalars['Int']['output'];
  measurementCount: Scalars['Int']['output'];
  movieCount: Scalars['Int']['output'];
  podcastCount: Scalars['Int']['output'];
  showCount: Scalars['Int']['output'];
  totalAudioBookDuration: Scalars['Int']['output'];
  totalBookPages: Scalars['Int']['output'];
  totalCollectionReviewCount: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
  totalDuration: Scalars['Int']['output'];
  totalMetadataCount: Scalars['Int']['output'];
  totalMetadataGroupReviewCount: Scalars['Int']['output'];
  totalMetadataReviewCount: Scalars['Int']['output'];
  totalMovieDuration: Scalars['Int']['output'];
  totalPersonReviewCount: Scalars['Int']['output'];
  totalPodcastDuration: Scalars['Int']['output'];
  totalReviewCount: Scalars['Int']['output'];
  totalShowDuration: Scalars['Int']['output'];
  totalVideoGameDuration: Scalars['Int']['output'];
  totalVisualNovelDuration: Scalars['Int']['output'];
  totalWorkoutDistance: Scalars['Int']['output'];
  totalWorkoutDuration: Scalars['Int']['output'];
  totalWorkoutPersonalBests: Scalars['Int']['output'];
  totalWorkoutReps: Scalars['Int']['output'];
  totalWorkoutRestTime: Scalars['Int']['output'];
  totalWorkoutWeight: Scalars['Int']['output'];
  videoGameCount: Scalars['Int']['output'];
  visualNovelCount: Scalars['Int']['output'];
  workoutCount: Scalars['Int']['output'];
};

export enum DashboardElementLot {
  Activity = 'ACTIVITY',
  InProgress = 'IN_PROGRESS',
  Recommendations = 'RECOMMENDATIONS',
  Summary = 'SUMMARY',
  Upcoming = 'UPCOMING'
}

export type DeployGenericCsvImportInput = {
  csvPath: Scalars['String']['input'];
};

export type DeployIgdbImportInput = {
  collection: Scalars['String']['input'];
  csvPath: Scalars['String']['input'];
};

export type DeployImportJobInput = {
  genericCsv?: InputMaybe<DeployGenericCsvImportInput>;
  genericJson?: InputMaybe<DeployJsonImportInput>;
  igdb?: InputMaybe<DeployIgdbImportInput>;
  jellyfin?: InputMaybe<DeployUrlAndKeyAndUsernameImportInput>;
  mal?: InputMaybe<DeployMalImportInput>;
  movary?: InputMaybe<DeployMovaryImportInput>;
  source: ImportSource;
  strongApp?: InputMaybe<DeployStrongAppImportInput>;
  trakt?: InputMaybe<DeployTraktImportInput>;
  urlAndKey?: InputMaybe<DeployUrlAndKeyImportInput>;
};

export type DeployJsonImportInput = {
  export: Scalars['String']['input'];
};

export type DeployMalImportInput = {
  /** The anime export file path (uploaded via temporary upload). */
  animePath?: InputMaybe<Scalars['String']['input']>;
  /** The manga export file path (uploaded via temporary upload). */
  mangaPath?: InputMaybe<Scalars['String']['input']>;
};

export type DeployMovaryImportInput = {
  history: Scalars['String']['input'];
  ratings: Scalars['String']['input'];
  watchlist: Scalars['String']['input'];
};

export type DeployStrongAppImportInput = {
  exportPath: Scalars['String']['input'];
  mapping: Array<StrongAppImportMapping>;
};

export type DeployTraktImportInput = {
  username: Scalars['String']['input'];
};

export type DeployUrlAndKeyAndUsernameImportInput = {
  apiUrl: Scalars['String']['input'];
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type DeployUrlAndKeyImportInput = {
  apiKey: Scalars['String']['input'];
  apiUrl: Scalars['String']['input'];
};

/** The assets that were uploaded for an entity. */
export type EntityAssets = {
  __typename?: 'EntityAssets';
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
  Metadata = 'METADATA',
  MetadataGroup = 'METADATA_GROUP',
  Person = 'PERSON',
  Workout = 'WORKOUT',
  WorkoutTemplate = 'WORKOUT_TEMPLATE'
}

export type EntityWithLot = {
  __typename?: 'EntityWithLot';
  entityId: Scalars['String']['output'];
  entityLot: EntityLot;
};

export type Exercise = {
  __typename?: 'Exercise';
  attributes: ExerciseAttributes;
  createdByUserId?: Maybe<Scalars['String']['output']>;
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
  __typename?: 'ExerciseAttributes';
  images: Array<Scalars['String']['output']>;
  instructions: Array<Scalars['String']['output']>;
};

export type ExerciseAttributesInput = {
  images: Array<Scalars['String']['input']>;
  instructions: Array<Scalars['String']['input']>;
};

export type ExerciseBestSetRecord = {
  __typename?: 'ExerciseBestSetRecord';
  exerciseIdx: Scalars['Int']['output'];
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
  __typename?: 'ExerciseFilters';
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
};

export enum ExerciseLevel {
  Beginner = 'BEGINNER',
  Expert = 'EXPERT',
  Intermediate = 'INTERMEDIATE'
}

export type ExerciseListFilter = {
  collection?: InputMaybe<Scalars['String']['input']>;
  equipment?: InputMaybe<ExerciseEquipment>;
  force?: InputMaybe<ExerciseForce>;
  level?: InputMaybe<ExerciseLevel>;
  mechanic?: InputMaybe<ExerciseMechanic>;
  muscle?: InputMaybe<ExerciseMuscle>;
  type?: InputMaybe<ExerciseLot>;
};

export type ExerciseListItem = {
  __typename?: 'ExerciseListItem';
  id: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  lastUpdatedOn?: Maybe<Scalars['DateTime']['output']>;
  lot: ExerciseLot;
  muscle?: Maybe<ExerciseMuscle>;
  numTimesInteracted?: Maybe<Scalars['Int']['output']>;
};

export type ExerciseListResults = {
  __typename?: 'ExerciseListResults';
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
  __typename?: 'ExerciseParameters';
  downloadRequired: Scalars['Boolean']['output'];
  /** All filters applicable to an exercises query. */
  filters: ExerciseFilters;
  /** Exercise type mapped to the personal bests possible. */
  lotMapping: Array<ExerciseParametersLotMapping>;
};

export type ExerciseParametersLotMapping = {
  __typename?: 'ExerciseParametersLotMapping';
  bests: Array<WorkoutSetPersonalBest>;
  lot: ExerciseLot;
};

export enum ExerciseSortBy {
  LastPerformed = 'LAST_PERFORMED',
  Name = 'NAME',
  TimesPerformed = 'TIMES_PERFORMED'
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

export type ExportJob = {
  __typename?: 'ExportJob';
  endedAt: Scalars['DateTime']['output'];
  size: Scalars['Int']['output'];
  startedAt: Scalars['DateTime']['output'];
  url: Scalars['String']['output'];
};

export type ExternalIdentifiers = {
  __typename?: 'ExternalIdentifiers';
  tvdbId?: Maybe<Scalars['Int']['output']>;
};

export type FrontendConfig = {
  __typename?: 'FrontendConfig';
  /** A message to be displayed on the dashboard. */
  dashboardMessage: Scalars['String']['output'];
  /** The button label for OIDC authentication. */
  oidcButtonLabel: Scalars['String']['output'];
  /** Settings related to Umami analytics. */
  umami: FrontendUmamiConfig;
  /** Used as the base URL when generating item links for the frontend. */
  url: Scalars['String']['output'];
};

/**
 * The configuration related to Umami analytics. More information
 * [here](https://umami.is/docs/tracker-configuration).
 */
export type FrontendUmamiConfig = {
  __typename?: 'FrontendUmamiConfig';
  domains: Scalars['String']['output'];
  /** For example: https://umami.is/script.js. */
  scriptUrl: Scalars['String']['output'];
  websiteId: Scalars['String']['output'];
};

export type GenreDetails = {
  __typename?: 'GenreDetails';
  contents: IdResults;
  details: GenreListItem;
};

export type GenreDetailsInput = {
  genreId: Scalars['String']['input'];
  page?: InputMaybe<Scalars['Int']['input']>;
};

export type GenreListItem = {
  __typename?: 'GenreListItem';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  numItems?: Maybe<Scalars['Int']['output']>;
};

export type GenreListResults = {
  __typename?: 'GenreListResults';
  details: SearchDetails;
  items: Array<GenreListItem>;
};

export type GraphqlCalendarEvent = {
  __typename?: 'GraphqlCalendarEvent';
  animeExtraInformation?: Maybe<SeenAnimeExtraInformation>;
  calendarEventId: Scalars['String']['output'];
  date: Scalars['NaiveDate']['output'];
  episodeName?: Maybe<Scalars['String']['output']>;
  metadataId: Scalars['String']['output'];
  metadataImage?: Maybe<Scalars['String']['output']>;
  metadataLot: MediaLot;
  metadataTitle: Scalars['String']['output'];
  podcastExtraInformation?: Maybe<SeenPodcastExtraInformation>;
  showExtraInformation?: Maybe<SeenShowExtraInformation>;
};

export type GraphqlMediaAssets = {
  __typename?: 'GraphqlMediaAssets';
  images: Array<Scalars['String']['output']>;
  videos: Array<GraphqlVideoAsset>;
};

export type GraphqlMetadataDetails = {
  __typename?: 'GraphqlMetadataDetails';
  animeSpecifics?: Maybe<AnimeSpecifics>;
  assets: GraphqlMediaAssets;
  audioBookSpecifics?: Maybe<AudioBookSpecifics>;
  bookSpecifics?: Maybe<BookSpecifics>;
  creators: Array<MetadataCreatorGroupedByRole>;
  description?: Maybe<Scalars['String']['output']>;
  externalIdentifiers?: Maybe<ExternalIdentifiers>;
  genres: Array<GenreListItem>;
  group?: Maybe<GraphqlMetadataGroup>;
  id: Scalars['String']['output'];
  identifier: Scalars['String']['output'];
  isNsfw?: Maybe<Scalars['Boolean']['output']>;
  isPartial?: Maybe<Scalars['Boolean']['output']>;
  lot: MediaLot;
  mangaSpecifics?: Maybe<MangaSpecifics>;
  movieSpecifics?: Maybe<MovieSpecifics>;
  originalLanguage?: Maybe<Scalars['String']['output']>;
  podcastSpecifics?: Maybe<PodcastSpecifics>;
  productionStatus?: Maybe<Scalars['String']['output']>;
  providerRating?: Maybe<Scalars['Decimal']['output']>;
  publishDate?: Maybe<Scalars['NaiveDate']['output']>;
  publishYear?: Maybe<Scalars['Int']['output']>;
  showSpecifics?: Maybe<ShowSpecifics>;
  source: MediaSource;
  sourceUrl?: Maybe<Scalars['String']['output']>;
  suggestions: Array<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  videoGameSpecifics?: Maybe<VideoGameSpecifics>;
  visualNovelSpecifics?: Maybe<VisualNovelSpecifics>;
  watchProviders: Array<WatchProvider>;
};

export type GraphqlMetadataGroup = {
  __typename?: 'GraphqlMetadataGroup';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  part: Scalars['Int']['output'];
};

export enum GraphqlSortOrder {
  Asc = 'ASC',
  Desc = 'DESC'
}

export type GraphqlVideoAsset = {
  __typename?: 'GraphqlVideoAsset';
  source: MetadataVideoSource;
  videoId: Scalars['String']['output'];
};

export enum GridPacking {
  Dense = 'DENSE',
  Normal = 'NORMAL'
}

export type GroupedCalendarEvent = {
  __typename?: 'GroupedCalendarEvent';
  date: Scalars['NaiveDate']['output'];
  events: Array<GraphqlCalendarEvent>;
};

export type IdAndNamedObject = {
  __typename?: 'IdAndNamedObject';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type IdResults = {
  __typename?: 'IdResults';
  details: SearchDetails;
  items: Array<Scalars['String']['output']>;
};

export type ImportDetails = {
  __typename?: 'ImportDetails';
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
  __typename?: 'ImportFailedItem';
  error?: Maybe<Scalars['String']['output']>;
  identifier: Scalars['String']['output'];
  lot?: Maybe<MediaLot>;
  step: ImportFailStep;
};

/** Comments left in replies to posted reviews. */
export type ImportOrExportItemReviewComment = {
  __typename?: 'ImportOrExportItemReviewComment';
  createdOn: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  /** The user ids of all those who liked it. */
  likedBy: Array<Scalars['String']['output']>;
  text: Scalars['String']['output'];
  user: IdAndNamedObject;
};

export type ImportReport = {
  __typename?: 'ImportReport';
  details?: Maybe<ImportResultResponse>;
  finishedOn?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  source: ImportSource;
  startedOn: Scalars['DateTime']['output'];
  userId: Scalars['String']['output'];
  wasSuccess?: Maybe<Scalars['Boolean']['output']>;
};

export type ImportResultResponse = {
  __typename?: 'ImportResultResponse';
  failedItems: Array<ImportFailedItem>;
  import: ImportDetails;
};

export enum ImportSource {
  Audiobookshelf = 'AUDIOBOOKSHELF',
  GenericJson = 'GENERIC_JSON',
  Goodreads = 'GOODREADS',
  Igdb = 'IGDB',
  Imdb = 'IMDB',
  Jellyfin = 'JELLYFIN',
  Mal = 'MAL',
  MediaTracker = 'MEDIA_TRACKER',
  Movary = 'MOVARY',
  OpenScale = 'OPEN_SCALE',
  StoryGraph = 'STORY_GRAPH',
  StrongApp = 'STRONG_APP',
  Trakt = 'TRAKT'
}

export type Integration = {
  __typename?: 'Integration';
  createdOn: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  isDisabled?: Maybe<Scalars['Boolean']['output']>;
  lastTriggeredOn?: Maybe<Scalars['DateTime']['output']>;
  lot: IntegrationLot;
  maximumProgress?: Maybe<Scalars['Decimal']['output']>;
  minimumProgress?: Maybe<Scalars['Decimal']['output']>;
  provider: IntegrationProvider;
  syncToOwnedCollection?: Maybe<Scalars['Boolean']['output']>;
};

export enum IntegrationLot {
  Push = 'PUSH',
  Sink = 'SINK',
  Yank = 'YANK'
}

export enum IntegrationProvider {
  Audiobookshelf = 'AUDIOBOOKSHELF',
  Emby = 'EMBY',
  GenericJson = 'GENERIC_JSON',
  JellyfinPush = 'JELLYFIN_PUSH',
  JellyfinSink = 'JELLYFIN_SINK',
  Kodi = 'KODI',
  Komga = 'KOMGA',
  Plex = 'PLEX',
  Radarr = 'RADARR',
  Sonarr = 'SONARR'
}

export type IntegrationSourceSpecificsInput = {
  audiobookshelfBaseUrl?: InputMaybe<Scalars['String']['input']>;
  audiobookshelfToken?: InputMaybe<Scalars['String']['input']>;
  jellyfinPushBaseUrl?: InputMaybe<Scalars['String']['input']>;
  jellyfinPushPassword?: InputMaybe<Scalars['String']['input']>;
  jellyfinPushUsername?: InputMaybe<Scalars['String']['input']>;
  komgaBaseUrl?: InputMaybe<Scalars['String']['input']>;
  komgaPassword?: InputMaybe<Scalars['String']['input']>;
  komgaProvider?: InputMaybe<MediaSource>;
  komgaUsername?: InputMaybe<Scalars['String']['input']>;
  plexUsername?: InputMaybe<Scalars['String']['input']>;
  radarrApiKey?: InputMaybe<Scalars['String']['input']>;
  radarrBaseUrl?: InputMaybe<Scalars['String']['input']>;
  radarrProfileId?: InputMaybe<Scalars['Int']['input']>;
  radarrRootFolderPath?: InputMaybe<Scalars['String']['input']>;
  radarrSyncCollectionIds?: InputMaybe<Array<Scalars['String']['input']>>;
  sonarrApiKey?: InputMaybe<Scalars['String']['input']>;
  sonarrBaseUrl?: InputMaybe<Scalars['String']['input']>;
  sonarrProfileId?: InputMaybe<Scalars['Int']['input']>;
  sonarrRootFolderPath?: InputMaybe<Scalars['String']['input']>;
  sonarrSyncCollectionIds?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type LoginError = {
  __typename?: 'LoginError';
  error: LoginErrorVariant;
};

export enum LoginErrorVariant {
  AccountDisabled = 'ACCOUNT_DISABLED',
  CredentialsMismatch = 'CREDENTIALS_MISMATCH',
  IncorrectProviderChosen = 'INCORRECT_PROVIDER_CHOSEN',
  UsernameDoesNotExist = 'USERNAME_DOES_NOT_EXIST'
}

export type LoginResponse = {
  __typename?: 'LoginResponse';
  apiKey: Scalars['String']['output'];
};

export type LoginResult = LoginError | LoginResponse;

export type MangaSpecifics = {
  __typename?: 'MangaSpecifics';
  chapters?: Maybe<Scalars['Decimal']['output']>;
  url?: Maybe<Scalars['String']['output']>;
  volumes?: Maybe<Scalars['Int']['output']>;
};

export type MangaSpecificsInput = {
  chapters?: InputMaybe<Scalars['Decimal']['input']>;
  url?: InputMaybe<Scalars['String']['input']>;
  volumes?: InputMaybe<Scalars['Int']['input']>;
};

export type MediaCollectionContentsResults = {
  __typename?: 'MediaCollectionContentsResults';
  details: SearchDetails;
  items: Array<EntityWithLot>;
};

export type MediaFilter = {
  collections?: InputMaybe<Array<Scalars['String']['input']>>;
  general?: InputMaybe<MediaGeneralFilter>;
};

export enum MediaGeneralFilter {
  All = 'ALL',
  Dropped = 'DROPPED',
  OnAHold = 'ON_A_HOLD',
  Rated = 'RATED',
  Unfinished = 'UNFINISHED',
  Unrated = 'UNRATED'
}

/** The different types of media that can be stored. */
export enum MediaLot {
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

export enum MediaSortBy {
  LastSeen = 'LAST_SEEN',
  LastUpdated = 'LAST_UPDATED',
  ProviderRating = 'PROVIDER_RATING',
  ReleaseDate = 'RELEASE_DATE',
  Title = 'TITLE',
  UserRating = 'USER_RATING'
}

export type MediaSortInput = {
  by?: MediaSortBy;
  order?: GraphqlSortOrder;
};

/** The different sources (or providers) from which data can be obtained from. */
export enum MediaSource {
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

export enum MediaStateChanged {
  MetadataChaptersOrEpisodesChanged = 'METADATA_CHAPTERS_OR_EPISODES_CHANGED',
  MetadataEpisodeImagesChanged = 'METADATA_EPISODE_IMAGES_CHANGED',
  MetadataEpisodeNameChanged = 'METADATA_EPISODE_NAME_CHANGED',
  MetadataEpisodeReleased = 'METADATA_EPISODE_RELEASED',
  MetadataNumberOfSeasonsChanged = 'METADATA_NUMBER_OF_SEASONS_CHANGED',
  MetadataPublished = 'METADATA_PUBLISHED',
  MetadataReleaseDateChanged = 'METADATA_RELEASE_DATE_CHANGED',
  MetadataStatusChanged = 'METADATA_STATUS_CHANGED',
  PersonMediaAssociated = 'PERSON_MEDIA_ASSOCIATED',
  ReviewPosted = 'REVIEW_POSTED'
}

export type MetadataCreator = {
  __typename?: 'MetadataCreator';
  character?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  image?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type MetadataCreatorGroupedByRole = {
  __typename?: 'MetadataCreatorGroupedByRole';
  items: Array<MetadataCreator>;
  name: Scalars['String']['output'];
};

export type MetadataGroup = {
  __typename?: 'MetadataGroup';
  description?: Maybe<Scalars['String']['output']>;
  displayImages: Array<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  identifier: Scalars['String']['output'];
  isPartial?: Maybe<Scalars['Boolean']['output']>;
  lot: MediaLot;
  parts: Scalars['Int']['output'];
  source: MediaSource;
  title: Scalars['String']['output'];
};

export type MetadataGroupDetails = {
  __typename?: 'MetadataGroupDetails';
  contents: Array<Scalars['String']['output']>;
  details: MetadataGroup;
  sourceUrl?: Maybe<Scalars['String']['output']>;
};

export type MetadataGroupSearchInput = {
  lot: MediaLot;
  search: SearchInput;
  source: MediaSource;
};

export type MetadataGroupSearchItem = {
  __typename?: 'MetadataGroupSearchItem';
  identifier: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  parts?: Maybe<Scalars['Int']['output']>;
};

export type MetadataGroupSearchResults = {
  __typename?: 'MetadataGroupSearchResults';
  details: SearchDetails;
  items: Array<MetadataGroupSearchItem>;
};

export type MetadataGroupsListInput = {
  filter?: InputMaybe<MediaFilter>;
  invertCollection?: InputMaybe<Scalars['Boolean']['input']>;
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<PersonSortInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type MetadataListInput = {
  filter?: InputMaybe<MediaFilter>;
  invertCollection?: InputMaybe<Scalars['Boolean']['input']>;
  lot?: InputMaybe<MediaLot>;
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<MediaSortInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type MetadataPartialDetails = {
  __typename?: 'MetadataPartialDetails';
  id: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  lot: MediaLot;
  publishYear?: Maybe<Scalars['Int']['output']>;
  title: Scalars['String']['output'];
};

export type MetadataSearchInput = {
  lot: MediaLot;
  search: SearchInput;
  source: MediaSource;
};

export type MetadataSearchItem = {
  __typename?: 'MetadataSearchItem';
  identifier: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  publishYear?: Maybe<Scalars['Int']['output']>;
  title: Scalars['String']['output'];
};

export type MetadataSearchItemResponse = {
  __typename?: 'MetadataSearchItemResponse';
  databaseId?: Maybe<Scalars['String']['output']>;
  /** Whether the user has interacted with this media item. */
  hasInteracted: Scalars['Boolean']['output'];
  item: MetadataSearchItem;
};

export type MetadataSearchResults = {
  __typename?: 'MetadataSearchResults';
  details: SearchDetails;
  items: Array<MetadataSearchItemResponse>;
};

export enum MetadataVideoSource {
  Custom = 'CUSTOM',
  Dailymotion = 'DAILYMOTION',
  Youtube = 'YOUTUBE'
}

export type MovieSpecifics = {
  __typename?: 'MovieSpecifics';
  runtime?: Maybe<Scalars['Int']['output']>;
};

export type MovieSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']['input']>;
};

export type MutationRoot = {
  __typename?: 'MutationRoot';
  /** Add a entity to a collection if it is not there, otherwise do nothing. */
  addEntityToCollection: Scalars['Boolean']['output'];
  /** Fetch details about a media and create a media item in the database. */
  commitMetadata: StringIdObject;
  /** Fetch details about a media group and create a media group item in the database. */
  commitMetadataGroup: StringIdObject;
  /** Fetches details about a person and creates a person item in the database. */
  commitPerson: StringIdObject;
  /** Create or edit an access link. */
  createAccessLink: StringIdObject;
  /** Create a custom exercise. */
  createCustomExercise: Scalars['String']['output'];
  /** Create a custom media item. */
  createCustomMetadata: StringIdObject;
  /** Create a new collection for the logged in user or edit details of an existing one. */
  createOrUpdateCollection: StringIdObject;
  /** Create or update a review. */
  createOrUpdateReview: StringIdObject;
  /** Take a user workout, process it and commit it to database. */
  createOrUpdateUserWorkout: Scalars['String']['output'];
  /** Create or update a workout template. */
  createOrUpdateUserWorkoutTemplate: Scalars['String']['output'];
  /** Create, like or delete a comment on a review. */
  createReviewComment: Scalars['Boolean']['output'];
  /** Create an integration for the currently logged in user. */
  createUserIntegration: StringIdObject;
  /** Create a user measurement. */
  createUserMeasurement: Scalars['DateTime']['output'];
  /** Add a notification platform for the currently logged in user. */
  createUserNotificationPlatform: Scalars['String']['output'];
  /** Delete a collection. */
  deleteCollection: Scalars['Boolean']['output'];
  /** Delete a review if it belongs to the currently logged in user. */
  deleteReview: Scalars['Boolean']['output'];
  /** Delete an S3 object by the given key. */
  deleteS3Object: Scalars['Boolean']['output'];
  /** Delete a seen item from a user's history. */
  deleteSeenItem: StringIdObject;
  /** Delete a user. The account deleting the user must be an `Admin`. */
  deleteUser: Scalars['Boolean']['output'];
  /** Delete an integration for the currently logged in user. */
  deleteUserIntegration: Scalars['Boolean']['output'];
  /** Delete a user measurement. */
  deleteUserMeasurement: Scalars['Boolean']['output'];
  /** Delete a notification platform for the currently logged in user. */
  deleteUserNotificationPlatform: Scalars['Boolean']['output'];
  /** Delete a workout and remove all exercise associations. */
  deleteUserWorkout: Scalars['Boolean']['output'];
  /** Delete a workout template. */
  deleteUserWorkoutTemplate: Scalars['Boolean']['output'];
  /** Start a background job. */
  deployBackgroundJob: Scalars['Boolean']['output'];
  /**
   * Deploy job to update progress of media items in bulk. For seen items in progress,
   * progress is updated only if it has actually changed.
   */
  deployBulkProgressUpdate: Scalars['Boolean']['output'];
  /** Deploy a job to export data for a user. */
  deployExportJob: Scalars['Boolean']['output'];
  /** Add job to import data from various sources. */
  deployImportJob: Scalars['Boolean']['output'];
  /** Deploy a job to update a metadata group's details. */
  deployUpdateMetadataGroupJob: Scalars['Boolean']['output'];
  /** Deploy a job to update a media item's metadata. */
  deployUpdateMetadataJob: Scalars['Boolean']['output'];
  /** Deploy a job to update a person's metadata. */
  deployUpdatePersonJob: Scalars['Boolean']['output'];
  /**
   * Use this mutation to call a function that needs to be tested for implementation.
   * It is only available in development mode.
   */
  developmentMutation: Scalars['Boolean']['output'];
  /**
   * Delete all history and reviews for a given media item and remove it from all
   * collections for the user.
   */
  disassociateMetadata: Scalars['Boolean']['output'];
  /** Generate an auth token without any expiry. */
  generateAuthToken: Scalars['String']['output'];
  /** Login a user using their username and password and return an auth token. */
  loginUser: LoginResult;
  /**
   * Merge a media item into another. This will move all `seen`, `collection`
   * and `review` associations with to the metadata.
   */
  mergeMetadata: Scalars['Boolean']['output'];
  /** Get a presigned URL (valid for 10 minutes) for a given file name. */
  presignedPutS3Url: PresignedPutUrlResponse;
  /** Get an access token using an access link. */
  processAccessLink: ProcessAccessLinkResult;
  /**
   * Create a new user for the service. Also set their `lot` as admin if
   * they are the first user.
   */
  registerUser: RegisterResult;
  /** Remove an entity from a collection if it is not there, otherwise do nothing. */
  removeEntityFromCollection: StringIdObject;
  /** Revoke an access link. */
  revokeAccessLink: Scalars['Boolean']['output'];
  /** Test all notification platforms for the currently logged in user. */
  testUserNotificationPlatforms: Scalars['Boolean']['output'];
  /** Update a custom exercise. */
  updateCustomExercise: Scalars['Boolean']['output'];
  /** Update the attributes of a seen item. */
  updateSeenItem: Scalars['Boolean']['output'];
  /** Update a user's profile details. */
  updateUser: StringIdObject;
  /** Update a user's exercise settings. */
  updateUserExerciseSettings: Scalars['Boolean']['output'];
  /** Update an integration for the currently logged in user. */
  updateUserIntegration: Scalars['Boolean']['output'];
  /** Edit a notification platform for the currently logged in user. */
  updateUserNotificationPlatform: Scalars['Boolean']['output'];
  /** Change a user's preferences. */
  updateUserPreference: Scalars['Boolean']['output'];
  /** Change the details about a user's workout. */
  updateUserWorkoutAttributes: Scalars['Boolean']['output'];
};


export type MutationRootAddEntityToCollectionArgs = {
  input: ChangeCollectionToEntityInput;
};


export type MutationRootCommitMetadataArgs = {
  input: CommitMediaInput;
};


export type MutationRootCommitMetadataGroupArgs = {
  input: CommitMediaInput;
};


export type MutationRootCommitPersonArgs = {
  input: CommitPersonInput;
};


export type MutationRootCreateAccessLinkArgs = {
  input: CreateAccessLinkInput;
};


export type MutationRootCreateCustomExerciseArgs = {
  input: ExerciseInput;
};


export type MutationRootCreateCustomMetadataArgs = {
  input: CreateCustomMetadataInput;
};


export type MutationRootCreateOrUpdateCollectionArgs = {
  input: CreateOrUpdateCollectionInput;
};


export type MutationRootCreateOrUpdateReviewArgs = {
  input: CreateOrUpdateReviewInput;
};


export type MutationRootCreateOrUpdateUserWorkoutArgs = {
  input: UserWorkoutInput;
};


export type MutationRootCreateOrUpdateUserWorkoutTemplateArgs = {
  input: UserWorkoutInput;
};


export type MutationRootCreateReviewCommentArgs = {
  input: CreateReviewCommentInput;
};


export type MutationRootCreateUserIntegrationArgs = {
  input: CreateUserIntegrationInput;
};


export type MutationRootCreateUserMeasurementArgs = {
  input: UserMeasurementInput;
};


export type MutationRootCreateUserNotificationPlatformArgs = {
  input: CreateUserNotificationPlatformInput;
};


export type MutationRootDeleteCollectionArgs = {
  collectionName: Scalars['String']['input'];
};


export type MutationRootDeleteReviewArgs = {
  reviewId: Scalars['String']['input'];
};


export type MutationRootDeleteS3ObjectArgs = {
  key: Scalars['String']['input'];
};


export type MutationRootDeleteSeenItemArgs = {
  seenId: Scalars['String']['input'];
};


export type MutationRootDeleteUserArgs = {
  toDeleteUserId: Scalars['String']['input'];
};


export type MutationRootDeleteUserIntegrationArgs = {
  integrationId: Scalars['String']['input'];
};


export type MutationRootDeleteUserMeasurementArgs = {
  timestamp: Scalars['DateTime']['input'];
};


export type MutationRootDeleteUserNotificationPlatformArgs = {
  notificationId: Scalars['String']['input'];
};


export type MutationRootDeleteUserWorkoutArgs = {
  workoutId: Scalars['String']['input'];
};


export type MutationRootDeleteUserWorkoutTemplateArgs = {
  workoutTemplateId: Scalars['String']['input'];
};


export type MutationRootDeployBackgroundJobArgs = {
  jobName: BackgroundJob;
};


export type MutationRootDeployBulkProgressUpdateArgs = {
  input: Array<ProgressUpdateInput>;
};


export type MutationRootDeployImportJobArgs = {
  input: DeployImportJobInput;
};


export type MutationRootDeployUpdateMetadataGroupJobArgs = {
  metadataGroupId: Scalars['String']['input'];
};


export type MutationRootDeployUpdateMetadataJobArgs = {
  metadataId: Scalars['String']['input'];
};


export type MutationRootDeployUpdatePersonJobArgs = {
  personId: Scalars['String']['input'];
};


export type MutationRootDisassociateMetadataArgs = {
  metadataId: Scalars['String']['input'];
};


export type MutationRootLoginUserArgs = {
  input: AuthUserInput;
};


export type MutationRootMergeMetadataArgs = {
  mergeFrom: Scalars['String']['input'];
  mergeInto: Scalars['String']['input'];
};


export type MutationRootPresignedPutS3UrlArgs = {
  input: PresignedPutUrlInput;
};


export type MutationRootProcessAccessLinkArgs = {
  input: ProcessAccessLinkInput;
};


export type MutationRootRegisterUserArgs = {
  input: RegisterUserInput;
};


export type MutationRootRemoveEntityFromCollectionArgs = {
  input: ChangeCollectionToEntityInput;
};


export type MutationRootRevokeAccessLinkArgs = {
  accessLinkId: Scalars['String']['input'];
};


export type MutationRootUpdateCustomExerciseArgs = {
  input: UpdateCustomExerciseInput;
};


export type MutationRootUpdateSeenItemArgs = {
  input: UpdateSeenItemInput;
};


export type MutationRootUpdateUserArgs = {
  input: UpdateUserInput;
};


export type MutationRootUpdateUserExerciseSettingsArgs = {
  input: UpdateUserExerciseSettings;
};


export type MutationRootUpdateUserIntegrationArgs = {
  input: UpdateUserIntegrationInput;
};


export type MutationRootUpdateUserNotificationPlatformArgs = {
  input: UpdateUserNotificationPlatformInput;
};


export type MutationRootUpdateUserPreferenceArgs = {
  input: UpdateComplexJsonInput;
};


export type MutationRootUpdateUserWorkoutAttributesArgs = {
  input: UpdateUserWorkoutAttributesInput;
};

export type NotificationPlatform = {
  __typename?: 'NotificationPlatform';
  createdOn: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isDisabled?: Maybe<Scalars['Boolean']['output']>;
  lot: NotificationPlatformLot;
};

export enum NotificationPlatformLot {
  Apprise = 'APPRISE',
  Discord = 'DISCORD',
  Email = 'EMAIL',
  Gotify = 'GOTIFY',
  Ntfy = 'NTFY',
  PushBullet = 'PUSH_BULLET',
  PushOver = 'PUSH_OVER',
  PushSafer = 'PUSH_SAFER',
  Telegram = 'TELEGRAM'
}

export type OidcTokenOutput = {
  __typename?: 'OidcTokenOutput';
  email: Scalars['String']['output'];
  subject: Scalars['String']['output'];
};

export type OidcUserInput = {
  email: Scalars['String']['input'];
  issuerId: Scalars['String']['input'];
};

export type PasswordUserInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type PeopleListInput = {
  filter?: InputMaybe<MediaFilter>;
  invertCollection?: InputMaybe<Scalars['Boolean']['input']>;
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<PersonSortInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type PeopleSearchInput = {
  search: SearchInput;
  source: MediaSource;
  sourceSpecifics?: InputMaybe<PersonSourceSpecificsInput>;
};

export type PeopleSearchItem = {
  __typename?: 'PeopleSearchItem';
  birthYear?: Maybe<Scalars['Int']['output']>;
  identifier: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type PeopleSearchResults = {
  __typename?: 'PeopleSearchResults';
  details: SearchDetails;
  items: Array<PeopleSearchItem>;
};

export type Person = {
  __typename?: 'Person';
  birthDate?: Maybe<Scalars['NaiveDate']['output']>;
  createdOn: Scalars['DateTime']['output'];
  deathDate?: Maybe<Scalars['NaiveDate']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  displayImages: Array<Scalars['String']['output']>;
  gender?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  identifier: Scalars['String']['output'];
  isPartial?: Maybe<Scalars['Boolean']['output']>;
  lastUpdatedOn: Scalars['DateTime']['output'];
  name: Scalars['String']['output'];
  place?: Maybe<Scalars['String']['output']>;
  source: MediaSource;
  website?: Maybe<Scalars['String']['output']>;
};

export enum PersonAndMetadataGroupsSortBy {
  MediaItems = 'MEDIA_ITEMS',
  Name = 'NAME'
}

export type PersonDetails = {
  __typename?: 'PersonDetails';
  contents: Array<PersonDetailsGroupedByRole>;
  details: Person;
  sourceUrl?: Maybe<Scalars['String']['output']>;
};

export type PersonDetailsGroupedByRole = {
  __typename?: 'PersonDetailsGroupedByRole';
  /** The number of items in this role. */
  count: Scalars['Int']['output'];
  /** The media items in which this role was performed. */
  items: Array<PersonDetailsItemWithCharacter>;
  /** The name of the role performed. */
  name: Scalars['String']['output'];
};

export type PersonDetailsItemWithCharacter = {
  __typename?: 'PersonDetailsItemWithCharacter';
  character?: Maybe<Scalars['String']['output']>;
  metadataId: Scalars['String']['output'];
};

export type PersonSortInput = {
  by?: PersonAndMetadataGroupsSortBy;
  order?: GraphqlSortOrder;
};

export type PersonSourceSpecificsInput = {
  isAnilistStudio?: InputMaybe<Scalars['Boolean']['input']>;
  isTmdbCompany?: InputMaybe<Scalars['Boolean']['input']>;
};

export type PodcastEpisode = {
  __typename?: 'PodcastEpisode';
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
  __typename?: 'PodcastSpecifics';
  episodes: Array<PodcastEpisode>;
  totalEpisodes: Scalars['Int']['output'];
};

export type PodcastSpecificsInput = {
  episodes: Array<PodcastEpisodeInput>;
  totalEpisodes: Scalars['Int']['input'];
};

export type PresignedPutUrlInput = {
  fileName: Scalars['String']['input'];
  prefix: Scalars['String']['input'];
};

export type PresignedPutUrlResponse = {
  __typename?: 'PresignedPutUrlResponse';
  key: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

export type ProcessAccessLinkError = {
  __typename?: 'ProcessAccessLinkError';
  error: ProcessAccessLinkErrorVariant;
};

export enum ProcessAccessLinkErrorVariant {
  Expired = 'EXPIRED',
  MaximumUsesReached = 'MAXIMUM_USES_REACHED',
  NotFound = 'NOT_FOUND',
  Revoked = 'REVOKED'
}

export type ProcessAccessLinkInput = {
  id?: InputMaybe<Scalars['String']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
};

export type ProcessAccessLinkResponse = {
  __typename?: 'ProcessAccessLinkResponse';
  apiKey: Scalars['String']['output'];
  redirectTo?: Maybe<Scalars['String']['output']>;
  tokenValidForDays: Scalars['Int']['output'];
};

export type ProcessAccessLinkResult = ProcessAccessLinkError | ProcessAccessLinkResponse;

/** An exercise that has been processed and committed to the database. */
export type ProcessedExercise = {
  __typename?: 'ProcessedExercise';
  assets?: Maybe<EntityAssets>;
  lot: ExerciseLot;
  name: Scalars['String']['output'];
  notes: Array<Scalars['String']['output']>;
  sets: Array<WorkoutSetRecord>;
  total?: Maybe<WorkoutOrExerciseTotals>;
};

export type ProgressUpdateInput = {
  animeEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  changeState?: InputMaybe<SeenState>;
  date?: InputMaybe<Scalars['NaiveDate']['input']>;
  mangaChapterNumber?: InputMaybe<Scalars['Decimal']['input']>;
  mangaVolumeNumber?: InputMaybe<Scalars['Int']['input']>;
  metadataId: Scalars['String']['input'];
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  progress?: InputMaybe<Scalars['Decimal']['input']>;
  providerWatchedOn?: InputMaybe<Scalars['String']['input']>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
};

export type ProviderLanguageInformation = {
  __typename?: 'ProviderLanguageInformation';
  default: Scalars['String']['output'];
  source: MediaSource;
  supported: Array<Scalars['String']['output']>;
};

export type QueryRoot = {
  __typename?: 'QueryRoot';
  /** Get the contents of a collection and respect visibility. */
  collectionContents: CollectionContents;
  /** Get some primary information about the service. */
  coreDetails: CoreDetails;
  /** Get daily user activities for the currently logged in user. */
  dailyUserActivities: DailyUserActivitiesResponse;
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
  /** Get an authorization URL using the configured OIDC client. */
  getOidcRedirectUrl: Scalars['String']['output'];
  /** Get an access token using the configured OIDC client. */
  getOidcToken: OidcTokenOutput;
  /** Get a presigned URL (valid for 90 minutes) for a given key. */
  getPresignedS3Url: Scalars['String']['output'];
  /** Get all the import jobs deployed by the user. */
  importReports: Array<ImportReport>;
  /** Get a summary of all the media items that have been consumed by this user. */
  latestUserSummary: DailyUserActivityItem;
  /** Get details about a media present in the database. */
  metadataDetails: GraphqlMetadataDetails;
  /** Get details about a metadata group present in the database. */
  metadataGroupDetails: MetadataGroupDetails;
  /** Search for a list of groups from a given source. */
  metadataGroupSearch: MetadataGroupSearchResults;
  /** Get paginated list of metadata groups. */
  metadataGroupsList: IdResults;
  /** Get all the media items related to a user for a specific media type. */
  metadataList: IdResults;
  /** Get partial details about a media present in the database. */
  metadataPartialDetails: MetadataPartialDetails;
  /** Search for a list of media for a given type. */
  metadataSearch: MetadataSearchResults;
  /** Get paginated list of people. */
  peopleList: IdResults;
  /** Search for a list of people from a given source. */
  peopleSearch: PeopleSearchResults;
  /** Get details about a creator present in the database. */
  personDetails: PersonDetails;
  /** Get all languages supported by all the providers. */
  providersLanguageInformation: Array<ProviderLanguageInformation>;
  /** Get all access links generated by the currently logged in user. */
  userAccessLinks: Array<AccessLink>;
  /** Get user by OIDC issuer ID. */
  userByOidcIssuerId?: Maybe<Scalars['String']['output']>;
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
  userIntegrations: Array<Integration>;
  /** Get all the measurements for a user. */
  userMeasurementsList: Array<UserMeasurement>;
  /** Get details that can be displayed to a user for a media. */
  userMetadataDetails: UserMetadataDetails;
  /** Get details that can be displayed to a user for a metadata group. */
  userMetadataGroupDetails: UserMetadataGroupDetails;
  /** Get all the notification platforms for the currently logged in user. */
  userNotificationPlatforms: Array<NotificationPlatform>;
  /** Get details that can be displayed to a user for a creator. */
  userPersonDetails: UserPersonDetails;
  /** Get media recommendations for the currently logged in user. */
  userRecommendations: Array<Scalars['String']['output']>;
  /** Get upcoming calendar events for the given filter. */
  userUpcomingCalendarEvents: Array<GraphqlCalendarEvent>;
  /** Get details about a workout. */
  userWorkoutDetails: UserWorkoutDetails;
  /** Get information about a workout template. */
  userWorkoutTemplateDetails: UserWorkoutTemplateDetails;
  /** Get a paginated list of templates created by the user. */
  userWorkoutTemplatesList: WorkoutTemplateListResults;
  /** Get a paginated list of workouts done by the user. */
  userWorkoutsList: WorkoutListResults;
  /** Get details about all the users in the service. */
  usersList: Array<User>;
};


export type QueryRootCollectionContentsArgs = {
  input: CollectionContentsInput;
};


export type QueryRootDailyUserActivitiesArgs = {
  input: DailyUserActivitiesInput;
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


export type QueryRootGetOidcTokenArgs = {
  code: Scalars['String']['input'];
};


export type QueryRootGetPresignedS3UrlArgs = {
  key: Scalars['String']['input'];
};


export type QueryRootMetadataDetailsArgs = {
  metadataId: Scalars['String']['input'];
};


export type QueryRootMetadataGroupDetailsArgs = {
  metadataGroupId: Scalars['String']['input'];
};


export type QueryRootMetadataGroupSearchArgs = {
  input: MetadataGroupSearchInput;
};


export type QueryRootMetadataGroupsListArgs = {
  input: MetadataGroupsListInput;
};


export type QueryRootMetadataListArgs = {
  input: MetadataListInput;
};


export type QueryRootMetadataPartialDetailsArgs = {
  metadataId: Scalars['String']['input'];
};


export type QueryRootMetadataSearchArgs = {
  input: MetadataSearchInput;
};


export type QueryRootPeopleListArgs = {
  input: PeopleListInput;
};


export type QueryRootPeopleSearchArgs = {
  input: PeopleSearchInput;
};


export type QueryRootPersonDetailsArgs = {
  personId: Scalars['String']['input'];
};


export type QueryRootUserByOidcIssuerIdArgs = {
  oidcIssuerId: Scalars['String']['input'];
};


export type QueryRootUserCalendarEventsArgs = {
  input: UserCalendarEventInput;
};


export type QueryRootUserCollectionsListArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
};


export type QueryRootUserExerciseDetailsArgs = {
  exerciseId: Scalars['String']['input'];
};


export type QueryRootUserMeasurementsListArgs = {
  input: UserMeasurementsListInput;
};


export type QueryRootUserMetadataDetailsArgs = {
  metadataId: Scalars['String']['input'];
};


export type QueryRootUserMetadataGroupDetailsArgs = {
  metadataGroupId: Scalars['String']['input'];
};


export type QueryRootUserPersonDetailsArgs = {
  personId: Scalars['String']['input'];
};


export type QueryRootUserUpcomingCalendarEventsArgs = {
  input: UserUpcomingCalendarEventInput;
};


export type QueryRootUserWorkoutDetailsArgs = {
  workoutId: Scalars['String']['input'];
};


export type QueryRootUserWorkoutTemplateDetailsArgs = {
  workoutTemplateId: Scalars['String']['input'];
};


export type QueryRootUserWorkoutTemplatesListArgs = {
  input: SearchInput;
};


export type QueryRootUserWorkoutsListArgs = {
  input: SearchInput;
};


export type QueryRootUsersListArgs = {
  query?: InputMaybe<Scalars['String']['input']>;
};

export type RegisterError = {
  __typename?: 'RegisterError';
  error: RegisterErrorVariant;
};

export enum RegisterErrorVariant {
  Disabled = 'DISABLED',
  IdentifierAlreadyExists = 'IDENTIFIER_ALREADY_EXISTS'
}

export type RegisterResult = RegisterError | StringIdObject;

export type RegisterUserInput = {
  /** If registration is disabled, this can be used to override it. */
  adminAccessToken?: InputMaybe<Scalars['String']['input']>;
  data: AuthUserInput;
};

export type ReviewItem = {
  __typename?: 'ReviewItem';
  animeExtraInformation?: Maybe<SeenAnimeExtraInformation>;
  comments: Array<ImportOrExportItemReviewComment>;
  id: Scalars['String']['output'];
  isSpoiler: Scalars['Boolean']['output'];
  mangaExtraInformation?: Maybe<SeenMangaExtraInformation>;
  podcastExtraInformation?: Maybe<SeenPodcastExtraInformation>;
  postedBy: IdAndNamedObject;
  postedOn: Scalars['DateTime']['output'];
  rating?: Maybe<Scalars['Decimal']['output']>;
  seenItemsAssociatedWith: Array<Scalars['String']['output']>;
  showExtraInformation?: Maybe<SeenShowExtraInformation>;
  textOriginal?: Maybe<Scalars['String']['output']>;
  textRendered?: Maybe<Scalars['String']['output']>;
  visibility: Visibility;
};

export type SearchDetails = {
  __typename?: 'SearchDetails';
  nextPage?: Maybe<Scalars['Int']['output']>;
  total: Scalars['Int']['output'];
};

export type SearchInput = {
  page?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
};

export type Seen = {
  __typename?: 'Seen';
  animeExtraInformation?: Maybe<SeenAnimeExtraInformation>;
  finishedOn?: Maybe<Scalars['NaiveDate']['output']>;
  id: Scalars['String']['output'];
  lastUpdatedOn: Scalars['DateTime']['output'];
  mangaExtraInformation?: Maybe<SeenMangaExtraInformation>;
  manualTimeSpent?: Maybe<Scalars['Decimal']['output']>;
  metadataId: Scalars['String']['output'];
  numTimesUpdated: Scalars['Int']['output'];
  podcastExtraInformation?: Maybe<SeenPodcastExtraInformation>;
  progress: Scalars['Decimal']['output'];
  providerWatchedOn?: Maybe<Scalars['String']['output']>;
  reviewId?: Maybe<Scalars['String']['output']>;
  showExtraInformation?: Maybe<SeenShowExtraInformation>;
  startedOn?: Maybe<Scalars['NaiveDate']['output']>;
  state: SeenState;
  userId: Scalars['String']['output'];
};

export type SeenAnimeExtraInformation = {
  __typename?: 'SeenAnimeExtraInformation';
  episode?: Maybe<Scalars['Int']['output']>;
};

export type SeenMangaExtraInformation = {
  __typename?: 'SeenMangaExtraInformation';
  chapter?: Maybe<Scalars['Decimal']['output']>;
  volume?: Maybe<Scalars['Int']['output']>;
};

export type SeenPodcastExtraInformation = {
  __typename?: 'SeenPodcastExtraInformation';
  episode: Scalars['Int']['output'];
};

export type SeenShowExtraInformation = {
  __typename?: 'SeenShowExtraInformation';
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

export type SetRestTimersSettings = {
  __typename?: 'SetRestTimersSettings';
  drop?: Maybe<Scalars['Int']['output']>;
  failure?: Maybe<Scalars['Int']['output']>;
  normal?: Maybe<Scalars['Int']['output']>;
  warmup?: Maybe<Scalars['Int']['output']>;
};

/** Details about the statistics of the set performed. */
export type SetStatisticInput = {
  distance?: InputMaybe<Scalars['Decimal']['input']>;
  duration?: InputMaybe<Scalars['Decimal']['input']>;
  oneRm?: InputMaybe<Scalars['Decimal']['input']>;
  pace?: InputMaybe<Scalars['Decimal']['input']>;
  reps?: InputMaybe<Scalars['Decimal']['input']>;
  volume?: InputMaybe<Scalars['Decimal']['input']>;
  weight?: InputMaybe<Scalars['Decimal']['input']>;
};

export type ShowEpisode = {
  __typename?: 'ShowEpisode';
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
  __typename?: 'ShowSeason';
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
  __typename?: 'ShowSpecifics';
  runtime?: Maybe<Scalars['Int']['output']>;
  seasons: Array<ShowSeason>;
  totalEpisodes?: Maybe<Scalars['Int']['output']>;
  totalSeasons?: Maybe<Scalars['Int']['output']>;
};

export type ShowSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']['input']>;
  seasons: Array<ShowSeasonSpecificsInput>;
  totalEpisodes?: InputMaybe<Scalars['Int']['input']>;
  totalSeasons?: InputMaybe<Scalars['Int']['input']>;
};

export type StringIdObject = {
  __typename?: 'StringIdObject';
  id: Scalars['String']['output'];
};

export type StrongAppImportMapping = {
  multiplier?: InputMaybe<Scalars['Decimal']['input']>;
  sourceName: Scalars['String']['input'];
  targetName: Scalars['String']['input'];
};

export type UpdateComplexJsonInput = {
  /** Dot delimited path to the property that needs to be changed. */
  property: Scalars['String']['input'];
  value: Scalars['String']['input'];
};

export type UpdateCustomExerciseInput = {
  attributes: ExerciseAttributesInput;
  equipment?: InputMaybe<ExerciseEquipment>;
  force?: InputMaybe<ExerciseForce>;
  id: Scalars['String']['input'];
  level: ExerciseLevel;
  lot: ExerciseLot;
  mechanic?: InputMaybe<ExerciseMechanic>;
  muscles: Array<ExerciseMuscle>;
  oldName: Scalars['String']['input'];
  shouldDelete?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateSeenItemInput = {
  finishedOn?: InputMaybe<Scalars['NaiveDate']['input']>;
  manualTimeSpent?: InputMaybe<Scalars['Decimal']['input']>;
  providerWatchedOn?: InputMaybe<Scalars['String']['input']>;
  reviewId?: InputMaybe<Scalars['String']['input']>;
  seenId: Scalars['String']['input'];
  startedOn?: InputMaybe<Scalars['NaiveDate']['input']>;
};

export type UpdateUserExerciseSettings = {
  change: UpdateComplexJsonInput;
  exerciseId: Scalars['String']['input'];
};

export type UpdateUserInput = {
  adminAccessToken?: InputMaybe<Scalars['String']['input']>;
  extraInformation?: InputMaybe<Scalars['JSON']['input']>;
  isDisabled?: InputMaybe<Scalars['Boolean']['input']>;
  lot?: InputMaybe<UserLot>;
  password?: InputMaybe<Scalars['String']['input']>;
  userId: Scalars['String']['input'];
  username?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserIntegrationInput = {
  integrationId: Scalars['String']['input'];
  isDisabled?: InputMaybe<Scalars['Boolean']['input']>;
  maximumProgress?: InputMaybe<Scalars['Decimal']['input']>;
  minimumProgress?: InputMaybe<Scalars['Decimal']['input']>;
  syncToOwnedCollection?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateUserNotificationPlatformInput = {
  isDisabled?: InputMaybe<Scalars['Boolean']['input']>;
  notificationId: Scalars['String']['input'];
};

export type UpdateUserWorkoutAttributesInput = {
  endTime?: InputMaybe<Scalars['DateTime']['input']>;
  id: Scalars['String']['input'];
  startTime?: InputMaybe<Scalars['DateTime']['input']>;
};

export type User = {
  __typename?: 'User';
  createdOn: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  isDisabled?: Maybe<Scalars['Boolean']['output']>;
  lot: UserLot;
  name: Scalars['String']['output'];
  oidcIssuerId?: Maybe<Scalars['String']['output']>;
  preferences: UserPreferences;
};

export type UserCalendarEventInput = {
  month: Scalars['Int']['input'];
  year: Scalars['Int']['input'];
};

export type UserCustomMeasurement = {
  __typename?: 'UserCustomMeasurement';
  dataType: UserCustomMeasurementDataType;
  name: Scalars['String']['output'];
};

export enum UserCustomMeasurementDataType {
  Decimal = 'DECIMAL'
}

export type UserDetailsError = {
  __typename?: 'UserDetailsError';
  error: UserDetailsErrorVariant;
};

export enum UserDetailsErrorVariant {
  AuthTokenInvalid = 'AUTH_TOKEN_INVALID'
}

export type UserDetailsResult = User | UserDetailsError;

export type UserExerciseDetails = {
  __typename?: 'UserExerciseDetails';
  collections: Array<Collection>;
  details?: Maybe<UserToEntity>;
  history?: Maybe<Array<UserToExerciseHistoryExtraInformation>>;
  reviews: Array<ReviewItem>;
};

export type UserExerciseInput = {
  assets?: InputMaybe<EntityAssetsInput>;
  exerciseId: Scalars['String']['input'];
  notes: Array<Scalars['String']['input']>;
  sets: Array<UserWorkoutSetRecord>;
};

export type UserFeaturesEnabledPreferences = {
  __typename?: 'UserFeaturesEnabledPreferences';
  fitness: UserFitnessFeaturesEnabledPreferences;
  media: UserMediaFeaturesEnabledPreferences;
  others: UserOthersFeaturesEnabledPreferences;
};

export type UserFitnessExercisesPreferences = {
  __typename?: 'UserFitnessExercisesPreferences';
  setRestTimers: SetRestTimersSettings;
  unitSystem: UserUnitSystem;
};

export type UserFitnessFeaturesEnabledPreferences = {
  __typename?: 'UserFitnessFeaturesEnabledPreferences';
  enabled: Scalars['Boolean']['output'];
  measurements: Scalars['Boolean']['output'];
  templates: Scalars['Boolean']['output'];
  workouts: Scalars['Boolean']['output'];
};

export type UserFitnessLoggingPreferences = {
  __typename?: 'UserFitnessLoggingPreferences';
  showDetailsWhileEditing: Scalars['Boolean']['output'];
};

export type UserFitnessMeasurementsPreferences = {
  __typename?: 'UserFitnessMeasurementsPreferences';
  custom: Array<UserCustomMeasurement>;
  inbuilt: UserMeasurementsInBuiltPreferences;
};

export type UserFitnessPreferences = {
  __typename?: 'UserFitnessPreferences';
  exercises: UserFitnessExercisesPreferences;
  logging: UserFitnessLoggingPreferences;
  measurements: UserFitnessMeasurementsPreferences;
};

export type UserGeneralDashboardElement = {
  __typename?: 'UserGeneralDashboardElement';
  deduplicateMedia?: Maybe<Scalars['Boolean']['output']>;
  hidden: Scalars['Boolean']['output'];
  numElements?: Maybe<Scalars['Int']['output']>;
  section: DashboardElementLot;
};

export type UserGeneralPreferences = {
  __typename?: 'UserGeneralPreferences';
  dashboard: Array<UserGeneralDashboardElement>;
  disableIntegrations: Scalars['Boolean']['output'];
  disableNavigationAnimation: Scalars['Boolean']['output'];
  disableReviews: Scalars['Boolean']['output'];
  disableVideos: Scalars['Boolean']['output'];
  disableWatchProviders: Scalars['Boolean']['output'];
  displayNsfw: Scalars['Boolean']['output'];
  gridPacking: GridPacking;
  persistQueries: Scalars['Boolean']['output'];
  reviewScale: UserReviewScale;
  watchProviders: Array<UserGeneralWatchProvider>;
};

export type UserGeneralWatchProvider = {
  __typename?: 'UserGeneralWatchProvider';
  lot: MediaLot;
  values: Array<Scalars['String']['output']>;
};

export enum UserLot {
  Admin = 'ADMIN',
  Normal = 'NORMAL'
}

/** An export of a measurement taken at a point in time. */
export type UserMeasurement = {
  __typename?: 'UserMeasurement';
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
  __typename?: 'UserMeasurementStats';
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
  __typename?: 'UserMeasurementsInBuiltPreferences';
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

export type UserMediaFeaturesEnabledPreferences = {
  __typename?: 'UserMediaFeaturesEnabledPreferences';
  anime: Scalars['Boolean']['output'];
  audioBook: Scalars['Boolean']['output'];
  book: Scalars['Boolean']['output'];
  enabled: Scalars['Boolean']['output'];
  genres: Scalars['Boolean']['output'];
  groups: Scalars['Boolean']['output'];
  manga: Scalars['Boolean']['output'];
  movie: Scalars['Boolean']['output'];
  people: Scalars['Boolean']['output'];
  podcast: Scalars['Boolean']['output'];
  show: Scalars['Boolean']['output'];
  videoGame: Scalars['Boolean']['output'];
  visualNovel: Scalars['Boolean']['output'];
};

export type UserMediaNextEntry = {
  __typename?: 'UserMediaNextEntry';
  chapter?: Maybe<Scalars['Decimal']['output']>;
  episode?: Maybe<Scalars['Int']['output']>;
  season?: Maybe<Scalars['Int']['output']>;
  volume?: Maybe<Scalars['Int']['output']>;
};

export type UserMetadataDetails = {
  __typename?: 'UserMetadataDetails';
  /** The average rating of this media in this service. */
  averageRating?: Maybe<Scalars['Decimal']['output']>;
  /** The collections in which this media is present. */
  collections: Array<Collection>;
  /** Whether this media has been interacted with */
  hasInteracted: Scalars['Boolean']['output'];
  /** The seen history of this media. */
  history: Array<Seen>;
  /** The seen item if it is in progress. */
  inProgress?: Maybe<Seen>;
  /** The reasons why this metadata is related to this user */
  mediaReason?: Maybe<Array<UserToMediaReason>>;
  /** The next episode/chapter of this media. */
  nextEntry?: Maybe<UserMediaNextEntry>;
  /** The seen progress of this media if it is a podcast. */
  podcastProgress?: Maybe<Array<UserMetadataDetailsEpisodeProgress>>;
  /** The public reviews of this media. */
  reviews: Array<ReviewItem>;
  /** The number of users who have seen this media. */
  seenByAllCount: Scalars['Int']['output'];
  /** The number of times this user has seen this media. */
  seenByUserCount: Scalars['Int']['output'];
  /** The seen progress of this media if it is a show. */
  showProgress?: Maybe<Array<UserMetadataDetailsShowSeasonProgress>>;
};

export type UserMetadataDetailsEpisodeProgress = {
  __typename?: 'UserMetadataDetailsEpisodeProgress';
  episodeNumber: Scalars['Int']['output'];
  timesSeen: Scalars['Int']['output'];
};

export type UserMetadataDetailsShowSeasonProgress = {
  __typename?: 'UserMetadataDetailsShowSeasonProgress';
  episodes: Array<UserMetadataDetailsEpisodeProgress>;
  seasonNumber: Scalars['Int']['output'];
  timesSeen: Scalars['Int']['output'];
};

export type UserMetadataGroupDetails = {
  __typename?: 'UserMetadataGroupDetails';
  collections: Array<Collection>;
  reviews: Array<ReviewItem>;
};

export type UserNotificationsPreferences = {
  __typename?: 'UserNotificationsPreferences';
  enabled: Scalars['Boolean']['output'];
  toSend: Array<MediaStateChanged>;
};

export type UserOthersFeaturesEnabledPreferences = {
  __typename?: 'UserOthersFeaturesEnabledPreferences';
  calendar: Scalars['Boolean']['output'];
  collections: Scalars['Boolean']['output'];
};

export type UserPersonDetails = {
  __typename?: 'UserPersonDetails';
  collections: Array<Collection>;
  reviews: Array<ReviewItem>;
};

export type UserPreferences = {
  __typename?: 'UserPreferences';
  featuresEnabled: UserFeaturesEnabledPreferences;
  fitness: UserFitnessPreferences;
  general: UserGeneralPreferences;
  notifications: UserNotificationsPreferences;
};

export enum UserReviewScale {
  OutOfFive = 'OUT_OF_FIVE',
  OutOfHundred = 'OUT_OF_HUNDRED',
  ThreePointSmiley = 'THREE_POINT_SMILEY'
}

export type UserToEntity = {
  __typename?: 'UserToEntity';
  collectionId?: Maybe<Scalars['String']['output']>;
  createdOn: Scalars['DateTime']['output'];
  exerciseExtraInformation?: Maybe<UserToExerciseExtraInformation>;
  exerciseId?: Maybe<Scalars['String']['output']>;
  exerciseNumTimesInteracted?: Maybe<Scalars['Int']['output']>;
  lastUpdatedOn: Scalars['DateTime']['output'];
  metadataGroupId?: Maybe<Scalars['String']['output']>;
  metadataId?: Maybe<Scalars['String']['output']>;
  personId?: Maybe<Scalars['String']['output']>;
  userId: Scalars['String']['output'];
};

export type UserToExerciseBestSetExtraInformation = {
  __typename?: 'UserToExerciseBestSetExtraInformation';
  lot: WorkoutSetPersonalBest;
  sets: Array<ExerciseBestSetRecord>;
};

export type UserToExerciseExtraInformation = {
  __typename?: 'UserToExerciseExtraInformation';
  history: Array<UserToExerciseHistoryExtraInformation>;
  lifetimeStats: WorkoutOrExerciseTotals;
  personalBests: Array<UserToExerciseBestSetExtraInformation>;
  settings: UserToExerciseSettingsExtraInformation;
};

export type UserToExerciseHistoryExtraInformation = {
  __typename?: 'UserToExerciseHistoryExtraInformation';
  bestSet?: Maybe<WorkoutSetRecord>;
  idx: Scalars['Int']['output'];
  workoutEndOn: Scalars['DateTime']['output'];
  workoutId: Scalars['String']['output'];
};

export type UserToExerciseSettingsExtraInformation = {
  __typename?: 'UserToExerciseSettingsExtraInformation';
  setRestTimers: SetRestTimersSettings;
};

export enum UserToMediaReason {
  Collection = 'COLLECTION',
  Finished = 'FINISHED',
  Monitoring = 'MONITORING',
  Owned = 'OWNED',
  Reminder = 'REMINDER',
  Reviewed = 'REVIEWED',
  Seen = 'SEEN',
  Watchlist = 'WATCHLIST'
}

export enum UserUnitSystem {
  Imperial = 'IMPERIAL',
  Metric = 'METRIC'
}

export type UserUpcomingCalendarEventInput = {
  /** The number of days to select */
  nextDays?: InputMaybe<Scalars['Int']['input']>;
  /** The number of media to select */
  nextMedia?: InputMaybe<Scalars['Int']['input']>;
};

export type UserWorkoutDetails = {
  __typename?: 'UserWorkoutDetails';
  collections: Array<Collection>;
  details: Workout;
};

export type UserWorkoutInput = {
  assets?: InputMaybe<EntityAssetsInput>;
  comment?: InputMaybe<Scalars['String']['input']>;
  endTime: Scalars['DateTime']['input'];
  exercises: Array<UserExerciseInput>;
  name: Scalars['String']['input'];
  repeatedFrom?: InputMaybe<Scalars['String']['input']>;
  startTime: Scalars['DateTime']['input'];
  supersets: Array<WorkoutSupersetsInformationInput>;
  templateId?: InputMaybe<Scalars['String']['input']>;
  updateWorkoutId?: InputMaybe<Scalars['String']['input']>;
  updateWorkoutTemplateId?: InputMaybe<Scalars['String']['input']>;
};

export type UserWorkoutSetRecord = {
  confirmedAt?: InputMaybe<Scalars['DateTime']['input']>;
  lot: SetLot;
  note?: InputMaybe<Scalars['String']['input']>;
  restTime?: InputMaybe<Scalars['Int']['input']>;
  statistic: SetStatisticInput;
};

export type UserWorkoutTemplateDetails = {
  __typename?: 'UserWorkoutTemplateDetails';
  collections: Array<Collection>;
  details: WorkoutTemplate;
};

export type VideoGameSpecifics = {
  __typename?: 'VideoGameSpecifics';
  platforms: Array<Scalars['String']['output']>;
};

export type VideoGameSpecificsInput = {
  platforms: Array<Scalars['String']['input']>;
};

export enum Visibility {
  Private = 'PRIVATE',
  Public = 'PUBLIC'
}

export type VisualNovelSpecifics = {
  __typename?: 'VisualNovelSpecifics';
  length?: Maybe<Scalars['Int']['output']>;
};

export type VisualNovelSpecificsInput = {
  length?: InputMaybe<Scalars['Int']['input']>;
};

export type WatchProvider = {
  __typename?: 'WatchProvider';
  image?: Maybe<Scalars['String']['output']>;
  languages: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

/** A workout that was completed by the user. */
export type Workout = {
  __typename?: 'Workout';
  duration: Scalars['Int']['output'];
  endTime: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  information: WorkoutInformation;
  name: Scalars['String']['output'];
  repeatedFrom?: Maybe<Scalars['String']['output']>;
  startTime: Scalars['DateTime']['output'];
  summary: WorkoutSummary;
  templateId?: Maybe<Scalars['String']['output']>;
};

export type WorkoutEquipmentFocusedSummary = {
  __typename?: 'WorkoutEquipmentFocusedSummary';
  equipment: ExerciseEquipment;
  exercises: Array<Scalars['Int']['output']>;
};

export type WorkoutFocusedSummary = {
  __typename?: 'WorkoutFocusedSummary';
  equipments: Array<WorkoutEquipmentFocusedSummary>;
  forces: Array<WorkoutForceFocusedSummary>;
  levels: Array<WorkoutLevelFocusedSummary>;
  lots: Array<WorkoutLotFocusedSummary>;
  muscles: Array<WorkoutMuscleFocusedSummary>;
};

export type WorkoutForceFocusedSummary = {
  __typename?: 'WorkoutForceFocusedSummary';
  exercises: Array<Scalars['Int']['output']>;
  force: ExerciseForce;
};

/** Information about a workout done. */
export type WorkoutInformation = {
  __typename?: 'WorkoutInformation';
  assets?: Maybe<EntityAssets>;
  comment?: Maybe<Scalars['String']['output']>;
  exercises: Array<ProcessedExercise>;
  supersets: Array<WorkoutSupersetsInformation>;
};

export type WorkoutLevelFocusedSummary = {
  __typename?: 'WorkoutLevelFocusedSummary';
  exercises: Array<Scalars['Int']['output']>;
  level: ExerciseLevel;
};

export type WorkoutListResults = {
  __typename?: 'WorkoutListResults';
  details: SearchDetails;
  items: Array<Workout>;
};

export type WorkoutLotFocusedSummary = {
  __typename?: 'WorkoutLotFocusedSummary';
  exercises: Array<Scalars['Int']['output']>;
  lot: ExerciseLot;
};

export type WorkoutMuscleFocusedSummary = {
  __typename?: 'WorkoutMuscleFocusedSummary';
  exercises: Array<Scalars['Int']['output']>;
  muscle: ExerciseMuscle;
};

/** The totals of a workout and the different bests achieved. */
export type WorkoutOrExerciseTotals = {
  __typename?: 'WorkoutOrExerciseTotals';
  distance: Scalars['Decimal']['output'];
  duration: Scalars['Decimal']['output'];
  /** The number of personal bests achieved. */
  personalBestsAchieved: Scalars['Int']['output'];
  reps: Scalars['Decimal']['output'];
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
  __typename?: 'WorkoutSetRecord';
  actualRestTime?: Maybe<Scalars['Int']['output']>;
  confirmedAt?: Maybe<Scalars['DateTime']['output']>;
  lot: SetLot;
  note?: Maybe<Scalars['String']['output']>;
  personalBests?: Maybe<Array<WorkoutSetPersonalBest>>;
  restTime?: Maybe<Scalars['Int']['output']>;
  statistic: WorkoutSetStatistic;
  totals?: Maybe<WorkoutSetTotals>;
};

/** Details about the statistics of the set performed. */
export type WorkoutSetStatistic = {
  __typename?: 'WorkoutSetStatistic';
  distance?: Maybe<Scalars['Decimal']['output']>;
  duration?: Maybe<Scalars['Decimal']['output']>;
  oneRm?: Maybe<Scalars['Decimal']['output']>;
  pace?: Maybe<Scalars['Decimal']['output']>;
  reps?: Maybe<Scalars['Decimal']['output']>;
  volume?: Maybe<Scalars['Decimal']['output']>;
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type WorkoutSetTotals = {
  __typename?: 'WorkoutSetTotals';
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type WorkoutSummary = {
  __typename?: 'WorkoutSummary';
  exercises: Array<WorkoutSummaryExercise>;
  focused: WorkoutFocusedSummary;
  total?: Maybe<WorkoutOrExerciseTotals>;
};

/** The summary about an exercise done in a workout. */
export type WorkoutSummaryExercise = {
  __typename?: 'WorkoutSummaryExercise';
  bestSet?: Maybe<WorkoutSetRecord>;
  lot?: Maybe<ExerciseLot>;
  name: Scalars['String']['output'];
  numSets: Scalars['Int']['output'];
};

export type WorkoutSupersetsInformation = {
  __typename?: 'WorkoutSupersetsInformation';
  /** A color that will be displayed on the frontend. */
  color: Scalars['String']['output'];
  /** The identifier of all the exercises which are in the same superset */
  exercises: Array<Scalars['Int']['output']>;
};

export type WorkoutSupersetsInformationInput = {
  /** A color that will be displayed on the frontend. */
  color: Scalars['String']['input'];
  /** The identifier of all the exercises which are in the same superset */
  exercises: Array<Scalars['Int']['input']>;
};

export type WorkoutTemplate = {
  __typename?: 'WorkoutTemplate';
  createdOn: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  information: WorkoutInformation;
  name: Scalars['String']['output'];
  summary: WorkoutSummary;
  visibility: Visibility;
};

export type WorkoutTemplateListResults = {
  __typename?: 'WorkoutTemplateListResults';
  details: SearchDetails;
  items: Array<WorkoutTemplate>;
};
