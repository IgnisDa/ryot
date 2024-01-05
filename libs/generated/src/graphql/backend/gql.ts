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
    "mutation AddEntityToCollection($input: ChangeCollectionToEntityInput!) {\n  addEntityToCollection(input: $input)\n}": types.AddEntityToCollectionDocument,
    "mutation CommitMedia($lot: MetadataLot!, $source: MetadataSource!, $identifier: String!) {\n  commitMedia(lot: $lot, source: $source, identifier: $identifier) {\n    id\n  }\n}": types.CommitMediaDocument,
    "mutation CreateCustomExercise($input: ExerciseInput!) {\n  createCustomExercise(input: $input)\n}": types.CreateCustomExerciseDocument,
    "mutation CreateCustomMedia($input: CreateCustomMediaInput!) {\n  createCustomMedia(input: $input) {\n    __typename\n    ... on IdObject {\n      id\n    }\n    ... on CreateCustomMediaError {\n      error\n    }\n  }\n}": types.CreateCustomMediaDocument,
    "mutation CreateMediaReminder($input: CreateMediaReminderInput!) {\n  createMediaReminder(input: $input)\n}": types.CreateMediaReminderDocument,
    "mutation CreateOrUpdateCollection($input: CreateOrUpdateCollectionInput!) {\n  createOrUpdateCollection(input: $input) {\n    id\n  }\n}": types.CreateOrUpdateCollectionDocument,
    "mutation CreateReviewComment($input: CreateReviewCommentInput!) {\n  createReviewComment(input: $input)\n}": types.CreateReviewCommentDocument,
    "mutation CreateUserMeasurement($input: UserMeasurementInput!) {\n  createUserMeasurement(input: $input)\n}": types.CreateUserMeasurementDocument,
    "mutation CreateUserNotificationPlatform($input: CreateUserNotificationPlatformInput!) {\n  createUserNotificationPlatform(input: $input)\n}": types.CreateUserNotificationPlatformDocument,
    "mutation CreateUserSinkIntegration($input: CreateUserSinkIntegrationInput!) {\n  createUserSinkIntegration(input: $input)\n}": types.CreateUserSinkIntegrationDocument,
    "mutation CreateUserWorkout($input: UserWorkoutInput!) {\n  createUserWorkout(input: $input)\n}": types.CreateUserWorkoutDocument,
    "mutation CreateUserYankIntegration($input: CreateUserYankIntegrationInput!) {\n  createUserYankIntegration(input: $input)\n}": types.CreateUserYankIntegrationDocument,
    "mutation DeleteCollection($collectionName: String!) {\n  deleteCollection(collectionName: $collectionName)\n}": types.DeleteCollectionDocument,
    "mutation DeleteMediaReminder($metadataId: Int!) {\n  deleteMediaReminder(metadataId: $metadataId)\n}": types.DeleteMediaReminderDocument,
    "mutation DeleteReview($reviewId: Int!) {\n  deleteReview(reviewId: $reviewId)\n}": types.DeleteReviewDocument,
    "mutation DeleteS3Object($key: String!) {\n  deleteS3Object(key: $key)\n}": types.DeleteS3ObjectDocument,
    "mutation DeleteSeenItem($seenId: Int!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}": types.DeleteSeenItemDocument,
    "mutation DeleteUser($toDeleteUserId: Int!) {\n  deleteUser(toDeleteUserId: $toDeleteUserId)\n}": types.DeleteUserDocument,
    "mutation DeleteUserIntegration($integrationId: Int!, $integrationLot: UserIntegrationLot!) {\n  deleteUserIntegration(\n    integrationId: $integrationId\n    integrationLot: $integrationLot\n  )\n}": types.DeleteUserIntegrationDocument,
    "mutation DeleteUserMeasurement($timestamp: DateTime!) {\n  deleteUserMeasurement(timestamp: $timestamp)\n}": types.DeleteUserMeasurementDocument,
    "mutation DeleteUserNotificationPlatform($notificationId: Int!) {\n  deleteUserNotificationPlatform(notificationId: $notificationId)\n}": types.DeleteUserNotificationPlatformDocument,
    "mutation DeleteUserWorkout($workoutId: String!) {\n  deleteUserWorkout(workoutId: $workoutId)\n}": types.DeleteUserWorkoutDocument,
    "mutation DeployBackgroundJob($jobName: BackgroundJob!) {\n  deployBackgroundJob(jobName: $jobName)\n}": types.DeployBackgroundJobDocument,
    "mutation DeployBulkProgressUpdate($input: [ProgressUpdateInput!]!) {\n  deployBulkProgressUpdate(input: $input)\n}": types.DeployBulkProgressUpdateDocument,
    "mutation DeployExportJob($toExport: [ExportItem!]!) {\n  deployExportJob(toExport: $toExport)\n}": types.DeployExportJobDocument,
    "mutation DeployImportJob($input: DeployImportJobInput!) {\n  deployImportJob(input: $input)\n}": types.DeployImportJobDocument,
    "mutation DeployUpdateMetadataJob($metadataId: Int!) {\n  deployUpdateMetadataJob(metadataId: $metadataId)\n}": types.DeployUpdateMetadataJobDocument,
    "mutation EditSeenItem($input: EditSeenItemInput!) {\n  editSeenItem(input: $input)\n}": types.EditSeenItemDocument,
    "mutation EditUserWorkout($input: EditUserWorkoutInput!) {\n  editUserWorkout(input: $input)\n}": types.EditUserWorkoutDocument,
    "mutation GenerateAuthToken {\n  generateAuthToken\n}": types.GenerateAuthTokenDocument,
    "mutation LoginUser($input: UserInput!) {\n  loginUser(input: $input) {\n    __typename\n    ... on LoginError {\n      error\n    }\n    ... on LoginResponse {\n      apiKey\n      validFor\n    }\n  }\n}": types.LoginUserDocument,
    "mutation MergeMetadata($mergeFrom: Int!, $mergeInto: Int!) {\n  mergeMetadata(mergeFrom: $mergeFrom, mergeInto: $mergeInto)\n}": types.MergeMetadataDocument,
    "mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}": types.PostReviewDocument,
    "mutation PresignedPutS3Url($input: PresignedPutUrlInput!) {\n  presignedPutS3Url(input: $input) {\n    key\n    uploadUrl\n  }\n}": types.PresignedPutS3UrlDocument,
    "mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}": types.RegisterUserDocument,
    "mutation RemoveEntityFromCollection($input: ChangeCollectionToEntityInput!) {\n  removeEntityFromCollection(input: $input) {\n    id\n  }\n}": types.RemoveEntityFromCollectionDocument,
    "mutation TestUserNotificationPlatforms {\n  testUserNotificationPlatforms\n}": types.TestUserNotificationPlatformsDocument,
    "mutation ToggleMediaMonitor($metadataId: Int!) {\n  toggleMediaMonitor(metadataId: $metadataId)\n}": types.ToggleMediaMonitorDocument,
    "mutation ToggleMediaOwnership($metadataId: Int!, $ownedOn: NaiveDate) {\n  toggleMediaOwnership(metadataId: $metadataId, ownedOn: $ownedOn)\n}": types.ToggleMediaOwnershipDocument,
    "mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}": types.UpdateUserDocument,
    "mutation UpdateUserPreference($input: UpdateUserPreferenceInput!) {\n  updateUserPreference(input: $input)\n}": types.UpdateUserPreferenceDocument,
    "query CollectionContents($input: CollectionContentsInput!) {\n  collectionContents(input: $input) {\n    user {\n      name\n    }\n    reviews {\n      ...ReviewItemPart\n    }\n    results {\n      details {\n        total\n        nextPage\n      }\n      items {\n        metadataLot\n        entityLot\n        details {\n          ...MediaSearchItemPart\n        }\n      }\n    }\n    details {\n      name\n      description\n      visibility\n      createdOn\n    }\n  }\n}": types.CollectionContentsDocument,
    "query CoreDetails {\n  coreDetails {\n    version\n    timezone\n    authorName\n    repositoryLink\n    docsLink\n    defaultCredentials\n    credentialsChangeAllowed\n    preferencesChangeAllowed\n    itemDetailsHeight\n    reviewsDisabled\n    videosDisabled\n    upgrade\n    pageLimit\n    deployAdminJobsAllowed\n  }\n}": types.CoreDetailsDocument,
    "query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    fileStorage\n    signupAllowed\n  }\n}": types.CoreEnabledFeaturesDocument,
    "query ExerciseDetails($exerciseId: String!) {\n  exerciseDetails(exerciseId: $exerciseId) {\n    id\n    lot\n    source\n    level\n    force\n    mechanic\n    equipment\n    muscles\n    attributes {\n      instructions\n      images\n    }\n  }\n}": types.ExerciseDetailsDocument,
    "query ExerciseParameters {\n  exerciseParameters {\n    filters {\n      type\n      level\n      force\n      mechanic\n      equipment\n      muscle\n    }\n    downloadRequired\n  }\n}": types.ExerciseParametersDocument,
    "query ExercisesList($input: ExercisesListInput!) {\n  exercisesList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      lot\n      image\n      muscle\n      numTimesInteracted\n      lastUpdatedOn\n    }\n  }\n}": types.ExercisesListDocument,
    "query GenreDetails($input: GenreDetailsInput!) {\n  genreDetails(input: $input) {\n    details {\n      id\n      name\n      numItems\n    }\n    contents {\n      details {\n        total\n        nextPage\n      }\n      items {\n        details {\n          ...MediaSearchItemPart\n        }\n        metadataLot\n      }\n    }\n  }\n}": types.GenreDetailsDocument,
    "query GenresList($input: SearchInput!) {\n  genresList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      numItems\n    }\n  }\n}": types.GenresListDocument,
    "query GetPresignedS3Url($key: String!) {\n  getPresignedS3Url(key: $key)\n}": types.GetPresignedS3UrlDocument,
    "query ImportReports {\n  importReports {\n    id\n    source\n    startedOn\n    finishedOn\n    success\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n        error\n      }\n    }\n  }\n}": types.ImportReportsDocument,
    "query LatestUserSummary {\n  latestUserSummary {\n    calculatedOn\n    fitness {\n      measurementsRecorded\n      exercisesInteractedWith\n      workouts {\n        recorded\n        duration\n        weight\n      }\n    }\n    media {\n      reviewsPosted\n      creatorsInteractedWith\n      mediaInteractedWith\n      manga {\n        chapters\n        read\n      }\n      books {\n        pages\n        read\n      }\n      movies {\n        runtime\n        watched\n      }\n      anime {\n        episodes\n        watched\n      }\n      podcasts {\n        runtime\n        played\n        playedEpisodes\n      }\n      visualNovels {\n        played\n        runtime\n      }\n      videoGames {\n        played\n      }\n      shows {\n        runtime\n        watchedEpisodes\n        watchedSeasons\n        watched\n      }\n      audioBooks {\n        runtime\n        played\n      }\n    }\n  }\n}": types.LatestUserSummaryDocument,
    "query MediaAdditionalDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    lot\n    creators {\n      name\n      items {\n        id\n        name\n        image\n        character\n      }\n    }\n    assets {\n      images\n      videos {\n        videoId\n        source\n      }\n    }\n    suggestions {\n      ...PartialMetadataPart\n    }\n    animeSpecifics {\n      episodes\n    }\n    audioBookSpecifics {\n      runtime\n    }\n    bookSpecifics {\n      pages\n    }\n    movieSpecifics {\n      runtime\n    }\n    mangaSpecifics {\n      volumes\n      chapters\n    }\n    podcastSpecifics {\n      episodes {\n        title\n        overview\n        thumbnail\n        number\n        runtime\n        publishDate\n      }\n      totalEpisodes\n    }\n    showSpecifics {\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n          runtime\n        }\n      }\n    }\n    visualNovelSpecifics {\n      length\n    }\n    videoGameSpecifics {\n      platforms\n    }\n  }\n}": types.MediaAdditionalDetailsDocument,
    "query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      averageRating\n      data {\n        ...MediaSearchItemPart\n      }\n    }\n  }\n}": types.MediaListDocument,
    "query MediaMainDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    lot\n    source\n    isNsfw\n    sourceUrl\n    identifier\n    description\n    publishYear\n    publishDate\n    providerRating\n    productionStatus\n    originalLanguage\n    genres {\n      id\n      name\n    }\n    group {\n      id\n      name\n      part\n    }\n  }\n}": types.MediaMainDetailsDocument,
    "query MediaSearch($lot: MetadataLot!, $source: MetadataSource!, $input: SearchInput!) {\n  mediaSearch(lot: $lot, source: $source, input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      databaseId\n      hasInteracted\n      item {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}": types.MediaSearchDocument,
    "query MediaSourcesForLot($lot: MetadataLot!) {\n  mediaSourcesForLot(lot: $lot)\n}": types.MediaSourcesForLotDocument,
    "query MetadataGroupDetails($metadataGroupId: Int!) {\n  metadataGroupDetails(metadataGroupId: $metadataGroupId) {\n    details {\n      id\n      title\n      lot\n      source\n      displayImages\n      parts\n    }\n    sourceUrl\n    contents {\n      ...PartialMetadataPart\n    }\n  }\n}": types.MetadataGroupDetailsDocument,
    "query MetadataGroupsList($input: SearchInput!) {\n  metadataGroupsList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      title\n      lot\n      parts\n      image\n    }\n  }\n}": types.MetadataGroupsListDocument,
    "query PersonDetails($personId: Int!) {\n  personDetails(personId: $personId) {\n    sourceUrl\n    details {\n      id\n      name\n      source\n      description\n      birthDate\n      deathDate\n      place\n      website\n      gender\n      displayImages\n    }\n    contents {\n      name\n      items {\n        id\n        title\n        image\n      }\n    }\n  }\n}": types.PersonDetailsDocument,
    "query PeopleList($input: PeopleListInput!) {\n  peopleList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      image\n      mediaCount\n    }\n  }\n}": types.PeopleListDocument,
    "query ProvidersLanguageInformation {\n  providersLanguageInformation {\n    supported\n    default\n    source\n  }\n}": types.ProvidersLanguageInformationDocument,
    "query PublicCollectionsList($input: SearchInput!) {\n  publicCollectionsList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      username\n    }\n  }\n}": types.PublicCollectionsListDocument,
    "query Review($reviewId: Int!) {\n  review(reviewId: $reviewId) {\n    rating\n    text\n    visibility\n    spoiler\n    showSeason\n    showEpisode\n    podcastEpisode\n  }\n}": types.ReviewDocument,
    "query UserCalendarEvents($input: UserCalendarEventInput!) {\n  userCalendarEvents(input: $input) {\n    date\n    events {\n      ...CalendarEventPart\n    }\n  }\n}": types.UserCalendarEventsDocument,
    "query UserCollectionsList($name: String) {\n  userCollectionsList(name: $name) {\n    id\n    name\n    description\n    visibility\n    numItems\n  }\n}": types.UserCollectionsListDocument,
    "query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n      lot\n    }\n  }\n}": types.UserDetailsDocument,
    "query UserExerciseDetails($input: UserExerciseDetailsInput!) {\n  userExerciseDetails(input: $input) {\n    collections {\n      ...CollectionPart\n    }\n    history {\n      workoutId\n      workoutName\n      workoutTime\n      index\n      sets {\n        lot\n        statistic {\n          ...WorkoutSetStatisticPart\n        }\n      }\n    }\n    details {\n      exerciseId\n      numTimesInteracted\n      lastUpdatedOn\n      exerciseExtraInformation {\n        lifetimeStats {\n          weight\n          reps\n          distance\n          duration\n          personalBestsAchieved\n        }\n        personalBests {\n          lot\n          sets {\n            workoutId\n            workoutDoneOn\n            exerciseIdx\n            setIdx\n            data {\n              statistic {\n                ...WorkoutSetStatisticPart\n              }\n              lot\n            }\n          }\n        }\n      }\n    }\n  }\n}": types.UserExerciseDetailsDocument,
    "query UserExports {\n  userExports {\n    startedAt\n    endedAt\n    url\n    exported\n  }\n}": types.UserExportsDocument,
    "query UserIntegrations {\n  userIntegrations {\n    id\n    lot\n    description\n    timestamp\n    slug\n  }\n}": types.UserIntegrationsDocument,
    "query UserMeasurementsList($input: UserMeasurementsListInput!) {\n  userMeasurementsList(input: $input) {\n    timestamp\n    name\n    comment\n    stats {\n      weight\n      bodyMassIndex\n      totalBodyWater\n      muscle\n      leanBodyMass\n      bodyFat\n      boneMass\n      visceralFat\n      waistCircumference\n      waistToHeightRatio\n      hipCircumference\n      waistToHipRatio\n      chestCircumference\n      thighCircumference\n      bicepsCircumference\n      neckCircumference\n      bodyFatCaliper\n      chestSkinfold\n      abdominalSkinfold\n      thighSkinfold\n      basalMetabolicRate\n      totalDailyEnergyExpenditure\n      calories\n      custom\n    }\n  }\n}": types.UserMeasurementsListDocument,
    "query UserMediaDetails($metadataId: Int!) {\n  userMediaDetails(metadataId: $metadataId) {\n    collections {\n      ...CollectionPart\n    }\n    inProgress {\n      ...SeenPart\n    }\n    history {\n      ...SeenPart\n    }\n    averageRating\n    reviews {\n      ...ReviewItemPart\n    }\n    reminder {\n      remindOn\n      message\n    }\n    ownership {\n      markedOn\n      ownedOn\n    }\n    isMonitored\n    seenBy\n    nextEpisode {\n      seasonNumber\n      episodeNumber\n    }\n  }\n}": types.UserMediaDetailsDocument,
    "query UserMetadataGroupDetails($metadataGroupId: Int!) {\n  userMetadataGroupDetails(metadataGroupId: $metadataGroupId) {\n    reviews {\n      ...ReviewItemPart\n    }\n    collections {\n      ...CollectionPart\n    }\n  }\n}": types.UserMetadataGroupDetailsDocument,
    "query UserNotificationPlatforms {\n  userNotificationPlatforms {\n    id\n    description\n    timestamp\n  }\n}": types.UserNotificationPlatformsDocument,
    "query UserPersonDetails($personId: Int!) {\n  userPersonDetails(personId: $personId) {\n    collections {\n      ...CollectionPart\n    }\n    reviews {\n      ...ReviewItemPart\n    }\n  }\n}": types.UserPersonDetailsDocument,
    "query UserPreferences {\n  userPreferences {\n    general {\n      reviewScale\n      displayNsfw\n      disableYankIntegrations\n      dashboard {\n        section\n        hidden\n        numElements\n      }\n    }\n    fitness {\n      measurements {\n        custom {\n          name\n          dataType\n        }\n        inbuilt {\n          weight\n          bodyMassIndex\n          totalBodyWater\n          muscle\n          leanBodyMass\n          bodyFat\n          boneMass\n          visceralFat\n          waistCircumference\n          waistToHeightRatio\n          hipCircumference\n          waistToHipRatio\n          chestCircumference\n          thighCircumference\n          bicepsCircumference\n          neckCircumference\n          bodyFatCaliper\n          chestSkinfold\n          abdominalSkinfold\n          thighSkinfold\n          basalMetabolicRate\n          totalDailyEnergyExpenditure\n          calories\n        }\n      }\n      exercises {\n        saveHistory\n        defaultTimer\n        unitSystem\n      }\n    }\n    notifications {\n      episodeReleased\n      episodeNameChanged\n      episodeImagesChanged\n      statusChanged\n      releaseDateChanged\n      numberOfSeasonsChanged\n      numberOfChaptersOrEpisodesChanged\n      newReviewPosted\n    }\n    featuresEnabled {\n      fitness {\n        enabled\n        workouts\n        measurements\n      }\n      media {\n        enabled\n        anime\n        audioBook\n        book\n        manga\n        movie\n        podcast\n        show\n        videoGame\n        visualNovel\n      }\n    }\n  }\n}": types.UserPreferencesDocument,
    "query UserUpcomingCalendarEvents($input: UserUpcomingCalendarEventInput!) {\n  userUpcomingCalendarEvents(input: $input) {\n    ...CalendarEventPart\n  }\n}": types.UserUpcomingCalendarEventsDocument,
    "query UserWorkoutList($input: SearchInput!) {\n  userWorkoutList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      startTime\n      endTime\n      summary {\n        ...WorkoutSummaryPart\n      }\n    }\n  }\n}": types.UserWorkoutListDocument,
    "query UsersList {\n  usersList {\n    id\n    name\n    lot\n  }\n}": types.UsersListDocument,
    "query WorkoutDetails($workoutId: String!) {\n  workoutDetails(workoutId: $workoutId) {\n    id\n    name\n    comment\n    startTime\n    endTime\n    summary {\n      ...WorkoutSummaryPart\n    }\n    information {\n      assets {\n        ...EntityAssetsPart\n      }\n      exercises {\n        name\n        lot\n        notes\n        restTime\n        total {\n          ...WorkoutOrExerciseTotalsPart\n        }\n        supersetWith\n        assets {\n          ...EntityAssetsPart\n        }\n        sets {\n          statistic {\n            ...WorkoutSetStatisticPart\n          }\n          lot\n          personalBests\n          confirmedAt\n        }\n      }\n    }\n  }\n}": types.WorkoutDetailsDocument,
    "fragment CalendarEventPart on GraphqlCalendarEvent {\n  calendarEventId\n  metadataId\n  metadataTitle\n  metadataLot\n  metadataImage\n  date\n  showSeasonNumber\n  showEpisodeNumber\n  podcastEpisodeNumber\n}\n\nfragment SeenPart on Seen {\n  id\n  progress\n  state\n  startedOn\n  finishedOn\n  lastUpdatedOn\n  numTimesUpdated\n  showInformation {\n    episode\n    season\n  }\n  podcastInformation {\n    episode\n  }\n}\n\nfragment MediaSearchItemPart on MediaSearchItem {\n  identifier\n  title\n  image\n  publishYear\n}\n\nfragment PartialMetadataPart on PartialMetadata {\n  id\n  lot\n  source\n  identifier\n  title\n  image\n}\n\nfragment WorkoutOrExerciseTotalsPart on WorkoutOrExerciseTotals {\n  personalBestsAchieved\n  weight\n  reps\n  distance\n  duration\n  restTime\n}\n\nfragment EntityAssetsPart on EntityAssets {\n  images\n  videos\n}\n\nfragment WorkoutSetStatisticPart on WorkoutSetStatistic {\n  duration\n  distance\n  reps\n  weight\n  oneRm\n  pace\n  volume\n}\n\nfragment WorkoutSummaryPart on WorkoutSummary {\n  total {\n    ...WorkoutOrExerciseTotalsPart\n  }\n  exercises {\n    numSets\n    id\n    lot\n    bestSet {\n      statistic {\n        ...WorkoutSetStatisticPart\n      }\n      lot\n      personalBests\n    }\n  }\n}\n\nfragment CollectionPart on Collection {\n  id\n  name\n}\n\nfragment ReviewItemPart on ReviewItem {\n  id\n  rating\n  text\n  spoiler\n  visibility\n  showSeason\n  showEpisode\n  podcastEpisode\n  postedOn\n  postedBy {\n    id\n    name\n  }\n  comments {\n    id\n    text\n    createdOn\n    user {\n      id\n      name\n    }\n    likedBy\n  }\n}": types.CalendarEventPartFragmentDoc,
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
export function graphql(source: "mutation AddEntityToCollection($input: ChangeCollectionToEntityInput!) {\n  addEntityToCollection(input: $input)\n}"): (typeof documents)["mutation AddEntityToCollection($input: ChangeCollectionToEntityInput!) {\n  addEntityToCollection(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CommitMedia($lot: MetadataLot!, $source: MetadataSource!, $identifier: String!) {\n  commitMedia(lot: $lot, source: $source, identifier: $identifier) {\n    id\n  }\n}"): (typeof documents)["mutation CommitMedia($lot: MetadataLot!, $source: MetadataSource!, $identifier: String!) {\n  commitMedia(lot: $lot, source: $source, identifier: $identifier) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateCustomExercise($input: ExerciseInput!) {\n  createCustomExercise(input: $input)\n}"): (typeof documents)["mutation CreateCustomExercise($input: ExerciseInput!) {\n  createCustomExercise(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateCustomMedia($input: CreateCustomMediaInput!) {\n  createCustomMedia(input: $input) {\n    __typename\n    ... on IdObject {\n      id\n    }\n    ... on CreateCustomMediaError {\n      error\n    }\n  }\n}"): (typeof documents)["mutation CreateCustomMedia($input: CreateCustomMediaInput!) {\n  createCustomMedia(input: $input) {\n    __typename\n    ... on IdObject {\n      id\n    }\n    ... on CreateCustomMediaError {\n      error\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateMediaReminder($input: CreateMediaReminderInput!) {\n  createMediaReminder(input: $input)\n}"): (typeof documents)["mutation CreateMediaReminder($input: CreateMediaReminderInput!) {\n  createMediaReminder(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateOrUpdateCollection($input: CreateOrUpdateCollectionInput!) {\n  createOrUpdateCollection(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation CreateOrUpdateCollection($input: CreateOrUpdateCollectionInput!) {\n  createOrUpdateCollection(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateReviewComment($input: CreateReviewCommentInput!) {\n  createReviewComment(input: $input)\n}"): (typeof documents)["mutation CreateReviewComment($input: CreateReviewCommentInput!) {\n  createReviewComment(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateUserMeasurement($input: UserMeasurementInput!) {\n  createUserMeasurement(input: $input)\n}"): (typeof documents)["mutation CreateUserMeasurement($input: UserMeasurementInput!) {\n  createUserMeasurement(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateUserNotificationPlatform($input: CreateUserNotificationPlatformInput!) {\n  createUserNotificationPlatform(input: $input)\n}"): (typeof documents)["mutation CreateUserNotificationPlatform($input: CreateUserNotificationPlatformInput!) {\n  createUserNotificationPlatform(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateUserSinkIntegration($input: CreateUserSinkIntegrationInput!) {\n  createUserSinkIntegration(input: $input)\n}"): (typeof documents)["mutation CreateUserSinkIntegration($input: CreateUserSinkIntegrationInput!) {\n  createUserSinkIntegration(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation CreateUserWorkout($input: UserWorkoutInput!) {\n  createUserWorkout(input: $input)\n}"): (typeof documents)["mutation CreateUserWorkout($input: UserWorkoutInput!) {\n  createUserWorkout(input: $input)\n}"];
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
export function graphql(source: "mutation DeleteMediaReminder($metadataId: Int!) {\n  deleteMediaReminder(metadataId: $metadataId)\n}"): (typeof documents)["mutation DeleteMediaReminder($metadataId: Int!) {\n  deleteMediaReminder(metadataId: $metadataId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteReview($reviewId: Int!) {\n  deleteReview(reviewId: $reviewId)\n}"): (typeof documents)["mutation DeleteReview($reviewId: Int!) {\n  deleteReview(reviewId: $reviewId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteS3Object($key: String!) {\n  deleteS3Object(key: $key)\n}"): (typeof documents)["mutation DeleteS3Object($key: String!) {\n  deleteS3Object(key: $key)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteSeenItem($seenId: Int!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}"): (typeof documents)["mutation DeleteSeenItem($seenId: Int!) {\n  deleteSeenItem(seenId: $seenId) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteUser($toDeleteUserId: Int!) {\n  deleteUser(toDeleteUserId: $toDeleteUserId)\n}"): (typeof documents)["mutation DeleteUser($toDeleteUserId: Int!) {\n  deleteUser(toDeleteUserId: $toDeleteUserId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteUserIntegration($integrationId: Int!, $integrationLot: UserIntegrationLot!) {\n  deleteUserIntegration(\n    integrationId: $integrationId\n    integrationLot: $integrationLot\n  )\n}"): (typeof documents)["mutation DeleteUserIntegration($integrationId: Int!, $integrationLot: UserIntegrationLot!) {\n  deleteUserIntegration(\n    integrationId: $integrationId\n    integrationLot: $integrationLot\n  )\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteUserMeasurement($timestamp: DateTime!) {\n  deleteUserMeasurement(timestamp: $timestamp)\n}"): (typeof documents)["mutation DeleteUserMeasurement($timestamp: DateTime!) {\n  deleteUserMeasurement(timestamp: $timestamp)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteUserNotificationPlatform($notificationId: Int!) {\n  deleteUserNotificationPlatform(notificationId: $notificationId)\n}"): (typeof documents)["mutation DeleteUserNotificationPlatform($notificationId: Int!) {\n  deleteUserNotificationPlatform(notificationId: $notificationId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeleteUserWorkout($workoutId: String!) {\n  deleteUserWorkout(workoutId: $workoutId)\n}"): (typeof documents)["mutation DeleteUserWorkout($workoutId: String!) {\n  deleteUserWorkout(workoutId: $workoutId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployBackgroundJob($jobName: BackgroundJob!) {\n  deployBackgroundJob(jobName: $jobName)\n}"): (typeof documents)["mutation DeployBackgroundJob($jobName: BackgroundJob!) {\n  deployBackgroundJob(jobName: $jobName)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployBulkProgressUpdate($input: [ProgressUpdateInput!]!) {\n  deployBulkProgressUpdate(input: $input)\n}"): (typeof documents)["mutation DeployBulkProgressUpdate($input: [ProgressUpdateInput!]!) {\n  deployBulkProgressUpdate(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployExportJob($toExport: [ExportItem!]!) {\n  deployExportJob(toExport: $toExport)\n}"): (typeof documents)["mutation DeployExportJob($toExport: [ExportItem!]!) {\n  deployExportJob(toExport: $toExport)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployImportJob($input: DeployImportJobInput!) {\n  deployImportJob(input: $input)\n}"): (typeof documents)["mutation DeployImportJob($input: DeployImportJobInput!) {\n  deployImportJob(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation DeployUpdateMetadataJob($metadataId: Int!) {\n  deployUpdateMetadataJob(metadataId: $metadataId)\n}"): (typeof documents)["mutation DeployUpdateMetadataJob($metadataId: Int!) {\n  deployUpdateMetadataJob(metadataId: $metadataId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation EditSeenItem($input: EditSeenItemInput!) {\n  editSeenItem(input: $input)\n}"): (typeof documents)["mutation EditSeenItem($input: EditSeenItemInput!) {\n  editSeenItem(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation EditUserWorkout($input: EditUserWorkoutInput!) {\n  editUserWorkout(input: $input)\n}"): (typeof documents)["mutation EditUserWorkout($input: EditUserWorkoutInput!) {\n  editUserWorkout(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation GenerateAuthToken {\n  generateAuthToken\n}"): (typeof documents)["mutation GenerateAuthToken {\n  generateAuthToken\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation LoginUser($input: UserInput!) {\n  loginUser(input: $input) {\n    __typename\n    ... on LoginError {\n      error\n    }\n    ... on LoginResponse {\n      apiKey\n      validFor\n    }\n  }\n}"): (typeof documents)["mutation LoginUser($input: UserInput!) {\n  loginUser(input: $input) {\n    __typename\n    ... on LoginError {\n      error\n    }\n    ... on LoginResponse {\n      apiKey\n      validFor\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation MergeMetadata($mergeFrom: Int!, $mergeInto: Int!) {\n  mergeMetadata(mergeFrom: $mergeFrom, mergeInto: $mergeInto)\n}"): (typeof documents)["mutation MergeMetadata($mergeFrom: Int!, $mergeInto: Int!) {\n  mergeMetadata(mergeFrom: $mergeFrom, mergeInto: $mergeInto)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation PostReview($input: PostReviewInput!) {\n  postReview(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation PresignedPutS3Url($input: PresignedPutUrlInput!) {\n  presignedPutS3Url(input: $input) {\n    key\n    uploadUrl\n  }\n}"): (typeof documents)["mutation PresignedPutS3Url($input: PresignedPutUrlInput!) {\n  presignedPutS3Url(input: $input) {\n    key\n    uploadUrl\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}"): (typeof documents)["mutation RegisterUser($input: UserInput!) {\n  registerUser(input: $input) {\n    __typename\n    ... on RegisterError {\n      error\n    }\n    ... on IdObject {\n      id\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation RemoveEntityFromCollection($input: ChangeCollectionToEntityInput!) {\n  removeEntityFromCollection(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation RemoveEntityFromCollection($input: ChangeCollectionToEntityInput!) {\n  removeEntityFromCollection(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation TestUserNotificationPlatforms {\n  testUserNotificationPlatforms\n}"): (typeof documents)["mutation TestUserNotificationPlatforms {\n  testUserNotificationPlatforms\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ToggleMediaMonitor($metadataId: Int!) {\n  toggleMediaMonitor(metadataId: $metadataId)\n}"): (typeof documents)["mutation ToggleMediaMonitor($metadataId: Int!) {\n  toggleMediaMonitor(metadataId: $metadataId)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation ToggleMediaOwnership($metadataId: Int!, $ownedOn: NaiveDate) {\n  toggleMediaOwnership(metadataId: $metadataId, ownedOn: $ownedOn)\n}"): (typeof documents)["mutation ToggleMediaOwnership($metadataId: Int!, $ownedOn: NaiveDate) {\n  toggleMediaOwnership(metadataId: $metadataId, ownedOn: $ownedOn)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}"): (typeof documents)["mutation UpdateUser($input: UpdateUserInput!) {\n  updateUser(input: $input) {\n    id\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateUserPreference($input: UpdateUserPreferenceInput!) {\n  updateUserPreference(input: $input)\n}"): (typeof documents)["mutation UpdateUserPreference($input: UpdateUserPreferenceInput!) {\n  updateUserPreference(input: $input)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CollectionContents($input: CollectionContentsInput!) {\n  collectionContents(input: $input) {\n    user {\n      name\n    }\n    reviews {\n      ...ReviewItemPart\n    }\n    results {\n      details {\n        total\n        nextPage\n      }\n      items {\n        metadataLot\n        entityLot\n        details {\n          ...MediaSearchItemPart\n        }\n      }\n    }\n    details {\n      name\n      description\n      visibility\n      createdOn\n    }\n  }\n}"): (typeof documents)["query CollectionContents($input: CollectionContentsInput!) {\n  collectionContents(input: $input) {\n    user {\n      name\n    }\n    reviews {\n      ...ReviewItemPart\n    }\n    results {\n      details {\n        total\n        nextPage\n      }\n      items {\n        metadataLot\n        entityLot\n        details {\n          ...MediaSearchItemPart\n        }\n      }\n    }\n    details {\n      name\n      description\n      visibility\n      createdOn\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CoreDetails {\n  coreDetails {\n    version\n    timezone\n    authorName\n    repositoryLink\n    docsLink\n    defaultCredentials\n    credentialsChangeAllowed\n    preferencesChangeAllowed\n    itemDetailsHeight\n    reviewsDisabled\n    videosDisabled\n    upgrade\n    pageLimit\n    deployAdminJobsAllowed\n  }\n}"): (typeof documents)["query CoreDetails {\n  coreDetails {\n    version\n    timezone\n    authorName\n    repositoryLink\n    docsLink\n    defaultCredentials\n    credentialsChangeAllowed\n    preferencesChangeAllowed\n    itemDetailsHeight\n    reviewsDisabled\n    videosDisabled\n    upgrade\n    pageLimit\n    deployAdminJobsAllowed\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    fileStorage\n    signupAllowed\n  }\n}"): (typeof documents)["query CoreEnabledFeatures {\n  coreEnabledFeatures {\n    fileStorage\n    signupAllowed\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ExerciseDetails($exerciseId: String!) {\n  exerciseDetails(exerciseId: $exerciseId) {\n    id\n    lot\n    source\n    level\n    force\n    mechanic\n    equipment\n    muscles\n    attributes {\n      instructions\n      images\n    }\n  }\n}"): (typeof documents)["query ExerciseDetails($exerciseId: String!) {\n  exerciseDetails(exerciseId: $exerciseId) {\n    id\n    lot\n    source\n    level\n    force\n    mechanic\n    equipment\n    muscles\n    attributes {\n      instructions\n      images\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ExerciseParameters {\n  exerciseParameters {\n    filters {\n      type\n      level\n      force\n      mechanic\n      equipment\n      muscle\n    }\n    downloadRequired\n  }\n}"): (typeof documents)["query ExerciseParameters {\n  exerciseParameters {\n    filters {\n      type\n      level\n      force\n      mechanic\n      equipment\n      muscle\n    }\n    downloadRequired\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ExercisesList($input: ExercisesListInput!) {\n  exercisesList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      lot\n      image\n      muscle\n      numTimesInteracted\n      lastUpdatedOn\n    }\n  }\n}"): (typeof documents)["query ExercisesList($input: ExercisesListInput!) {\n  exercisesList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      lot\n      image\n      muscle\n      numTimesInteracted\n      lastUpdatedOn\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GenreDetails($input: GenreDetailsInput!) {\n  genreDetails(input: $input) {\n    details {\n      id\n      name\n      numItems\n    }\n    contents {\n      details {\n        total\n        nextPage\n      }\n      items {\n        details {\n          ...MediaSearchItemPart\n        }\n        metadataLot\n      }\n    }\n  }\n}"): (typeof documents)["query GenreDetails($input: GenreDetailsInput!) {\n  genreDetails(input: $input) {\n    details {\n      id\n      name\n      numItems\n    }\n    contents {\n      details {\n        total\n        nextPage\n      }\n      items {\n        details {\n          ...MediaSearchItemPart\n        }\n        metadataLot\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GenresList($input: SearchInput!) {\n  genresList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      numItems\n    }\n  }\n}"): (typeof documents)["query GenresList($input: SearchInput!) {\n  genresList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      numItems\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query GetPresignedS3Url($key: String!) {\n  getPresignedS3Url(key: $key)\n}"): (typeof documents)["query GetPresignedS3Url($key: String!) {\n  getPresignedS3Url(key: $key)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ImportReports {\n  importReports {\n    id\n    source\n    startedOn\n    finishedOn\n    success\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n        error\n      }\n    }\n  }\n}"): (typeof documents)["query ImportReports {\n  importReports {\n    id\n    source\n    startedOn\n    finishedOn\n    success\n    details {\n      import {\n        total\n      }\n      failedItems {\n        lot\n        step\n        identifier\n        error\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query LatestUserSummary {\n  latestUserSummary {\n    calculatedOn\n    fitness {\n      measurementsRecorded\n      exercisesInteractedWith\n      workouts {\n        recorded\n        duration\n        weight\n      }\n    }\n    media {\n      reviewsPosted\n      creatorsInteractedWith\n      mediaInteractedWith\n      manga {\n        chapters\n        read\n      }\n      books {\n        pages\n        read\n      }\n      movies {\n        runtime\n        watched\n      }\n      anime {\n        episodes\n        watched\n      }\n      podcasts {\n        runtime\n        played\n        playedEpisodes\n      }\n      visualNovels {\n        played\n        runtime\n      }\n      videoGames {\n        played\n      }\n      shows {\n        runtime\n        watchedEpisodes\n        watchedSeasons\n        watched\n      }\n      audioBooks {\n        runtime\n        played\n      }\n    }\n  }\n}"): (typeof documents)["query LatestUserSummary {\n  latestUserSummary {\n    calculatedOn\n    fitness {\n      measurementsRecorded\n      exercisesInteractedWith\n      workouts {\n        recorded\n        duration\n        weight\n      }\n    }\n    media {\n      reviewsPosted\n      creatorsInteractedWith\n      mediaInteractedWith\n      manga {\n        chapters\n        read\n      }\n      books {\n        pages\n        read\n      }\n      movies {\n        runtime\n        watched\n      }\n      anime {\n        episodes\n        watched\n      }\n      podcasts {\n        runtime\n        played\n        playedEpisodes\n      }\n      visualNovels {\n        played\n        runtime\n      }\n      videoGames {\n        played\n      }\n      shows {\n        runtime\n        watchedEpisodes\n        watchedSeasons\n        watched\n      }\n      audioBooks {\n        runtime\n        played\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaAdditionalDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    lot\n    creators {\n      name\n      items {\n        id\n        name\n        image\n        character\n      }\n    }\n    assets {\n      images\n      videos {\n        videoId\n        source\n      }\n    }\n    suggestions {\n      ...PartialMetadataPart\n    }\n    animeSpecifics {\n      episodes\n    }\n    audioBookSpecifics {\n      runtime\n    }\n    bookSpecifics {\n      pages\n    }\n    movieSpecifics {\n      runtime\n    }\n    mangaSpecifics {\n      volumes\n      chapters\n    }\n    podcastSpecifics {\n      episodes {\n        title\n        overview\n        thumbnail\n        number\n        runtime\n        publishDate\n      }\n      totalEpisodes\n    }\n    showSpecifics {\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n          runtime\n        }\n      }\n    }\n    visualNovelSpecifics {\n      length\n    }\n    videoGameSpecifics {\n      platforms\n    }\n  }\n}"): (typeof documents)["query MediaAdditionalDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    lot\n    creators {\n      name\n      items {\n        id\n        name\n        image\n        character\n      }\n    }\n    assets {\n      images\n      videos {\n        videoId\n        source\n      }\n    }\n    suggestions {\n      ...PartialMetadataPart\n    }\n    animeSpecifics {\n      episodes\n    }\n    audioBookSpecifics {\n      runtime\n    }\n    bookSpecifics {\n      pages\n    }\n    movieSpecifics {\n      runtime\n    }\n    mangaSpecifics {\n      volumes\n      chapters\n    }\n    podcastSpecifics {\n      episodes {\n        title\n        overview\n        thumbnail\n        number\n        runtime\n        publishDate\n      }\n      totalEpisodes\n    }\n    showSpecifics {\n      seasons {\n        seasonNumber\n        name\n        overview\n        backdropImages\n        posterImages\n        episodes {\n          id\n          name\n          posterImages\n          episodeNumber\n          publishDate\n          name\n          overview\n          runtime\n        }\n      }\n    }\n    visualNovelSpecifics {\n      length\n    }\n    videoGameSpecifics {\n      platforms\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      averageRating\n      data {\n        ...MediaSearchItemPart\n      }\n    }\n  }\n}"): (typeof documents)["query MediaList($input: MediaListInput!) {\n  mediaList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      averageRating\n      data {\n        ...MediaSearchItemPart\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaMainDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    lot\n    source\n    isNsfw\n    sourceUrl\n    identifier\n    description\n    publishYear\n    publishDate\n    providerRating\n    productionStatus\n    originalLanguage\n    genres {\n      id\n      name\n    }\n    group {\n      id\n      name\n      part\n    }\n  }\n}"): (typeof documents)["query MediaMainDetails($metadataId: Int!) {\n  mediaDetails(metadataId: $metadataId) {\n    title\n    lot\n    source\n    isNsfw\n    sourceUrl\n    identifier\n    description\n    publishYear\n    publishDate\n    providerRating\n    productionStatus\n    originalLanguage\n    genres {\n      id\n      name\n    }\n    group {\n      id\n      name\n      part\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaSearch($lot: MetadataLot!, $source: MetadataSource!, $input: SearchInput!) {\n  mediaSearch(lot: $lot, source: $source, input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      databaseId\n      hasInteracted\n      item {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}"): (typeof documents)["query MediaSearch($lot: MetadataLot!, $source: MetadataSource!, $input: SearchInput!) {\n  mediaSearch(lot: $lot, source: $source, input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      databaseId\n      hasInteracted\n      item {\n        identifier\n        title\n        image\n        publishYear\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MediaSourcesForLot($lot: MetadataLot!) {\n  mediaSourcesForLot(lot: $lot)\n}"): (typeof documents)["query MediaSourcesForLot($lot: MetadataLot!) {\n  mediaSourcesForLot(lot: $lot)\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MetadataGroupDetails($metadataGroupId: Int!) {\n  metadataGroupDetails(metadataGroupId: $metadataGroupId) {\n    details {\n      id\n      title\n      lot\n      source\n      displayImages\n      parts\n    }\n    sourceUrl\n    contents {\n      ...PartialMetadataPart\n    }\n  }\n}"): (typeof documents)["query MetadataGroupDetails($metadataGroupId: Int!) {\n  metadataGroupDetails(metadataGroupId: $metadataGroupId) {\n    details {\n      id\n      title\n      lot\n      source\n      displayImages\n      parts\n    }\n    sourceUrl\n    contents {\n      ...PartialMetadataPart\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query MetadataGroupsList($input: SearchInput!) {\n  metadataGroupsList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      title\n      lot\n      parts\n      image\n    }\n  }\n}"): (typeof documents)["query MetadataGroupsList($input: SearchInput!) {\n  metadataGroupsList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      title\n      lot\n      parts\n      image\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query PersonDetails($personId: Int!) {\n  personDetails(personId: $personId) {\n    sourceUrl\n    details {\n      id\n      name\n      source\n      description\n      birthDate\n      deathDate\n      place\n      website\n      gender\n      displayImages\n    }\n    contents {\n      name\n      items {\n        id\n        title\n        image\n      }\n    }\n  }\n}"): (typeof documents)["query PersonDetails($personId: Int!) {\n  personDetails(personId: $personId) {\n    sourceUrl\n    details {\n      id\n      name\n      source\n      description\n      birthDate\n      deathDate\n      place\n      website\n      gender\n      displayImages\n    }\n    contents {\n      name\n      items {\n        id\n        title\n        image\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query PeopleList($input: PeopleListInput!) {\n  peopleList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      image\n      mediaCount\n    }\n  }\n}"): (typeof documents)["query PeopleList($input: PeopleListInput!) {\n  peopleList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      image\n      mediaCount\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query ProvidersLanguageInformation {\n  providersLanguageInformation {\n    supported\n    default\n    source\n  }\n}"): (typeof documents)["query ProvidersLanguageInformation {\n  providersLanguageInformation {\n    supported\n    default\n    source\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query PublicCollectionsList($input: SearchInput!) {\n  publicCollectionsList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      username\n    }\n  }\n}"): (typeof documents)["query PublicCollectionsList($input: SearchInput!) {\n  publicCollectionsList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      username\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Review($reviewId: Int!) {\n  review(reviewId: $reviewId) {\n    rating\n    text\n    visibility\n    spoiler\n    showSeason\n    showEpisode\n    podcastEpisode\n  }\n}"): (typeof documents)["query Review($reviewId: Int!) {\n  review(reviewId: $reviewId) {\n    rating\n    text\n    visibility\n    spoiler\n    showSeason\n    showEpisode\n    podcastEpisode\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserCalendarEvents($input: UserCalendarEventInput!) {\n  userCalendarEvents(input: $input) {\n    date\n    events {\n      ...CalendarEventPart\n    }\n  }\n}"): (typeof documents)["query UserCalendarEvents($input: UserCalendarEventInput!) {\n  userCalendarEvents(input: $input) {\n    date\n    events {\n      ...CalendarEventPart\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserCollectionsList($name: String) {\n  userCollectionsList(name: $name) {\n    id\n    name\n    description\n    visibility\n    numItems\n  }\n}"): (typeof documents)["query UserCollectionsList($name: String) {\n  userCollectionsList(name: $name) {\n    id\n    name\n    description\n    visibility\n    numItems\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n      lot\n    }\n  }\n}"): (typeof documents)["query UserDetails {\n  userDetails {\n    __typename\n    ... on User {\n      id\n      email\n      name\n      lot\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserExerciseDetails($input: UserExerciseDetailsInput!) {\n  userExerciseDetails(input: $input) {\n    collections {\n      ...CollectionPart\n    }\n    history {\n      workoutId\n      workoutName\n      workoutTime\n      index\n      sets {\n        lot\n        statistic {\n          ...WorkoutSetStatisticPart\n        }\n      }\n    }\n    details {\n      exerciseId\n      numTimesInteracted\n      lastUpdatedOn\n      exerciseExtraInformation {\n        lifetimeStats {\n          weight\n          reps\n          distance\n          duration\n          personalBestsAchieved\n        }\n        personalBests {\n          lot\n          sets {\n            workoutId\n            workoutDoneOn\n            exerciseIdx\n            setIdx\n            data {\n              statistic {\n                ...WorkoutSetStatisticPart\n              }\n              lot\n            }\n          }\n        }\n      }\n    }\n  }\n}"): (typeof documents)["query UserExerciseDetails($input: UserExerciseDetailsInput!) {\n  userExerciseDetails(input: $input) {\n    collections {\n      ...CollectionPart\n    }\n    history {\n      workoutId\n      workoutName\n      workoutTime\n      index\n      sets {\n        lot\n        statistic {\n          ...WorkoutSetStatisticPart\n        }\n      }\n    }\n    details {\n      exerciseId\n      numTimesInteracted\n      lastUpdatedOn\n      exerciseExtraInformation {\n        lifetimeStats {\n          weight\n          reps\n          distance\n          duration\n          personalBestsAchieved\n        }\n        personalBests {\n          lot\n          sets {\n            workoutId\n            workoutDoneOn\n            exerciseIdx\n            setIdx\n            data {\n              statistic {\n                ...WorkoutSetStatisticPart\n              }\n              lot\n            }\n          }\n        }\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserExports {\n  userExports {\n    startedAt\n    endedAt\n    url\n    exported\n  }\n}"): (typeof documents)["query UserExports {\n  userExports {\n    startedAt\n    endedAt\n    url\n    exported\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserIntegrations {\n  userIntegrations {\n    id\n    lot\n    description\n    timestamp\n    slug\n  }\n}"): (typeof documents)["query UserIntegrations {\n  userIntegrations {\n    id\n    lot\n    description\n    timestamp\n    slug\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserMeasurementsList($input: UserMeasurementsListInput!) {\n  userMeasurementsList(input: $input) {\n    timestamp\n    name\n    comment\n    stats {\n      weight\n      bodyMassIndex\n      totalBodyWater\n      muscle\n      leanBodyMass\n      bodyFat\n      boneMass\n      visceralFat\n      waistCircumference\n      waistToHeightRatio\n      hipCircumference\n      waistToHipRatio\n      chestCircumference\n      thighCircumference\n      bicepsCircumference\n      neckCircumference\n      bodyFatCaliper\n      chestSkinfold\n      abdominalSkinfold\n      thighSkinfold\n      basalMetabolicRate\n      totalDailyEnergyExpenditure\n      calories\n      custom\n    }\n  }\n}"): (typeof documents)["query UserMeasurementsList($input: UserMeasurementsListInput!) {\n  userMeasurementsList(input: $input) {\n    timestamp\n    name\n    comment\n    stats {\n      weight\n      bodyMassIndex\n      totalBodyWater\n      muscle\n      leanBodyMass\n      bodyFat\n      boneMass\n      visceralFat\n      waistCircumference\n      waistToHeightRatio\n      hipCircumference\n      waistToHipRatio\n      chestCircumference\n      thighCircumference\n      bicepsCircumference\n      neckCircumference\n      bodyFatCaliper\n      chestSkinfold\n      abdominalSkinfold\n      thighSkinfold\n      basalMetabolicRate\n      totalDailyEnergyExpenditure\n      calories\n      custom\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserMediaDetails($metadataId: Int!) {\n  userMediaDetails(metadataId: $metadataId) {\n    collections {\n      ...CollectionPart\n    }\n    inProgress {\n      ...SeenPart\n    }\n    history {\n      ...SeenPart\n    }\n    averageRating\n    reviews {\n      ...ReviewItemPart\n    }\n    reminder {\n      remindOn\n      message\n    }\n    ownership {\n      markedOn\n      ownedOn\n    }\n    isMonitored\n    seenBy\n    nextEpisode {\n      seasonNumber\n      episodeNumber\n    }\n  }\n}"): (typeof documents)["query UserMediaDetails($metadataId: Int!) {\n  userMediaDetails(metadataId: $metadataId) {\n    collections {\n      ...CollectionPart\n    }\n    inProgress {\n      ...SeenPart\n    }\n    history {\n      ...SeenPart\n    }\n    averageRating\n    reviews {\n      ...ReviewItemPart\n    }\n    reminder {\n      remindOn\n      message\n    }\n    ownership {\n      markedOn\n      ownedOn\n    }\n    isMonitored\n    seenBy\n    nextEpisode {\n      seasonNumber\n      episodeNumber\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserMetadataGroupDetails($metadataGroupId: Int!) {\n  userMetadataGroupDetails(metadataGroupId: $metadataGroupId) {\n    reviews {\n      ...ReviewItemPart\n    }\n    collections {\n      ...CollectionPart\n    }\n  }\n}"): (typeof documents)["query UserMetadataGroupDetails($metadataGroupId: Int!) {\n  userMetadataGroupDetails(metadataGroupId: $metadataGroupId) {\n    reviews {\n      ...ReviewItemPart\n    }\n    collections {\n      ...CollectionPart\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserNotificationPlatforms {\n  userNotificationPlatforms {\n    id\n    description\n    timestamp\n  }\n}"): (typeof documents)["query UserNotificationPlatforms {\n  userNotificationPlatforms {\n    id\n    description\n    timestamp\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserPersonDetails($personId: Int!) {\n  userPersonDetails(personId: $personId) {\n    collections {\n      ...CollectionPart\n    }\n    reviews {\n      ...ReviewItemPart\n    }\n  }\n}"): (typeof documents)["query UserPersonDetails($personId: Int!) {\n  userPersonDetails(personId: $personId) {\n    collections {\n      ...CollectionPart\n    }\n    reviews {\n      ...ReviewItemPart\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserPreferences {\n  userPreferences {\n    general {\n      reviewScale\n      displayNsfw\n      disableYankIntegrations\n      dashboard {\n        section\n        hidden\n        numElements\n      }\n    }\n    fitness {\n      measurements {\n        custom {\n          name\n          dataType\n        }\n        inbuilt {\n          weight\n          bodyMassIndex\n          totalBodyWater\n          muscle\n          leanBodyMass\n          bodyFat\n          boneMass\n          visceralFat\n          waistCircumference\n          waistToHeightRatio\n          hipCircumference\n          waistToHipRatio\n          chestCircumference\n          thighCircumference\n          bicepsCircumference\n          neckCircumference\n          bodyFatCaliper\n          chestSkinfold\n          abdominalSkinfold\n          thighSkinfold\n          basalMetabolicRate\n          totalDailyEnergyExpenditure\n          calories\n        }\n      }\n      exercises {\n        saveHistory\n        defaultTimer\n        unitSystem\n      }\n    }\n    notifications {\n      episodeReleased\n      episodeNameChanged\n      episodeImagesChanged\n      statusChanged\n      releaseDateChanged\n      numberOfSeasonsChanged\n      numberOfChaptersOrEpisodesChanged\n      newReviewPosted\n    }\n    featuresEnabled {\n      fitness {\n        enabled\n        workouts\n        measurements\n      }\n      media {\n        enabled\n        anime\n        audioBook\n        book\n        manga\n        movie\n        podcast\n        show\n        videoGame\n        visualNovel\n      }\n    }\n  }\n}"): (typeof documents)["query UserPreferences {\n  userPreferences {\n    general {\n      reviewScale\n      displayNsfw\n      disableYankIntegrations\n      dashboard {\n        section\n        hidden\n        numElements\n      }\n    }\n    fitness {\n      measurements {\n        custom {\n          name\n          dataType\n        }\n        inbuilt {\n          weight\n          bodyMassIndex\n          totalBodyWater\n          muscle\n          leanBodyMass\n          bodyFat\n          boneMass\n          visceralFat\n          waistCircumference\n          waistToHeightRatio\n          hipCircumference\n          waistToHipRatio\n          chestCircumference\n          thighCircumference\n          bicepsCircumference\n          neckCircumference\n          bodyFatCaliper\n          chestSkinfold\n          abdominalSkinfold\n          thighSkinfold\n          basalMetabolicRate\n          totalDailyEnergyExpenditure\n          calories\n        }\n      }\n      exercises {\n        saveHistory\n        defaultTimer\n        unitSystem\n      }\n    }\n    notifications {\n      episodeReleased\n      episodeNameChanged\n      episodeImagesChanged\n      statusChanged\n      releaseDateChanged\n      numberOfSeasonsChanged\n      numberOfChaptersOrEpisodesChanged\n      newReviewPosted\n    }\n    featuresEnabled {\n      fitness {\n        enabled\n        workouts\n        measurements\n      }\n      media {\n        enabled\n        anime\n        audioBook\n        book\n        manga\n        movie\n        podcast\n        show\n        videoGame\n        visualNovel\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserUpcomingCalendarEvents($input: UserUpcomingCalendarEventInput!) {\n  userUpcomingCalendarEvents(input: $input) {\n    ...CalendarEventPart\n  }\n}"): (typeof documents)["query UserUpcomingCalendarEvents($input: UserUpcomingCalendarEventInput!) {\n  userUpcomingCalendarEvents(input: $input) {\n    ...CalendarEventPart\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UserWorkoutList($input: SearchInput!) {\n  userWorkoutList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      startTime\n      endTime\n      summary {\n        ...WorkoutSummaryPart\n      }\n    }\n  }\n}"): (typeof documents)["query UserWorkoutList($input: SearchInput!) {\n  userWorkoutList(input: $input) {\n    details {\n      total\n      nextPage\n    }\n    items {\n      id\n      name\n      startTime\n      endTime\n      summary {\n        ...WorkoutSummaryPart\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query UsersList {\n  usersList {\n    id\n    name\n    lot\n  }\n}"): (typeof documents)["query UsersList {\n  usersList {\n    id\n    name\n    lot\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query WorkoutDetails($workoutId: String!) {\n  workoutDetails(workoutId: $workoutId) {\n    id\n    name\n    comment\n    startTime\n    endTime\n    summary {\n      ...WorkoutSummaryPart\n    }\n    information {\n      assets {\n        ...EntityAssetsPart\n      }\n      exercises {\n        name\n        lot\n        notes\n        restTime\n        total {\n          ...WorkoutOrExerciseTotalsPart\n        }\n        supersetWith\n        assets {\n          ...EntityAssetsPart\n        }\n        sets {\n          statistic {\n            ...WorkoutSetStatisticPart\n          }\n          lot\n          personalBests\n          confirmedAt\n        }\n      }\n    }\n  }\n}"): (typeof documents)["query WorkoutDetails($workoutId: String!) {\n  workoutDetails(workoutId: $workoutId) {\n    id\n    name\n    comment\n    startTime\n    endTime\n    summary {\n      ...WorkoutSummaryPart\n    }\n    information {\n      assets {\n        ...EntityAssetsPart\n      }\n      exercises {\n        name\n        lot\n        notes\n        restTime\n        total {\n          ...WorkoutOrExerciseTotalsPart\n        }\n        supersetWith\n        assets {\n          ...EntityAssetsPart\n        }\n        sets {\n          statistic {\n            ...WorkoutSetStatisticPart\n          }\n          lot\n          personalBests\n          confirmedAt\n        }\n      }\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment CalendarEventPart on GraphqlCalendarEvent {\n  calendarEventId\n  metadataId\n  metadataTitle\n  metadataLot\n  metadataImage\n  date\n  showSeasonNumber\n  showEpisodeNumber\n  podcastEpisodeNumber\n}\n\nfragment SeenPart on Seen {\n  id\n  progress\n  state\n  startedOn\n  finishedOn\n  lastUpdatedOn\n  numTimesUpdated\n  showInformation {\n    episode\n    season\n  }\n  podcastInformation {\n    episode\n  }\n}\n\nfragment MediaSearchItemPart on MediaSearchItem {\n  identifier\n  title\n  image\n  publishYear\n}\n\nfragment PartialMetadataPart on PartialMetadata {\n  id\n  lot\n  source\n  identifier\n  title\n  image\n}\n\nfragment WorkoutOrExerciseTotalsPart on WorkoutOrExerciseTotals {\n  personalBestsAchieved\n  weight\n  reps\n  distance\n  duration\n  restTime\n}\n\nfragment EntityAssetsPart on EntityAssets {\n  images\n  videos\n}\n\nfragment WorkoutSetStatisticPart on WorkoutSetStatistic {\n  duration\n  distance\n  reps\n  weight\n  oneRm\n  pace\n  volume\n}\n\nfragment WorkoutSummaryPart on WorkoutSummary {\n  total {\n    ...WorkoutOrExerciseTotalsPart\n  }\n  exercises {\n    numSets\n    id\n    lot\n    bestSet {\n      statistic {\n        ...WorkoutSetStatisticPart\n      }\n      lot\n      personalBests\n    }\n  }\n}\n\nfragment CollectionPart on Collection {\n  id\n  name\n}\n\nfragment ReviewItemPart on ReviewItem {\n  id\n  rating\n  text\n  spoiler\n  visibility\n  showSeason\n  showEpisode\n  podcastEpisode\n  postedOn\n  postedBy {\n    id\n    name\n  }\n  comments {\n    id\n    text\n    createdOn\n    user {\n      id\n      name\n    }\n    likedBy\n  }\n}"): (typeof documents)["fragment CalendarEventPart on GraphqlCalendarEvent {\n  calendarEventId\n  metadataId\n  metadataTitle\n  metadataLot\n  metadataImage\n  date\n  showSeasonNumber\n  showEpisodeNumber\n  podcastEpisodeNumber\n}\n\nfragment SeenPart on Seen {\n  id\n  progress\n  state\n  startedOn\n  finishedOn\n  lastUpdatedOn\n  numTimesUpdated\n  showInformation {\n    episode\n    season\n  }\n  podcastInformation {\n    episode\n  }\n}\n\nfragment MediaSearchItemPart on MediaSearchItem {\n  identifier\n  title\n  image\n  publishYear\n}\n\nfragment PartialMetadataPart on PartialMetadata {\n  id\n  lot\n  source\n  identifier\n  title\n  image\n}\n\nfragment WorkoutOrExerciseTotalsPart on WorkoutOrExerciseTotals {\n  personalBestsAchieved\n  weight\n  reps\n  distance\n  duration\n  restTime\n}\n\nfragment EntityAssetsPart on EntityAssets {\n  images\n  videos\n}\n\nfragment WorkoutSetStatisticPart on WorkoutSetStatistic {\n  duration\n  distance\n  reps\n  weight\n  oneRm\n  pace\n  volume\n}\n\nfragment WorkoutSummaryPart on WorkoutSummary {\n  total {\n    ...WorkoutOrExerciseTotalsPart\n  }\n  exercises {\n    numSets\n    id\n    lot\n    bestSet {\n      statistic {\n        ...WorkoutSetStatisticPart\n      }\n      lot\n      personalBests\n    }\n  }\n}\n\nfragment CollectionPart on Collection {\n  id\n  name\n}\n\nfragment ReviewItemPart on ReviewItem {\n  id\n  rating\n  text\n  spoiler\n  visibility\n  showSeason\n  showEpisode\n  podcastEpisode\n  postedOn\n  postedBy {\n    id\n    name\n  }\n  comments {\n    id\n    text\n    createdOn\n    user {\n      id\n      name\n    }\n    likedBy\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;