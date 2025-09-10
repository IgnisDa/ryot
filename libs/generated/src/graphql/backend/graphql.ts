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
  /** A scalar that can represent any JSON value. */
  JSON: { input: any; output: any; }
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
  /**
   * ISO 8601 combined date and time without timezone.
   *
   * # Examples
   *
   * * `2015-07-01T08:59:60.123`,
   */
  NaiveDateTime: { input: any; output: any; }
  /**
   * A UUID is a unique 128-bit number, stored as 16 octets. UUIDs are parsed as
   * Strings within GraphQL. UUIDs are used to assign unique identifiers to
   * entities without requiring a central allocating authority.
   *
   * # References
   *
   * * [Wikipedia: Universally Unique Identifier](http://en.wikipedia.org/wiki/Universally_unique_identifier)
   * * [RFC4122: A Universally Unique Identifier (UUID) URN Namespace](http://tools.ietf.org/html/rfc4122)
   */
  UUID: { input: string; output: string; }
};

export type AccessLink = {
  createdOn: Scalars['DateTime']['output'];
  expiresOn?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  isAccountDefault?: Maybe<Scalars['Boolean']['output']>;
  isMutationAllowed?: Maybe<Scalars['Boolean']['output']>;
  isRevoked?: Maybe<Scalars['Boolean']['output']>;
  maximumUses?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  redirectTo?: Maybe<Scalars['String']['output']>;
  timesUsed: Scalars['Int']['output'];
};

export type AnimeAiringScheduleSpecifics = {
  airingAt: Scalars['NaiveDateTime']['output'];
  episode: Scalars['Int']['output'];
};

export type AnimeAiringScheduleSpecificsInput = {
  airingAt: Scalars['NaiveDateTime']['input'];
  episode: Scalars['Int']['input'];
};

export type AnimeSpecifics = {
  airingSchedule?: Maybe<Array<AnimeAiringScheduleSpecifics>>;
  episodes?: Maybe<Scalars['Int']['output']>;
};

export type AnimeSpecificsInput = {
  airingSchedule?: InputMaybe<Array<AnimeAiringScheduleSpecificsInput>>;
  episodes?: InputMaybe<Scalars['Int']['input']>;
};

export type ApiKeyResponse = {
  apiKey: Scalars['String']['output'];
};

/** The start date must be before the end date. */
export type ApplicationDateRange = {
  endDate?: Maybe<Scalars['NaiveDate']['output']>;
  startDate?: Maybe<Scalars['NaiveDate']['output']>;
};

/** The start date must be before the end date. */
export type ApplicationDateRangeInput = {
  endDate?: InputMaybe<Scalars['NaiveDate']['input']>;
  startDate?: InputMaybe<Scalars['NaiveDate']['input']>;
};

export type AudioBookSpecifics = {
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
  NoSessionId = 'NO_SESSION_ID',
  NoUserId = 'NO_USER_ID',
  SessionExpired = 'SESSION_EXPIRED'
}

export enum BackgroundJob {
  CalculateUserActivitiesAndSummary = 'CALCULATE_USER_ACTIVITIES_AND_SUMMARY',
  PerformBackgroundTasks = 'PERFORM_BACKGROUND_TASKS',
  ReviseUserWorkouts = 'REVISE_USER_WORKOUTS',
  SyncIntegrationsData = 'SYNC_INTEGRATIONS_DATA',
  UpdateAllExercises = 'UPDATE_ALL_EXERCISES',
  UpdateAllMetadata = 'UPDATE_ALL_METADATA'
}

export type BasicUserDetails = {
  id: Scalars['String']['output'];
  isDisabled?: Maybe<Scalars['Boolean']['output']>;
  lot: UserLot;
  name: Scalars['String']['output'];
};

export type BookSpecifics = {
  isCompilation?: Maybe<Scalars['Boolean']['output']>;
  pages?: Maybe<Scalars['Int']['output']>;
};

export type BookSpecificsInput = {
  isCompilation?: InputMaybe<Scalars['Boolean']['input']>;
  pages?: InputMaybe<Scalars['Int']['input']>;
};

export type CachedCollectionContentsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: CollectionContents;
};

export type CachedCollectionsListResponse = {
  cacheId: Scalars['UUID']['output'];
  response: Array<CollectionItem>;
};

export type CachedGenreDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: GenreDetails;
};

export type CachedGraphqlMetadataDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: GraphqlMetadataDetails;
};

export type CachedGraphqlPersonDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: GraphqlPersonDetails;
};

export type CachedMetadataGroupDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: MetadataGroupDetails;
};

export type CachedMetadataLookupResponse = {
  cacheId: Scalars['UUID']['output'];
  response: MetadataLookupResponse;
};

export type CachedSearchIdResponse = {
  cacheId: Scalars['UUID']['output'];
  response: IdResults;
};

export type CachedUserAnalyticsParametersResponse = {
  cacheId: Scalars['UUID']['output'];
  response: ApplicationDateRange;
};

export type CachedUserAnalyticsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: UserAnalytics;
};

export type CachedUserMeasurementsListResponse = {
  cacheId: Scalars['UUID']['output'];
  response: Array<UserMeasurement>;
};

export type CachedUserMetadataDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: UserMetadataDetails;
};

export type CachedUserMetadataGroupDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: UserMetadataGroupDetails;
};

export type CachedUserMetadataRecommendationsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: Array<Scalars['String']['output']>;
};

export type CachedUserPersonDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: UserPersonDetails;
};

export type CachedUserWorkoutTemplateDetailsResponse = {
  cacheId: Scalars['UUID']['output'];
  response: UserWorkoutTemplateDetails;
};

export type ChangeCollectionToEntitiesInput = {
  collectionName: Scalars['String']['input'];
  creatorUserId: Scalars['String']['input'];
  entities: Array<EntityToCollectionInput>;
};

export type Collection = {
  createdOn: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  informationTemplate?: Maybe<Array<CollectionExtraInformation>>;
  lastUpdatedOn: Scalars['DateTime']['output'];
  name: Scalars['String']['output'];
  userId: Scalars['String']['output'];
};

export type CollectionContents = {
  details: Collection;
  results: MediaCollectionContentsResults;
  reviews: Array<ReviewItem>;
  totalItems: Scalars['Int']['output'];
  user: BasicUserDetails;
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
};

export enum CollectionContentsSortBy {
  Date = 'DATE',
  LastUpdatedOn = 'LAST_UPDATED_ON',
  Random = 'RANDOM',
  Rank = 'RANK',
  Title = 'TITLE'
}

export type CollectionContentsSortInput = {
  by?: CollectionContentsSortBy;
  order?: GraphqlSortOrder;
};

export type CollectionExtraInformation = {
  defaultValue?: Maybe<Scalars['String']['output']>;
  description: Scalars['String']['output'];
  lot: CollectionExtraInformationLot;
  name: Scalars['String']['output'];
  possibleValues?: Maybe<Array<Scalars['String']['output']>>;
  required?: Maybe<Scalars['Boolean']['output']>;
};

export type CollectionExtraInformationInput = {
  defaultValue?: InputMaybe<Scalars['String']['input']>;
  description: Scalars['String']['input'];
  lot: CollectionExtraInformationLot;
  name: Scalars['String']['input'];
  possibleValues?: InputMaybe<Array<Scalars['String']['input']>>;
  required?: InputMaybe<Scalars['Boolean']['input']>;
};

export enum CollectionExtraInformationLot {
  Boolean = 'BOOLEAN',
  Date = 'DATE',
  DateTime = 'DATE_TIME',
  Number = 'NUMBER',
  String = 'STRING',
  StringArray = 'STRING_ARRAY'
}

export type CollectionItem = {
  collaborators: Array<CollectionItemCollaboratorInformation>;
  count: Scalars['Int']['output'];
  creator: StringIdAndNamedObject;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  informationTemplate?: Maybe<Array<CollectionExtraInformation>>;
  isDefault: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

export type CollectionItemCollaboratorInformation = {
  collaborator: StringIdAndNamedObject;
  extraInformation?: Maybe<UserToCollectionExtraInformation>;
};

export type CollectionRecommendationsInput = {
  collectionId: Scalars['String']['input'];
  search?: InputMaybe<SearchInput>;
};

export type CollectionToEntityDetails = {
  collectionId: Scalars['String']['output'];
  collectionName: Scalars['String']['output'];
  createdOn: Scalars['DateTime']['output'];
  creatorUserId: Scalars['String']['output'];
  information?: Maybe<Scalars['JSON']['output']>;
  lastUpdatedOn: Scalars['DateTime']['output'];
  /** The rank of this entity in the collection. This is ignored during importing. */
  rank: Scalars['Decimal']['output'];
};

export type CoreDetails = {
  backendErrors: Array<BackendError>;
  disableTelemetry: Scalars['Boolean']['output'];
  docsLink: Scalars['String']['output'];
  exerciseParameters: ExerciseParameters;
  fileStorageEnabled: Scalars['Boolean']['output'];
  frontend: FrontendConfig;
  isDemoInstance: Scalars['Boolean']['output'];
  isServerKeyValidated: Scalars['Boolean']['output'];
  localAuthDisabled: Scalars['Boolean']['output'];
  maxFileSizeMb: Scalars['Int']['output'];
  metadataGroupSourceLotMappings: Array<MetadataGroupSourceLotMapping>;
  metadataLotSourceMappings: Array<MetadataLotSourceMappings>;
  metadataProviderLanguages: Array<ProviderLanguageInformation>;
  oidcEnabled: Scalars['Boolean']['output'];
  pageSize: Scalars['Int']['output'];
  peopleSearchSources: Array<MediaSource>;
  providerSpecifics: CoreDetailsProviderSpecifics;
  repositoryLink: Scalars['String']['output'];
  signupAllowed: Scalars['Boolean']['output'];
  smtpEnabled: Scalars['Boolean']['output'];
  tokenValidForDays: Scalars['Int']['output'];
  twoFactorBackupCodesCount: Scalars['Int']['output'];
  version: Scalars['String']['output'];
  websiteUrl: Scalars['String']['output'];
};

export type CoreDetailsProviderIgdbSpecifics = {
  gameModes: Array<IdAndNamedObject>;
  gameTypes: Array<IdAndNamedObject>;
  genres: Array<IdAndNamedObject>;
  platforms: Array<IdAndNamedObject>;
  releaseDateRegions: Array<IdAndNamedObject>;
  themes: Array<IdAndNamedObject>;
};

export type CoreDetailsProviderSpecifics = {
  igdb: CoreDetailsProviderIgdbSpecifics;
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
  assets: EntityAssetsInput;
  audioBookSpecifics?: InputMaybe<AudioBookSpecificsInput>;
  bookSpecifics?: InputMaybe<BookSpecificsInput>;
  creators?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  genres?: InputMaybe<Array<Scalars['String']['input']>>;
  isNsfw?: InputMaybe<Scalars['Boolean']['input']>;
  lot: MediaLot;
  mangaSpecifics?: InputMaybe<MangaSpecificsInput>;
  movieSpecifics?: InputMaybe<MovieSpecificsInput>;
  musicSpecifics?: InputMaybe<MusicSpecificsInput>;
  podcastSpecifics?: InputMaybe<PodcastSpecificsInput>;
  publishDate?: InputMaybe<Scalars['NaiveDate']['input']>;
  publishYear?: InputMaybe<Scalars['Int']['input']>;
  showSpecifics?: InputMaybe<ShowSpecificsInput>;
  title: Scalars['String']['input'];
  videoGameSpecifics?: InputMaybe<VideoGameSpecificsInput>;
  visualNovelSpecifics?: InputMaybe<VisualNovelSpecificsInput>;
};

export type CreateOrUpdateCollectionInput = {
  collaborators?: InputMaybe<Array<Scalars['String']['input']>>;
  description?: InputMaybe<Scalars['String']['input']>;
  extraInformation?: InputMaybe<UserToCollectionExtraInformationInput>;
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

export type CreateOrUpdateUserIntegrationInput = {
  extraSettings: IntegrationExtraSettingsInput;
  integrationId?: InputMaybe<Scalars['String']['input']>;
  isDisabled?: InputMaybe<Scalars['Boolean']['input']>;
  maximumProgress?: InputMaybe<Scalars['Decimal']['input']>;
  minimumProgress?: InputMaybe<Scalars['Decimal']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  provider?: InputMaybe<IntegrationProvider>;
  providerSpecifics?: InputMaybe<IntegrationSourceSpecificsInput>;
  syncToOwnedCollection?: InputMaybe<Scalars['Boolean']['input']>;
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

export type CreateUserNotificationPlatformInput = {
  apiToken?: InputMaybe<Scalars['String']['input']>;
  authHeader?: InputMaybe<Scalars['String']['input']>;
  baseUrl?: InputMaybe<Scalars['String']['input']>;
  chatId?: InputMaybe<Scalars['String']['input']>;
  lot: NotificationPlatformLot;
  priority?: InputMaybe<Scalars['Int']['input']>;
};

export type DailyUserActivitiesResponse = {
  groupedBy: DailyUserActivitiesResponseGroupedBy;
  itemCount: Scalars['Int']['output'];
  items: Array<DailyUserActivityItem>;
  totalCount: Scalars['Int']['output'];
  totalDuration: Scalars['Int']['output'];
};

export enum DailyUserActivitiesResponseGroupedBy {
  AllTime = 'ALL_TIME',
  Day = 'DAY',
  Month = 'MONTH',
  Year = 'YEAR'
}

export type DailyUserActivityHourRecord = {
  entities: Array<DailyUserActivityHourRecordEntity>;
  hour: Scalars['Int']['output'];
};

export type DailyUserActivityHourRecordEntity = {
  entityId: Scalars['String']['output'];
  entityLot: EntityLot;
  metadataLot?: Maybe<MediaLot>;
};

export type DailyUserActivityItem = {
  animeCount: Scalars['Int']['output'];
  audioBookCount: Scalars['Int']['output'];
  bookCount: Scalars['Int']['output'];
  day: Scalars['NaiveDate']['output'];
  mangaCount: Scalars['Int']['output'];
  movieCount: Scalars['Int']['output'];
  musicCount: Scalars['Int']['output'];
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
  totalMusicDuration: Scalars['Int']['output'];
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
  userMeasurementCount: Scalars['Int']['output'];
  videoGameCount: Scalars['Int']['output'];
  visualNovelCount: Scalars['Int']['output'];
  workoutCount: Scalars['Int']['output'];
};

export enum DashboardElementLot {
  InProgress = 'IN_PROGRESS',
  Recommendations = 'RECOMMENDATIONS',
  Summary = 'SUMMARY',
  Trending = 'TRENDING',
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
  jellyfin?: InputMaybe<DeployJellyfinImportInput>;
  mal?: InputMaybe<DeployMalImportInput>;
  movary?: InputMaybe<DeployMovaryImportInput>;
  source: ImportSource;
  strongApp?: InputMaybe<DeployStrongAppImportInput>;
  trakt?: InputMaybe<DeployTraktImportInput>;
  urlAndKey?: InputMaybe<DeployUrlAndKeyImportInput>;
};

export type DeployJellyfinImportInput = {
  apiUrl: Scalars['String']['input'];
  password?: InputMaybe<Scalars['String']['input']>;
  username: Scalars['String']['input'];
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
  dataExportPath?: InputMaybe<Scalars['String']['input']>;
  measurementsZipPath?: InputMaybe<Scalars['String']['input']>;
};

export type DeployTraktImportInput = {
  list?: InputMaybe<DeployTraktImportListInput>;
  user?: InputMaybe<Scalars['String']['input']>;
};

export type DeployTraktImportListInput = {
  collection: Scalars['String']['input'];
  url: Scalars['String']['input'];
};

export type DeployUrlAndKeyImportInput = {
  apiKey: Scalars['String']['input'];
  apiUrl: Scalars['String']['input'];
};

/** The assets related to an entity. */
export type EntityAssets = {
  /** The urls of the remote images. */
  remoteImages: Array<Scalars['String']['output']>;
  /** The urls of the remote videos. */
  remoteVideos: Array<EntityRemoteVideo>;
  /** The keys of the S3 images. */
  s3Images: Array<Scalars['String']['output']>;
  /** The keys of the S3 videos. */
  s3Videos: Array<Scalars['String']['output']>;
};

/** The assets related to an entity. */
export type EntityAssetsInput = {
  /** The urls of the remote images. */
  remoteImages: Array<Scalars['String']['input']>;
  /** The urls of the remote videos. */
  remoteVideos: Array<EntityRemoteVideoInput>;
  /** The keys of the S3 images. */
  s3Images: Array<Scalars['String']['input']>;
  /** The keys of the S3 videos. */
  s3Videos: Array<Scalars['String']['input']>;
};

export enum EntityLot {
  Collection = 'COLLECTION',
  Exercise = 'EXERCISE',
  Genre = 'GENRE',
  Metadata = 'METADATA',
  MetadataGroup = 'METADATA_GROUP',
  Person = 'PERSON',
  Review = 'REVIEW',
  UserMeasurement = 'USER_MEASUREMENT',
  Workout = 'WORKOUT',
  WorkoutTemplate = 'WORKOUT_TEMPLATE'
}

/** The data that a remote video can have. */
export type EntityRemoteVideo = {
  source: EntityRemoteVideoSource;
  url: Scalars['String']['output'];
};

/** The data that a remote video can have. */
export type EntityRemoteVideoInput = {
  source: EntityRemoteVideoSource;
  url: Scalars['String']['input'];
};

export enum EntityRemoteVideoSource {
  Dailymotion = 'DAILYMOTION',
  Youtube = 'YOUTUBE'
}

export type EntityToCollectionInput = {
  entityId: Scalars['String']['input'];
  entityLot: EntityLot;
  information?: InputMaybe<Scalars['JSON']['input']>;
};

export type EntityWithLot = {
  entityId: Scalars['String']['output'];
  entityLot: EntityLot;
};

export type Exercise = {
  assets: EntityAssets;
  createdByUserId?: Maybe<Scalars['String']['output']>;
  equipment?: Maybe<ExerciseEquipment>;
  force?: Maybe<ExerciseForce>;
  id: Scalars['String']['output'];
  instructions: Array<Scalars['String']['output']>;
  level: ExerciseLevel;
  lot: ExerciseLot;
  mechanic?: Maybe<ExerciseMechanic>;
  muscles: Array<ExerciseMuscle>;
  name: Scalars['String']['output'];
  source: ExerciseSource;
};

export type ExerciseBestSetRecord = {
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
  assets: EntityAssetsInput;
  equipment?: InputMaybe<ExerciseEquipment>;
  force?: InputMaybe<ExerciseForce>;
  id: Scalars['String']['input'];
  instructions: Array<Scalars['String']['input']>;
  level: ExerciseLevel;
  lot: ExerciseLot;
  mechanic?: InputMaybe<ExerciseMechanic>;
  muscles: Array<ExerciseMuscle>;
  name: Scalars['String']['input'];
  source: ExerciseSource;
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

/** The different types of exercises that can be done. */
export enum ExerciseLot {
  DistanceAndDuration = 'DISTANCE_AND_DURATION',
  Duration = 'DURATION',
  Reps = 'REPS',
  RepsAndDuration = 'REPS_AND_DURATION',
  RepsAndDurationAndDistance = 'REPS_AND_DURATION_AND_DISTANCE',
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
  /** All filters applicable to an exercises query. */
  filters: ExerciseFilters;
  /** Exercise type mapped to the personal bests possible. */
  lotMapping: Array<ExerciseParametersLotMapping>;
};

export type ExerciseParametersLotMapping = {
  bests: Array<WorkoutSetPersonalBest>;
  lot: ExerciseLot;
};

export enum ExerciseSortBy {
  LastPerformed = 'LAST_PERFORMED',
  Name = 'NAME',
  Random = 'RANDOM',
  TimesPerformed = 'TIMES_PERFORMED'
}

export enum ExerciseSource {
  Custom = 'CUSTOM',
  Github = 'GITHUB'
}

export type ExportJob = {
  endedAt: Scalars['DateTime']['output'];
  key: Scalars['String']['output'];
  size: Scalars['Int']['output'];
  startedAt: Scalars['DateTime']['output'];
  url: Scalars['String']['output'];
};

export type FitnessAnalyticsEquipment = {
  count: Scalars['Int']['output'];
  equipment: ExerciseEquipment;
};

export type FitnessAnalyticsExercise = {
  count: Scalars['Int']['output'];
  exercise: Scalars['String']['output'];
};

export type FitnessAnalyticsMuscle = {
  count: Scalars['Int']['output'];
  muscle: ExerciseMuscle;
};

export type FrontendConfig = {
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
  /** For example: https://umami.is/script.js. */
  scriptUrl: Scalars['String']['output'];
  websiteId: Scalars['String']['output'];
};

export type GenreDetails = {
  contents: IdResults;
  details: GenreListItem;
};

export type GenreDetailsInput = {
  genreId: Scalars['String']['input'];
  search?: InputMaybe<SearchInput>;
};

export type GenreListItem = {
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  numItems?: Maybe<Scalars['Int']['output']>;
};

export type GetPasswordChangeSessionInput = {
  /** If user details are not present in the request, this can be used to override it */
  adminAccessToken?: InputMaybe<Scalars['String']['input']>;
  userId: Scalars['String']['input'];
};

export type GetPasswordChangeSessionResponse = {
  passwordChangeUrl: Scalars['String']['output'];
  userId: Scalars['String']['output'];
};

export type GraphqlCalendarEvent = {
  animeExtraInformation?: Maybe<SeenAnimeExtraInformation>;
  calendarEventId: Scalars['String']['output'];
  date: Scalars['NaiveDate']['output'];
  metadataId: Scalars['String']['output'];
  metadataImage?: Maybe<Scalars['String']['output']>;
  metadataLot: MediaLot;
  metadataText: Scalars['String']['output'];
  podcastExtraInformation?: Maybe<SeenPodcastExtraInformation>;
  showExtraInformation?: Maybe<SeenShowExtraInformation>;
};

export type GraphqlCollectionToEntityDetails = {
  details: CollectionToEntityDetails;
  id: Scalars['UUID']['output'];
};

export type GraphqlMetadataDetails = {
  animeSpecifics?: Maybe<AnimeSpecifics>;
  assets: EntityAssets;
  audioBookSpecifics?: Maybe<AudioBookSpecifics>;
  bookSpecifics?: Maybe<BookSpecifics>;
  createdByUserId?: Maybe<Scalars['String']['output']>;
  creators: Array<MetadataCreatorsGroupedByRole>;
  description?: Maybe<Scalars['String']['output']>;
  genres: Array<GenreListItem>;
  groups: Array<GraphqlMetadataGroup>;
  id: Scalars['String']['output'];
  identifier: Scalars['String']['output'];
  isNsfw?: Maybe<Scalars['Boolean']['output']>;
  isPartial?: Maybe<Scalars['Boolean']['output']>;
  lot: MediaLot;
  mangaSpecifics?: Maybe<MangaSpecifics>;
  movieSpecifics?: Maybe<MovieSpecifics>;
  musicSpecifics?: Maybe<MusicSpecifics>;
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
  id: Scalars['String']['output'];
  part: Scalars['Int']['output'];
};

export type GraphqlPersonDetails = {
  associatedMetadata: Array<PersonDetailsGroupedByRole>;
  associatedMetadataGroups: Array<PersonDetailsGroupedByRole>;
  details: Person;
};

export enum GraphqlSortOrder {
  Asc = 'ASC',
  Desc = 'DESC'
}

export enum GridPacking {
  Dense = 'DENSE',
  Normal = 'NORMAL'
}

export type GroupedCalendarEvent = {
  date: Scalars['NaiveDate']['output'];
  events: Array<GraphqlCalendarEvent>;
};

export type IdAndNamedObject = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
};

export type IdResults = {
  details: SearchDetails;
  items: Array<Scalars['String']['output']>;
};

export type ImportDetails = {
  total: Scalars['Int']['output'];
};

/** The various steps in which media importing can fail */
export enum ImportFailStep {
  /** Failed to save an entity/review/progress item */
  DatabaseCommit = 'DATABASE_COMMIT',
  /** Failed to transform the data into the required format */
  InputTransformation = 'INPUT_TRANSFORMATION',
  /** Failed to get details from the source (eg: MediaTracker, Goodreads etc.) */
  ItemDetailsFromSource = 'ITEM_DETAILS_FROM_SOURCE',
  /** Failed to get metadata from the provider (eg: Openlibrary, IGDB etc.) */
  MediaDetailsFromProvider = 'MEDIA_DETAILS_FROM_PROVIDER'
}

export type ImportFailedItem = {
  error?: Maybe<Scalars['String']['output']>;
  identifier: Scalars['String']['output'];
  lot?: Maybe<MediaLot>;
  step: ImportFailStep;
};

/** Comments left in replies to posted reviews. */
export type ImportOrExportItemReviewComment = {
  createdOn: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  /** The user ids of all those who liked it. */
  likedBy: Array<Scalars['String']['output']>;
  text: Scalars['String']['output'];
  user: StringIdAndNamedObject;
};

export type ImportReport = {
  details?: Maybe<ImportResultResponse>;
  estimatedFinishTime: Scalars['DateTime']['output'];
  finishedOn?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  progress?: Maybe<Scalars['Decimal']['output']>;
  source: ImportSource;
  startedOn: Scalars['DateTime']['output'];
  userId: Scalars['String']['output'];
  wasSuccess?: Maybe<Scalars['Boolean']['output']>;
};

export type ImportResultResponse = {
  failedItems: Array<ImportFailedItem>;
  import: ImportDetails;
};

export enum ImportSource {
  Anilist = 'ANILIST',
  Audiobookshelf = 'AUDIOBOOKSHELF',
  GenericJson = 'GENERIC_JSON',
  Goodreads = 'GOODREADS',
  Grouvee = 'GROUVEE',
  Hardcover = 'HARDCOVER',
  Hevy = 'HEVY',
  Igdb = 'IGDB',
  Imdb = 'IMDB',
  Jellyfin = 'JELLYFIN',
  Mediatracker = 'MEDIATRACKER',
  Movary = 'MOVARY',
  Myanimelist = 'MYANIMELIST',
  OpenScale = 'OPEN_SCALE',
  Plex = 'PLEX',
  Storygraph = 'STORYGRAPH',
  StrongApp = 'STRONG_APP',
  Trakt = 'TRAKT'
}

export type Integration = {
  createdOn: Scalars['DateTime']['output'];
  extraSettings: IntegrationExtraSettings;
  id: Scalars['String']['output'];
  isDisabled?: Maybe<Scalars['Boolean']['output']>;
  lastFinishedAt?: Maybe<Scalars['DateTime']['output']>;
  lot: IntegrationLot;
  maximumProgress?: Maybe<Scalars['Decimal']['output']>;
  minimumProgress?: Maybe<Scalars['Decimal']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  provider: IntegrationProvider;
  providerSpecifics?: Maybe<IntegrationProviderSpecifics>;
  syncToOwnedCollection?: Maybe<Scalars['Boolean']['output']>;
  triggerResult: Array<IntegrationTriggerResult>;
};

export type IntegrationExtraSettings = {
  disableOnContinuousErrors: Scalars['Boolean']['output'];
};

export type IntegrationExtraSettingsInput = {
  disableOnContinuousErrors: Scalars['Boolean']['input'];
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
  PlexSink = 'PLEX_SINK',
  PlexYank = 'PLEX_YANK',
  Radarr = 'RADARR',
  RyotBrowserExtension = 'RYOT_BROWSER_EXTENSION',
  Sonarr = 'SONARR',
  YoutubeMusic = 'YOUTUBE_MUSIC'
}

export type IntegrationProviderSpecifics = {
  audiobookshelfBaseUrl?: Maybe<Scalars['String']['output']>;
  audiobookshelfToken?: Maybe<Scalars['String']['output']>;
  jellyfinPushBaseUrl?: Maybe<Scalars['String']['output']>;
  jellyfinPushPassword?: Maybe<Scalars['String']['output']>;
  jellyfinPushUsername?: Maybe<Scalars['String']['output']>;
  komgaBaseUrl?: Maybe<Scalars['String']['output']>;
  komgaPassword?: Maybe<Scalars['String']['output']>;
  komgaProvider?: Maybe<MediaSource>;
  komgaUsername?: Maybe<Scalars['String']['output']>;
  plexSinkUsername?: Maybe<Scalars['String']['output']>;
  plexYankBaseUrl?: Maybe<Scalars['String']['output']>;
  plexYankToken?: Maybe<Scalars['String']['output']>;
  radarrApiKey?: Maybe<Scalars['String']['output']>;
  radarrBaseUrl?: Maybe<Scalars['String']['output']>;
  radarrProfileId?: Maybe<Scalars['Int']['output']>;
  radarrRootFolderPath?: Maybe<Scalars['String']['output']>;
  radarrSyncCollectionIds?: Maybe<Array<Scalars['String']['output']>>;
  radarrTagIds?: Maybe<Array<Scalars['Int']['output']>>;
  ryotBrowserExtensionDisabledSites?: Maybe<Array<Scalars['String']['output']>>;
  sonarrApiKey?: Maybe<Scalars['String']['output']>;
  sonarrBaseUrl?: Maybe<Scalars['String']['output']>;
  sonarrProfileId?: Maybe<Scalars['Int']['output']>;
  sonarrRootFolderPath?: Maybe<Scalars['String']['output']>;
  sonarrSyncCollectionIds?: Maybe<Array<Scalars['String']['output']>>;
  sonarrTagIds?: Maybe<Array<Scalars['Int']['output']>>;
  youtubeMusicAuthCookie?: Maybe<Scalars['String']['output']>;
  youtubeMusicTimezone?: Maybe<Scalars['String']['output']>;
};

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
  plexSinkUsername?: InputMaybe<Scalars['String']['input']>;
  plexYankBaseUrl?: InputMaybe<Scalars['String']['input']>;
  plexYankToken?: InputMaybe<Scalars['String']['input']>;
  radarrApiKey?: InputMaybe<Scalars['String']['input']>;
  radarrBaseUrl?: InputMaybe<Scalars['String']['input']>;
  radarrProfileId?: InputMaybe<Scalars['Int']['input']>;
  radarrRootFolderPath?: InputMaybe<Scalars['String']['input']>;
  radarrSyncCollectionIds?: InputMaybe<Array<Scalars['String']['input']>>;
  radarrTagIds?: InputMaybe<Array<Scalars['Int']['input']>>;
  ryotBrowserExtensionDisabledSites?: InputMaybe<Array<Scalars['String']['input']>>;
  sonarrApiKey?: InputMaybe<Scalars['String']['input']>;
  sonarrBaseUrl?: InputMaybe<Scalars['String']['input']>;
  sonarrProfileId?: InputMaybe<Scalars['Int']['input']>;
  sonarrRootFolderPath?: InputMaybe<Scalars['String']['input']>;
  sonarrSyncCollectionIds?: InputMaybe<Array<Scalars['String']['input']>>;
  sonarrTagIds?: InputMaybe<Array<Scalars['Int']['input']>>;
  youtubeMusicAuthCookie?: InputMaybe<Scalars['String']['input']>;
  youtubeMusicTimezone?: InputMaybe<Scalars['String']['input']>;
};

export type IntegrationTriggerResult = {
  error?: Maybe<Scalars['String']['output']>;
  finishedAt: Scalars['DateTime']['output'];
};

export type LoginError = {
  error: LoginErrorVariant;
};

export enum LoginErrorVariant {
  AccountDisabled = 'ACCOUNT_DISABLED',
  CredentialsMismatch = 'CREDENTIALS_MISMATCH',
  IncorrectProviderChosen = 'INCORRECT_PROVIDER_CHOSEN',
  UsernameDoesNotExist = 'USERNAME_DOES_NOT_EXIST'
}

export type LoginResult = ApiKeyResponse | LoginError | StringIdObject;

export type MangaSpecifics = {
  chapters?: Maybe<Scalars['Decimal']['output']>;
  url?: Maybe<Scalars['String']['output']>;
  volumes?: Maybe<Scalars['Int']['output']>;
};

export type MangaSpecificsInput = {
  chapters?: InputMaybe<Scalars['Decimal']['input']>;
  url?: InputMaybe<Scalars['String']['input']>;
  volumes?: InputMaybe<Scalars['Int']['input']>;
};

export type MarkEntityAsPartialInput = {
  entityId: Scalars['String']['input'];
  entityLot: EntityLot;
};

export type MediaCollectionContentsResults = {
  details: SearchDetails;
  items: Array<EntityWithLot>;
};

export type MediaCollectionFilter = {
  collectionId: Scalars['String']['input'];
  presence: MediaCollectionPresenceFilter;
  strategy: MediaCollectionStrategyFilter;
};

export enum MediaCollectionPresenceFilter {
  NotPresentIn = 'NOT_PRESENT_IN',
  PresentIn = 'PRESENT_IN'
}

export enum MediaCollectionStrategyFilter {
  And = 'AND',
  Or = 'OR'
}

export type MediaFilter = {
  collections?: InputMaybe<Array<MediaCollectionFilter>>;
  dateRange?: InputMaybe<ApplicationDateRangeInput>;
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
  Music = 'MUSIC',
  Podcast = 'PODCAST',
  Show = 'SHOW',
  VideoGame = 'VIDEO_GAME',
  VisualNovel = 'VISUAL_NOVEL'
}

export enum MediaSortBy {
  LastConsumed = 'LAST_CONSUMED',
  LastUpdated = 'LAST_UPDATED',
  ProviderRating = 'PROVIDER_RATING',
  Random = 'RANDOM',
  ReleaseDate = 'RELEASE_DATE',
  TimesConsumed = 'TIMES_CONSUMED',
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
  GiantBomb = 'GIANT_BOMB',
  GoogleBooks = 'GOOGLE_BOOKS',
  Hardcover = 'HARDCOVER',
  Igdb = 'IGDB',
  Itunes = 'ITUNES',
  Listennotes = 'LISTENNOTES',
  MangaUpdates = 'MANGA_UPDATES',
  Myanimelist = 'MYANIMELIST',
  Openlibrary = 'OPENLIBRARY',
  Spotify = 'SPOTIFY',
  Tmdb = 'TMDB',
  Tvdb = 'TVDB',
  Vndb = 'VNDB',
  YoutubeMusic = 'YOUTUBE_MUSIC'
}

export type MetadataCreator = {
  character?: Maybe<Scalars['String']['output']>;
  idOrName: Scalars['String']['output'];
  isFree: Scalars['Boolean']['output'];
};

export type MetadataCreatorsGroupedByRole = {
  items: Array<MetadataCreator>;
  name: Scalars['String']['output'];
};

export type MetadataGroup = {
  assets: EntityAssets;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  identifier: Scalars['String']['output'];
  isPartial?: Maybe<Scalars['Boolean']['output']>;
  lot: MediaLot;
  parts: Scalars['Int']['output'];
  source: MediaSource;
  sourceUrl?: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
};

export type MetadataGroupDetails = {
  contents: Array<Scalars['String']['output']>;
  details: MetadataGroup;
};

export type MetadataGroupSearchInput = {
  lot: MediaLot;
  search: SearchInput;
  source: MediaSource;
};

export type MetadataGroupSourceLotMapping = {
  lot: MediaLot;
  source: MediaSource;
};

export type MetadataLookupFoundResult = {
  data: UniqueMediaIdentifier;
  showInformation?: Maybe<SeenShowExtraInformation>;
};

export type MetadataLookupNotFound = {
  notFound: Scalars['Boolean']['output'];
};

export type MetadataLookupResponse = MetadataLookupFoundResult | MetadataLookupNotFound;

export type MetadataLotSourceMappings = {
  lot: MediaLot;
  sources: Array<MediaSource>;
};

export type MetadataProgressUpdateChange = {
  changeLatestInProgress?: InputMaybe<Scalars['Decimal']['input']>;
  changeLatestState?: InputMaybe<SeenState>;
  createNewCompleted?: InputMaybe<MetadataProgressUpdateChangeCreateNewCompletedInput>;
  createNewInProgress?: InputMaybe<MetadataProgressUpdateNewInProgressInput>;
};

export type MetadataProgressUpdateChangeCreateNewCompletedInput = {
  finishedOnDate?: InputMaybe<MetadataProgressUpdateStartedOrFinishedOnDateInput>;
  startedAndFinishedOnDate?: InputMaybe<MetadataProgressUpdateStartedAndFinishedOnDateInput>;
  startedOnDate?: InputMaybe<MetadataProgressUpdateStartedOrFinishedOnDateInput>;
  withoutDates?: InputMaybe<MetadataProgressUpdateCommonInput>;
};

export type MetadataProgressUpdateCommonInput = {
  animeEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  mangaChapterNumber?: InputMaybe<Scalars['Decimal']['input']>;
  mangaVolumeNumber?: InputMaybe<Scalars['Int']['input']>;
  manualTimeSpent?: InputMaybe<Scalars['Decimal']['input']>;
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  providersConsumedOn?: InputMaybe<Array<Scalars['String']['input']>>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
};

export type MetadataProgressUpdateInput = {
  change: MetadataProgressUpdateChange;
  metadataId: Scalars['String']['input'];
};

export type MetadataProgressUpdateNewInProgressInput = {
  animeEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  mangaChapterNumber?: InputMaybe<Scalars['Decimal']['input']>;
  mangaVolumeNumber?: InputMaybe<Scalars['Int']['input']>;
  manualTimeSpent?: InputMaybe<Scalars['Decimal']['input']>;
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  providersConsumedOn?: InputMaybe<Array<Scalars['String']['input']>>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
  startedOn: Scalars['DateTime']['input'];
};

export type MetadataProgressUpdateStartedAndFinishedOnDateInput = {
  animeEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  mangaChapterNumber?: InputMaybe<Scalars['Decimal']['input']>;
  mangaVolumeNumber?: InputMaybe<Scalars['Int']['input']>;
  manualTimeSpent?: InputMaybe<Scalars['Decimal']['input']>;
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  providersConsumedOn?: InputMaybe<Array<Scalars['String']['input']>>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
  startedOn: Scalars['DateTime']['input'];
  timestamp: Scalars['DateTime']['input'];
};

export type MetadataProgressUpdateStartedOrFinishedOnDateInput = {
  animeEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  mangaChapterNumber?: InputMaybe<Scalars['Decimal']['input']>;
  mangaVolumeNumber?: InputMaybe<Scalars['Int']['input']>;
  manualTimeSpent?: InputMaybe<Scalars['Decimal']['input']>;
  podcastEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  providersConsumedOn?: InputMaybe<Array<Scalars['String']['input']>>;
  showEpisodeNumber?: InputMaybe<Scalars['Int']['input']>;
  showSeasonNumber?: InputMaybe<Scalars['Int']['input']>;
  timestamp: Scalars['DateTime']['input'];
};

export type MetadataSearchInput = {
  lot: MediaLot;
  search: SearchInput;
  source: MediaSource;
  sourceSpecifics?: InputMaybe<MetadataSearchSourceSpecificsInput>;
};

export type MetadataSearchSourceGoogleBooksSpecifics = {
  passRawQuery?: InputMaybe<Scalars['Boolean']['input']>;
};

export type MetadataSearchSourceIgdbFilterSpecifics = {
  allowGamesWithParent?: InputMaybe<Scalars['Boolean']['input']>;
  gameModeIds?: InputMaybe<Array<Scalars['String']['input']>>;
  gameTypeIds?: InputMaybe<Array<Scalars['String']['input']>>;
  genreIds?: InputMaybe<Array<Scalars['String']['input']>>;
  platformIds?: InputMaybe<Array<Scalars['String']['input']>>;
  releaseDateRegionIds?: InputMaybe<Array<Scalars['String']['input']>>;
  themeIds?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type MetadataSearchSourceIgdbSpecifics = {
  filters?: InputMaybe<MetadataSearchSourceIgdbFilterSpecifics>;
};

export type MetadataSearchSourceSpecificsInput = {
  googleBooks?: InputMaybe<MetadataSearchSourceGoogleBooksSpecifics>;
  igdb?: InputMaybe<MetadataSearchSourceIgdbSpecifics>;
};

export type MovieSpecifics = {
  runtime?: Maybe<Scalars['Int']['output']>;
};

export type MovieSpecificsInput = {
  runtime?: InputMaybe<Scalars['Int']['input']>;
};

export type MusicSpecifics = {
  byVariousArtists?: Maybe<Scalars['Boolean']['output']>;
  discNumber?: Maybe<Scalars['Int']['output']>;
  duration?: Maybe<Scalars['Int']['output']>;
  trackNumber?: Maybe<Scalars['Int']['output']>;
  viewCount?: Maybe<Scalars['Int']['output']>;
};

export type MusicSpecificsInput = {
  byVariousArtists?: InputMaybe<Scalars['Boolean']['input']>;
  discNumber?: InputMaybe<Scalars['Int']['input']>;
  duration?: InputMaybe<Scalars['Int']['input']>;
  trackNumber?: InputMaybe<Scalars['Int']['input']>;
  viewCount?: InputMaybe<Scalars['Int']['input']>;
};

export type MutationRoot = {
  /** Complete two-factor authentication setup by verifying the TOTP code. */
  completeTwoFactorSetup: UserTwoFactorBackupCodesResponse;
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
  /** Create or update an integration for the currently logged in user. */
  createOrUpdateUserIntegration: Scalars['Boolean']['output'];
  /** Take a user workout, process it and commit it to database. */
  createOrUpdateUserWorkout: Scalars['String']['output'];
  /** Create or update a workout template. */
  createOrUpdateUserWorkoutTemplate: Scalars['String']['output'];
  /** Create, like or delete a comment on a review. */
  createReviewComment: Scalars['Boolean']['output'];
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
  /** Deploy a background job to add entities to a collection. */
  deployAddEntitiesToCollectionJob: Scalars['Boolean']['output'];
  /** Start a background job. */
  deployBackgroundJob: Scalars['Boolean']['output'];
  /**
   * Deploy job to update progress of media items in bulk. For seen items in progress,
   * progress is updated only if it has actually changed.
   */
  deployBulkMetadataProgressUpdate: Scalars['Boolean']['output'];
  /** Deploy a job to export data for a user. */
  deployExportJob: Scalars['Boolean']['output'];
  /** Add job to import data from various sources. */
  deployImportJob: Scalars['Boolean']['output'];
  /** Deploy a background job to remove entities from a collection. */
  deployRemoveEntitiesFromCollectionJob: Scalars['Boolean']['output'];
  /** Deploy a job to update a media entity's metadata. */
  deployUpdateMediaEntityJob: Scalars['Boolean']['output'];
  /**
   * Use this mutation to call a function that needs to be tested for implementation.
   * It is only available in development mode.
   */
  developmentMutation: Scalars['Boolean']['output'];
  /** Disable two-factor authentication for the currently logged in user. */
  disableTwoFactor: Scalars['Boolean']['output'];
  /**
   * Delete all history and reviews for a given media item and remove it from all
   * collections for the user.
   */
  disassociateMetadata: Scalars['Boolean']['output'];
  /** Expire a cache key by its ID */
  expireCacheKey: Scalars['Boolean']['output'];
  /** Generate an auth token without any expiry. */
  generateAuthToken: Scalars['String']['output'];
  /** Get a URL which can be used to set a new password for the user. */
  getPasswordChangeSession: GetPasswordChangeSessionResponse;
  /** Initiate two-factor authentication setup by generating a TOTP secret. */
  initiateTwoFactorSetup: UserTwoFactorInitiateResponse;
  /** Login a user using their username and password and return an auth token. */
  loginUser: LoginResult;
  /** Logout the current user by invalidating their session. */
  logoutUser: Scalars['Boolean']['output'];
  /** Mark an entity as partial. */
  markEntityAsPartial: Scalars['Boolean']['output'];
  /** Merge an exercise into another. */
  mergeExercise: Scalars['Boolean']['output'];
  /**
   * Merge a media item into another. This will move all `seen`, `collection`
   * and `review` associations with to the metadata.
   */
  mergeMetadata: Scalars['Boolean']['output'];
  /** Get a presigned URL (valid for 10 minutes) for a given file name. */
  presignedPutS3Url: PresignedPutUrlResponse;
  /** Get an access token using an access link. */
  processAccessLink: ProcessAccessLinkResult;
  /** Regenerate backup codes for the currently logged in user. */
  regenerateTwoFactorBackupCodes: UserTwoFactorBackupCodesResponse;
  /**
   * Create a new user for the service. Also set their `lot` as admin if
   * they are the first user.
   */
  registerUser: RegisterResult;
  /** Reorder an entity within a collection. */
  reorderCollectionEntity: Scalars['Boolean']['output'];
  /**
   * Reset a user by deleting and recreating them with the same ID. The account
   * resetting the user must be an `Admin`.
   */
  resetUser: UserResetResult;
  /** Revoke an access link. */
  revokeAccessLink: Scalars['Boolean']['output'];
  /** Set password using a valid session ID (non-authenticated route). */
  setPasswordViaSession: Scalars['Boolean']['output'];
  /** Test all notification platforms for the currently logged in user. */
  testUserNotificationPlatforms: Scalars['Boolean']['output'];
  /** Update a custom exercise. */
  updateCustomExercise: Scalars['Boolean']['output'];
  /** Update custom metadata. */
  updateCustomMetadata: Scalars['Boolean']['output'];
  /** Update the attributes of a seen item. */
  updateSeenItem: Scalars['Boolean']['output'];
  /** Update a user's profile details. */
  updateUser: StringIdObject;
  /** Update a user's exercise settings. */
  updateUserExerciseSettings: Scalars['Boolean']['output'];
  /** Edit a notification platform for the currently logged in user. */
  updateUserNotificationPlatform: Scalars['Boolean']['output'];
  /** Change a user's preferences. */
  updateUserPreference: Scalars['Boolean']['output'];
  /** Change the details about a user's workout. */
  updateUserWorkoutAttributes: Scalars['Boolean']['output'];
  /** Verify a two-factor authentication code (TOTP or backup code). */
  verifyTwoFactor: VerifyTwoFactorResult;
};


export type MutationRootCompleteTwoFactorSetupArgs = {
  input: UserTwoFactorSetupInput;
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


export type MutationRootCreateOrUpdateUserIntegrationArgs = {
  input: CreateOrUpdateUserIntegrationInput;
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


export type MutationRootDeployAddEntitiesToCollectionJobArgs = {
  input: ChangeCollectionToEntitiesInput;
};


export type MutationRootDeployBackgroundJobArgs = {
  jobName: BackgroundJob;
};


export type MutationRootDeployBulkMetadataProgressUpdateArgs = {
  input: Array<MetadataProgressUpdateInput>;
};


export type MutationRootDeployImportJobArgs = {
  input: DeployImportJobInput;
};


export type MutationRootDeployRemoveEntitiesFromCollectionJobArgs = {
  input: ChangeCollectionToEntitiesInput;
};


export type MutationRootDeployUpdateMediaEntityJobArgs = {
  entityId: Scalars['String']['input'];
  entityLot: EntityLot;
};


export type MutationRootDisassociateMetadataArgs = {
  metadataId: Scalars['String']['input'];
};


export type MutationRootExpireCacheKeyArgs = {
  cacheId: Scalars['UUID']['input'];
};


export type MutationRootGetPasswordChangeSessionArgs = {
  input: GetPasswordChangeSessionInput;
};


export type MutationRootLoginUserArgs = {
  input: AuthUserInput;
};


export type MutationRootMarkEntityAsPartialArgs = {
  input: MarkEntityAsPartialInput;
};


export type MutationRootMergeExerciseArgs = {
  mergeFrom: Scalars['String']['input'];
  mergeInto: Scalars['String']['input'];
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


export type MutationRootReorderCollectionEntityArgs = {
  input: ReorderCollectionEntityInput;
};


export type MutationRootResetUserArgs = {
  toResetUserId: Scalars['String']['input'];
};


export type MutationRootRevokeAccessLinkArgs = {
  accessLinkId: Scalars['String']['input'];
};


export type MutationRootSetPasswordViaSessionArgs = {
  input: SetPasswordViaSessionInput;
};


export type MutationRootUpdateCustomExerciseArgs = {
  input: UpdateCustomExerciseInput;
};


export type MutationRootUpdateCustomMetadataArgs = {
  input: UpdateCustomMetadataInput;
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


export type MutationRootUpdateUserNotificationPlatformArgs = {
  input: UpdateUserNotificationPlatformInput;
};


export type MutationRootUpdateUserPreferenceArgs = {
  input: UserPreferencesInput;
};


export type MutationRootUpdateUserWorkoutAttributesArgs = {
  input: UpdateUserWorkoutAttributesInput;
};


export type MutationRootVerifyTwoFactorArgs = {
  input: UserTwoFactorVerifyInput;
};

export type NotificationPlatform = {
  configuredEvents: Array<UserNotificationContentDiscriminants>;
  createdOn: Scalars['DateTime']['output'];
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  isDisabled?: Maybe<Scalars['Boolean']['output']>;
  lot: NotificationPlatformLot;
};

export enum NotificationPlatformLot {
  Apprise = 'APPRISE',
  Discord = 'DISCORD',
  Gotify = 'GOTIFY',
  Ntfy = 'NTFY',
  PushBullet = 'PUSH_BULLET',
  PushOver = 'PUSH_OVER',
  PushSafer = 'PUSH_SAFER',
  Telegram = 'TELEGRAM'
}

export type OidcTokenOutput = {
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

export type PeopleSearchInput = {
  search: SearchInput;
  source: MediaSource;
  sourceSpecifics?: InputMaybe<PersonSourceSpecificsInput>;
};

export type Person = {
  alternateNames?: Maybe<Array<Scalars['String']['output']>>;
  assets: EntityAssets;
  associatedEntityCount: Scalars['Int']['output'];
  associatedMetadataCount: Scalars['Int']['output'];
  associatedMetadataGroupsCount: Scalars['Int']['output'];
  birthDate?: Maybe<Scalars['NaiveDate']['output']>;
  createdOn: Scalars['DateTime']['output'];
  deathDate?: Maybe<Scalars['NaiveDate']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  gender?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  identifier: Scalars['String']['output'];
  isPartial?: Maybe<Scalars['Boolean']['output']>;
  lastUpdatedOn: Scalars['DateTime']['output'];
  name: Scalars['String']['output'];
  place?: Maybe<Scalars['String']['output']>;
  source: MediaSource;
  sourceUrl?: Maybe<Scalars['String']['output']>;
  website?: Maybe<Scalars['String']['output']>;
};

export enum PersonAndMetadataGroupsSortBy {
  AssociatedEntityCount = 'ASSOCIATED_ENTITY_COUNT',
  Name = 'NAME',
  Random = 'RANDOM'
}

export type PersonDetailsGroupedByRole = {
  /** The media items in which this role was performed. */
  items: Array<PersonDetailsItemWithCharacter>;
  /** The name of the role performed. */
  name: Scalars['String']['output'];
};

export type PersonDetailsItemWithCharacter = {
  character?: Maybe<Scalars['String']['output']>;
  entityId: Scalars['String']['output'];
};

export type PersonSortInput = {
  by?: PersonAndMetadataGroupsSortBy;
  order?: GraphqlSortOrder;
};

export type PersonSourceSpecificsInput = {
  isAnilistStudio?: InputMaybe<Scalars['Boolean']['input']>;
  isGiantBombCompany?: InputMaybe<Scalars['Boolean']['input']>;
  isHardcoverPublisher?: InputMaybe<Scalars['Boolean']['input']>;
  isTmdbCompany?: InputMaybe<Scalars['Boolean']['input']>;
  isTvdbCompany?: InputMaybe<Scalars['Boolean']['input']>;
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

export type PresignedPutUrlInput = {
  fileName: Scalars['String']['input'];
  prefix: Scalars['String']['input'];
};

export type PresignedPutUrlResponse = {
  key: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

export type ProcessAccessLinkError = {
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
  apiKey: Scalars['String']['output'];
  redirectTo?: Maybe<Scalars['String']['output']>;
  tokenValidForDays: Scalars['Int']['output'];
};

export type ProcessAccessLinkResult = ProcessAccessLinkError | ProcessAccessLinkResponse;

/** An exercise that has been processed and committed to the database. */
export type ProcessedExercise = {
  assets?: Maybe<EntityAssets>;
  id: Scalars['String']['output'];
  lot: ExerciseLot;
  notes: Array<Scalars['String']['output']>;
  sets: Array<WorkoutSetRecord>;
  total?: Maybe<WorkoutOrExerciseTotals>;
  unitSystem: UserUnitSystem;
};

export type ProviderLanguageInformation = {
  default: Scalars['String']['output'];
  source: MediaSource;
  supported: Array<Scalars['String']['output']>;
};

export type QueryRoot = {
  /** Get the contents of a collection and respect visibility. */
  collectionContents: CachedCollectionContentsResponse;
  /** Get recommendations for a collection. */
  collectionRecommendations: IdResults;
  /** Get some primary information about the service. */
  coreDetails: CoreDetails;
  /** Get details about an exercise. */
  exerciseDetails: Exercise;
  /** Get details about a genre present in the database. */
  genreDetails: CachedGenreDetailsResponse;
  /** Get an authorization URL using the configured OIDC client. */
  getOidcRedirectUrl: Scalars['String']['output'];
  /** Get an access token using the configured OIDC client. */
  getOidcToken: OidcTokenOutput;
  /** Get a presigned URL (valid for 90 minutes) for a given key. */
  getPresignedS3Url: Scalars['String']['output'];
  /** Get details about a media present in the database. */
  metadataDetails: CachedGraphqlMetadataDetailsResponse;
  /** Get details about a metadata group present in the database. */
  metadataGroupDetails: CachedMetadataGroupDetailsResponse;
  /** Search for a list of groups from a given source. */
  metadataGroupSearch: CachedSearchIdResponse;
  /** Lookup metadata by title. */
  metadataLookup: CachedMetadataLookupResponse;
  /** Search for a list of media for a given type. */
  metadataSearch: CachedSearchIdResponse;
  /** Search for a list of people from a given source. */
  peopleSearch: CachedSearchIdResponse;
  /** Get details about a creator present in the database. */
  personDetails: CachedGraphqlPersonDetailsResponse;
  /** Get trending media items. */
  trendingMetadata: Array<Scalars['String']['output']>;
  /** Get all access links generated by the currently logged in user. */
  userAccessLinks: Array<AccessLink>;
  /** Get the analytics for the currently logged in user. */
  userAnalytics: CachedUserAnalyticsResponse;
  /** Get the analytics parameters for the currently logged in user. */
  userAnalyticsParameters: CachedUserAnalyticsParametersResponse;
  /** Get user by OIDC issuer ID. */
  userByOidcIssuerId?: Maybe<Scalars['String']['output']>;
  /** Get calendar events for a user between a given date range. */
  userCalendarEvents: Array<GroupedCalendarEvent>;
  /** Get all collections for the currently logged in user. */
  userCollectionsList: CachedCollectionsListResponse;
  /** Get details about the currently logged in user. */
  userDetails: UserDetailsResult;
  /** Get information about an exercise for a user. */
  userExerciseDetails: UserExerciseDetails;
  /** Get a paginated list of exercises in the database. */
  userExercisesList: CachedSearchIdResponse;
  /** Get all the export jobs for the current user. */
  userExports: Array<ExportJob>;
  /** Get paginated list of genres for the user. */
  userGenresList: IdResults;
  /** Get all the import jobs deployed by the user. */
  userImportReports: Array<ImportReport>;
  /** Get all the integrations for the currently logged in user. */
  userIntegrations: Array<Integration>;
  /** Get all the measurements for a user. */
  userMeasurementsList: CachedUserMeasurementsListResponse;
  /** Get details that can be displayed to a user for a media. */
  userMetadataDetails: CachedUserMetadataDetailsResponse;
  /** Get details that can be displayed to a user for a metadata group. */
  userMetadataGroupDetails: CachedUserMetadataGroupDetailsResponse;
  /** Get paginated list of metadata groups. */
  userMetadataGroupsList: CachedSearchIdResponse;
  /** Get all the media items related to a user for a specific media type. */
  userMetadataList: CachedSearchIdResponse;
  /** Get metadata recommendations for the currently logged in user. */
  userMetadataRecommendations: CachedUserMetadataRecommendationsResponse;
  /** Get all the notification platforms for the currently logged in user. */
  userNotificationPlatforms: Array<NotificationPlatform>;
  /** Get paginated list of people. */
  userPeopleList: CachedSearchIdResponse;
  /** Get details that can be displayed to a user for a creator. */
  userPersonDetails: CachedUserPersonDetailsResponse;
  /** Get upcoming calendar events for the given filter. */
  userUpcomingCalendarEvents: Array<GraphqlCalendarEvent>;
  /** Get details about a workout. */
  userWorkoutDetails: UserWorkoutDetails;
  /** Get information about a workout template. */
  userWorkoutTemplateDetails: CachedUserWorkoutTemplateDetailsResponse;
  /** Get a paginated list of templates created by the user. */
  userWorkoutTemplatesList: CachedSearchIdResponse;
  /** Get a paginated list of workouts done by the user. */
  userWorkoutsList: CachedSearchIdResponse;
  /** Get details about all the users in the service. */
  usersList: Array<BasicUserDetails>;
};


export type QueryRootCollectionContentsArgs = {
  input: CollectionContentsInput;
};


export type QueryRootCollectionRecommendationsArgs = {
  input: CollectionRecommendationsInput;
};


export type QueryRootExerciseDetailsArgs = {
  exerciseId: Scalars['String']['input'];
};


export type QueryRootGenreDetailsArgs = {
  input: GenreDetailsInput;
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


export type QueryRootMetadataLookupArgs = {
  title: Scalars['String']['input'];
};


export type QueryRootMetadataSearchArgs = {
  input: MetadataSearchInput;
};


export type QueryRootPeopleSearchArgs = {
  input: PeopleSearchInput;
};


export type QueryRootPersonDetailsArgs = {
  personId: Scalars['String']['input'];
};


export type QueryRootUserAnalyticsArgs = {
  input: UserAnalyticsInput;
};


export type QueryRootUserByOidcIssuerIdArgs = {
  oidcIssuerId: Scalars['String']['input'];
};


export type QueryRootUserCalendarEventsArgs = {
  input: UserCalendarEventInput;
};


export type QueryRootUserExerciseDetailsArgs = {
  exerciseId: Scalars['String']['input'];
};


export type QueryRootUserExercisesListArgs = {
  input: UserExercisesListInput;
};


export type QueryRootUserGenresListArgs = {
  input?: InputMaybe<SearchInput>;
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


export type QueryRootUserMetadataGroupsListArgs = {
  input: UserMetadataGroupsListInput;
};


export type QueryRootUserMetadataListArgs = {
  input: UserMetadataListInput;
};


export type QueryRootUserPeopleListArgs = {
  input: UserPeopleListInput;
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
  input: UserTemplatesOrWorkoutsListInput;
};


export type QueryRootUserWorkoutsListArgs = {
  input: UserTemplatesOrWorkoutsListInput;
};


export type QueryRootUsersListArgs = {
  query?: InputMaybe<Scalars['String']['input']>;
};

export type RegisterError = {
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
  /** Specific user lot (role) to assign. */
  lot?: InputMaybe<UserLot>;
};

export type ReorderCollectionEntityInput = {
  collectionName: Scalars['String']['input'];
  entityId: Scalars['String']['input'];
  newPosition: Scalars['Int']['input'];
};

export type ReviewItem = {
  animeExtraInformation?: Maybe<SeenAnimeExtraInformation>;
  comments: Array<ImportOrExportItemReviewComment>;
  id: Scalars['String']['output'];
  isSpoiler: Scalars['Boolean']['output'];
  mangaExtraInformation?: Maybe<SeenMangaExtraInformation>;
  podcastExtraInformation?: Maybe<SeenPodcastExtraOptionalInformation>;
  postedBy: StringIdAndNamedObject;
  postedOn: Scalars['DateTime']['output'];
  rating?: Maybe<Scalars['Decimal']['output']>;
  seenItemsAssociatedWith: Array<Scalars['String']['output']>;
  showExtraInformation?: Maybe<SeenShowExtraOptionalInformation>;
  textOriginal?: Maybe<Scalars['String']['output']>;
  textRendered?: Maybe<Scalars['String']['output']>;
  visibility: Visibility;
};

export type SearchDetails = {
  nextPage?: Maybe<Scalars['Int']['output']>;
  totalItems: Scalars['Int']['output'];
};

export type SearchInput = {
  page?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type Seen = {
  animeExtraInformation?: Maybe<SeenAnimeExtraInformation>;
  finishedOn?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  lastUpdatedOn: Scalars['DateTime']['output'];
  mangaExtraInformation?: Maybe<SeenMangaExtraInformation>;
  manualTimeSpent?: Maybe<Scalars['Decimal']['output']>;
  metadataId: Scalars['String']['output'];
  numTimesUpdated: Scalars['Int']['output'];
  podcastExtraInformation?: Maybe<SeenPodcastExtraInformation>;
  progress: Scalars['Decimal']['output'];
  providersConsumedOn: Array<Scalars['String']['output']>;
  reviewId?: Maybe<Scalars['String']['output']>;
  showExtraInformation?: Maybe<SeenShowExtraInformation>;
  startedOn?: Maybe<Scalars['DateTime']['output']>;
  state: SeenState;
  userId: Scalars['String']['output'];
};

export type SeenAnimeExtraInformation = {
  episode?: Maybe<Scalars['Int']['output']>;
};

export type SeenMangaExtraInformation = {
  chapter?: Maybe<Scalars['Decimal']['output']>;
  volume?: Maybe<Scalars['Int']['output']>;
};

export type SeenPodcastExtraInformation = {
  episode: Scalars['Int']['output'];
};

export type SeenPodcastExtraOptionalInformation = {
  episode?: Maybe<Scalars['Int']['output']>;
};

export type SeenShowExtraInformation = {
  episode: Scalars['Int']['output'];
  season: Scalars['Int']['output'];
};

export type SeenShowExtraOptionalInformation = {
  episode?: Maybe<Scalars['Int']['output']>;
  season?: Maybe<Scalars['Int']['output']>;
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

export type SetPasswordViaSessionInput = {
  password: Scalars['String']['input'];
  sessionId: Scalars['String']['input'];
};

export type SetRestTimersSettings = {
  drop?: Maybe<Scalars['Int']['output']>;
  failure?: Maybe<Scalars['Int']['output']>;
  normal?: Maybe<Scalars['Int']['output']>;
  warmup?: Maybe<Scalars['Int']['output']>;
};

export type SetRestTimersSettingsInput = {
  drop?: InputMaybe<Scalars['Int']['input']>;
  failure?: InputMaybe<Scalars['Int']['input']>;
  normal?: InputMaybe<Scalars['Int']['input']>;
  warmup?: InputMaybe<Scalars['Int']['input']>;
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

export type StringIdAndNamedObject = {
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type StringIdObject = {
  id: Scalars['String']['output'];
};

export type UniqueMediaIdentifier = {
  identifier: Scalars['String']['output'];
  lot: MediaLot;
  source: MediaSource;
};

export type UpdateCustomExerciseInput = {
  assets: EntityAssetsInput;
  equipment?: InputMaybe<ExerciseEquipment>;
  force?: InputMaybe<ExerciseForce>;
  id: Scalars['String']['input'];
  instructions: Array<Scalars['String']['input']>;
  level: ExerciseLevel;
  lot: ExerciseLot;
  mechanic?: InputMaybe<ExerciseMechanic>;
  muscles: Array<ExerciseMuscle>;
  name: Scalars['String']['input'];
  shouldDelete?: InputMaybe<Scalars['Boolean']['input']>;
  source: ExerciseSource;
};

export type UpdateCustomMetadataInput = {
  existingMetadataId: Scalars['String']['input'];
  update: CreateCustomMetadataInput;
};

export type UpdateSeenItemInput = {
  finishedOn?: InputMaybe<Scalars['DateTime']['input']>;
  manualTimeSpent?: InputMaybe<Scalars['Decimal']['input']>;
  providersConsumedOn?: InputMaybe<Array<Scalars['String']['input']>>;
  reviewId?: InputMaybe<Scalars['String']['input']>;
  seenId: Scalars['String']['input'];
  startedOn?: InputMaybe<Scalars['DateTime']['input']>;
};

export type UpdateUserExerciseSettings = {
  change: UserToExerciseSettingsExtraInformationInput;
  exerciseId: Scalars['String']['input'];
};

export type UpdateUserInput = {
  adminAccessToken?: InputMaybe<Scalars['String']['input']>;
  isDisabled?: InputMaybe<Scalars['Boolean']['input']>;
  lot?: InputMaybe<UserLot>;
  userId: Scalars['String']['input'];
  username?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserNotificationPlatformInput = {
  configuredEvents?: InputMaybe<Array<UserNotificationContentDiscriminants>>;
  isDisabled?: InputMaybe<Scalars['Boolean']['input']>;
  notificationId: Scalars['String']['input'];
};

export type UpdateUserWorkoutAttributesInput = {
  endTime?: InputMaybe<Scalars['DateTime']['input']>;
  id: Scalars['String']['input'];
  startTime?: InputMaybe<Scalars['DateTime']['input']>;
};

export type UserAnalytics = {
  activities: DailyUserActivitiesResponse;
  fitness: UserFitnessAnalytics;
  hours: Array<DailyUserActivityHourRecord>;
};

export type UserAnalyticsFeaturesEnabledPreferences = {
  enabled: Scalars['Boolean']['output'];
};

export type UserAnalyticsFeaturesEnabledPreferencesInput = {
  enabled: Scalars['Boolean']['input'];
};

export type UserAnalyticsInput = {
  dateRange: ApplicationDateRangeInput;
  groupBy?: InputMaybe<DailyUserActivitiesResponseGroupedBy>;
};

export type UserCalendarEventInput = {
  month: Scalars['Int']['input'];
  year: Scalars['Int']['input'];
};

export type UserCustomMeasurementInput = {
  name: Scalars['String']['input'];
  unit?: InputMaybe<Scalars['String']['input']>;
};

export type UserDetails = {
  accessLinkId?: Maybe<Scalars['String']['output']>;
  extraInformation?: Maybe<UserExtraInformation>;
  id: Scalars['String']['output'];
  isDisabled?: Maybe<Scalars['Boolean']['output']>;
  lot: UserLot;
  name: Scalars['String']['output'];
  oidcIssuerId?: Maybe<Scalars['String']['output']>;
  preferences: UserPreferences;
  timesTwoFactorBackupCodesUsed?: Maybe<Scalars['Int']['output']>;
};

export type UserDetailsError = {
  error: UserDetailsErrorVariant;
};

export enum UserDetailsErrorVariant {
  SessionInvalid = 'SESSION_INVALID'
}

export type UserDetailsResult = UserDetails | UserDetailsError;

export type UserExerciseDetails = {
  collections: Array<GraphqlCollectionToEntityDetails>;
  details?: Maybe<UserToEntity>;
  history?: Maybe<Array<UserToExerciseHistoryExtraInformation>>;
  reviews: Array<ReviewItem>;
};

export type UserExerciseInput = {
  assets?: InputMaybe<EntityAssetsInput>;
  exerciseId: Scalars['String']['input'];
  notes: Array<Scalars['String']['input']>;
  sets: Array<UserWorkoutSetRecord>;
  unitSystem: UserUnitSystem;
};

export type UserExercisesListInput = {
  filter?: InputMaybe<ExerciseListFilter>;
  search?: InputMaybe<SearchInput>;
  sortBy?: InputMaybe<ExerciseSortBy>;
};

export type UserExtraInformation = {
  scheduledForWorkoutRevision: Scalars['Boolean']['output'];
};

export type UserFeaturesEnabledPreferences = {
  analytics: UserAnalyticsFeaturesEnabledPreferences;
  fitness: UserFitnessFeaturesEnabledPreferences;
  media: UserMediaFeaturesEnabledPreferences;
  others: UserOthersFeaturesEnabledPreferences;
};

export type UserFeaturesEnabledPreferencesInput = {
  analytics: UserAnalyticsFeaturesEnabledPreferencesInput;
  fitness: UserFitnessFeaturesEnabledPreferencesInput;
  media: UserMediaFeaturesEnabledPreferencesInput;
  others: UserOthersFeaturesEnabledPreferencesInput;
};

export type UserFitnessAnalytics = {
  measurementCount: Scalars['Int']['output'];
  workoutCaloriesBurnt: Scalars['Int']['output'];
  workoutCount: Scalars['Int']['output'];
  workoutDistance: Scalars['Int']['output'];
  workoutDuration: Scalars['Int']['output'];
  workoutEquipments: Array<FitnessAnalyticsEquipment>;
  workoutExercises: Array<FitnessAnalyticsExercise>;
  workoutMuscles: Array<FitnessAnalyticsMuscle>;
  workoutPersonalBests: Scalars['Int']['output'];
  workoutReps: Scalars['Int']['output'];
  workoutRestTime: Scalars['Int']['output'];
  workoutWeight: Scalars['Int']['output'];
};

export type UserFitnessExercisesPreferences = {
  setRestTimers: SetRestTimersSettings;
  unitSystem: UserUnitSystem;
};

export type UserFitnessExercisesPreferencesInput = {
  setRestTimers: SetRestTimersSettingsInput;
  unitSystem: UserUnitSystem;
};

export type UserFitnessFeaturesEnabledPreferences = {
  enabled: Scalars['Boolean']['output'];
  measurements: Scalars['Boolean']['output'];
  templates: Scalars['Boolean']['output'];
  workouts: Scalars['Boolean']['output'];
};

export type UserFitnessFeaturesEnabledPreferencesInput = {
  enabled: Scalars['Boolean']['input'];
  measurements: Scalars['Boolean']['input'];
  templates: Scalars['Boolean']['input'];
  workouts: Scalars['Boolean']['input'];
};

export type UserFitnessLoggingPreferences = {
  caloriesBurntUnit: Scalars['String']['output'];
  muteSounds: Scalars['Boolean']['output'];
  promptForRestTimer: Scalars['Boolean']['output'];
  startTimerForDurationExercises: Scalars['Boolean']['output'];
};

export type UserFitnessLoggingPreferencesInput = {
  caloriesBurntUnit: Scalars['String']['input'];
  muteSounds: Scalars['Boolean']['input'];
  promptForRestTimer: Scalars['Boolean']['input'];
  startTimerForDurationExercises: Scalars['Boolean']['input'];
};

export type UserFitnessMeasurementsPreferences = {
  statistics: Array<UserStatisticsMeasurement>;
};

export type UserFitnessMeasurementsPreferencesInput = {
  statistics: Array<UserCustomMeasurementInput>;
};

export type UserFitnessPreferences = {
  exercises: UserFitnessExercisesPreferences;
  logging: UserFitnessLoggingPreferences;
  measurements: UserFitnessMeasurementsPreferences;
};

export type UserFitnessPreferencesInput = {
  exercises: UserFitnessExercisesPreferencesInput;
  logging: UserFitnessLoggingPreferencesInput;
  measurements: UserFitnessMeasurementsPreferencesInput;
};

export type UserGeneralDashboardElement = {
  deduplicateMedia?: Maybe<Scalars['Boolean']['output']>;
  hidden: Scalars['Boolean']['output'];
  numElements?: Maybe<Scalars['Int']['output']>;
  section: DashboardElementLot;
};

export type UserGeneralDashboardElementInput = {
  deduplicateMedia?: InputMaybe<Scalars['Boolean']['input']>;
  hidden: Scalars['Boolean']['input'];
  numElements?: InputMaybe<Scalars['Int']['input']>;
  section: DashboardElementLot;
};

export type UserGeneralPreferences = {
  dashboard: Array<UserGeneralDashboardElement>;
  disableIntegrations: Scalars['Boolean']['output'];
  disableNavigationAnimation: Scalars['Boolean']['output'];
  disableReviews: Scalars['Boolean']['output'];
  disableVideos: Scalars['Boolean']['output'];
  disableWatchProviders: Scalars['Boolean']['output'];
  displayNsfw: Scalars['Boolean']['output'];
  gridPacking: GridPacking;
  landingPath: Scalars['String']['output'];
  listPageSize: Scalars['Int']['output'];
  reviewScale: UserReviewScale;
  showSpoilersInCalendar: Scalars['Boolean']['output'];
  watchProviders: Array<UserGeneralWatchProvider>;
};

export type UserGeneralPreferencesInput = {
  dashboard: Array<UserGeneralDashboardElementInput>;
  disableIntegrations: Scalars['Boolean']['input'];
  disableNavigationAnimation: Scalars['Boolean']['input'];
  disableReviews: Scalars['Boolean']['input'];
  disableVideos: Scalars['Boolean']['input'];
  disableWatchProviders: Scalars['Boolean']['input'];
  displayNsfw: Scalars['Boolean']['input'];
  gridPacking: GridPacking;
  landingPath: Scalars['String']['input'];
  listPageSize: Scalars['Int']['input'];
  reviewScale: UserReviewScale;
  showSpoilersInCalendar: Scalars['Boolean']['input'];
  watchProviders: Array<UserGeneralWatchProviderInput>;
};

export type UserGeneralWatchProvider = {
  lot: MediaLot;
  values: Array<Scalars['String']['output']>;
};

export type UserGeneralWatchProviderInput = {
  lot: MediaLot;
  values: Array<Scalars['String']['input']>;
};

export enum UserLot {
  Admin = 'ADMIN',
  Normal = 'NORMAL'
}

/** An export of a measurement taken at a point in time. */
export type UserMeasurement = {
  /** Any comment associated entered by the user. */
  comment?: Maybe<Scalars['String']['output']>;
  /** The contents of the actual measurement. */
  information: UserMeasurementInformation;
  /** The name given to this measurement by the user. */
  name?: Maybe<Scalars['String']['output']>;
  /** The date and time this measurement was made. */
  timestamp: Scalars['DateTime']['output'];
};

/** The actual statistics that were logged in a user measurement. */
export type UserMeasurementInformation = {
  assets: EntityAssets;
  statistics: Array<UserMeasurementStatistic>;
};

/** The actual statistics that were logged in a user measurement. */
export type UserMeasurementInformationInput = {
  assets: EntityAssetsInput;
  statistics: Array<UserMeasurementStatisticInput>;
};

/** An export of a measurement taken at a point in time. */
export type UserMeasurementInput = {
  /** Any comment associated entered by the user. */
  comment?: InputMaybe<Scalars['String']['input']>;
  /** The contents of the actual measurement. */
  information: UserMeasurementInformationInput;
  /** The name given to this measurement by the user. */
  name?: InputMaybe<Scalars['String']['input']>;
  /** The date and time this measurement was made. */
  timestamp: Scalars['DateTime']['input'];
};

export type UserMeasurementStatistic = {
  name: Scalars['String']['output'];
  value: Scalars['Decimal']['output'];
};

export type UserMeasurementStatisticInput = {
  name: Scalars['String']['input'];
  value: Scalars['Decimal']['input'];
};

export type UserMeasurementsListInput = {
  endTime?: InputMaybe<Scalars['DateTime']['input']>;
  startTime?: InputMaybe<Scalars['DateTime']['input']>;
};

export type UserMediaFeaturesEnabledPreferences = {
  enabled: Scalars['Boolean']['output'];
  genres: Scalars['Boolean']['output'];
  groups: Scalars['Boolean']['output'];
  people: Scalars['Boolean']['output'];
  specific: Array<MediaLot>;
};

export type UserMediaFeaturesEnabledPreferencesInput = {
  enabled: Scalars['Boolean']['input'];
  genres: Scalars['Boolean']['input'];
  groups: Scalars['Boolean']['input'];
  people: Scalars['Boolean']['input'];
  specific: Array<MediaLot>;
};

export type UserMediaNextEntry = {
  chapter?: Maybe<Scalars['Decimal']['output']>;
  episode?: Maybe<Scalars['Int']['output']>;
  season?: Maybe<Scalars['Int']['output']>;
  volume?: Maybe<Scalars['Int']['output']>;
};

export type UserMetadataDetails = {
  /** The average rating of this media in this service. */
  averageRating?: Maybe<Scalars['Decimal']['output']>;
  /** The collections in which this media is present. */
  collections: Array<GraphqlCollectionToEntityDetails>;
  /** Whether this media has been interacted with */
  hasInteracted: Scalars['Boolean']['output'];
  /** The seen history of this media. */
  history: Array<Seen>;
  /** The seen item if it is in progress. */
  inProgress?: Maybe<Seen>;
  /** Whether this media has been recently interacted with */
  isRecentlyConsumed: Scalars['Boolean']['output'];
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
  episodeNumber: Scalars['Int']['output'];
  timesSeen: Scalars['Int']['output'];
};

export type UserMetadataDetailsShowSeasonProgress = {
  episodes: Array<UserMetadataDetailsEpisodeProgress>;
  seasonNumber: Scalars['Int']['output'];
  timesSeen: Scalars['Int']['output'];
};

export type UserMetadataGroupDetails = {
  averageRating?: Maybe<Scalars['Decimal']['output']>;
  collections: Array<GraphqlCollectionToEntityDetails>;
  hasInteracted: Scalars['Boolean']['output'];
  isRecentlyConsumed: Scalars['Boolean']['output'];
  reviews: Array<ReviewItem>;
};

export type UserMetadataGroupsListInput = {
  filter?: InputMaybe<MediaFilter>;
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<PersonSortInput>;
};

export type UserMetadataListInput = {
  filter?: InputMaybe<MediaFilter>;
  lot?: InputMaybe<MediaLot>;
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<MediaSortInput>;
};

/** Auto-generated discriminant enum variants */
export enum UserNotificationContentDiscriminants {
  IntegrationDisabledDueToTooManyErrors = 'INTEGRATION_DISABLED_DUE_TO_TOO_MANY_ERRORS',
  MetadataChaptersOrEpisodesChanged = 'METADATA_CHAPTERS_OR_EPISODES_CHANGED',
  MetadataEpisodeImagesChanged = 'METADATA_EPISODE_IMAGES_CHANGED',
  MetadataEpisodeNameChanged = 'METADATA_EPISODE_NAME_CHANGED',
  MetadataEpisodeReleased = 'METADATA_EPISODE_RELEASED',
  MetadataMovedFromCompletedToWatchlistCollection = 'METADATA_MOVED_FROM_COMPLETED_TO_WATCHLIST_COLLECTION',
  MetadataNumberOfSeasonsChanged = 'METADATA_NUMBER_OF_SEASONS_CHANGED',
  MetadataPublished = 'METADATA_PUBLISHED',
  MetadataReleaseDateChanged = 'METADATA_RELEASE_DATE_CHANGED',
  MetadataStatusChanged = 'METADATA_STATUS_CHANGED',
  NewWorkoutCreated = 'NEW_WORKOUT_CREATED',
  NotificationFromReminderCollection = 'NOTIFICATION_FROM_REMINDER_COLLECTION',
  OutdatedSeenEntries = 'OUTDATED_SEEN_ENTRIES',
  PersonMetadataAssociated = 'PERSON_METADATA_ASSOCIATED',
  PersonMetadataGroupAssociated = 'PERSON_METADATA_GROUP_ASSOCIATED',
  ReviewPosted = 'REVIEW_POSTED'
}

export type UserOthersFeaturesEnabledPreferences = {
  calendar: Scalars['Boolean']['output'];
  collections: Scalars['Boolean']['output'];
};

export type UserOthersFeaturesEnabledPreferencesInput = {
  calendar: Scalars['Boolean']['input'];
  collections: Scalars['Boolean']['input'];
};

export type UserPeopleListInput = {
  filter?: InputMaybe<MediaFilter>;
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<PersonSortInput>;
};

export type UserPersonDetails = {
  averageRating?: Maybe<Scalars['Decimal']['output']>;
  collections: Array<GraphqlCollectionToEntityDetails>;
  hasInteracted: Scalars['Boolean']['output'];
  isRecentlyConsumed: Scalars['Boolean']['output'];
  reviews: Array<ReviewItem>;
};

export type UserPreferences = {
  featuresEnabled: UserFeaturesEnabledPreferences;
  fitness: UserFitnessPreferences;
  general: UserGeneralPreferences;
};

export type UserPreferencesInput = {
  featuresEnabled: UserFeaturesEnabledPreferencesInput;
  fitness: UserFitnessPreferencesInput;
  general: UserGeneralPreferencesInput;
};

export type UserResetResponse = {
  passwordChangeUrl?: Maybe<Scalars['String']['output']>;
  userId: Scalars['String']['output'];
};

export type UserResetResult = RegisterError | UserResetResponse;

export enum UserReviewScale {
  OutOfFive = 'OUT_OF_FIVE',
  OutOfHundred = 'OUT_OF_HUNDRED',
  OutOfTen = 'OUT_OF_TEN',
  ThreePointSmiley = 'THREE_POINT_SMILEY'
}

export type UserStatisticsMeasurement = {
  name: Scalars['String']['output'];
  unit?: Maybe<Scalars['String']['output']>;
};

export type UserTemplatesOrWorkoutsListInput = {
  search?: InputMaybe<SearchInput>;
  sort?: InputMaybe<UserWorkoutsListSortInput>;
};

export enum UserTemplatesOrWorkoutsListSortBy {
  Random = 'RANDOM',
  Time = 'TIME'
}

export type UserToCollectionExtraInformation = {
  isHidden?: Maybe<Scalars['Boolean']['output']>;
};

export type UserToCollectionExtraInformationInput = {
  isHidden?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UserToEntity = {
  collectionExtraInformation?: Maybe<UserToCollectionExtraInformation>;
  collectionId?: Maybe<Scalars['String']['output']>;
  createdOn: Scalars['DateTime']['output'];
  entityId: Scalars['String']['output'];
  entityLot: EntityLot;
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
  lot: WorkoutSetPersonalBest;
  sets: Array<ExerciseBestSetRecord>;
};

export type UserToExerciseExtraInformation = {
  history: Array<UserToExerciseHistoryExtraInformation>;
  lifetimeStats: WorkoutOrExerciseTotals;
  personalBests: Array<UserToExerciseBestSetExtraInformation>;
  settings: UserToExerciseSettingsExtraInformation;
};

export type UserToExerciseHistoryExtraInformation = {
  bestSet?: Maybe<WorkoutSetRecord>;
  idx: Scalars['Int']['output'];
  workoutEndOn: Scalars['DateTime']['output'];
  workoutId: Scalars['String']['output'];
};

export type UserToExerciseSettingsExtraInformation = {
  excludeFromAnalytics: Scalars['Boolean']['output'];
  setRestTimers: SetRestTimersSettings;
};

export type UserToExerciseSettingsExtraInformationInput = {
  excludeFromAnalytics: Scalars['Boolean']['input'];
  setRestTimers: SetRestTimersSettingsInput;
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

export type UserTwoFactorBackupCodesResponse = {
  backupCodes: Array<Scalars['String']['output']>;
};

export type UserTwoFactorInitiateResponse = {
  qrCodeUrl: Scalars['String']['output'];
  secret: Scalars['String']['output'];
};

export type UserTwoFactorSetupInput = {
  totpCode: Scalars['String']['input'];
};

export type UserTwoFactorVerifyInput = {
  code: Scalars['String']['input'];
  method: UserTwoFactorVerifyMethod;
  userId: Scalars['String']['input'];
};

export enum UserTwoFactorVerifyMethod {
  BackupCode = 'BACKUP_CODE',
  Totp = 'TOTP'
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
  collections: Array<GraphqlCollectionToEntityDetails>;
  details: Workout;
  metadataConsumed: Array<Scalars['String']['output']>;
};

export type UserWorkoutInput = {
  assets?: InputMaybe<EntityAssetsInput>;
  caloriesBurnt?: InputMaybe<Scalars['Decimal']['input']>;
  comment?: InputMaybe<Scalars['String']['input']>;
  duration?: InputMaybe<Scalars['Int']['input']>;
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
  restTimerStartedAt?: InputMaybe<Scalars['DateTime']['input']>;
  rpe?: InputMaybe<Scalars['Int']['input']>;
  statistic: SetStatisticInput;
};

export type UserWorkoutTemplateDetails = {
  collections: Array<GraphqlCollectionToEntityDetails>;
  details: WorkoutTemplate;
};

export type UserWorkoutsListSortInput = {
  by?: UserTemplatesOrWorkoutsListSortBy;
  order?: GraphqlSortOrder;
};

export type VerifyTwoFactorError = {
  error: VerifyTwoFactorErrorVariant;
};

export enum VerifyTwoFactorErrorVariant {
  Invalid = 'INVALID',
  RateLimited = 'RATE_LIMITED'
}

export type VerifyTwoFactorResult = ApiKeyResponse | VerifyTwoFactorError;

export type VideoGameSpecifics = {
  platformReleases?: Maybe<Array<VideoGameSpecificsPlatformRelease>>;
  timeToBeat?: Maybe<VideoGameSpecificsTimeToBeat>;
};

export type VideoGameSpecificsInput = {
  platformReleases?: InputMaybe<Array<VideoGameSpecificsPlatformReleaseInput>>;
  timeToBeat?: InputMaybe<VideoGameSpecificsTimeToBeatInput>;
};

export type VideoGameSpecificsPlatformRelease = {
  name: Scalars['String']['output'];
  releaseDate?: Maybe<Scalars['DateTime']['output']>;
  releaseRegion?: Maybe<Scalars['String']['output']>;
};

export type VideoGameSpecificsPlatformReleaseInput = {
  name: Scalars['String']['input'];
  releaseDate?: InputMaybe<Scalars['DateTime']['input']>;
  releaseRegion?: InputMaybe<Scalars['String']['input']>;
};

export type VideoGameSpecificsTimeToBeat = {
  completely?: Maybe<Scalars['Int']['output']>;
  hastily?: Maybe<Scalars['Int']['output']>;
  normally?: Maybe<Scalars['Int']['output']>;
};

export type VideoGameSpecificsTimeToBeatInput = {
  completely?: InputMaybe<Scalars['Int']['input']>;
  hastily?: InputMaybe<Scalars['Int']['input']>;
  normally?: InputMaybe<Scalars['Int']['input']>;
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

export type WatchProvider = {
  image?: Maybe<Scalars['String']['output']>;
  languages: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

/** A workout that was completed by the user. */
export type Workout = {
  caloriesBurnt?: Maybe<Scalars['Decimal']['output']>;
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
  equipment: ExerciseEquipment;
  exercises: Array<Scalars['Int']['output']>;
};

export type WorkoutFocusedSummary = {
  equipments: Array<WorkoutEquipmentFocusedSummary>;
  forces: Array<WorkoutForceFocusedSummary>;
  levels: Array<WorkoutLevelFocusedSummary>;
  lots: Array<WorkoutLotFocusedSummary>;
  muscles: Array<WorkoutMuscleFocusedSummary>;
};

export type WorkoutForceFocusedSummary = {
  exercises: Array<Scalars['Int']['output']>;
  force: ExerciseForce;
};

/** Information about a workout done. */
export type WorkoutInformation = {
  assets?: Maybe<EntityAssets>;
  comment?: Maybe<Scalars['String']['output']>;
  exercises: Array<ProcessedExercise>;
  supersets: Array<WorkoutSupersetsInformation>;
};

export type WorkoutLevelFocusedSummary = {
  exercises: Array<Scalars['Int']['output']>;
  level: ExerciseLevel;
};

export type WorkoutLotFocusedSummary = {
  exercises: Array<Scalars['Int']['output']>;
  lot: ExerciseLot;
};

export type WorkoutMuscleFocusedSummary = {
  exercises: Array<Scalars['Int']['output']>;
  muscle: ExerciseMuscle;
};

/** The totals of a workout and the different bests achieved. */
export type WorkoutOrExerciseTotals = {
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
  Distance = 'DISTANCE',
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
  note?: Maybe<Scalars['String']['output']>;
  personalBests?: Maybe<Array<WorkoutSetPersonalBest>>;
  restTime?: Maybe<Scalars['Int']['output']>;
  restTimerStartedAt?: Maybe<Scalars['DateTime']['output']>;
  rpe?: Maybe<Scalars['Int']['output']>;
  statistic: WorkoutSetStatistic;
  totals?: Maybe<WorkoutSetTotals>;
};

/** Details about the statistics of the set performed. */
export type WorkoutSetStatistic = {
  distance?: Maybe<Scalars['Decimal']['output']>;
  duration?: Maybe<Scalars['Decimal']['output']>;
  oneRm?: Maybe<Scalars['Decimal']['output']>;
  pace?: Maybe<Scalars['Decimal']['output']>;
  reps?: Maybe<Scalars['Decimal']['output']>;
  volume?: Maybe<Scalars['Decimal']['output']>;
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type WorkoutSetTotals = {
  weight?: Maybe<Scalars['Decimal']['output']>;
};

export type WorkoutSummary = {
  exercises: Array<WorkoutSummaryExercise>;
  focused: WorkoutFocusedSummary;
  total?: Maybe<WorkoutOrExerciseTotals>;
};

/** The summary about an exercise done in a workout. */
export type WorkoutSummaryExercise = {
  bestSet?: Maybe<WorkoutSetRecord>;
  id: Scalars['String']['output'];
  lot?: Maybe<ExerciseLot>;
  numSets: Scalars['Int']['output'];
  unitSystem: UserUnitSystem;
};

export type WorkoutSupersetsInformation = {
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
  createdOn: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  information: WorkoutInformation;
  name: Scalars['String']['output'];
  summary: WorkoutSummary;
};

export type RegisterUserMutationVariables = Exact<{
  input: RegisterUserInput;
}>;


export type RegisterUserMutation = { registerUser: { __typename: 'RegisterError', error: RegisterErrorVariant } | { __typename: 'StringIdObject', id: string } };

export type LoginUserMutationVariables = Exact<{
  input: AuthUserInput;
}>;


export type LoginUserMutation = { loginUser: { __typename: 'ApiKeyResponse', apiKey: string } | { __typename: 'LoginError', error: LoginErrorVariant } | { __typename: 'StringIdObject', id: string } };

export type LogoutUserMutationVariables = Exact<{ [key: string]: never; }>;


export type LogoutUserMutation = { logoutUser: boolean };

export type DeployAddEntitiesToCollectionJobMutationVariables = Exact<{
  input: ChangeCollectionToEntitiesInput;
}>;


export type DeployAddEntitiesToCollectionJobMutation = { deployAddEntitiesToCollectionJob: boolean };

export type CreateCustomExerciseMutationVariables = Exact<{
  input: ExerciseInput;
}>;


export type CreateCustomExerciseMutation = { createCustomExercise: string };

export type UpdateCustomExerciseMutationVariables = Exact<{
  input: UpdateCustomExerciseInput;
}>;


export type UpdateCustomExerciseMutation = { updateCustomExercise: boolean };

export type CreateCustomMetadataMutationVariables = Exact<{
  input: CreateCustomMetadataInput;
}>;


export type CreateCustomMetadataMutation = { createCustomMetadata: { id: string } };

export type UpdateCustomMetadataMutationVariables = Exact<{
  input: UpdateCustomMetadataInput;
}>;


export type UpdateCustomMetadataMutation = { updateCustomMetadata: boolean };

export type CreateOrUpdateCollectionMutationVariables = Exact<{
  input: CreateOrUpdateCollectionInput;
}>;


export type CreateOrUpdateCollectionMutation = { createOrUpdateCollection: { id: string } };

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


export type CreateUserNotificationPlatformMutation = { createUserNotificationPlatform: string };

export type CreateOrUpdateUserIntegrationMutationVariables = Exact<{
  input: CreateOrUpdateUserIntegrationInput;
}>;


export type CreateOrUpdateUserIntegrationMutation = { createOrUpdateUserIntegration: boolean };

export type CreateOrUpdateUserWorkoutMutationVariables = Exact<{
  input: UserWorkoutInput;
}>;


export type CreateOrUpdateUserWorkoutMutation = { createOrUpdateUserWorkout: string };

export type CreateOrUpdateUserWorkoutTemplateMutationVariables = Exact<{
  input: UserWorkoutInput;
}>;


export type CreateOrUpdateUserWorkoutTemplateMutation = { createOrUpdateUserWorkoutTemplate: string };

export type DeleteCollectionMutationVariables = Exact<{
  collectionName: Scalars['String']['input'];
}>;


export type DeleteCollectionMutation = { deleteCollection: boolean };

export type DeleteReviewMutationVariables = Exact<{
  reviewId: Scalars['String']['input'];
}>;


export type DeleteReviewMutation = { deleteReview: boolean };

export type DeleteS3ObjectMutationVariables = Exact<{
  key: Scalars['String']['input'];
}>;


export type DeleteS3ObjectMutation = { deleteS3Object: boolean };

export type DeleteSeenItemMutationVariables = Exact<{
  seenId: Scalars['String']['input'];
}>;


export type DeleteSeenItemMutation = { deleteSeenItem: { id: string } };

export type DeleteUserMutationVariables = Exact<{
  toDeleteUserId: Scalars['String']['input'];
}>;


export type DeleteUserMutation = { deleteUser: boolean };

export type ResetUserMutationVariables = Exact<{
  toResetUserId: Scalars['String']['input'];
}>;


export type ResetUserMutation = { resetUser: { __typename: 'RegisterError' } | { __typename: 'UserResetResponse', userId: string, passwordChangeUrl?: string | null } };

export type DeleteUserIntegrationMutationVariables = Exact<{
  integrationId: Scalars['String']['input'];
}>;


export type DeleteUserIntegrationMutation = { deleteUserIntegration: boolean };

export type DeleteUserMeasurementMutationVariables = Exact<{
  timestamp: Scalars['DateTime']['input'];
}>;


export type DeleteUserMeasurementMutation = { deleteUserMeasurement: boolean };

export type DeleteUserNotificationPlatformMutationVariables = Exact<{
  notificationId: Scalars['String']['input'];
}>;


export type DeleteUserNotificationPlatformMutation = { deleteUserNotificationPlatform: boolean };

export type DeleteUserWorkoutMutationVariables = Exact<{
  workoutId: Scalars['String']['input'];
}>;


export type DeleteUserWorkoutMutation = { deleteUserWorkout: boolean };

export type DeleteUserWorkoutTemplateMutationVariables = Exact<{
  workoutTemplateId: Scalars['String']['input'];
}>;


export type DeleteUserWorkoutTemplateMutation = { deleteUserWorkoutTemplate: boolean };

export type DeployBackgroundJobMutationVariables = Exact<{
  jobName: BackgroundJob;
}>;


export type DeployBackgroundJobMutation = { deployBackgroundJob: boolean };

export type DeployExportJobMutationVariables = Exact<{ [key: string]: never; }>;


export type DeployExportJobMutation = { deployExportJob: boolean };

export type DeployImportJobMutationVariables = Exact<{
  input: DeployImportJobInput;
}>;


export type DeployImportJobMutation = { deployImportJob: boolean };

export type DeployUpdateMediaEntityJobMutationVariables = Exact<{
  entityId: Scalars['String']['input'];
  entityLot: EntityLot;
}>;


export type DeployUpdateMediaEntityJobMutation = { deployUpdateMediaEntityJob: boolean };

export type UpdateSeenItemMutationVariables = Exact<{
  input: UpdateSeenItemInput;
}>;


export type UpdateSeenItemMutation = { updateSeenItem: boolean };

export type UpdateUserNotificationPlatformMutationVariables = Exact<{
  input: UpdateUserNotificationPlatformInput;
}>;


export type UpdateUserNotificationPlatformMutation = { updateUserNotificationPlatform: boolean };

export type UpdateUserWorkoutAttributesMutationVariables = Exact<{
  input: UpdateUserWorkoutAttributesInput;
}>;


export type UpdateUserWorkoutAttributesMutation = { updateUserWorkoutAttributes: boolean };

export type GenerateAuthTokenMutationVariables = Exact<{ [key: string]: never; }>;


export type GenerateAuthTokenMutation = { generateAuthToken: string };

export type MergeMetadataMutationVariables = Exact<{
  mergeFrom: Scalars['String']['input'];
  mergeInto: Scalars['String']['input'];
}>;


export type MergeMetadataMutation = { mergeMetadata: boolean };

export type DisassociateMetadataMutationVariables = Exact<{
  metadataId: Scalars['String']['input'];
}>;


export type DisassociateMetadataMutation = { disassociateMetadata: boolean };

export type CreateOrUpdateReviewMutationVariables = Exact<{
  input: CreateOrUpdateReviewInput;
}>;


export type CreateOrUpdateReviewMutation = { createOrUpdateReview: { id: string } };

export type PresignedPutS3UrlMutationVariables = Exact<{
  input: PresignedPutUrlInput;
}>;


export type PresignedPutS3UrlMutation = { presignedPutS3Url: { key: string, uploadUrl: string } };

export type DeployRemoveEntitiesFromCollectionJobMutationVariables = Exact<{
  input: ChangeCollectionToEntitiesInput;
}>;


export type DeployRemoveEntitiesFromCollectionJobMutation = { deployRemoveEntitiesFromCollectionJob: boolean };

export type ReorderCollectionEntityMutationVariables = Exact<{
  input: ReorderCollectionEntityInput;
}>;


export type ReorderCollectionEntityMutation = { reorderCollectionEntity: boolean };

export type TestUserNotificationPlatformsMutationVariables = Exact<{ [key: string]: never; }>;


export type TestUserNotificationPlatformsMutation = { testUserNotificationPlatforms: boolean };

export type UpdateUserMutationVariables = Exact<{
  input: UpdateUserInput;
}>;


export type UpdateUserMutation = { updateUser: { id: string } };

export type UpdateUserPreferenceMutationVariables = Exact<{
  input: UserPreferencesInput;
}>;


export type UpdateUserPreferenceMutation = { updateUserPreference: boolean };

export type CreateAccessLinkMutationVariables = Exact<{
  input: CreateAccessLinkInput;
}>;


export type CreateAccessLinkMutation = { createAccessLink: { id: string } };

export type ProcessAccessLinkMutationVariables = Exact<{
  input: ProcessAccessLinkInput;
}>;


export type ProcessAccessLinkMutation = { processAccessLink: { __typename: 'ProcessAccessLinkError', error: ProcessAccessLinkErrorVariant } | { __typename: 'ProcessAccessLinkResponse', apiKey: string, redirectTo?: string | null, tokenValidForDays: number } };

export type RevokeAccessLinkMutationVariables = Exact<{
  accessLinkId: Scalars['String']['input'];
}>;


export type RevokeAccessLinkMutation = { revokeAccessLink: boolean };

export type UpdateUserExerciseSettingsMutationVariables = Exact<{
  input: UpdateUserExerciseSettings;
}>;


export type UpdateUserExerciseSettingsMutation = { updateUserExerciseSettings: boolean };

export type MergeExerciseMutationVariables = Exact<{
  mergeFrom: Scalars['String']['input'];
  mergeInto: Scalars['String']['input'];
}>;


export type MergeExerciseMutation = { mergeExercise: boolean };

export type MarkEntityAsPartialMutationVariables = Exact<{
  input: MarkEntityAsPartialInput;
}>;


export type MarkEntityAsPartialMutation = { markEntityAsPartial: boolean };

export type ExpireCacheKeyMutationVariables = Exact<{
  cacheId: Scalars['UUID']['input'];
}>;


export type ExpireCacheKeyMutation = { expireCacheKey: boolean };

export type DeployBulkMetadataProgressUpdateMutationVariables = Exact<{
  input: Array<MetadataProgressUpdateInput> | MetadataProgressUpdateInput;
}>;


export type DeployBulkMetadataProgressUpdateMutation = { deployBulkMetadataProgressUpdate: boolean };

export type InitiateTwoFactorSetupMutationVariables = Exact<{ [key: string]: never; }>;


export type InitiateTwoFactorSetupMutation = { initiateTwoFactorSetup: { secret: string, qrCodeUrl: string } };

export type CompleteTwoFactorSetupMutationVariables = Exact<{
  input: UserTwoFactorSetupInput;
}>;


export type CompleteTwoFactorSetupMutation = { completeTwoFactorSetup: { backupCodes: Array<string> } };

export type VerifyTwoFactorMutationVariables = Exact<{
  input: UserTwoFactorVerifyInput;
}>;


export type VerifyTwoFactorMutation = { verifyTwoFactor: { __typename: 'ApiKeyResponse', apiKey: string } | { __typename: 'VerifyTwoFactorError', error: VerifyTwoFactorErrorVariant } };

export type DisableTwoFactorMutationVariables = Exact<{ [key: string]: never; }>;


export type DisableTwoFactorMutation = { disableTwoFactor: boolean };

export type RegenerateTwoFactorBackupCodesMutationVariables = Exact<{ [key: string]: never; }>;


export type RegenerateTwoFactorBackupCodesMutation = { regenerateTwoFactorBackupCodes: { backupCodes: Array<string> } };

export type GetPasswordChangeSessionMutationVariables = Exact<{
  input: GetPasswordChangeSessionInput;
}>;


export type GetPasswordChangeSessionMutation = { getPasswordChangeSession: { userId: string, passwordChangeUrl: string } };

export type SetPasswordViaSessionMutationVariables = Exact<{
  input: SetPasswordViaSessionInput;
}>;


export type SetPasswordViaSessionMutation = { setPasswordViaSession: boolean };

export type CoreDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type CoreDetailsQuery = { coreDetails: { version: string, docsLink: string, pageSize: number, websiteUrl: string, smtpEnabled: boolean, oidcEnabled: boolean, signupAllowed: boolean, maxFileSizeMb: number, repositoryLink: string, isDemoInstance: boolean, disableTelemetry: boolean, tokenValidForDays: number, localAuthDisabled: boolean, fileStorageEnabled: boolean, peopleSearchSources: Array<MediaSource>, isServerKeyValidated: boolean, twoFactorBackupCodesCount: number, metadataGroupSourceLotMappings: Array<{ lot: MediaLot, source: MediaSource }>, metadataLotSourceMappings: Array<{ lot: MediaLot, sources: Array<MediaSource> }>, providerSpecifics: { igdb: { themes: Array<{ id: number, name: string }>, genres: Array<{ id: number, name: string }>, platforms: Array<{ id: number, name: string }>, gameModes: Array<{ id: number, name: string }>, gameTypes: Array<{ id: number, name: string }>, releaseDateRegions: Array<{ id: number, name: string }> } }, metadataProviderLanguages: Array<{ source: MediaSource, default: string, supported: Array<string> }>, frontend: { url: string, oidcButtonLabel: string, dashboardMessage: string, umami: { scriptUrl: string, websiteId: string } }, exerciseParameters: { lotMapping: Array<{ lot: ExerciseLot, bests: Array<WorkoutSetPersonalBest> }>, filters: { type: Array<ExerciseLot>, level: Array<ExerciseLevel>, force: Array<ExerciseForce>, muscle: Array<ExerciseMuscle>, mechanic: Array<ExerciseMechanic>, equipment: Array<ExerciseEquipment> } } } };

export type MetadataDetailsQueryVariables = Exact<{
  metadataId: Scalars['String']['input'];
}>;


export type MetadataDetailsQuery = { metadataDetails: { response: { id: string, lot: MediaLot, title: string, source: MediaSource, isNsfw?: boolean | null, isPartial?: boolean | null, sourceUrl?: string | null, identifier: string, description?: string | null, suggestions: Array<string>, publishYear?: number | null, publishDate?: string | null, providerRating?: string | null, createdByUserId?: string | null, productionStatus?: string | null, originalLanguage?: string | null, animeSpecifics?: { episodes?: number | null } | null, audioBookSpecifics?: { runtime?: number | null } | null, movieSpecifics?: { runtime?: number | null } | null, genres: Array<{ id: string, name: string }>, groups: Array<{ id: string, part: number }>, watchProviders: Array<{ name: string, image?: string | null, languages: Array<string> }>, bookSpecifics?: { pages?: number | null, isCompilation?: boolean | null } | null, mangaSpecifics?: { volumes?: number | null, chapters?: string | null } | null, assets: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> }, creators: Array<{ name: string, items: Array<{ isFree: boolean, idOrName: string, character?: string | null }> }>, podcastSpecifics?: { totalEpisodes: number, episodes: Array<{ id: string, title: string, overview?: string | null, thumbnail?: string | null, number: number, runtime?: number | null, publishDate: string }> } | null, showSpecifics?: { totalSeasons?: number | null, totalEpisodes?: number | null, runtime?: number | null, seasons: Array<{ id: number, seasonNumber: number, name: string, overview?: string | null, backdropImages: Array<string>, posterImages: Array<string>, episodes: Array<{ id: number, name: string, runtime?: number | null, overview?: string | null, publishDate?: string | null, posterImages: Array<string>, episodeNumber: number }> }> } | null, visualNovelSpecifics?: { length?: number | null } | null, videoGameSpecifics?: { platformReleases?: Array<{ name: string, releaseDate?: string | null, releaseRegion?: string | null }> | null, timeToBeat?: { hastily?: number | null, normally?: number | null, completely?: number | null } | null } | null, musicSpecifics?: { duration?: number | null, viewCount?: number | null, discNumber?: number | null, trackNumber?: number | null, byVariousArtists?: boolean | null } | null } } };

export type PersonDetailsQueryVariables = Exact<{
  personId: Scalars['String']['input'];
}>;


export type PersonDetailsQuery = { personDetails: { response: { associatedMetadata: Array<{ name: string, items: Array<{ entityId: string, character?: string | null }> }>, associatedMetadataGroups: Array<{ name: string, items: Array<{ entityId: string, character?: string | null }> }>, details: { id: string, name: string, place?: string | null, source: MediaSource, gender?: string | null, website?: string | null, deathDate?: string | null, birthDate?: string | null, isPartial?: boolean | null, sourceUrl?: string | null, identifier: string, description?: string | null, alternateNames?: Array<string> | null, associatedEntityCount: number, associatedMetadataCount: number, associatedMetadataGroupsCount: number, assets: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } } } } };

export type UserAnalyticsQueryVariables = Exact<{
  input: UserAnalyticsInput;
}>;


export type UserAnalyticsQuery = { userAnalytics: { cacheId: string, response: { hours: Array<{ hour: number, entities: Array<{ entityLot: EntityLot, metadataLot?: MediaLot | null }> }>, activities: { groupedBy: DailyUserActivitiesResponseGroupedBy, totalCount: number, totalDuration: number, items: Array<{ day: string, totalCount: number, totalDuration: number, totalBookPages: number, totalReviewCount: number, totalMetadataCount: number, totalShowDuration: number, totalMovieDuration: number, totalMusicDuration: number, totalWorkoutReps: number, totalWorkoutWeight: number, totalWorkoutDistance: number, totalWorkoutRestTime: number, totalWorkoutDuration: number, totalPodcastDuration: number, totalVideoGameDuration: number, totalAudioBookDuration: number, totalVisualNovelDuration: number, totalPersonReviewCount: number, totalMetadataReviewCount: number, totalWorkoutPersonalBests: number, totalCollectionReviewCount: number, totalMetadataGroupReviewCount: number, userMeasurementCount: number, bookCount: number, showCount: number, movieCount: number, musicCount: number, animeCount: number, mangaCount: number, workoutCount: number, podcastCount: number, audioBookCount: number, videoGameCount: number, visualNovelCount: number }> }, fitness: { workoutReps: number, workoutCount: number, workoutWeight: number, workoutDistance: number, workoutDuration: number, workoutRestTime: number, measurementCount: number, workoutPersonalBests: number, workoutCaloriesBurnt: number, workoutExercises: Array<{ count: number, exercise: string }>, workoutMuscles: Array<{ count: number, muscle: ExerciseMuscle }>, workoutEquipments: Array<{ count: number, equipment: ExerciseEquipment }> } } } };

export type MinimalUserAnalyticsQueryVariables = Exact<{
  input: UserAnalyticsInput;
}>;


export type MinimalUserAnalyticsQuery = { userAnalytics: { cacheId: string, response: { activities: { items: Array<{ day: string, totalCount: number, totalDuration: number, totalBookPages: number, totalReviewCount: number, totalMetadataCount: number, totalShowDuration: number, totalMovieDuration: number, totalMusicDuration: number, totalWorkoutReps: number, totalWorkoutWeight: number, totalWorkoutDistance: number, totalWorkoutRestTime: number, totalWorkoutDuration: number, totalPodcastDuration: number, totalVideoGameDuration: number, totalAudioBookDuration: number, totalVisualNovelDuration: number, totalPersonReviewCount: number, totalMetadataReviewCount: number, totalWorkoutPersonalBests: number, totalCollectionReviewCount: number, totalMetadataGroupReviewCount: number, userMeasurementCount: number, bookCount: number, showCount: number, movieCount: number, musicCount: number, animeCount: number, mangaCount: number, workoutCount: number, podcastCount: number, audioBookCount: number, videoGameCount: number, visualNovelCount: number }> } } } };

export type UserDetailsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserDetailsQuery = { userDetails: { __typename: 'UserDetails', id: string, lot: UserLot, name: string, isDisabled?: boolean | null, oidcIssuerId?: string | null, accessLinkId?: string | null, timesTwoFactorBackupCodesUsed?: number | null, extraInformation?: { scheduledForWorkoutRevision: boolean } | null, preferences: { general: { reviewScale: UserReviewScale, gridPacking: GridPacking, displayNsfw: boolean, landingPath: string, listPageSize: number, disableVideos: boolean, disableReviews: boolean, disableIntegrations: boolean, disableWatchProviders: boolean, showSpoilersInCalendar: boolean, disableNavigationAnimation: boolean, dashboard: Array<{ hidden: boolean, section: DashboardElementLot, numElements?: number | null, deduplicateMedia?: boolean | null }>, watchProviders: Array<{ lot: MediaLot, values: Array<string> }> }, fitness: { exercises: { unitSystem: UserUnitSystem, setRestTimers: { drop?: number | null, warmup?: number | null, normal?: number | null, failure?: number | null } }, logging: { muteSounds: boolean, caloriesBurntUnit: string, promptForRestTimer: boolean, startTimerForDurationExercises: boolean }, measurements: { statistics: Array<{ name: string, unit?: string | null }> } }, featuresEnabled: { analytics: { enabled: boolean }, others: { calendar: boolean, collections: boolean }, fitness: { enabled: boolean, workouts: boolean, templates: boolean, measurements: boolean }, media: { enabled: boolean, groups: boolean, people: boolean, genres: boolean, specific: Array<MediaLot> } } } } | { __typename: 'UserDetailsError' } };

export type UserExerciseDetailsQueryVariables = Exact<{
  exerciseId: Scalars['String']['input'];
}>;


export type UserExerciseDetailsQuery = { userExerciseDetails: { collections: Array<{ id: string, details: { createdOn: string, information?: any | null, collectionId: string, lastUpdatedOn: string, creatorUserId: string, collectionName: string } }>, reviews: Array<{ id: string, rating?: string | null, postedOn: string, isSpoiler: boolean, visibility: Visibility, textOriginal?: string | null, textRendered?: string | null, seenItemsAssociatedWith: Array<string>, postedBy: { id: string, name: string }, comments: Array<{ id: string, text: string, likedBy: Array<string>, createdOn: string, user: { id: string, name: string } }>, showExtraInformation?: { season?: number | null, episode?: number | null } | null, podcastExtraInformation?: { episode?: number | null } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null }>, history?: Array<{ idx: number, workoutId: string, workoutEndOn: string, bestSet?: { lot: SetLot, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } } | null }> | null, details?: { exerciseId?: string | null, createdOn: string, lastUpdatedOn: string, exerciseNumTimesInteracted?: number | null, exerciseExtraInformation?: { settings: { excludeFromAnalytics: boolean, setRestTimers: { drop?: number | null, warmup?: number | null, normal?: number | null, failure?: number | null } }, lifetimeStats: { weight: string, reps: string, distance: string, duration: string, personalBestsAchieved: number }, personalBests: Array<{ lot: WorkoutSetPersonalBest, sets: Array<{ setIdx: number, workoutId: string, exerciseIdx: number }> }> } | null } | null } };

export type UserMeasurementsListQueryVariables = Exact<{
  input: UserMeasurementsListInput;
}>;


export type UserMeasurementsListQuery = { userMeasurementsList: { response: Array<{ name?: string | null, comment?: string | null, timestamp: string, information: { assets: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> }, statistics: Array<{ name: string, value: string }> } }> } };

export type UserMetadataDetailsQueryVariables = Exact<{
  metadataId: Scalars['String']['input'];
}>;


export type UserMetadataDetailsQuery = { userMetadataDetails: { response: { mediaReason?: Array<UserToMediaReason> | null, hasInteracted: boolean, averageRating?: string | null, seenByAllCount: number, seenByUserCount: number, isRecentlyConsumed: boolean, reviews: Array<{ id: string, rating?: string | null, postedOn: string, isSpoiler: boolean, visibility: Visibility, textOriginal?: string | null, textRendered?: string | null, seenItemsAssociatedWith: Array<string>, postedBy: { id: string, name: string }, comments: Array<{ id: string, text: string, likedBy: Array<string>, createdOn: string, user: { id: string, name: string } }>, showExtraInformation?: { season?: number | null, episode?: number | null } | null, podcastExtraInformation?: { episode?: number | null } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null }>, history: Array<{ id: string, state: SeenState, progress: string, reviewId?: string | null, startedOn?: string | null, finishedOn?: string | null, lastUpdatedOn: string, manualTimeSpent?: string | null, numTimesUpdated: number, providersConsumedOn: Array<string>, showExtraInformation?: { episode: number, season: number } | null, podcastExtraInformation?: { episode: number } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null }>, nextEntry?: { season?: number | null, volume?: number | null, episode?: number | null, chapter?: string | null } | null, inProgress?: { id: string, state: SeenState, progress: string, reviewId?: string | null, startedOn?: string | null, finishedOn?: string | null, lastUpdatedOn: string, manualTimeSpent?: string | null, numTimesUpdated: number, providersConsumedOn: Array<string>, showExtraInformation?: { episode: number, season: number } | null, podcastExtraInformation?: { episode: number } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null } | null, collections: Array<{ id: string, details: { createdOn: string, information?: any | null, collectionId: string, lastUpdatedOn: string, creatorUserId: string, collectionName: string } }>, showProgress?: Array<{ timesSeen: number, seasonNumber: number, episodes: Array<{ episodeNumber: number, timesSeen: number }> }> | null, podcastProgress?: Array<{ episodeNumber: number, timesSeen: number }> | null } } };

export type GetOidcRedirectUrlQueryVariables = Exact<{ [key: string]: never; }>;


export type GetOidcRedirectUrlQuery = { getOidcRedirectUrl: string };

export type UserByOidcIssuerIdQueryVariables = Exact<{
  oidcIssuerId: Scalars['String']['input'];
}>;


export type UserByOidcIssuerIdQuery = { userByOidcIssuerId?: string | null };

export type GetOidcTokenQueryVariables = Exact<{
  code: Scalars['String']['input'];
}>;


export type GetOidcTokenQuery = { getOidcToken: { email: string, subject: string } };

export type GetPresignedS3UrlQueryVariables = Exact<{
  key: Scalars['String']['input'];
}>;


export type GetPresignedS3UrlQuery = { getPresignedS3Url: string };

export type UserExportsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserExportsQuery = { userExports: Array<{ url: string, key: string, size: number, endedAt: string, startedAt: string }> };

export type UserCollectionsListQueryVariables = Exact<{ [key: string]: never; }>;


export type UserCollectionsListQuery = { userCollectionsList: { cacheId: string, response: Array<{ id: string, name: string, count: number, isDefault: boolean, description?: string | null, creator: { id: string, name: string }, collaborators: Array<{ extraInformation?: { isHidden?: boolean | null } | null, collaborator: { id: string, name: string } }>, informationTemplate?: Array<{ lot: CollectionExtraInformationLot, name: string, required?: boolean | null, description: string, defaultValue?: string | null, possibleValues?: Array<string> | null }> | null }> } };

export type UserIntegrationsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserIntegrationsQuery = { userIntegrations: Array<{ id: string, lot: IntegrationLot, name?: string | null, provider: IntegrationProvider, createdOn: string, isDisabled?: boolean | null, lastFinishedAt?: string | null, maximumProgress?: string | null, minimumProgress?: string | null, syncToOwnedCollection?: boolean | null, extraSettings: { disableOnContinuousErrors: boolean }, triggerResult: Array<{ error?: string | null, finishedAt: string }>, providerSpecifics?: { plexYankToken?: string | null, plexYankBaseUrl?: string | null, plexSinkUsername?: string | null, audiobookshelfToken?: string | null, audiobookshelfBaseUrl?: string | null, komgaBaseUrl?: string | null, komgaUsername?: string | null, komgaPassword?: string | null, komgaProvider?: MediaSource | null, radarrBaseUrl?: string | null, radarrApiKey?: string | null, radarrProfileId?: number | null, radarrRootFolderPath?: string | null, radarrSyncCollectionIds?: Array<string> | null, radarrTagIds?: Array<number> | null, sonarrProfileId?: number | null, sonarrApiKey?: string | null, sonarrBaseUrl?: string | null, sonarrRootFolderPath?: string | null, sonarrSyncCollectionIds?: Array<string> | null, sonarrTagIds?: Array<number> | null, jellyfinPushBaseUrl?: string | null, jellyfinPushUsername?: string | null, jellyfinPushPassword?: string | null, youtubeMusicTimezone?: string | null, youtubeMusicAuthCookie?: string | null, ryotBrowserExtensionDisabledSites?: Array<string> | null } | null }> };

export type UserNotificationPlatformsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserNotificationPlatformsQuery = { userNotificationPlatforms: Array<{ id: string, lot: NotificationPlatformLot, createdOn: string, isDisabled?: boolean | null, description: string, configuredEvents: Array<UserNotificationContentDiscriminants> }> };

export type UsersListQueryVariables = Exact<{
  query?: InputMaybe<Scalars['String']['input']>;
}>;


export type UsersListQuery = { usersList: Array<{ id: string, lot: UserLot, name: string, isDisabled?: boolean | null }> };

export type UserMetadataRecommendationsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserMetadataRecommendationsQuery = { userMetadataRecommendations: { cacheId: string, response: Array<string> } };

export type UserUpcomingCalendarEventsQueryVariables = Exact<{
  input: UserUpcomingCalendarEventInput;
}>;


export type UserUpcomingCalendarEventsQuery = { userUpcomingCalendarEvents: Array<{ date: string, metadataId: string, metadataLot: MediaLot, metadataText: string, metadataImage?: string | null, calendarEventId: string, showExtraInformation?: { episode: number, season: number } | null, podcastExtraInformation?: { episode: number } | null, animeExtraInformation?: { episode?: number | null } | null }> };

export type UserCalendarEventsQueryVariables = Exact<{
  input: UserCalendarEventInput;
}>;


export type UserCalendarEventsQuery = { userCalendarEvents: Array<{ date: string, events: Array<{ date: string, metadataId: string, metadataLot: MediaLot, metadataText: string, metadataImage?: string | null, calendarEventId: string, showExtraInformation?: { episode: number, season: number } | null, podcastExtraInformation?: { episode: number } | null, animeExtraInformation?: { episode?: number | null } | null }> }> };

export type UserMetadataGroupsListQueryVariables = Exact<{
  input: UserMetadataGroupsListInput;
}>;


export type UserMetadataGroupsListQuery = { userMetadataGroupsList: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type UserPeopleListQueryVariables = Exact<{
  input: UserPeopleListInput;
}>;


export type UserPeopleListQuery = { userPeopleList: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type UserAccessLinksQueryVariables = Exact<{ [key: string]: never; }>;


export type UserAccessLinksQuery = { userAccessLinks: Array<{ id: string, name: string, createdOn: string, expiresOn?: string | null, timesUsed: number, isRevoked?: boolean | null, maximumUses?: number | null, isAccountDefault?: boolean | null, isMutationAllowed?: boolean | null }> };

export type ExerciseDetailsQueryVariables = Exact<{
  exerciseId: Scalars['String']['input'];
}>;


export type ExerciseDetailsQuery = { exerciseDetails: { id: string, lot: ExerciseLot, name: string, level: ExerciseLevel, force?: ExerciseForce | null, source: ExerciseSource, muscles: Array<ExerciseMuscle>, mechanic?: ExerciseMechanic | null, equipment?: ExerciseEquipment | null, instructions: Array<string>, createdByUserId?: string | null, assets: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } } };

export type UserExercisesListQueryVariables = Exact<{
  input: UserExercisesListInput;
}>;


export type UserExercisesListQuery = { userExercisesList: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type UserImportReportsQueryVariables = Exact<{ [key: string]: never; }>;


export type UserImportReportsQuery = { userImportReports: Array<{ id: string, source: ImportSource, progress?: string | null, startedOn: string, finishedOn?: string | null, wasSuccess?: boolean | null, estimatedFinishTime: string, details?: { import: { total: number }, failedItems: Array<{ lot?: MediaLot | null, step: ImportFailStep, error?: string | null, identifier: string }> } | null }> };

export type UserGenresListQueryVariables = Exact<{
  input: SearchInput;
}>;


export type UserGenresListQuery = { userGenresList: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } };

export type GenreDetailsQueryVariables = Exact<{
  input: GenreDetailsInput;
}>;


export type GenreDetailsQuery = { genreDetails: { response: { details: { id: string, name: string, numItems?: number | null }, contents: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } } };

export type CollectionContentsQueryVariables = Exact<{
  input: CollectionContentsInput;
}>;


export type CollectionContentsQuery = { collectionContents: { cacheId: string, response: { totalItems: number, user: { id: string, name: string }, reviews: Array<{ id: string, rating?: string | null, postedOn: string, isSpoiler: boolean, visibility: Visibility, textOriginal?: string | null, textRendered?: string | null, seenItemsAssociatedWith: Array<string>, postedBy: { id: string, name: string }, comments: Array<{ id: string, text: string, likedBy: Array<string>, createdOn: string, user: { id: string, name: string } }>, showExtraInformation?: { season?: number | null, episode?: number | null } | null, podcastExtraInformation?: { episode?: number | null } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null }>, details: { name: string, createdOn: string, description?: string | null }, results: { details: { nextPage?: number | null, totalItems: number }, items: Array<{ entityId: string, entityLot: EntityLot }> } } } };

export type MetadataGroupDetailsQueryVariables = Exact<{
  metadataGroupId: Scalars['String']['input'];
}>;


export type MetadataGroupDetailsQuery = { metadataGroupDetails: { response: { contents: Array<string>, details: { id: string, lot: MediaLot, title: string, parts: number, source: MediaSource, isPartial?: boolean | null, sourceUrl?: string | null, identifier: string, description?: string | null, assets: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } } } } };

export type MetadataGroupSearchQueryVariables = Exact<{
  input: MetadataGroupSearchInput;
}>;


export type MetadataGroupSearchQuery = { metadataGroupSearch: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type UserMetadataListQueryVariables = Exact<{
  input: UserMetadataListInput;
}>;


export type UserMetadataListQuery = { userMetadataList: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type MetadataSearchQueryVariables = Exact<{
  input: MetadataSearchInput;
}>;


export type MetadataSearchQuery = { metadataSearch: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type PeopleSearchQueryVariables = Exact<{
  input: PeopleSearchInput;
}>;


export type PeopleSearchQuery = { peopleSearch: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type UserMetadataGroupDetailsQueryVariables = Exact<{
  metadataGroupId: Scalars['String']['input'];
}>;


export type UserMetadataGroupDetailsQuery = { userMetadataGroupDetails: { response: { hasInteracted: boolean, averageRating?: string | null, isRecentlyConsumed: boolean, reviews: Array<{ id: string, rating?: string | null, postedOn: string, isSpoiler: boolean, visibility: Visibility, textOriginal?: string | null, textRendered?: string | null, seenItemsAssociatedWith: Array<string>, postedBy: { id: string, name: string }, comments: Array<{ id: string, text: string, likedBy: Array<string>, createdOn: string, user: { id: string, name: string } }>, showExtraInformation?: { season?: number | null, episode?: number | null } | null, podcastExtraInformation?: { episode?: number | null } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null }>, collections: Array<{ id: string, details: { createdOn: string, information?: any | null, collectionId: string, lastUpdatedOn: string, creatorUserId: string, collectionName: string } }> } } };

export type UserPersonDetailsQueryVariables = Exact<{
  personId: Scalars['String']['input'];
}>;


export type UserPersonDetailsQuery = { userPersonDetails: { response: { hasInteracted: boolean, averageRating?: string | null, isRecentlyConsumed: boolean, collections: Array<{ id: string, details: { createdOn: string, information?: any | null, collectionId: string, lastUpdatedOn: string, creatorUserId: string, collectionName: string } }>, reviews: Array<{ id: string, rating?: string | null, postedOn: string, isSpoiler: boolean, visibility: Visibility, textOriginal?: string | null, textRendered?: string | null, seenItemsAssociatedWith: Array<string>, postedBy: { id: string, name: string }, comments: Array<{ id: string, text: string, likedBy: Array<string>, createdOn: string, user: { id: string, name: string } }>, showExtraInformation?: { season?: number | null, episode?: number | null } | null, podcastExtraInformation?: { episode?: number | null } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null }> } } };

export type UserWorkoutDetailsQueryVariables = Exact<{
  workoutId: Scalars['String']['input'];
}>;


export type UserWorkoutDetailsQuery = { userWorkoutDetails: { metadataConsumed: Array<string>, collections: Array<{ id: string, details: { createdOn: string, information?: any | null, collectionId: string, lastUpdatedOn: string, creatorUserId: string, collectionName: string } }>, details: { id: string, name: string, endTime: string, duration: number, startTime: string, templateId?: string | null, repeatedFrom?: string | null, caloriesBurnt?: string | null, summary: { total?: { reps: string, weight: string, distance: string, duration: string, restTime: number, personalBestsAchieved: number } | null, exercises: Array<{ id: string, lot?: ExerciseLot | null, numSets: number, unitSystem: UserUnitSystem, bestSet?: { lot: SetLot, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } } | null }>, focused: { lots: Array<{ lot: ExerciseLot, exercises: Array<number> }>, levels: Array<{ level: ExerciseLevel, exercises: Array<number> }>, forces: Array<{ force: ExerciseForce, exercises: Array<number> }>, muscles: Array<{ muscle: ExerciseMuscle, exercises: Array<number> }>, equipments: Array<{ equipment: ExerciseEquipment, exercises: Array<number> }> } }, information: { comment?: string | null, assets?: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } | null, supersets: Array<{ color: string, exercises: Array<number> }>, exercises: Array<{ id: string, lot: ExerciseLot, notes: Array<string>, unitSystem: UserUnitSystem, total?: { reps: string, weight: string, distance: string, duration: string, restTime: number, personalBestsAchieved: number } | null, assets?: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } | null, sets: Array<{ lot: SetLot, rpe?: number | null, note?: string | null, restTime?: number | null, confirmedAt?: string | null, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } }> }> } } } };

export type UserWorkoutsListQueryVariables = Exact<{
  input: UserTemplatesOrWorkoutsListInput;
}>;


export type UserWorkoutsListQuery = { userWorkoutsList: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type UserWorkoutTemplateDetailsQueryVariables = Exact<{
  workoutTemplateId: Scalars['String']['input'];
}>;


export type UserWorkoutTemplateDetailsQuery = { userWorkoutTemplateDetails: { response: { collections: Array<{ id: string, details: { createdOn: string, information?: any | null, collectionId: string, lastUpdatedOn: string, creatorUserId: string, collectionName: string } }>, details: { id: string, name: string, createdOn: string, summary: { total?: { reps: string, weight: string, distance: string, duration: string, restTime: number, personalBestsAchieved: number } | null, exercises: Array<{ id: string, lot?: ExerciseLot | null, numSets: number, unitSystem: UserUnitSystem, bestSet?: { lot: SetLot, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } } | null }>, focused: { lots: Array<{ lot: ExerciseLot, exercises: Array<number> }>, levels: Array<{ level: ExerciseLevel, exercises: Array<number> }>, forces: Array<{ force: ExerciseForce, exercises: Array<number> }>, muscles: Array<{ muscle: ExerciseMuscle, exercises: Array<number> }>, equipments: Array<{ equipment: ExerciseEquipment, exercises: Array<number> }> } }, information: { comment?: string | null, assets?: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } | null, supersets: Array<{ color: string, exercises: Array<number> }>, exercises: Array<{ id: string, lot: ExerciseLot, notes: Array<string>, unitSystem: UserUnitSystem, total?: { reps: string, weight: string, distance: string, duration: string, restTime: number, personalBestsAchieved: number } | null, assets?: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } | null, sets: Array<{ lot: SetLot, rpe?: number | null, note?: string | null, restTime?: number | null, confirmedAt?: string | null, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } }> }> } } } } };

export type UserWorkoutTemplatesListQueryVariables = Exact<{
  input: UserTemplatesOrWorkoutsListInput;
}>;


export type UserWorkoutTemplatesListQuery = { userWorkoutTemplatesList: { cacheId: string, response: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } } };

export type UserAnalyticsParametersQueryVariables = Exact<{ [key: string]: never; }>;


export type UserAnalyticsParametersQuery = { userAnalyticsParameters: { cacheId: string, response: { endDate?: string | null, startDate?: string | null } } };

export type TrendingMetadataQueryVariables = Exact<{ [key: string]: never; }>;


export type TrendingMetadataQuery = { trendingMetadata: Array<string> };

export type CollectionRecommendationsQueryVariables = Exact<{
  input: CollectionRecommendationsInput;
}>;


export type CollectionRecommendationsQuery = { collectionRecommendations: { items: Array<string>, details: { nextPage?: number | null, totalItems: number } } };

export type MetadataLookupQueryVariables = Exact<{
  title: Scalars['String']['input'];
}>;


export type MetadataLookupQuery = { metadataLookup: { cacheId: string, response: { data: { lot: MediaLot, source: MediaSource, identifier: string }, showInformation?: { season: number, episode: number } | null } | { notFound: boolean } } };

export type SearchDetailsPartFragment = { nextPage?: number | null, totalItems: number };

export type IdAndNamedObjectPartFragment = { id: number, name: string };

export type StringIdAndNamedObjectPartFragment = { id: string, name: string };

export type SeenPodcastExtraInformationPartFragment = { episode: number };

export type SeenShowExtraInformationPartFragment = { episode: number, season: number };

export type SeenAnimeExtraInformationPartFragment = { episode?: number | null };

export type SeenMangaExtraInformationPartFragment = { volume?: number | null, chapter?: string | null };

export type CalendarEventPartFragment = { date: string, metadataId: string, metadataLot: MediaLot, metadataText: string, metadataImage?: string | null, calendarEventId: string, showExtraInformation?: { episode: number, season: number } | null, podcastExtraInformation?: { episode: number } | null, animeExtraInformation?: { episode?: number | null } | null };

export type SeenPartFragment = { id: string, state: SeenState, progress: string, reviewId?: string | null, startedOn?: string | null, finishedOn?: string | null, lastUpdatedOn: string, manualTimeSpent?: string | null, numTimesUpdated: number, providersConsumedOn: Array<string>, showExtraInformation?: { episode: number, season: number } | null, podcastExtraInformation?: { episode: number } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null };

export type WorkoutOrExerciseTotalsPartFragment = { reps: string, weight: string, distance: string, duration: string, restTime: number, personalBestsAchieved: number };

export type EntityAssetsPartFragment = { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> };

export type WorkoutSetStatisticPartFragment = { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null };

export type WorkoutSetRecordPartFragment = { lot: SetLot, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } };

export type WorkoutSummaryPartFragment = { total?: { reps: string, weight: string, distance: string, duration: string, restTime: number, personalBestsAchieved: number } | null, exercises: Array<{ id: string, lot?: ExerciseLot | null, numSets: number, unitSystem: UserUnitSystem, bestSet?: { lot: SetLot, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } } | null }>, focused: { lots: Array<{ lot: ExerciseLot, exercises: Array<number> }>, levels: Array<{ level: ExerciseLevel, exercises: Array<number> }>, forces: Array<{ force: ExerciseForce, exercises: Array<number> }>, muscles: Array<{ muscle: ExerciseMuscle, exercises: Array<number> }>, equipments: Array<{ equipment: ExerciseEquipment, exercises: Array<number> }> } };

export type CollectionToEntityDetailsPartFragment = { id: string, details: { createdOn: string, information?: any | null, collectionId: string, lastUpdatedOn: string, creatorUserId: string, collectionName: string } };

export type ReviewItemPartFragment = { id: string, rating?: string | null, postedOn: string, isSpoiler: boolean, visibility: Visibility, textOriginal?: string | null, textRendered?: string | null, seenItemsAssociatedWith: Array<string>, postedBy: { id: string, name: string }, comments: Array<{ id: string, text: string, likedBy: Array<string>, createdOn: string, user: { id: string, name: string } }>, showExtraInformation?: { season?: number | null, episode?: number | null } | null, podcastExtraInformation?: { episode?: number | null } | null, animeExtraInformation?: { episode?: number | null } | null, mangaExtraInformation?: { volume?: number | null, chapter?: string | null } | null };

export type WorkoutInformationPartFragment = { comment?: string | null, assets?: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } | null, supersets: Array<{ color: string, exercises: Array<number> }>, exercises: Array<{ id: string, lot: ExerciseLot, notes: Array<string>, unitSystem: UserUnitSystem, total?: { reps: string, weight: string, distance: string, duration: string, restTime: number, personalBestsAchieved: number } | null, assets?: { s3Images: Array<string>, s3Videos: Array<string>, remoteImages: Array<string>, remoteVideos: Array<{ url: string, source: EntityRemoteVideoSource }> } | null, sets: Array<{ lot: SetLot, rpe?: number | null, note?: string | null, restTime?: number | null, confirmedAt?: string | null, personalBests?: Array<WorkoutSetPersonalBest> | null, statistic: { reps?: string | null, pace?: string | null, oneRm?: string | null, weight?: string | null, volume?: string | null, duration?: string | null, distance?: string | null } }> }> };

export type SetRestTimersPartFragment = { drop?: number | null, warmup?: number | null, normal?: number | null, failure?: number | null };

export type PersonDetailsGroupedByRolePartFragment = { name: string, items: Array<{ entityId: string, character?: string | null }> };

export type DailyUserActivityItemPartFragment = { day: string, totalCount: number, totalDuration: number, totalBookPages: number, totalReviewCount: number, totalMetadataCount: number, totalShowDuration: number, totalMovieDuration: number, totalMusicDuration: number, totalWorkoutReps: number, totalWorkoutWeight: number, totalWorkoutDistance: number, totalWorkoutRestTime: number, totalWorkoutDuration: number, totalPodcastDuration: number, totalVideoGameDuration: number, totalAudioBookDuration: number, totalVisualNovelDuration: number, totalPersonReviewCount: number, totalMetadataReviewCount: number, totalWorkoutPersonalBests: number, totalCollectionReviewCount: number, totalMetadataGroupReviewCount: number, userMeasurementCount: number, bookCount: number, showCount: number, movieCount: number, musicCount: number, animeCount: number, mangaCount: number, workoutCount: number, podcastCount: number, audioBookCount: number, videoGameCount: number, visualNovelCount: number };

export const SearchDetailsPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<SearchDetailsPartFragment, unknown>;
export const IdAndNamedObjectPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<IdAndNamedObjectPartFragment, unknown>;
export const SeenShowExtraInformationPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenShowExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenShowExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}}]} as unknown as DocumentNode<SeenShowExtraInformationPartFragment, unknown>;
export const SeenPodcastExtraInformationPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenPodcastExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]} as unknown as DocumentNode<SeenPodcastExtraInformationPartFragment, unknown>;
export const SeenAnimeExtraInformationPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]} as unknown as DocumentNode<SeenAnimeExtraInformationPartFragment, unknown>;
export const CalendarEventPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CalendarEventPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCalendarEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}},{"kind":"Field","name":{"kind":"Name","value":"metadataText"}},{"kind":"Field","name":{"kind":"Name","value":"metadataImage"}},{"kind":"Field","name":{"kind":"Name","value":"calendarEventId"}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenShowExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenShowExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenShowExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenPodcastExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]} as unknown as DocumentNode<CalendarEventPartFragment, unknown>;
export const SeenMangaExtraInformationPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}}]} as unknown as DocumentNode<SeenMangaExtraInformationPartFragment, unknown>;
export const SeenPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"reviewId"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"manualTimeSpent"}},{"kind":"Field","name":{"kind":"Name","value":"numTimesUpdated"}},{"kind":"Field","name":{"kind":"Name","value":"providersConsumedOn"}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenShowExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenShowExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenShowExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenPodcastExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}}]} as unknown as DocumentNode<SeenPartFragment, unknown>;
export const WorkoutOrExerciseTotalsPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}}]}}]} as unknown as DocumentNode<WorkoutOrExerciseTotalsPartFragment, unknown>;
export const WorkoutSetStatisticPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}}]}}]} as unknown as DocumentNode<WorkoutSetStatisticPartFragment, unknown>;
export const WorkoutSetRecordPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetRecordPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetRecord"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}}]}}]} as unknown as DocumentNode<WorkoutSetRecordPartFragment, unknown>;
export const WorkoutSummaryPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSummaryPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"numSets"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}},{"kind":"Field","name":{"kind":"Name","value":"bestSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetRecordPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"focused"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lots"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"levels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"forces"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"muscles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"equipments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetRecordPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetRecord"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}}]} as unknown as DocumentNode<WorkoutSummaryPartFragment, unknown>;
export const CollectionToEntityDetailsPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCollectionToEntityDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"information"}},{"kind":"Field","name":{"kind":"Name","value":"collectionId"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"creatorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"collectionName"}}]}}]}}]} as unknown as DocumentNode<CollectionToEntityDetailsPartFragment, unknown>;
export const StringIdAndNamedObjectPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<StringIdAndNamedObjectPartFragment, unknown>;
export const ReviewItemPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"isSpoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"textOriginal"}},{"kind":"Field","name":{"kind":"Name","value":"textRendered"}},{"kind":"Field","name":{"kind":"Name","value":"seenItemsAssociatedWith"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}}]} as unknown as DocumentNode<ReviewItemPartFragment, unknown>;
export const EntityAssetsPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<EntityAssetsPartFragment, unknown>;
export const WorkoutInformationPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"supersets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"notes"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}},{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"rpe"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedAt"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}}]}}]} as unknown as DocumentNode<WorkoutInformationPartFragment, unknown>;
export const SetRestTimersPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SetRestTimersPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SetRestTimersSettings"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"drop"}},{"kind":"Field","name":{"kind":"Name","value":"warmup"}},{"kind":"Field","name":{"kind":"Name","value":"normal"}},{"kind":"Field","name":{"kind":"Name","value":"failure"}}]}}]} as unknown as DocumentNode<SetRestTimersPartFragment, unknown>;
export const PersonDetailsGroupedByRolePartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PersonDetailsGroupedByRolePart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PersonDetailsGroupedByRole"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"character"}}]}}]}}]} as unknown as DocumentNode<PersonDetailsGroupedByRolePartFragment, unknown>;
export const DailyUserActivityItemPartFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DailyUserActivityItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DailyUserActivityItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"day"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalBookPages"}},{"kind":"Field","name":{"kind":"Name","value":"totalReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalShowDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalMovieDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalMusicDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutReps"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutWeight"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutDistance"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutRestTime"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalPodcastDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalVideoGameDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalAudioBookDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalVisualNovelDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalPersonReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutPersonalBests"}},{"kind":"Field","name":{"kind":"Name","value":"totalCollectionReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataGroupReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"userMeasurementCount"}},{"kind":"Field","name":{"kind":"Name","value":"bookCount"}},{"kind":"Field","name":{"kind":"Name","value":"showCount"}},{"kind":"Field","name":{"kind":"Name","value":"movieCount"}},{"kind":"Field","name":{"kind":"Name","value":"musicCount"}},{"kind":"Field","name":{"kind":"Name","value":"animeCount"}},{"kind":"Field","name":{"kind":"Name","value":"mangaCount"}},{"kind":"Field","name":{"kind":"Name","value":"workoutCount"}},{"kind":"Field","name":{"kind":"Name","value":"podcastCount"}},{"kind":"Field","name":{"kind":"Name","value":"audioBookCount"}},{"kind":"Field","name":{"kind":"Name","value":"videoGameCount"}},{"kind":"Field","name":{"kind":"Name","value":"visualNovelCount"}}]}}]} as unknown as DocumentNode<DailyUserActivityItemPartFragment, unknown>;
export const RegisterUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<RegisterUserMutation, RegisterUserMutationVariables>;
export const LoginUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LoginUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AuthUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"loginUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LoginError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApiKeyResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<LoginUserMutation, LoginUserMutationVariables>;
export const LogoutUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LogoutUser"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logoutUser"}}]}}]} as unknown as DocumentNode<LogoutUserMutation, LogoutUserMutationVariables>;
export const DeployAddEntitiesToCollectionJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployAddEntitiesToCollectionJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeCollectionToEntitiesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployAddEntitiesToCollectionJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployAddEntitiesToCollectionJobMutation, DeployAddEntitiesToCollectionJobMutationVariables>;
export const CreateCustomExerciseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCustomExercise"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExerciseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomExercise"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateCustomExerciseMutation, CreateCustomExerciseMutationVariables>;
export const UpdateCustomExerciseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateCustomExercise"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateCustomExerciseInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateCustomExercise"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateCustomExerciseMutation, UpdateCustomExerciseMutationVariables>;
export const CreateCustomMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateCustomMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateCustomMetadataInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createCustomMetadata"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateCustomMetadataMutation, CreateCustomMetadataMutationVariables>;
export const UpdateCustomMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateCustomMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateCustomMetadataInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateCustomMetadata"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateCustomMetadataMutation, UpdateCustomMetadataMutationVariables>;
export const CreateOrUpdateCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrUpdateCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateOrUpdateCollectionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrUpdateCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateOrUpdateCollectionMutation, CreateOrUpdateCollectionMutationVariables>;
export const CreateReviewCommentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateReviewComment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateReviewCommentInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createReviewComment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateReviewCommentMutation, CreateReviewCommentMutationVariables>;
export const CreateUserMeasurementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserMeasurement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMeasurementInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserMeasurement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserMeasurementMutation, CreateUserMeasurementMutationVariables>;
export const CreateUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateUserNotificationPlatformInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateUserNotificationPlatformMutation, CreateUserNotificationPlatformMutationVariables>;
export const CreateOrUpdateUserIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrUpdateUserIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateOrUpdateUserIntegrationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrUpdateUserIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateOrUpdateUserIntegrationMutation, CreateOrUpdateUserIntegrationMutationVariables>;
export const CreateOrUpdateUserWorkoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrUpdateUserWorkout"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserWorkoutInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrUpdateUserWorkout"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateOrUpdateUserWorkoutMutation, CreateOrUpdateUserWorkoutMutationVariables>;
export const CreateOrUpdateUserWorkoutTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrUpdateUserWorkoutTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserWorkoutInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrUpdateUserWorkoutTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<CreateOrUpdateUserWorkoutTemplateMutation, CreateOrUpdateUserWorkoutTemplateMutationVariables>;
export const DeleteCollectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteCollection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteCollection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"collectionName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"collectionName"}}}]}]}}]} as unknown as DocumentNode<DeleteCollectionMutation, DeleteCollectionMutationVariables>;
export const DeleteReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"reviewId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reviewId"}}}]}]}}]} as unknown as DocumentNode<DeleteReviewMutation, DeleteReviewMutationVariables>;
export const DeleteS3ObjectDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteS3Object"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteS3Object"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<DeleteS3ObjectMutation, DeleteS3ObjectMutationVariables>;
export const DeleteSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"seenId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"seenId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteSeenItemMutation, DeleteSeenItemMutationVariables>;
export const DeleteUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"toDeleteUserId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toDeleteUserId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMutation, DeleteUserMutationVariables>;
export const ResetUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResetUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"toResetUserId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resetUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"toResetUserId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"toResetUserId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UserResetResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"passwordChangeUrl"}}]}}]}}]}}]} as unknown as DocumentNode<ResetUserMutation, ResetUserMutationVariables>;
export const DeleteUserIntegrationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserIntegration"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserIntegration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"integrationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"integrationId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserIntegrationMutation, DeleteUserIntegrationMutationVariables>;
export const DeleteUserMeasurementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserMeasurement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DateTime"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserMeasurement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"timestamp"},"value":{"kind":"Variable","name":{"kind":"Name","value":"timestamp"}}}]}]}}]} as unknown as DocumentNode<DeleteUserMeasurementMutation, DeleteUserMeasurementMutationVariables>;
export const DeleteUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"notificationId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"notificationId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserNotificationPlatformMutation, DeleteUserNotificationPlatformMutationVariables>;
export const DeleteUserWorkoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserWorkout"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserWorkout"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"workoutId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserWorkoutMutation, DeleteUserWorkoutMutationVariables>;
export const DeleteUserWorkoutTemplateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteUserWorkoutTemplate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"workoutTemplateId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteUserWorkoutTemplate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"workoutTemplateId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"workoutTemplateId"}}}]}]}}]} as unknown as DocumentNode<DeleteUserWorkoutTemplateMutation, DeleteUserWorkoutTemplateMutationVariables>;
export const DeployBackgroundJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployBackgroundJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"jobName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BackgroundJob"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployBackgroundJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"jobName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"jobName"}}}]}]}}]} as unknown as DocumentNode<DeployBackgroundJobMutation, DeployBackgroundJobMutationVariables>;
export const DeployExportJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployExportJob"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployExportJob"}}]}}]} as unknown as DocumentNode<DeployExportJobMutation, DeployExportJobMutationVariables>;
export const DeployImportJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployImportJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeployImportJobInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployImportJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployImportJobMutation, DeployImportJobMutationVariables>;
export const DeployUpdateMediaEntityJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployUpdateMediaEntityJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"entityId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"entityLot"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EntityLot"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployUpdateMediaEntityJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"entityId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"entityId"}}},{"kind":"Argument","name":{"kind":"Name","value":"entityLot"},"value":{"kind":"Variable","name":{"kind":"Name","value":"entityLot"}}}]}]}}]} as unknown as DocumentNode<DeployUpdateMediaEntityJobMutation, DeployUpdateMediaEntityJobMutationVariables>;
export const UpdateSeenItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateSeenItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateSeenItemInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateSeenItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateSeenItemMutation, UpdateSeenItemMutationVariables>;
export const UpdateUserNotificationPlatformDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUserNotificationPlatform"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserNotificationPlatformInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUserNotificationPlatform"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateUserNotificationPlatformMutation, UpdateUserNotificationPlatformMutationVariables>;
export const UpdateUserWorkoutAttributesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUserWorkoutAttributes"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserWorkoutAttributesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUserWorkoutAttributes"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateUserWorkoutAttributesMutation, UpdateUserWorkoutAttributesMutationVariables>;
export const GenerateAuthTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GenerateAuthToken"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generateAuthToken"}}]}}]} as unknown as DocumentNode<GenerateAuthTokenMutation, GenerateAuthTokenMutationVariables>;
export const MergeMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MergeMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mergeMetadata"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mergeFrom"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}}},{"kind":"Argument","name":{"kind":"Name","value":"mergeInto"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}}}]}]}}]} as unknown as DocumentNode<MergeMetadataMutation, MergeMetadataMutationVariables>;
export const DisassociateMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DisassociateMetadata"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disassociateMetadata"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}]}]}}]} as unknown as DocumentNode<DisassociateMetadataMutation, DisassociateMetadataMutationVariables>;
export const CreateOrUpdateReviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateOrUpdateReview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateOrUpdateReviewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createOrUpdateReview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateOrUpdateReviewMutation, CreateOrUpdateReviewMutationVariables>;
export const PresignedPutS3UrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PresignedPutS3Url"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PresignedPutUrlInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"presignedPutS3Url"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"uploadUrl"}}]}}]}}]} as unknown as DocumentNode<PresignedPutS3UrlMutation, PresignedPutS3UrlMutationVariables>;
export const DeployRemoveEntitiesFromCollectionJobDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployRemoveEntitiesFromCollectionJob"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeCollectionToEntitiesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployRemoveEntitiesFromCollectionJob"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployRemoveEntitiesFromCollectionJobMutation, DeployRemoveEntitiesFromCollectionJobMutationVariables>;
export const ReorderCollectionEntityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ReorderCollectionEntity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ReorderCollectionEntityInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reorderCollectionEntity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<ReorderCollectionEntityMutation, ReorderCollectionEntityMutationVariables>;
export const TestUserNotificationPlatformsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TestUserNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"testUserNotificationPlatforms"}}]}}]} as unknown as DocumentNode<TestUserNotificationPlatformsMutation, TestUserNotificationPlatformsMutationVariables>;
export const UpdateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<UpdateUserMutation, UpdateUserMutationVariables>;
export const UpdateUserPreferenceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUserPreference"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserPreferencesInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUserPreference"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateUserPreferenceMutation, UpdateUserPreferenceMutationVariables>;
export const CreateAccessLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateAccessLink"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateAccessLinkInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createAccessLink"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateAccessLinkMutation, CreateAccessLinkMutationVariables>;
export const ProcessAccessLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ProcessAccessLink"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ProcessAccessLinkInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"processAccessLink"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProcessAccessLinkError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ProcessAccessLinkResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}},{"kind":"Field","name":{"kind":"Name","value":"redirectTo"}},{"kind":"Field","name":{"kind":"Name","value":"tokenValidForDays"}}]}}]}}]}}]} as unknown as DocumentNode<ProcessAccessLinkMutation, ProcessAccessLinkMutationVariables>;
export const RevokeAccessLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RevokeAccessLink"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"accessLinkId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"revokeAccessLink"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"accessLinkId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"accessLinkId"}}}]}]}}]} as unknown as DocumentNode<RevokeAccessLinkMutation, RevokeAccessLinkMutationVariables>;
export const UpdateUserExerciseSettingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateUserExerciseSettings"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateUserExerciseSettings"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateUserExerciseSettings"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<UpdateUserExerciseSettingsMutation, UpdateUserExerciseSettingsMutationVariables>;
export const MergeExerciseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MergeExercise"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mergeExercise"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mergeFrom"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeFrom"}}},{"kind":"Argument","name":{"kind":"Name","value":"mergeInto"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mergeInto"}}}]}]}}]} as unknown as DocumentNode<MergeExerciseMutation, MergeExerciseMutationVariables>;
export const MarkEntityAsPartialDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkEntityAsPartial"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MarkEntityAsPartialInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markEntityAsPartial"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<MarkEntityAsPartialMutation, MarkEntityAsPartialMutationVariables>;
export const ExpireCacheKeyDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ExpireCacheKey"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cacheId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UUID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"expireCacheKey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"cacheId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cacheId"}}}]}]}}]} as unknown as DocumentNode<ExpireCacheKeyMutation, ExpireCacheKeyMutationVariables>;
export const DeployBulkMetadataProgressUpdateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeployBulkMetadataProgressUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataProgressUpdateInput"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deployBulkMetadataProgressUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<DeployBulkMetadataProgressUpdateMutation, DeployBulkMetadataProgressUpdateMutationVariables>;
export const InitiateTwoFactorSetupDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"InitiateTwoFactorSetup"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"initiateTwoFactorSetup"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"secret"}},{"kind":"Field","name":{"kind":"Name","value":"qrCodeUrl"}}]}}]}}]} as unknown as DocumentNode<InitiateTwoFactorSetupMutation, InitiateTwoFactorSetupMutationVariables>;
export const CompleteTwoFactorSetupDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CompleteTwoFactorSetup"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserTwoFactorSetupInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"completeTwoFactorSetup"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"backupCodes"}}]}}]}}]} as unknown as DocumentNode<CompleteTwoFactorSetupMutation, CompleteTwoFactorSetupMutationVariables>;
export const VerifyTwoFactorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VerifyTwoFactor"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserTwoFactorVerifyInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"verifyTwoFactor"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"VerifyTwoFactorError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApiKeyResponse"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"apiKey"}}]}}]}}]}}]} as unknown as DocumentNode<VerifyTwoFactorMutation, VerifyTwoFactorMutationVariables>;
export const DisableTwoFactorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DisableTwoFactor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disableTwoFactor"}}]}}]} as unknown as DocumentNode<DisableTwoFactorMutation, DisableTwoFactorMutationVariables>;
export const RegenerateTwoFactorBackupCodesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegenerateTwoFactorBackupCodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"regenerateTwoFactorBackupCodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"backupCodes"}}]}}]}}]} as unknown as DocumentNode<RegenerateTwoFactorBackupCodesMutation, RegenerateTwoFactorBackupCodesMutationVariables>;
export const GetPasswordChangeSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"GetPasswordChangeSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"GetPasswordChangeSessionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"getPasswordChangeSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"passwordChangeUrl"}}]}}]}}]} as unknown as DocumentNode<GetPasswordChangeSessionMutation, GetPasswordChangeSessionMutationVariables>;
export const SetPasswordViaSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetPasswordViaSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SetPasswordViaSessionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setPasswordViaSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<SetPasswordViaSessionMutation, SetPasswordViaSessionMutationVariables>;
export const CoreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CoreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"coreDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"docsLink"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"websiteUrl"}},{"kind":"Field","name":{"kind":"Name","value":"smtpEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"oidcEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"signupAllowed"}},{"kind":"Field","name":{"kind":"Name","value":"maxFileSizeMb"}},{"kind":"Field","name":{"kind":"Name","value":"repositoryLink"}},{"kind":"Field","name":{"kind":"Name","value":"isDemoInstance"}},{"kind":"Field","name":{"kind":"Name","value":"disableTelemetry"}},{"kind":"Field","name":{"kind":"Name","value":"tokenValidForDays"}},{"kind":"Field","name":{"kind":"Name","value":"localAuthDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"fileStorageEnabled"}},{"kind":"Field","name":{"kind":"Name","value":"peopleSearchSources"}},{"kind":"Field","name":{"kind":"Name","value":"isServerKeyValidated"}},{"kind":"Field","name":{"kind":"Name","value":"twoFactorBackupCodesCount"}},{"kind":"Field","name":{"kind":"Name","value":"metadataGroupSourceLotMappings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}},{"kind":"Field","name":{"kind":"Name","value":"metadataLotSourceMappings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"sources"}}]}},{"kind":"Field","name":{"kind":"Name","value":"providerSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"igdb"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"themes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"platforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"gameModes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"gameTypes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"releaseDateRegions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"IdAndNamedObjectPart"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"metadataProviderLanguages"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"default"}},{"kind":"Field","name":{"kind":"Name","value":"supported"}}]}},{"kind":"Field","name":{"kind":"Name","value":"frontend"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"oidcButtonLabel"}},{"kind":"Field","name":{"kind":"Name","value":"dashboardMessage"}},{"kind":"Field","name":{"kind":"Name","value":"umami"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"scriptUrl"}},{"kind":"Field","name":{"kind":"Name","value":"websiteId"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"exerciseParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lotMapping"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"bests"}}]}},{"kind":"Field","name":{"kind":"Name","value":"filters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"mechanic"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"IdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<CoreDetailsQuery, CoreDetailsQueryVariables>;
export const MetadataDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"isNsfw"}},{"kind":"Field","name":{"kind":"Name","value":"isPartial"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"suggestions"}},{"kind":"Field","name":{"kind":"Name","value":"publishYear"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"providerRating"}},{"kind":"Field","name":{"kind":"Name","value":"createdByUserId"}},{"kind":"Field","name":{"kind":"Name","value":"productionStatus"}},{"kind":"Field","name":{"kind":"Name","value":"originalLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"animeSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"audioBookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"movieSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"runtime"}}]}},{"kind":"Field","name":{"kind":"Name","value":"genres"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"groups"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"part"}}]}},{"kind":"Field","name":{"kind":"Name","value":"watchProviders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"languages"}}]}},{"kind":"Field","name":{"kind":"Name","value":"bookSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pages"}},{"kind":"Field","name":{"kind":"Name","value":"isCompilation"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volumes"}},{"kind":"Field","name":{"kind":"Name","value":"chapters"}}]}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"creators"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isFree"}},{"kind":"Field","name":{"kind":"Name","value":"idOrName"}},{"kind":"Field","name":{"kind":"Name","value":"character"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"thumbnail"}},{"kind":"Field","name":{"kind":"Name","value":"number"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalEpisodes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalSeasons"}},{"kind":"Field","name":{"kind":"Name","value":"totalEpisodes"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"backdropImages"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"overview"}},{"kind":"Field","name":{"kind":"Name","value":"publishDate"}},{"kind":"Field","name":{"kind":"Name","value":"posterImages"}},{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"visualNovelSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"length"}}]}},{"kind":"Field","name":{"kind":"Name","value":"videoGameSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platformReleases"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"releaseRegion"}}]}},{"kind":"Field","name":{"kind":"Name","value":"timeToBeat"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hastily"}},{"kind":"Field","name":{"kind":"Name","value":"normally"}},{"kind":"Field","name":{"kind":"Name","value":"completely"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"musicSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"viewCount"}},{"kind":"Field","name":{"kind":"Name","value":"discNumber"}},{"kind":"Field","name":{"kind":"Name","value":"trackNumber"}},{"kind":"Field","name":{"kind":"Name","value":"byVariousArtists"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<MetadataDetailsQuery, MetadataDetailsQueryVariables>;
export const PersonDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PersonDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"personId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"personDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"personId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"personId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"associatedMetadata"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PersonDetailsGroupedByRolePart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"associatedMetadataGroups"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"PersonDetailsGroupedByRolePart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"place"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"website"}},{"kind":"Field","name":{"kind":"Name","value":"deathDate"}},{"kind":"Field","name":{"kind":"Name","value":"birthDate"}},{"kind":"Field","name":{"kind":"Name","value":"isPartial"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"alternateNames"}},{"kind":"Field","name":{"kind":"Name","value":"associatedEntityCount"}},{"kind":"Field","name":{"kind":"Name","value":"associatedMetadataCount"}},{"kind":"Field","name":{"kind":"Name","value":"associatedMetadataGroupsCount"}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"PersonDetailsGroupedByRolePart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"PersonDetailsGroupedByRole"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"character"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<PersonDetailsQuery, PersonDetailsQueryVariables>;
export const UserAnalyticsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserAnalytics"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserAnalyticsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userAnalytics"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hours"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hour"}},{"kind":"Field","name":{"kind":"Name","value":"entities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityLot"}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"activities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"groupedBy"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalDuration"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DailyUserActivityItemPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"workoutReps"}},{"kind":"Field","name":{"kind":"Name","value":"workoutCount"}},{"kind":"Field","name":{"kind":"Name","value":"workoutWeight"}},{"kind":"Field","name":{"kind":"Name","value":"workoutDistance"}},{"kind":"Field","name":{"kind":"Name","value":"workoutDuration"}},{"kind":"Field","name":{"kind":"Name","value":"workoutRestTime"}},{"kind":"Field","name":{"kind":"Name","value":"measurementCount"}},{"kind":"Field","name":{"kind":"Name","value":"workoutPersonalBests"}},{"kind":"Field","name":{"kind":"Name","value":"workoutCaloriesBurnt"}},{"kind":"Field","name":{"kind":"Name","value":"workoutExercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"exercise"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workoutMuscles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"muscle"}}]}},{"kind":"Field","name":{"kind":"Name","value":"workoutEquipments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DailyUserActivityItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DailyUserActivityItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"day"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalBookPages"}},{"kind":"Field","name":{"kind":"Name","value":"totalReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalShowDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalMovieDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalMusicDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutReps"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutWeight"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutDistance"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutRestTime"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalPodcastDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalVideoGameDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalAudioBookDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalVisualNovelDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalPersonReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutPersonalBests"}},{"kind":"Field","name":{"kind":"Name","value":"totalCollectionReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataGroupReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"userMeasurementCount"}},{"kind":"Field","name":{"kind":"Name","value":"bookCount"}},{"kind":"Field","name":{"kind":"Name","value":"showCount"}},{"kind":"Field","name":{"kind":"Name","value":"movieCount"}},{"kind":"Field","name":{"kind":"Name","value":"musicCount"}},{"kind":"Field","name":{"kind":"Name","value":"animeCount"}},{"kind":"Field","name":{"kind":"Name","value":"mangaCount"}},{"kind":"Field","name":{"kind":"Name","value":"workoutCount"}},{"kind":"Field","name":{"kind":"Name","value":"podcastCount"}},{"kind":"Field","name":{"kind":"Name","value":"audioBookCount"}},{"kind":"Field","name":{"kind":"Name","value":"videoGameCount"}},{"kind":"Field","name":{"kind":"Name","value":"visualNovelCount"}}]}}]} as unknown as DocumentNode<UserAnalyticsQuery, UserAnalyticsQueryVariables>;
export const MinimalUserAnalyticsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MinimalUserAnalytics"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserAnalyticsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userAnalytics"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"DailyUserActivityItemPart"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"DailyUserActivityItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DailyUserActivityItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"day"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalBookPages"}},{"kind":"Field","name":{"kind":"Name","value":"totalReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalShowDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalMovieDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalMusicDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutReps"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutWeight"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutDistance"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutRestTime"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalPodcastDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalVideoGameDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalAudioBookDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalVisualNovelDuration"}},{"kind":"Field","name":{"kind":"Name","value":"totalPersonReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalWorkoutPersonalBests"}},{"kind":"Field","name":{"kind":"Name","value":"totalCollectionReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalMetadataGroupReviewCount"}},{"kind":"Field","name":{"kind":"Name","value":"userMeasurementCount"}},{"kind":"Field","name":{"kind":"Name","value":"bookCount"}},{"kind":"Field","name":{"kind":"Name","value":"showCount"}},{"kind":"Field","name":{"kind":"Name","value":"movieCount"}},{"kind":"Field","name":{"kind":"Name","value":"musicCount"}},{"kind":"Field","name":{"kind":"Name","value":"animeCount"}},{"kind":"Field","name":{"kind":"Name","value":"mangaCount"}},{"kind":"Field","name":{"kind":"Name","value":"workoutCount"}},{"kind":"Field","name":{"kind":"Name","value":"podcastCount"}},{"kind":"Field","name":{"kind":"Name","value":"audioBookCount"}},{"kind":"Field","name":{"kind":"Name","value":"videoGameCount"}},{"kind":"Field","name":{"kind":"Name","value":"visualNovelCount"}}]}}]} as unknown as DocumentNode<MinimalUserAnalyticsQuery, MinimalUserAnalyticsQueryVariables>;
export const UserDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userDetails"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UserDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"isDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"oidcIssuerId"}},{"kind":"Field","name":{"kind":"Name","value":"accessLinkId"}},{"kind":"Field","name":{"kind":"Name","value":"timesTwoFactorBackupCodesUsed"}},{"kind":"Field","name":{"kind":"Name","value":"extraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"scheduledForWorkoutRevision"}}]}},{"kind":"Field","name":{"kind":"Name","value":"preferences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"general"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reviewScale"}},{"kind":"Field","name":{"kind":"Name","value":"gridPacking"}},{"kind":"Field","name":{"kind":"Name","value":"displayNsfw"}},{"kind":"Field","name":{"kind":"Name","value":"landingPath"}},{"kind":"Field","name":{"kind":"Name","value":"listPageSize"}},{"kind":"Field","name":{"kind":"Name","value":"disableVideos"}},{"kind":"Field","name":{"kind":"Name","value":"disableReviews"}},{"kind":"Field","name":{"kind":"Name","value":"disableIntegrations"}},{"kind":"Field","name":{"kind":"Name","value":"disableWatchProviders"}},{"kind":"Field","name":{"kind":"Name","value":"showSpoilersInCalendar"}},{"kind":"Field","name":{"kind":"Name","value":"disableNavigationAnimation"}},{"kind":"Field","name":{"kind":"Name","value":"dashboard"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hidden"}},{"kind":"Field","name":{"kind":"Name","value":"section"}},{"kind":"Field","name":{"kind":"Name","value":"numElements"}},{"kind":"Field","name":{"kind":"Name","value":"deduplicateMedia"}}]}},{"kind":"Field","name":{"kind":"Name","value":"watchProviders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"values"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}},{"kind":"Field","name":{"kind":"Name","value":"setRestTimers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SetRestTimersPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"logging"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"muteSounds"}},{"kind":"Field","name":{"kind":"Name","value":"caloriesBurntUnit"}},{"kind":"Field","name":{"kind":"Name","value":"promptForRestTimer"}},{"kind":"Field","name":{"kind":"Name","value":"startTimerForDurationExercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"measurements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"statistics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"unit"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"featuresEnabled"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"analytics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}}]}},{"kind":"Field","name":{"kind":"Name","value":"others"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"calendar"}},{"kind":"Field","name":{"kind":"Name","value":"collections"}}]}},{"kind":"Field","name":{"kind":"Name","value":"fitness"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"workouts"}},{"kind":"Field","name":{"kind":"Name","value":"templates"}},{"kind":"Field","name":{"kind":"Name","value":"measurements"}}]}},{"kind":"Field","name":{"kind":"Name","value":"media"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"groups"}},{"kind":"Field","name":{"kind":"Name","value":"people"}},{"kind":"Field","name":{"kind":"Name","value":"genres"}},{"kind":"Field","name":{"kind":"Name","value":"specific"}}]}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SetRestTimersPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SetRestTimersSettings"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"drop"}},{"kind":"Field","name":{"kind":"Name","value":"warmup"}},{"kind":"Field","name":{"kind":"Name","value":"normal"}},{"kind":"Field","name":{"kind":"Name","value":"failure"}}]}}]} as unknown as DocumentNode<UserDetailsQuery, UserDetailsQueryVariables>;
export const UserExerciseDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserExerciseDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userExerciseDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"exerciseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"idx"}},{"kind":"Field","name":{"kind":"Name","value":"workoutId"}},{"kind":"Field","name":{"kind":"Name","value":"workoutEndOn"}},{"kind":"Field","name":{"kind":"Name","value":"bestSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetRecordPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseId"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"exerciseNumTimesInteracted"}},{"kind":"Field","name":{"kind":"Name","value":"exerciseExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"settings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"excludeFromAnalytics"}},{"kind":"Field","name":{"kind":"Name","value":"setRestTimers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SetRestTimersPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"lifetimeStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}}]}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setIdx"}},{"kind":"Field","name":{"kind":"Name","value":"workoutId"}},{"kind":"Field","name":{"kind":"Name","value":"exerciseIdx"}}]}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCollectionToEntityDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"information"}},{"kind":"Field","name":{"kind":"Name","value":"collectionId"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"creatorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"collectionName"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"isSpoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"textOriginal"}},{"kind":"Field","name":{"kind":"Name","value":"textRendered"}},{"kind":"Field","name":{"kind":"Name","value":"seenItemsAssociatedWith"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetRecordPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetRecord"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SetRestTimersPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SetRestTimersSettings"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"drop"}},{"kind":"Field","name":{"kind":"Name","value":"warmup"}},{"kind":"Field","name":{"kind":"Name","value":"normal"}},{"kind":"Field","name":{"kind":"Name","value":"failure"}}]}}]} as unknown as DocumentNode<UserExerciseDetailsQuery, UserExerciseDetailsQueryVariables>;
export const UserMeasurementsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMeasurementsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMeasurementsListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMeasurementsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"information"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"statistics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"value"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<UserMeasurementsListQuery, UserMeasurementsListQueryVariables>;
export const UserMetadataDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMetadataDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMetadataDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mediaReason"}},{"kind":"Field","name":{"kind":"Name","value":"hasInteracted"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"seenByAllCount"}},{"kind":"Field","name":{"kind":"Name","value":"seenByUserCount"}},{"kind":"Field","name":{"kind":"Name","value":"isRecentlyConsumed"}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"history"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"nextEntry"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}},{"kind":"Field","name":{"kind":"Name","value":"inProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timesSeen"}},{"kind":"Field","name":{"kind":"Name","value":"seasonNumber"}},{"kind":"Field","name":{"kind":"Name","value":"episodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"timesSeen"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episodeNumber"}},{"kind":"Field","name":{"kind":"Name","value":"timesSeen"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenShowExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenShowExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenPodcastExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"isSpoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"textOriginal"}},{"kind":"Field","name":{"kind":"Name","value":"textRendered"}},{"kind":"Field","name":{"kind":"Name","value":"seenItemsAssociatedWith"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Seen"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"reviewId"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"manualTimeSpent"}},{"kind":"Field","name":{"kind":"Name","value":"numTimesUpdated"}},{"kind":"Field","name":{"kind":"Name","value":"providersConsumedOn"}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenShowExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCollectionToEntityDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"information"}},{"kind":"Field","name":{"kind":"Name","value":"collectionId"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"creatorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"collectionName"}}]}}]}}]} as unknown as DocumentNode<UserMetadataDetailsQuery, UserMetadataDetailsQueryVariables>;
export const GetOidcRedirectUrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOidcRedirectUrl"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"getOidcRedirectUrl"}}]}}]} as unknown as DocumentNode<GetOidcRedirectUrlQuery, GetOidcRedirectUrlQueryVariables>;
export const UserByOidcIssuerIdDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserByOidcIssuerId"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"oidcIssuerId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userByOidcIssuerId"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"oidcIssuerId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"oidcIssuerId"}}}]}]}}]} as unknown as DocumentNode<UserByOidcIssuerIdQuery, UserByOidcIssuerIdQueryVariables>;
export const GetOidcTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetOidcToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"code"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"getOidcToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"code"},"value":{"kind":"Variable","name":{"kind":"Name","value":"code"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"subject"}}]}}]}}]} as unknown as DocumentNode<GetOidcTokenQuery, GetOidcTokenQueryVariables>;
export const GetPresignedS3UrlDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetPresignedS3Url"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"key"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"getPresignedS3Url"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"key"},"value":{"kind":"Variable","name":{"kind":"Name","value":"key"}}}]}]}}]} as unknown as DocumentNode<GetPresignedS3UrlQuery, GetPresignedS3UrlQueryVariables>;
export const UserExportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserExports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userExports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}}]}}]}}]} as unknown as DocumentNode<UserExportsQuery, UserExportsQueryVariables>;
export const UserCollectionsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserCollectionsList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userCollectionsList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"isDefault"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"creator"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"collaborators"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"extraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isHidden"}}]}},{"kind":"Field","name":{"kind":"Name","value":"collaborator"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"informationTemplate"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"required"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"defaultValue"}},{"kind":"Field","name":{"kind":"Name","value":"possibleValues"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserCollectionsListQuery, UserCollectionsListQueryVariables>;
export const UserIntegrationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userIntegrations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"isDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"lastFinishedAt"}},{"kind":"Field","name":{"kind":"Name","value":"maximumProgress"}},{"kind":"Field","name":{"kind":"Name","value":"minimumProgress"}},{"kind":"Field","name":{"kind":"Name","value":"syncToOwnedCollection"}},{"kind":"Field","name":{"kind":"Name","value":"extraSettings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disableOnContinuousErrors"}}]}},{"kind":"Field","name":{"kind":"Name","value":"triggerResult"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"finishedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"providerSpecifics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"plexYankToken"}},{"kind":"Field","name":{"kind":"Name","value":"plexYankBaseUrl"}},{"kind":"Field","name":{"kind":"Name","value":"plexSinkUsername"}},{"kind":"Field","name":{"kind":"Name","value":"audiobookshelfToken"}},{"kind":"Field","name":{"kind":"Name","value":"audiobookshelfBaseUrl"}},{"kind":"Field","name":{"kind":"Name","value":"komgaBaseUrl"}},{"kind":"Field","name":{"kind":"Name","value":"komgaUsername"}},{"kind":"Field","name":{"kind":"Name","value":"komgaPassword"}},{"kind":"Field","name":{"kind":"Name","value":"komgaProvider"}},{"kind":"Field","name":{"kind":"Name","value":"radarrBaseUrl"}},{"kind":"Field","name":{"kind":"Name","value":"radarrApiKey"}},{"kind":"Field","name":{"kind":"Name","value":"radarrProfileId"}},{"kind":"Field","name":{"kind":"Name","value":"radarrRootFolderPath"}},{"kind":"Field","name":{"kind":"Name","value":"radarrSyncCollectionIds"}},{"kind":"Field","name":{"kind":"Name","value":"radarrTagIds"}},{"kind":"Field","name":{"kind":"Name","value":"sonarrProfileId"}},{"kind":"Field","name":{"kind":"Name","value":"sonarrApiKey"}},{"kind":"Field","name":{"kind":"Name","value":"sonarrBaseUrl"}},{"kind":"Field","name":{"kind":"Name","value":"sonarrRootFolderPath"}},{"kind":"Field","name":{"kind":"Name","value":"sonarrSyncCollectionIds"}},{"kind":"Field","name":{"kind":"Name","value":"sonarrTagIds"}},{"kind":"Field","name":{"kind":"Name","value":"jellyfinPushBaseUrl"}},{"kind":"Field","name":{"kind":"Name","value":"jellyfinPushUsername"}},{"kind":"Field","name":{"kind":"Name","value":"jellyfinPushPassword"}},{"kind":"Field","name":{"kind":"Name","value":"youtubeMusicTimezone"}},{"kind":"Field","name":{"kind":"Name","value":"youtubeMusicAuthCookie"}},{"kind":"Field","name":{"kind":"Name","value":"ryotBrowserExtensionDisabledSites"}}]}}]}}]}}]} as unknown as DocumentNode<UserIntegrationsQuery, UserIntegrationsQueryVariables>;
export const UserNotificationPlatformsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userNotificationPlatforms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"isDisabled"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"configuredEvents"}}]}}]}}]} as unknown as DocumentNode<UserNotificationPlatformsQuery, UserNotificationPlatformsQueryVariables>;
export const UsersListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UsersList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"query"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"usersList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"query"},"value":{"kind":"Variable","name":{"kind":"Name","value":"query"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"isDisabled"}}]}}]}}]} as unknown as DocumentNode<UsersListQuery, UsersListQueryVariables>;
export const UserMetadataRecommendationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMetadataRecommendations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMetadataRecommendations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"}}]}}]}}]} as unknown as DocumentNode<UserMetadataRecommendationsQuery, UserMetadataRecommendationsQueryVariables>;
export const UserUpcomingCalendarEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserUpcomingCalendarEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserUpcomingCalendarEventInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userUpcomingCalendarEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CalendarEventPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenShowExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenShowExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenPodcastExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CalendarEventPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCalendarEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}},{"kind":"Field","name":{"kind":"Name","value":"metadataText"}},{"kind":"Field","name":{"kind":"Name","value":"metadataImage"}},{"kind":"Field","name":{"kind":"Name","value":"calendarEventId"}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenShowExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}}]}}]} as unknown as DocumentNode<UserUpcomingCalendarEventsQuery, UserUpcomingCalendarEventsQueryVariables>;
export const UserCalendarEventsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserCalendarEvents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserCalendarEventInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userCalendarEvents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"events"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CalendarEventPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenShowExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenShowExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}},{"kind":"Field","name":{"kind":"Name","value":"season"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenPodcastExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CalendarEventPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCalendarEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"metadataId"}},{"kind":"Field","name":{"kind":"Name","value":"metadataLot"}},{"kind":"Field","name":{"kind":"Name","value":"metadataText"}},{"kind":"Field","name":{"kind":"Name","value":"metadataImage"}},{"kind":"Field","name":{"kind":"Name","value":"calendarEventId"}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenShowExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenPodcastExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}}]}}]} as unknown as DocumentNode<UserCalendarEventsQuery, UserCalendarEventsQueryVariables>;
export const UserMetadataGroupsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMetadataGroupsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMetadataGroupsListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMetadataGroupsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<UserMetadataGroupsListQuery, UserMetadataGroupsListQueryVariables>;
export const UserPeopleListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserPeopleList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserPeopleListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userPeopleList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<UserPeopleListQuery, UserPeopleListQueryVariables>;
export const UserAccessLinksDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserAccessLinks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userAccessLinks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"expiresOn"}},{"kind":"Field","name":{"kind":"Name","value":"timesUsed"}},{"kind":"Field","name":{"kind":"Name","value":"isRevoked"}},{"kind":"Field","name":{"kind":"Name","value":"maximumUses"}},{"kind":"Field","name":{"kind":"Name","value":"isAccountDefault"}},{"kind":"Field","name":{"kind":"Name","value":"isMutationAllowed"}}]}}]}}]} as unknown as DocumentNode<UserAccessLinksQuery, UserAccessLinksQueryVariables>;
export const ExerciseDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ExerciseDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"exerciseDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"exerciseId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"exerciseId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"muscles"}},{"kind":"Field","name":{"kind":"Name","value":"mechanic"}},{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"instructions"}},{"kind":"Field","name":{"kind":"Name","value":"createdByUserId"}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<ExerciseDetailsQuery, ExerciseDetailsQueryVariables>;
export const UserExercisesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserExercisesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserExercisesListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userExercisesList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<UserExercisesListQuery, UserExercisesListQueryVariables>;
export const UserImportReportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserImportReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userImportReports"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"startedOn"}},{"kind":"Field","name":{"kind":"Name","value":"finishedOn"}},{"kind":"Field","name":{"kind":"Name","value":"wasSuccess"}},{"kind":"Field","name":{"kind":"Name","value":"estimatedFinishTime"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"import"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}}]}},{"kind":"Field","name":{"kind":"Name","value":"failedItems"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"step"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserImportReportsQuery, UserImportReportsQueryVariables>;
export const UserGenresListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserGenresList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userGenresList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<UserGenresListQuery, UserGenresListQueryVariables>;
export const GenreDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GenreDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"GenreDetailsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"genreDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"numItems"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<GenreDetailsQuery, GenreDetailsQueryVariables>;
export const CollectionContentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CollectionContents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CollectionContentsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collectionContents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalItems"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"description"}}]}},{"kind":"Field","name":{"kind":"Name","value":"results"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityLot"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"isSpoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"textOriginal"}},{"kind":"Field","name":{"kind":"Name","value":"textRendered"}},{"kind":"Field","name":{"kind":"Name","value":"seenItemsAssociatedWith"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<CollectionContentsQuery, CollectionContentsQueryVariables>;
export const MetadataGroupDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataGroupDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataGroupDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataGroupId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"contents"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"parts"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"isPartial"}},{"kind":"Field","name":{"kind":"Name","value":"sourceUrl"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}}]} as unknown as DocumentNode<MetadataGroupDetailsQuery, MetadataGroupDetailsQueryVariables>;
export const MetadataGroupSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataGroupSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataGroupSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataGroupSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<MetadataGroupSearchQuery, MetadataGroupSearchQueryVariables>;
export const UserMetadataListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMetadataList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserMetadataListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMetadataList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<UserMetadataListQuery, UserMetadataListQueryVariables>;
export const MetadataSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<MetadataSearchQuery, MetadataSearchQueryVariables>;
export const PeopleSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PeopleSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PeopleSearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"peopleSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<PeopleSearchQuery, PeopleSearchQueryVariables>;
export const UserMetadataGroupDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserMetadataGroupDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userMetadataGroupDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"metadataGroupId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"metadataGroupId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasInteracted"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"isRecentlyConsumed"}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"isSpoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"textOriginal"}},{"kind":"Field","name":{"kind":"Name","value":"textRendered"}},{"kind":"Field","name":{"kind":"Name","value":"seenItemsAssociatedWith"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCollectionToEntityDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"information"}},{"kind":"Field","name":{"kind":"Name","value":"collectionId"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"creatorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"collectionName"}}]}}]}}]} as unknown as DocumentNode<UserMetadataGroupDetailsQuery, UserMetadataGroupDetailsQueryVariables>;
export const UserPersonDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserPersonDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"personId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userPersonDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"personId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"personId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasInteracted"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"isRecentlyConsumed"}},{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reviews"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"ReviewItemPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StringIdAndNamedObject"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenAnimeExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SeenMangaExtraInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"chapter"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCollectionToEntityDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"information"}},{"kind":"Field","name":{"kind":"Name","value":"collectionId"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"creatorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"collectionName"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ReviewItemPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ReviewItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"rating"}},{"kind":"Field","name":{"kind":"Name","value":"postedOn"}},{"kind":"Field","name":{"kind":"Name","value":"isSpoiler"}},{"kind":"Field","name":{"kind":"Name","value":"visibility"}},{"kind":"Field","name":{"kind":"Name","value":"textOriginal"}},{"kind":"Field","name":{"kind":"Name","value":"textRendered"}},{"kind":"Field","name":{"kind":"Name","value":"seenItemsAssociatedWith"}},{"kind":"Field","name":{"kind":"Name","value":"postedBy"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"comments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"likedBy"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"StringIdAndNamedObjectPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"showExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"podcastExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"animeExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenAnimeExtraInformationPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"mangaExtraInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeenMangaExtraInformationPart"}}]}}]}}]} as unknown as DocumentNode<UserPersonDetailsQuery, UserPersonDetailsQueryVariables>;
export const UserWorkoutDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserWorkoutDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userWorkoutDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"workoutId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"workoutId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataConsumed"}},{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"endTime"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"startTime"}},{"kind":"Field","name":{"kind":"Name","value":"templateId"}},{"kind":"Field","name":{"kind":"Name","value":"repeatedFrom"}},{"kind":"Field","name":{"kind":"Name","value":"caloriesBurnt"}},{"kind":"Field","name":{"kind":"Name","value":"summary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSummaryPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"information"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutInformationPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetRecordPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetRecord"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCollectionToEntityDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"information"}},{"kind":"Field","name":{"kind":"Name","value":"collectionId"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"creatorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"collectionName"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSummaryPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"numSets"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}},{"kind":"Field","name":{"kind":"Name","value":"bestSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetRecordPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"focused"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lots"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"levels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"forces"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"muscles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"equipments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"supersets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"notes"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}},{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"rpe"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedAt"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserWorkoutDetailsQuery, UserWorkoutDetailsQueryVariables>;
export const UserWorkoutsListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserWorkoutsList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserTemplatesOrWorkoutsListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userWorkoutsList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<UserWorkoutsListQuery, UserWorkoutsListQueryVariables>;
export const UserWorkoutTemplateDetailsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserWorkoutTemplateDetails"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"workoutTemplateId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userWorkoutTemplateDetails"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"workoutTemplateId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"workoutTemplateId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"summary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSummaryPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"information"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutInformationPart"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutOrExerciseTotals"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"personalBestsAchieved"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetStatisticPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetStatistic"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reps"}},{"kind":"Field","name":{"kind":"Name","value":"pace"}},{"kind":"Field","name":{"kind":"Name","value":"oneRm"}},{"kind":"Field","name":{"kind":"Name","value":"weight"}},{"kind":"Field","name":{"kind":"Name","value":"volume"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"distance"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSetRecordPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSetRecord"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EntityAssetsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"EntityAssets"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"s3Images"}},{"kind":"Field","name":{"kind":"Name","value":"s3Videos"}},{"kind":"Field","name":{"kind":"Name","value":"remoteImages"}},{"kind":"Field","name":{"kind":"Name","value":"remoteVideos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"source"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"CollectionToEntityDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"GraphqlCollectionToEntityDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdOn"}},{"kind":"Field","name":{"kind":"Name","value":"information"}},{"kind":"Field","name":{"kind":"Name","value":"collectionId"}},{"kind":"Field","name":{"kind":"Name","value":"lastUpdatedOn"}},{"kind":"Field","name":{"kind":"Name","value":"creatorUserId"}},{"kind":"Field","name":{"kind":"Name","value":"collectionName"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutSummaryPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutSummary"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"numSets"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}},{"kind":"Field","name":{"kind":"Name","value":"bestSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetRecordPart"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"focused"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lots"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"levels"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"level"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"forces"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"force"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"muscles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"muscle"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"equipments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"equipment"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"WorkoutInformationPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorkoutInformation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"comment"}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"supersets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"exercises"}}]}},{"kind":"Field","name":{"kind":"Name","value":"exercises"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"notes"}},{"kind":"Field","name":{"kind":"Name","value":"unitSystem"}},{"kind":"Field","name":{"kind":"Name","value":"total"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutOrExerciseTotalsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"assets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EntityAssetsPart"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"rpe"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"restTime"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedAt"}},{"kind":"Field","name":{"kind":"Name","value":"personalBests"}},{"kind":"Field","name":{"kind":"Name","value":"statistic"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"WorkoutSetStatisticPart"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserWorkoutTemplateDetailsQuery, UserWorkoutTemplateDetailsQueryVariables>;
export const UserWorkoutTemplatesListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserWorkoutTemplatesList"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserTemplatesOrWorkoutsListInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userWorkoutTemplatesList"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<UserWorkoutTemplatesListQuery, UserWorkoutTemplatesListQueryVariables>;
export const UserAnalyticsParametersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserAnalyticsParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userAnalyticsParameters"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}}]}}]}}]}}]} as unknown as DocumentNode<UserAnalyticsParametersQuery, UserAnalyticsParametersQueryVariables>;
export const TrendingMetadataDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TrendingMetadata"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trendingMetadata"}}]}}]} as unknown as DocumentNode<TrendingMetadataQuery, TrendingMetadataQueryVariables>;
export const CollectionRecommendationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CollectionRecommendations"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CollectionRecommendationsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"collectionRecommendations"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"}},{"kind":"Field","name":{"kind":"Name","value":"details"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SearchDetailsPart"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SearchDetailsPart"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"SearchDetails"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"nextPage"}},{"kind":"Field","name":{"kind":"Name","value":"totalItems"}}]}}]} as unknown as DocumentNode<CollectionRecommendationsQuery, CollectionRecommendationsQueryVariables>;
export const MetadataLookupDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MetadataLookup"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"title"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"metadataLookup"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"title"},"value":{"kind":"Variable","name":{"kind":"Name","value":"title"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cacheId"}},{"kind":"Field","name":{"kind":"Name","value":"response"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLookupFoundResult"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"data"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lot"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"identifier"}}]}},{"kind":"Field","name":{"kind":"Name","value":"showInformation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"season"}},{"kind":"Field","name":{"kind":"Name","value":"episode"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MetadataLookupNotFound"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"notFound"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MetadataLookupQuery, MetadataLookupQueryVariables>;