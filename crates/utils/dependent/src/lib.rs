use std::{
    cmp::Reverse,
    collections::{HashMap, HashSet, hash_map::Entry},
    future::Future,
    iter::zip,
    sync::Arc,
};

use application_utils::{get_current_date, graphql_to_db_order};
use async_graphql::{Enum, Error, Result};
use background_models::{ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob};
use chrono::Utc;
use common_models::{
    BackgroundJob, ChangeCollectionToEntityInput, DefaultCollection, EntityAssets,
    MetadataRecentlyConsumedCacheInput, ProgressUpdateCacheInput, SearchDetails, StringIdObject,
    UserLevelCacheKey,
};
use common_utils::{
    MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE, SHOW_SPECIAL_SEASON_NAMES, ryot_log, sleep_for_n_seconds,
};
use database_models::{
    collection, collection_to_entity, exercise,
    functions::get_user_to_entity_association,
    genre, metadata, metadata_group, metadata_group_to_person, metadata_to_genre,
    metadata_to_metadata, metadata_to_metadata_group, metadata_to_person, monitored_entity,
    notification_platform, person,
    prelude::{
        Collection, CollectionToEntity, Exercise, Genre, Metadata, MetadataGroup,
        MetadataGroupToPerson, MetadataToGenre, MetadataToMetadata, MetadataToMetadataGroup,
        MetadataToPerson, MonitoredEntity, NotificationPlatform, Person, Seen, UserMeasurement,
        UserToEntity, Workout, WorkoutTemplate,
    },
    review, seen, user, user_measurement, user_to_entity, workout, workout_template,
};
use database_utils::{
    admin_account_guard, apply_collection_filter, get_cte_column_from_lot, ilike_sql,
    schedule_user_for_workout_revision, user_by_id,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheKeyDiscriminants, ApplicationCacheValue, CachedResponse,
    EmptyCacheValue, ExpireCacheKeyInput, ImportCompletedItem, ImportResult, MetadataBaseData,
    SearchResults, UserExercisesListResponse, UserMeasurementsListResponse,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse,
    UserTemplatesOrWorkoutsListInput, UserTemplatesOrWorkoutsListSortBy, UserWorkoutsListResponse,
    UserWorkoutsTemplatesListResponse,
};
use enum_meta::Meta;
use enum_models::{
    EntityLot, ExerciseLot, ExerciseSource, MediaLot, MediaSource, MetadataToMetadataRelation,
    SeenState, UserNotificationContent, UserToMediaReason, Visibility, WorkoutSetPersonalBest,
};
use fitness_models::{
    ExerciseBestSetRecord, ExerciseSortBy, ProcessedExercise, UserExerciseInput,
    UserExercisesListInput, UserMeasurementsListInput, UserToExerciseBestSetExtraInformation,
    UserToExerciseExtraInformation, UserToExerciseHistoryExtraInformation, UserWorkoutInput,
    UserWorkoutSetRecord, WorkoutEquipmentFocusedSummary, WorkoutFocusedSummary,
    WorkoutForceFocusedSummary, WorkoutInformation, WorkoutLevelFocusedSummary,
    WorkoutLotFocusedSummary, WorkoutMuscleFocusedSummary, WorkoutOrExerciseTotals,
    WorkoutSetRecord, WorkoutSetStatistic, WorkoutSetTotals, WorkoutSummary,
    WorkoutSummaryExercise,
};
use importer_models::{ImportDetails, ImportFailStep, ImportFailedItem, ImportResultResponse};
use itertools::Itertools;
use markdown::{CompileOptions, Options, to_html_with_options as markdown_to_html_opts};
use media_models::{
    CommitMetadataGroupInput, CommitPersonInput, CreateOrUpdateCollectionInput,
    CreateOrUpdateReviewInput, GenreListItem, ImportOrExportItemRating, ImportOrExportMetadataItem,
    MediaAssociatedPersonStateChanges, MediaGeneralFilter, MediaSortBy, MetadataCreator,
    MetadataCreatorGroupedByRole, MetadataDetails, PartialMetadata, PartialMetadataPerson,
    PartialMetadataWithoutId, PersonAndMetadataGroupsSortBy, ProgressUpdateError,
    ProgressUpdateErrorVariant, ProgressUpdateInput, ProgressUpdateResultUnion, ReviewPostedEvent,
    SeenAnimeExtraInformation, SeenMangaExtraInformation, SeenPodcastExtraInformation,
    SeenPodcastExtraOptionalInformation, SeenShowExtraInformation,
    SeenShowExtraOptionalInformation, UniqueMediaIdentifier, UpdateMediaEntityResult,
};
use migrations::{AliasedExercise, AliasedReview};
use nanoid::nanoid;
use notification_service::send_notification;
use providers::{
    anilist::{AnilistAnimeService, AnilistMangaService, NonMediaAnilistService},
    audible::AudibleService,
    google_books::GoogleBooksService,
    hardcover::HardcoverService,
    igdb::IgdbService,
    itunes::ITunesService,
    listennotes::ListennotesService,
    mal::{MalAnimeService, MalMangaService, NonMediaMalService},
    manga_updates::MangaUpdatesService,
    openlibrary::OpenlibraryService,
    tmdb::{NonMediaTmdbService, TmdbMovieService, TmdbShowService},
    vndb::VndbService,
    youtube_music::YoutubeMusicService,
};
use rand::seq::SliceRandom;
use rust_decimal::{
    Decimal,
    prelude::{FromPrimitive, One, ToPrimitive},
};
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, Condition, DatabaseConnection, EntityTrait,
    FromQueryResult, ItemsAndPagesNumber, Iterable, JoinType, ModelTrait, Order, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, RelationTrait, TransactionTrait,
    prelude::{DateTimeUtc, Expr},
    sea_query::{
        Alias, Asterisk, Func, NullOrdering, OnConflict, PgFunc, extension::postgres::PgExpr,
    },
};
use serde::{Deserialize, Serialize};
use slug::slugify;
use supporting_service::SupportingService;
use traits::{MediaProvider, TraceOk};
use user_models::{UserPreferences, UserReviewScale, UserStatisticsMeasurement};
use uuid::Uuid;

pub type Provider = Box<(dyn MediaProvider + Send + Sync)>;

pub async fn get_openlibrary_service(config: &config::AppConfig) -> Result<OpenlibraryService> {
    Ok(OpenlibraryService::new(&config.books.openlibrary).await)
}

pub async fn get_google_books_service(config: &config::AppConfig) -> Result<GoogleBooksService> {
    Ok(GoogleBooksService::new(&config.books.google_books).await)
}

pub async fn get_hardcover_service(config: &config::AppConfig) -> Result<HardcoverService> {
    Ok(HardcoverService::new(&config.books.hardcover).await)
}

pub async fn get_tmdb_non_media_service(
    ss: &Arc<SupportingService>,
) -> Result<NonMediaTmdbService> {
    Ok(NonMediaTmdbService::new(ss.clone()).await)
}

pub async fn get_metadata_provider(
    lot: MediaLot,
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<Provider> {
    let err = || Err(Error::new("This source is not supported".to_owned()));
    let service: Provider = match source {
        MediaSource::YoutubeMusic => Box::new(YoutubeMusicService::new().await),
        MediaSource::Hardcover => Box::new(get_hardcover_service(&ss.config).await?),
        MediaSource::Vndb => Box::new(VndbService::new(&ss.config.visual_novels).await),
        MediaSource::Openlibrary => Box::new(get_openlibrary_service(&ss.config).await?),
        MediaSource::Itunes => Box::new(ITunesService::new(&ss.config.podcasts.itunes).await),
        MediaSource::GoogleBooks => Box::new(get_google_books_service(&ss.config).await?),
        MediaSource::Audible => Box::new(AudibleService::new(&ss.config.audio_books.audible).await),
        MediaSource::Listennotes => Box::new(ListennotesService::new(ss.clone()).await),
        MediaSource::Tmdb => match lot {
            MediaLot::Show => Box::new(TmdbShowService::new(ss.clone()).await),
            MediaLot::Movie => Box::new(TmdbMovieService::new(ss.clone()).await),
            _ => return err(),
        },
        MediaSource::Anilist => match lot {
            MediaLot::Anime => {
                Box::new(AnilistAnimeService::new(&ss.config.anime_and_manga.anilist).await)
            }
            MediaLot::Manga => {
                Box::new(AnilistMangaService::new(&ss.config.anime_and_manga.anilist).await)
            }
            _ => return err(),
        },
        MediaSource::Mal => match lot {
            MediaLot::Anime => Box::new(MalAnimeService::new(&ss.config.anime_and_manga.mal).await),
            MediaLot::Manga => Box::new(MalMangaService::new(&ss.config.anime_and_manga.mal).await),
            _ => return err(),
        },
        MediaSource::Igdb => Box::new(IgdbService::new(ss.clone()).await),
        MediaSource::MangaUpdates => {
            Box::new(MangaUpdatesService::new(&ss.config.anime_and_manga.manga_updates).await)
        }
        MediaSource::Custom => return err(),
    };
    Ok(service)
}

pub async fn get_non_metadata_provider(
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<Provider> {
    let err = || Err(Error::new("This source is not supported".to_owned()));
    let service: Provider = match source {
        MediaSource::YoutubeMusic => Box::new(YoutubeMusicService::new().await),
        MediaSource::Hardcover => Box::new(get_hardcover_service(&ss.config).await?),
        MediaSource::Vndb => Box::new(VndbService::new(&ss.config.visual_novels).await),
        MediaSource::Openlibrary => Box::new(get_openlibrary_service(&ss.config).await?),
        MediaSource::Itunes => Box::new(ITunesService::new(&ss.config.podcasts.itunes).await),
        MediaSource::GoogleBooks => Box::new(get_google_books_service(&ss.config).await?),
        MediaSource::Audible => Box::new(AudibleService::new(&ss.config.audio_books.audible).await),
        MediaSource::Listennotes => Box::new(ListennotesService::new(ss.clone()).await),
        MediaSource::Igdb => Box::new(IgdbService::new(ss.clone()).await),
        MediaSource::MangaUpdates => {
            Box::new(MangaUpdatesService::new(&ss.config.anime_and_manga.manga_updates).await)
        }
        MediaSource::Tmdb => Box::new(get_tmdb_non_media_service(ss).await?),
        MediaSource::Anilist => {
            Box::new(NonMediaAnilistService::new(&ss.config.anime_and_manga.anilist).await)
        }
        MediaSource::Mal => Box::new(NonMediaMalService::new().await),
        MediaSource::Custom => return err(),
    };
    Ok(service)
}

pub async fn details_from_provider(
    lot: MediaLot,
    source: MediaSource,
    identifier: &str,
    ss: &Arc<SupportingService>,
) -> Result<MetadataDetails> {
    let provider = get_metadata_provider(lot, source, ss).await?;
    let results = provider.metadata_details(identifier).await?;
    Ok(results)
}

pub async fn commit_metadata(
    data: PartialMetadataWithoutId,
    ss: &Arc<SupportingService>,
) -> Result<PartialMetadata> {
    let mode = match Metadata::find()
        .filter(metadata::Column::Identifier.eq(&data.identifier))
        .filter(metadata::Column::Lot.eq(data.lot))
        .filter(metadata::Column::Source.eq(data.source))
        .one(&ss.db)
        .await
        .unwrap()
    {
        Some(c) => c,
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = data.image.clone() {
                assets.remote_images = vec![i];
            }
            let c = metadata::ActiveModel {
                assets: ActiveValue::Set(assets),
                lot: ActiveValue::Set(data.lot),
                title: ActiveValue::Set(data.title),
                source: ActiveValue::Set(data.source),
                is_partial: ActiveValue::Set(Some(true)),
                identifier: ActiveValue::Set(data.identifier),
                publish_year: ActiveValue::Set(data.publish_year),
                ..Default::default()
            };
            c.insert(&ss.db).await?
        }
    };
    let model = PartialMetadata {
        id: mode.id,
        lot: mode.lot,
        image: data.image,
        title: mode.title,
        source: mode.source,
        identifier: mode.identifier,
        publish_year: mode.publish_year,
    };
    Ok(model)
}

pub async fn change_metadata_associations(
    metadata_id: &String,
    genres: Vec<String>,
    suggestions: Vec<PartialMetadataWithoutId>,
    groups: Vec<CommitMetadataGroupInput>,
    people: Vec<PartialMetadataPerson>,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    MetadataToPerson::delete_many()
        .filter(metadata_to_person::Column::MetadataId.eq(metadata_id))
        .exec(&ss.db)
        .await?;
    MetadataToGenre::delete_many()
        .filter(metadata_to_genre::Column::MetadataId.eq(metadata_id))
        .exec(&ss.db)
        .await?;
    MetadataToMetadata::delete_many()
        .filter(metadata_to_metadata::Column::FromMetadataId.eq(metadata_id))
        .filter(metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion))
        .exec(&ss.db)
        .await?;

    for (index, person) in people.into_iter().enumerate() {
        let role = person.role.clone();
        let db_person = commit_person(
            CommitPersonInput {
                name: person.name,
                source: person.source,
                identifier: person.identifier.clone(),
                source_specifics: person.source_specifics,
                ..Default::default()
            },
            ss,
        )
        .await?;
        let intermediate = metadata_to_person::ActiveModel {
            role: ActiveValue::Set(role),
            person_id: ActiveValue::Set(db_person.id),
            character: ActiveValue::Set(person.character),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            index: ActiveValue::Set(Some(index.try_into().unwrap())),
        };
        intermediate.insert(&ss.db).await.ok();
    }

    for name in genres {
        let genre = genre::ActiveModel {
            id: ActiveValue::Set(format!("gen_{}", nanoid!(12))),
            name: ActiveValue::Set(name.clone()),
        };
        let db_genre = Genre::insert(genre)
            .on_conflict(
                OnConflict::column(genre::Column::Name)
                    .update_column(genre::Column::Name)
                    .to_owned(),
            )
            .exec_with_returning(&ss.db)
            .await?;

        let intermediate = metadata_to_genre::ActiveModel {
            genre_id: ActiveValue::Set(db_genre.id),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        };
        intermediate.insert(&ss.db).await.ok();
    }

    for data in suggestions {
        let db_partial_metadata = commit_metadata(data, ss).await?;
        let intermediate = metadata_to_metadata::ActiveModel {
            to_metadata_id: ActiveValue::Set(db_partial_metadata.id.clone()),
            from_metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            relation: ActiveValue::Set(MetadataToMetadataRelation::Suggestion),
            ..Default::default()
        };
        intermediate.insert(&ss.db).await.ok();
    }

    for metadata_group in groups {
        let db_group = commit_metadata_group(metadata_group, ss).await?;
        let intermediate = metadata_to_metadata_group::ActiveModel {
            part: ActiveValue::Set(0),
            metadata_group_id: ActiveValue::Set(db_group.id),
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        };
        intermediate.insert(&ss.db).await.ok();
    }

    Ok(())
}

async fn update_metadata(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let metadata = Metadata::find_by_id(metadata_id)
        .one(&ss.db)
        .await
        .unwrap()
        .unwrap();
    if !metadata.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }
    let mut result = UpdateMediaEntityResult::default();
    ryot_log!(debug, "Updating metadata for {:?}", metadata_id);
    Metadata::update_many()
        .filter(metadata::Column::Id.eq(metadata_id))
        .col_expr(metadata::Column::IsPartial, Expr::value(false))
        .exec(&ss.db)
        .await?;
    let maybe_details =
        details_from_provider(metadata.lot, metadata.source, &metadata.identifier, ss).await;
    match maybe_details {
        Ok(details) => {
            let mut notifications = vec![];
            let meta = Metadata::find_by_id(metadata_id)
                .one(&ss.db)
                .await
                .unwrap()
                .unwrap();

            if let (Some(p1), Some(p2)) = (&meta.production_status, &details.production_status) {
                if p1 != p2 {
                    notifications.push((
                        format!("Status changed from {:#?} to {:#?}", p1, p2),
                        UserNotificationContent::MetadataStatusChanged,
                    ));
                }
            }
            if let (Some(p1), Some(p2)) = (meta.publish_year, details.publish_year) {
                if p1 != p2 {
                    notifications.push((
                        format!("Publish year from {:#?} to {:#?}", p1, p2),
                        UserNotificationContent::MetadataReleaseDateChanged,
                    ));
                }
            }
            if let (Some(s1), Some(s2)) = (&meta.show_specifics, &details.show_specifics) {
                if s1.seasons.len() != s2.seasons.len() {
                    notifications.push((
                        format!(
                            "Number of seasons changed from {:#?} to {:#?}",
                            s1.seasons.len(),
                            s2.seasons.len()
                        ),
                        UserNotificationContent::MetadataNumberOfSeasonsChanged,
                    ));
                } else {
                    for (s1, s2) in zip(s1.seasons.iter(), s2.seasons.iter()) {
                        if SHOW_SPECIAL_SEASON_NAMES.contains(&s1.name.as_str())
                            && SHOW_SPECIAL_SEASON_NAMES.contains(&s2.name.as_str())
                        {
                            continue;
                        }
                        if s1.episodes.len() != s2.episodes.len() {
                            notifications.push((
                                format!(
                                    "Number of episodes changed from {:#?} to {:#?} (Season {})",
                                    s1.episodes.len(),
                                    s2.episodes.len(),
                                    s1.season_number
                                ),
                                UserNotificationContent::MetadataEpisodeReleased,
                            ));
                        } else {
                            for (before_episode, after_episode) in
                                zip(s1.episodes.iter(), s2.episodes.iter())
                            {
                                if before_episode.name != after_episode.name {
                                    notifications.push((
                                        format!(
                                            "Episode name changed from {:#?} to {:#?} (S{}E{})",
                                            before_episode.name,
                                            after_episode.name,
                                            s1.season_number,
                                            before_episode.episode_number
                                        ),
                                        UserNotificationContent::MetadataEpisodeNameChanged,
                                    ));
                                }
                                if before_episode.poster_images != after_episode.poster_images {
                                    notifications.push((
                                        format!(
                                            "Episode image changed for S{}E{}",
                                            s1.season_number, before_episode.episode_number
                                        ),
                                        UserNotificationContent::MetadataEpisodeImagesChanged,
                                    ));
                                }
                                if let (Some(pd1), Some(pd2)) =
                                    (before_episode.publish_date, after_episode.publish_date)
                                {
                                    if pd1 != pd2 {
                                        notifications.push((
                                            format!(
                                                "Episode release date changed from {:?} to {:?} (S{}E{})",
                                                pd1,
                                                pd2,
                                                s1.season_number,
                                                before_episode.episode_number
                                            ),
                                            UserNotificationContent::MetadataReleaseDateChanged,
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            };
            if let (Some(a1), Some(a2)) = (&meta.anime_specifics, &details.anime_specifics) {
                if let (Some(e1), Some(e2)) = (a1.episodes, a2.episodes) {
                    if e1 != e2 {
                        notifications.push((
                            format!("Number of episodes changed from {:#?} to {:#?}", e1, e2),
                            UserNotificationContent::MetadataChaptersOrEpisodesChanged,
                        ));
                    }
                }
            };
            if let (Some(m1), Some(m2)) = (&meta.manga_specifics, &details.manga_specifics) {
                if let (Some(c1), Some(c2)) = (m1.chapters, m2.chapters) {
                    if c1 != c2 {
                        notifications.push((
                            format!("Number of chapters changed from {:#?} to {:#?}", c1, c2),
                            UserNotificationContent::MetadataChaptersOrEpisodesChanged,
                        ));
                    }
                }
            };
            if let (Some(p1), Some(p2)) = (&meta.podcast_specifics, &details.podcast_specifics) {
                if p1.episodes.len() != p2.episodes.len() {
                    notifications.push((
                        format!(
                            "Number of episodes changed from {:#?} to {:#?}",
                            p1.episodes.len(),
                            p2.episodes.len()
                        ),
                        UserNotificationContent::MetadataEpisodeReleased,
                    ));
                } else {
                    for (before_episode, after_episode) in
                        zip(p1.episodes.iter(), p2.episodes.iter())
                    {
                        if before_episode.title != after_episode.title {
                            notifications.push((
                                format!(
                                    "Episode name changed from {:#?} to {:#?} (EP{})",
                                    before_episode.title,
                                    after_episode.title,
                                    before_episode.number
                                ),
                                UserNotificationContent::MetadataEpisodeNameChanged,
                            ));
                        }
                        if before_episode.thumbnail != after_episode.thumbnail {
                            notifications.push((
                                format!("Episode image changed for EP{}", before_episode.number),
                                UserNotificationContent::MetadataEpisodeImagesChanged,
                            ));
                        }
                    }
                }
            };

            let notifications = notifications
                .into_iter()
                .map(|n| (format!("{} for {:?}.", n.0, meta.title), n.1))
                .collect_vec();

            let free_creators = details
                .creators
                .is_empty()
                .then_some(())
                .map(|_| details.creators);
            let watch_providers = details
                .watch_providers
                .is_empty()
                .then_some(())
                .map(|_| details.watch_providers);

            let mut meta: metadata::ActiveModel = meta.into();
            meta.title = ActiveValue::Set(details.title);
            meta.assets = ActiveValue::Set(details.assets);
            meta.is_partial = ActiveValue::Set(Some(false));
            meta.is_nsfw = ActiveValue::Set(details.is_nsfw);
            meta.last_updated_on = ActiveValue::Set(Utc::now());
            meta.free_creators = ActiveValue::Set(free_creators);
            meta.source_url = ActiveValue::Set(details.source_url);
            meta.description = ActiveValue::Set(details.description);
            meta.watch_providers = ActiveValue::Set(watch_providers);
            meta.publish_year = ActiveValue::Set(details.publish_year);
            meta.publish_date = ActiveValue::Set(details.publish_date);
            meta.show_specifics = ActiveValue::Set(details.show_specifics);
            meta.book_specifics = ActiveValue::Set(details.book_specifics);
            meta.anime_specifics = ActiveValue::Set(details.anime_specifics);
            meta.provider_rating = ActiveValue::Set(details.provider_rating);
            meta.manga_specifics = ActiveValue::Set(details.manga_specifics);
            meta.movie_specifics = ActiveValue::Set(details.movie_specifics);
            meta.music_specifics = ActiveValue::Set(details.music_specifics);
            meta.production_status = ActiveValue::Set(details.production_status);
            meta.original_language = ActiveValue::Set(details.original_language);
            meta.podcast_specifics = ActiveValue::Set(details.podcast_specifics);
            meta.audio_book_specifics = ActiveValue::Set(details.audio_book_specifics);
            meta.video_game_specifics = ActiveValue::Set(details.video_game_specifics);
            meta.external_identifiers = ActiveValue::Set(details.external_identifiers);
            meta.visual_novel_specifics = ActiveValue::Set(details.visual_novel_specifics);
            let metadata = meta.update(&ss.db).await.unwrap();

            change_metadata_associations(
                &metadata.id,
                details.genres,
                details.suggestions,
                details.groups,
                details.people,
                ss,
            )
            .await?;
            ryot_log!(debug, "Updated metadata for {:?}", metadata_id);
            result.notifications.extend(notifications);
        }
        Err(e) => {
            ryot_log!(
                error,
                "Error while updating metadata = {:?}: {:?}",
                metadata_id,
                e
            );
        }
    };
    Ok(result)
}

async fn update_metadata_group(
    metadata_group_id: &str,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let metadata_group = MetadataGroup::find_by_id(metadata_group_id)
        .one(&ss.db)
        .await?
        .ok_or(Error::new("Group not found"))?;
    if !metadata_group.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }
    let provider = get_metadata_provider(metadata_group.lot, metadata_group.source, ss).await?;
    let (group_details, associated_items) = provider
        .metadata_group_details(&metadata_group.identifier)
        .await?;
    let mut eg: metadata_group::ActiveModel = metadata_group.into();
    eg.is_partial = ActiveValue::Set(None);
    eg.title = ActiveValue::Set(group_details.title);
    eg.parts = ActiveValue::Set(group_details.parts);
    eg.source_url = ActiveValue::Set(group_details.source_url);
    eg.description = ActiveValue::Set(group_details.description);
    eg.assets = ActiveValue::Set(group_details.assets);
    let eg = eg.update(&ss.db).await?;
    for (idx, media) in associated_items.into_iter().enumerate() {
        let db_partial_metadata = commit_metadata(media, ss).await?;
        MetadataToMetadataGroup::delete_many()
            .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(&eg.id))
            .filter(metadata_to_metadata_group::Column::MetadataId.eq(&db_partial_metadata.id))
            .exec(&ss.db)
            .await
            .ok();
        let intermediate = metadata_to_metadata_group::ActiveModel {
            metadata_group_id: ActiveValue::Set(eg.id.clone()),
            metadata_id: ActiveValue::Set(db_partial_metadata.id),
            part: ActiveValue::Set((idx + 1).try_into().unwrap()),
        };
        intermediate.insert(&ss.db).await.ok();
    }
    Ok(UpdateMediaEntityResult::default())
}

async fn update_person(
    person_id: String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let person = Person::find_by_id(person_id.clone())
        .one(&ss.db)
        .await?
        .unwrap();
    if !person.is_partial.unwrap_or_default() {
        return Ok(UpdateMediaEntityResult::default());
    }
    let mut notifications = vec![];
    let provider = get_non_metadata_provider(person.source, ss).await?;
    let provider_person = provider
        .person_details(&person.identifier, &person.source_specifics)
        .await?;
    ryot_log!(debug, "Updating person for {:?}", person_id);

    let mut current_state_changes = person.clone().state_changes.unwrap_or_default();
    let mut to_update_person: person::ActiveModel = person.clone().into();
    to_update_person.is_partial = ActiveValue::Set(Some(false));
    to_update_person.name = ActiveValue::Set(provider_person.name);
    to_update_person.last_updated_on = ActiveValue::Set(Utc::now());
    to_update_person.place = ActiveValue::Set(provider_person.place);
    to_update_person.gender = ActiveValue::Set(provider_person.gender);
    to_update_person.assets = ActiveValue::Set(provider_person.assets);
    to_update_person.website = ActiveValue::Set(provider_person.website);
    to_update_person.source_url = ActiveValue::Set(provider_person.source_url);
    to_update_person.birth_date = ActiveValue::Set(provider_person.birth_date);
    to_update_person.death_date = ActiveValue::Set(provider_person.death_date);
    to_update_person.description = ActiveValue::Set(provider_person.description);
    to_update_person.alternate_names = ActiveValue::Set(provider_person.alternate_names);
    for data in provider_person.related_metadata.clone() {
        let title = data.metadata.title.clone();
        let pm = commit_metadata(data.metadata, ss).await?;
        let already_intermediate = MetadataToPerson::find()
            .filter(metadata_to_person::Column::MetadataId.eq(&pm.id))
            .filter(metadata_to_person::Column::PersonId.eq(&person_id))
            .filter(metadata_to_person::Column::Role.eq(&data.role))
            .one(&ss.db)
            .await?;
        if already_intermediate.is_none() {
            let intermediate = metadata_to_person::ActiveModel {
                role: ActiveValue::Set(data.role.clone()),
                metadata_id: ActiveValue::Set(pm.id.clone()),
                person_id: ActiveValue::Set(person.id.clone()),
                character: ActiveValue::Set(data.character.clone()),
                ..Default::default()
            };
            intermediate.insert(&ss.db).await.unwrap();
        }
        let search_for = MediaAssociatedPersonStateChanges {
            role: data.role.clone(),
            media: UniqueMediaIdentifier {
                lot: pm.lot,
                source: pm.source,
                identifier: pm.identifier.clone(),
            },
        };
        if !current_state_changes
            .metadata_associated
            .contains(&search_for)
        {
            notifications.push((
                format!(
                    "{} has been associated with {} as {}",
                    person.name, title, data.role
                ),
                UserNotificationContent::PersonMetadataAssociated,
            ));
            current_state_changes.metadata_associated.insert(search_for);
        }
    }
    for (idx, data) in provider_person.related_metadata_groups.iter().enumerate() {
        let db_dg = match MetadataGroup::find()
            .filter(metadata_group::Column::Lot.eq(data.metadata_group.lot))
            .filter(metadata_group::Column::Source.eq(data.metadata_group.source))
            .filter(metadata_group::Column::Identifier.eq(&data.metadata_group.identifier))
            .one(&ss.db)
            .await?
        {
            Some(m) => m.id,
            None => {
                let m = metadata_group::ActiveModel {
                    is_partial: ActiveValue::Set(Some(true)),
                    lot: ActiveValue::Set(data.metadata_group.lot),
                    source: ActiveValue::Set(data.metadata_group.source),
                    title: ActiveValue::Set(data.metadata_group.title.clone()),
                    assets: ActiveValue::Set(data.metadata_group.assets.clone()),
                    identifier: ActiveValue::Set(data.metadata_group.identifier.clone()),
                    ..Default::default()
                };
                m.insert(&ss.db).await?.id
            }
        };
        let already_intermediate = MetadataGroupToPerson::find()
            .filter(metadata_group_to_person::Column::Role.eq(&data.role))
            .filter(metadata_group_to_person::Column::PersonId.eq(&person_id))
            .filter(metadata_group_to_person::Column::MetadataGroupId.eq(&db_dg))
            .one(&ss.db)
            .await?;
        if already_intermediate.is_none() {
            let intermediate = metadata_group_to_person::ActiveModel {
                role: ActiveValue::Set(data.role.clone()),
                metadata_group_id: ActiveValue::Set(db_dg),
                index: ActiveValue::Set(idx.try_into().unwrap()),
                person_id: ActiveValue::Set(person_id.to_owned()),
            };
            intermediate.insert(&ss.db).await?;
        }
        let search_for = MediaAssociatedPersonStateChanges {
            role: data.role.clone(),
            media: UniqueMediaIdentifier {
                lot: data.metadata_group.lot,
                source: data.metadata_group.source,
                identifier: data.metadata_group.identifier.clone(),
            },
        };
        if !current_state_changes
            .metadata_groups_associated
            .contains(&search_for)
        {
            notifications.push((
                format!(
                    "{} has been associated with {} as {}",
                    person.name, data.metadata_group.title, data.role
                ),
                UserNotificationContent::PersonMetadataGroupAssociated,
            ));
            current_state_changes
                .metadata_groups_associated
                .insert(search_for);
        }
    }
    to_update_person.state_changes = ActiveValue::Set(Some(current_state_changes));
    to_update_person.update(&ss.db).await.unwrap();
    Ok(UpdateMediaEntityResult { notifications })
}

pub async fn get_users_and_cte_monitoring_entity(
    entity_id: &String,
    entity_lot: EntityLot,
    db: &DatabaseConnection,
) -> Result<Vec<(String, Uuid)>> {
    let all_entities = MonitoredEntity::find()
        .select_only()
        .column(monitored_entity::Column::UserId)
        .column(monitored_entity::Column::CollectionToEntityId)
        .filter(monitored_entity::Column::EntityId.eq(entity_id))
        .filter(monitored_entity::Column::EntityLot.eq(entity_lot))
        .into_tuple::<(String, Uuid)>()
        .all(db)
        .await?;
    Ok(all_entities)
}

pub async fn get_users_monitoring_entity(
    entity_id: &String,
    entity_lot: EntityLot,
    db: &DatabaseConnection,
) -> Result<Vec<String>> {
    Ok(
        get_users_and_cte_monitoring_entity(entity_id, entity_lot, db)
            .await?
            .into_iter()
            .map(|(u, _)| u)
            .collect_vec(),
    )
}

pub async fn send_notification_for_user(
    user_id: &String,
    ss: &Arc<SupportingService>,
    (msg, change): &(String, UserNotificationContent),
) -> Result<()> {
    let notification_platforms = NotificationPlatform::find()
        .filter(notification_platform::Column::UserId.eq(user_id))
        .all(&ss.db)
        .await?;
    for platform in notification_platforms {
        if platform.is_disabled.unwrap_or_default() {
            ryot_log!(
                debug,
                "Skipping sending notification to user: {} for platform: {} since it is disabled",
                user_id,
                platform.lot
            );
            continue;
        }
        if !platform.configured_events.contains(change) {
            ryot_log!(
                debug,
                "Skipping sending notification to user: {} for platform: {} since it is not configured for this event",
                user_id,
                platform.lot,
            );
            continue;
        }
        if let Err(err) = send_notification(platform.platform_specifics, msg).await {
            ryot_log!(trace, "Error sending notification: {:?}", err);
        }
    }
    Ok(())
}

pub async fn refresh_collection_to_entity_association(
    cte_id: &Uuid,
    db: &DatabaseConnection,
) -> Result<()> {
    ryot_log!(
        debug,
        "Refreshing collection to entity association for id = {cte_id}"
    );
    CollectionToEntity::update_many()
        .col_expr(
            collection_to_entity::Column::LastUpdatedOn,
            Expr::value(Utc::now()),
        )
        .filter(collection_to_entity::Column::Id.eq(cte_id.to_owned()))
        .exec(db)
        .await?;
    Ok(())
}

pub async fn update_metadata_and_notify_users(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = update_metadata(metadata_id, ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify =
            get_users_and_cte_monitoring_entity(metadata_id, EntityLot::Metadata, &ss.db).await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification)
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}

pub async fn update_person_and_notify_users(
    person_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = update_person(person_id.clone(), ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify =
            get_users_and_cte_monitoring_entity(person_id, EntityLot::Person, &ss.db).await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification)
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}

pub async fn update_metadata_group_and_notify_users(
    metadata_group_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = update_metadata_group(metadata_group_id, ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify = get_users_and_cte_monitoring_entity(
            metadata_group_id,
            EntityLot::MetadataGroup,
            &ss.db,
        )
        .await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification)
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}

pub async fn commit_metadata_group(
    input: CommitMetadataGroupInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    match MetadataGroup::find()
        .filter(metadata_group::Column::Lot.eq(input.unique.lot))
        .filter(metadata_group::Column::Source.eq(input.unique.source))
        .filter(metadata_group::Column::Identifier.eq(&input.unique.identifier))
        .one(&ss.db)
        .await?
        .map(|m| StringIdObject { id: m.id })
    {
        Some(m) => Ok(m),
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = input.image.clone() {
                assets.remote_images = vec![i];
            }
            let new_group = metadata_group::ActiveModel {
                assets: ActiveValue::Set(assets),
                title: ActiveValue::Set(input.name),
                lot: ActiveValue::Set(input.unique.lot),
                is_partial: ActiveValue::Set(Some(true)),
                source: ActiveValue::Set(input.unique.source),
                identifier: ActiveValue::Set(input.unique.identifier.clone()),
                parts: ActiveValue::Set(input.parts.unwrap_or_default().try_into().unwrap()),
                ..Default::default()
            };
            let new_group = new_group.insert(&ss.db).await?;
            Ok(StringIdObject { id: new_group.id })
        }
    }
}

pub async fn commit_person(
    data: CommitPersonInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    match Person::find()
        .filter(person::Column::Source.eq(data.source))
        .filter(person::Column::Identifier.eq(&data.identifier))
        .filter(match data.source_specifics.clone() {
            None => person::Column::SourceSpecifics.is_null(),
            Some(specifics) => person::Column::SourceSpecifics.eq(specifics),
        })
        .one(&ss.db)
        .await?
        .map(|p| StringIdObject { id: p.id })
    {
        Some(p) => Ok(p),
        None => {
            let mut assets = EntityAssets::default();
            if let Some(i) = data.image.clone() {
                assets.remote_images = vec![i];
            }
            let person = person::ActiveModel {
                assets: ActiveValue::Set(assets),
                name: ActiveValue::Set(data.name),
                source: ActiveValue::Set(data.source),
                is_partial: ActiveValue::Set(Some(true)),
                identifier: ActiveValue::Set(data.identifier),
                source_specifics: ActiveValue::Set(data.source_specifics),
                ..Default::default()
            };
            let person = person.insert(&ss.db).await?;
            Ok(StringIdObject { id: person.id })
        }
    }
}

pub async fn deploy_update_metadata_job(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateMetadata(
        metadata_id.to_owned(),
    )))
    .await?;
    Ok(true)
}

pub async fn deploy_update_metadata_group_job(
    metadata_group_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateMetadataGroup(
        metadata_group_id.to_owned(),
    )))
    .await?;
    Ok(true)
}

pub async fn deploy_update_person_job(
    person_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdatePerson(
        person_id.to_owned(),
    )))
    .await?;
    Ok(true)
}

pub async fn deploy_background_job(
    user_id: &String,
    job_name: BackgroundJob,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    match job_name {
        BackgroundJob::UpdateAllMetadata
        | BackgroundJob::UpdateAllExercises
        | BackgroundJob::PerformBackgroundTasks => {
            admin_account_guard(user_id, ss).await?;
        }
        _ => {}
    }
    match job_name {
        BackgroundJob::UpdateAllMetadata => {
            Metadata::update_many()
                .col_expr(metadata::Column::IsPartial, Expr::value(true))
                .exec(&ss.db)
                .await?;
            let many_metadata = Metadata::find()
                .select_only()
                .column(metadata::Column::Id)
                .order_by_asc(metadata::Column::LastUpdatedOn)
                .into_tuple::<String>()
                .all(&ss.db)
                .await
                .unwrap();
            for metadata_id in many_metadata {
                deploy_update_metadata_job(&metadata_id, ss).await?;
            }
        }
        BackgroundJob::UpdateAllExercises => {
            ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateExerciseLibrary))
                .await?;
        }
        BackgroundJob::PerformBackgroundTasks => {
            ss.perform_application_job(ApplicationJob::Mp(
                MpApplicationJob::PerformBackgroundTasks,
            ))
            .await?;
        }
        BackgroundJob::SyncIntegrationsData => {
            ss.perform_application_job(ApplicationJob::Hp(
                HpApplicationJob::SyncUserIntegrationsData(user_id.to_owned()),
            ))
            .await?;
        }
        BackgroundJob::CalculateUserActivitiesAndSummary => {
            ss.perform_application_job(ApplicationJob::Hp(
                HpApplicationJob::RecalculateUserActivitiesAndSummary(user_id.to_owned(), true),
            ))
            .await?;
        }
        BackgroundJob::ReviseUserWorkouts => {
            ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::ReviseUserWorkouts(
                user_id.to_owned(),
            )))
            .await?;
        }
    };
    Ok(true)
}

pub async fn get_entity_title_from_id_and_lot(
    id: &String,
    lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let obj_title = match lot {
        EntityLot::Metadata => Metadata::find_by_id(id).one(&ss.db).await?.unwrap().title,
        EntityLot::MetadataGroup => {
            MetadataGroup::find_by_id(id)
                .one(&ss.db)
                .await?
                .unwrap()
                .title
        }
        EntityLot::Person => Person::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::Collection => Collection::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::Exercise => id.clone(),
        EntityLot::Workout => Workout::find_by_id(id).one(&ss.db).await?.unwrap().name,
        EntityLot::WorkoutTemplate => {
            WorkoutTemplate::find_by_id(id)
                .one(&ss.db)
                .await?
                .unwrap()
                .name
        }
        EntityLot::Review | EntityLot::UserMeasurement => {
            unreachable!()
        }
    };
    Ok(obj_title)
}

pub async fn post_review(
    user_id: &String,
    input: CreateOrUpdateReviewInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    let preferences = user_by_id(user_id, ss).await?.preferences;
    if preferences.general.disable_reviews {
        return Err(Error::new("Reviews are disabled"));
    }
    let show_ei = if input.show_season_number.is_some() || input.show_episode_number.is_some() {
        Some(SeenShowExtraOptionalInformation {
            season: input.show_season_number,
            episode: input.show_episode_number,
        })
    } else {
        None
    };
    let podcast_ei =
        input
            .podcast_episode_number
            .map(|episode| SeenPodcastExtraOptionalInformation {
                episode: Some(episode),
            });
    let anime_ei = input
        .anime_episode_number
        .map(|episode| SeenAnimeExtraInformation {
            episode: Some(episode),
        });
    let manga_ei = if input.manga_chapter_number.is_none() && input.manga_volume_number.is_none() {
        None
    } else {
        Some(SeenMangaExtraInformation {
            chapter: input.manga_chapter_number,
            volume: input.manga_volume_number,
        })
    };

    if input.rating.is_none() && input.text.is_none() {
        return Err(Error::new("At-least one of rating or review is required."));
    }
    let mut review_obj =
        review::ActiveModel {
            id: match input.review_id.clone() {
                Some(i) => ActiveValue::Unchanged(i),
                None => ActiveValue::NotSet,
            },
            rating: ActiveValue::Set(input.rating.map(
                |r| match preferences.general.review_scale {
                    UserReviewScale::OutOfTen => r * dec!(10),
                    UserReviewScale::OutOfFive => r * dec!(20),
                    UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => r,
                },
            )),
            text: ActiveValue::Set(input.text),
            user_id: ActiveValue::Set(user_id.to_owned()),
            show_extra_information: ActiveValue::Set(show_ei),
            anime_extra_information: ActiveValue::Set(anime_ei),
            manga_extra_information: ActiveValue::Set(manga_ei),
            podcast_extra_information: ActiveValue::Set(podcast_ei),
            comments: ActiveValue::Set(vec![]),
            ..Default::default()
        };
    let entity_id = input.entity_id.clone();
    match input.entity_lot {
        EntityLot::Metadata => review_obj.metadata_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::Person => review_obj.person_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::MetadataGroup => {
            review_obj.metadata_group_id = ActiveValue::Set(Some(entity_id))
        }
        EntityLot::Collection => review_obj.collection_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::Exercise => review_obj.exercise_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::Workout
        | EntityLot::WorkoutTemplate
        | EntityLot::Review
        | EntityLot::UserMeasurement => unreachable!(),
    };
    if let Some(s) = input.is_spoiler {
        review_obj.is_spoiler = ActiveValue::Set(s);
    }
    if let Some(v) = input.visibility {
        review_obj.visibility = ActiveValue::Set(v);
    }
    if let Some(d) = input.date {
        review_obj.posted_on = ActiveValue::Set(d);
    }
    let insert = review_obj.save(&ss.db).await.unwrap();
    if insert.visibility.unwrap() == Visibility::Public {
        let entity_lot = insert.entity_lot.unwrap();
        let id = insert.entity_id.unwrap();
        let obj_title = get_entity_title_from_id_and_lot(&id, entity_lot, ss).await?;
        let user = user_by_id(&insert.user_id.unwrap(), ss).await?;
        // DEV: Do not send notification if updating a review
        if input.review_id.is_none() {
            ss.perform_application_job(ApplicationJob::Hp(HpApplicationJob::ReviewPosted(
                ReviewPostedEvent {
                    obj_title,
                    entity_lot,
                    obj_id: id,
                    username: user.name,
                    review_id: insert.id.clone().unwrap(),
                },
            )))
            .await?;
        }
    }
    mark_entity_as_recently_consumed(user_id, &input.entity_id, input.entity_lot, ss).await?;
    associate_user_with_entity(user_id, &input.entity_id, input.entity_lot, ss).await?;
    Ok(StringIdObject {
        id: insert.id.unwrap(),
    })
}

async fn seen_history(
    user_id: &String,
    metadata_id: &String,
    db: &DatabaseConnection,
) -> Result<Vec<seen::Model>> {
    let seen_items = Seen::find()
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::MetadataId.eq(metadata_id))
        .order_by_desc(seen::Column::LastUpdatedOn)
        .all(db)
        .await
        .unwrap();
    Ok(seen_items)
}

pub async fn is_metadata_finished_by_user(
    user_id: &String,
    metadata_id: &String,
    db: &DatabaseConnection,
) -> Result<(bool, Vec<seen::Model>)> {
    let metadata = Metadata::find_by_id(metadata_id)
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let seen_history = seen_history(user_id, metadata_id, db).await?;
    let is_finished = if metadata.lot == MediaLot::Podcast
        || metadata.lot == MediaLot::Show
        || metadata.lot == MediaLot::Anime
        || metadata.lot == MediaLot::Manga
    {
        // DEV: If all episodes have been seen the same number of times, the media can be
        // considered finished.
        let all_episodes = if let Some(s) = metadata.show_specifics {
            s.seasons
                .into_iter()
                .filter(|s| !SHOW_SPECIAL_SEASON_NAMES.contains(&s.name.as_str()))
                .flat_map(|s| {
                    s.episodes
                        .into_iter()
                        .map(move |e| format!("{}-{}", s.season_number, e.episode_number))
                })
                .collect_vec()
        } else if let Some(p) = metadata.podcast_specifics {
            p.episodes
                .into_iter()
                .map(|e| format!("{}", e.number))
                .collect_vec()
        } else if let Some(e) = metadata.anime_specifics.and_then(|a| a.episodes) {
            (1..e + 1).map(|e| format!("{}", e)).collect_vec()
        } else if let Some(c) = metadata.manga_specifics.and_then(|m| m.chapters) {
            let one = Decimal::one();
            (0..c.to_u32().unwrap_or(0))
                .map(|i| Decimal::from(i) + one)
                .map(|d| d.to_string())
                .collect_vec()
        } else {
            vec![]
        };
        if all_episodes.is_empty() {
            return Ok((true, seen_history));
        }
        let mut bag =
            HashMap::<String, i32>::from_iter(all_episodes.iter().cloned().map(|e| (e, 0)));
        seen_history
            .clone()
            .into_iter()
            .map(|h| {
                if let Some(s) = h.show_extra_information {
                    format!("{}-{}", s.season, s.episode)
                } else if let Some(p) = h.podcast_extra_information {
                    format!("{}", p.episode)
                } else if let Some(a) = h.anime_extra_information.and_then(|a| a.episode) {
                    format!("{}", a)
                } else if let Some(m) = h.manga_extra_information.and_then(|m| m.chapter) {
                    format!("{}", m)
                } else {
                    String::new()
                }
            })
            .for_each(|ep| {
                bag.entry(ep).and_modify(|c| *c += 1);
            });
        let values = bag.values().cloned().collect_vec();

        let min_value = values.iter().min();
        let max_value = values.iter().max();

        match (min_value, max_value) {
            (Some(min), Some(max)) => min == max && *min != 0,
            _ => false,
        }
    } else {
        seen_history.iter().any(|h| h.state == SeenState::Completed)
    };
    Ok((is_finished, seen_history))
}

pub async fn deploy_after_handle_media_seen_tasks(
    seen: seen::Model,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.perform_application_job(ApplicationJob::Lp(
        LpApplicationJob::HandleAfterMediaSeenTasks(Box::new(seen)),
    ))
    .await
}

pub async fn handle_after_metadata_seen_tasks(
    seen: seen::Model,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let add_entity_to_collection = |collection_name: &str| {
        add_entity_to_collection(
            &seen.user_id,
            ChangeCollectionToEntityInput {
                creator_user_id: seen.user_id.clone(),
                collection_name: collection_name.to_string(),
                entity_id: seen.metadata_id.clone(),
                entity_lot: EntityLot::Metadata,
                ..Default::default()
            },
            ss,
        )
    };
    let remove_entity_from_collection = |collection_name: &str| {
        remove_entity_from_collection(
            &seen.user_id,
            ChangeCollectionToEntityInput {
                creator_user_id: seen.user_id.clone(),
                collection_name: collection_name.to_string(),
                entity_id: seen.metadata_id.clone(),
                entity_lot: EntityLot::Metadata,
                ..Default::default()
            },
            ss,
        )
    };
    remove_entity_from_collection(&DefaultCollection::Watchlist.to_string())
        .await
        .ok();
    associate_user_with_entity(&seen.user_id, &seen.metadata_id, EntityLot::Metadata, ss).await?;
    expire_user_collections_list_cache(&seen.user_id, ss).await?;
    match seen.state {
        SeenState::InProgress => {
            for col in &[DefaultCollection::InProgress, DefaultCollection::Monitoring] {
                add_entity_to_collection(&col.to_string()).await.ok();
            }
        }
        SeenState::Dropped | SeenState::OnAHold => {
            remove_entity_from_collection(&DefaultCollection::InProgress.to_string())
                .await
                .ok();
        }
        SeenState::Completed => {
            let metadata = Metadata::find_by_id(&seen.metadata_id)
                .one(&ss.db)
                .await?
                .unwrap();
            if metadata.lot == MediaLot::Podcast
                || metadata.lot == MediaLot::Show
                || metadata.lot == MediaLot::Anime
                || metadata.lot == MediaLot::Manga
            {
                let (is_complete, _) =
                    is_metadata_finished_by_user(&seen.user_id, &seen.metadata_id, &ss.db).await?;
                if is_complete {
                    remove_entity_from_collection(&DefaultCollection::InProgress.to_string())
                        .await
                        .ok();
                    add_entity_to_collection(&DefaultCollection::Completed.to_string())
                        .await
                        .ok();
                } else {
                    for col in &[DefaultCollection::InProgress, DefaultCollection::Monitoring] {
                        add_entity_to_collection(&col.to_string()).await.ok();
                    }
                }
            } else {
                add_entity_to_collection(&DefaultCollection::Completed.to_string())
                    .await
                    .ok();
                for col in &[DefaultCollection::InProgress, DefaultCollection::Monitoring] {
                    remove_entity_from_collection(&col.to_string()).await.ok();
                }
            };
        }
    };
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(seen.user_id),
            key: ApplicationCacheKeyDiscriminants::UserCollectionContents,
        })
        .await?;
    Ok(())
}

pub async fn mark_entity_as_recently_consumed(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .set_key(
            ApplicationCacheKey::MetadataRecentlyConsumed(UserLevelCacheKey {
                user_id: user_id.to_owned(),
                input: MetadataRecentlyConsumedCacheInput {
                    entity_lot,
                    entity_id: entity_id.to_owned(),
                },
            }),
            ApplicationCacheValue::MetadataRecentlyConsumed(EmptyCacheValue::default()),
        )
        .await?;
    Ok(())
}

pub async fn get_entity_recently_consumed(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    Ok(ss
        .cache_service
        .get_value::<EmptyCacheValue>(ApplicationCacheKey::MetadataRecentlyConsumed(
            UserLevelCacheKey {
                user_id: user_id.to_owned(),
                input: MetadataRecentlyConsumedCacheInput {
                    entity_lot,
                    entity_id: entity_id.to_owned(),
                },
            },
        ))
        .await
        .is_some())
}

pub async fn progress_update(
    user_id: &String,
    // update only if media has not been consumed for this user in the last `n` duration
    respect_cache: bool,
    input: ProgressUpdateInput,
    ss: &Arc<SupportingService>,
) -> Result<ProgressUpdateResultUnion> {
    let cache_and_lock_key = ApplicationCacheKey::ProgressUpdateCache(UserLevelCacheKey {
        user_id: user_id.to_owned(),
        input: ProgressUpdateCacheInput {
            metadata_id: input.metadata_id.clone(),
            show_season_number: input.show_season_number,
            show_episode_number: input.show_episode_number,
            manga_volume_number: input.manga_volume_number,
            manga_chapter_number: input.manga_chapter_number,
            anime_episode_number: input.anime_episode_number,
            podcast_episode_number: input.podcast_episode_number,
            provider_watched_on: input.provider_watched_on.clone(),
        },
    });
    if respect_cache {
        let in_cache = ss
            .cache_service
            .get_value::<EmptyCacheValue>(cache_and_lock_key.clone())
            .await;
        if in_cache.is_some() {
            ryot_log!(debug, "Seen is already in cache");
            return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                error: ProgressUpdateErrorVariant::AlreadySeen,
            }));
        }
    }
    ryot_log!(debug, "Input for progress_update = {:?}", input);

    let all_prev_seen = Seen::find()
        .filter(seen::Column::Progress.lt(100))
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::State.ne(SeenState::Dropped))
        .filter(seen::Column::MetadataId.eq(&input.metadata_id))
        .order_by_desc(seen::Column::LastUpdatedOn)
        .all(&ss.db)
        .await
        .unwrap();
    #[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy)]
    enum ProgressUpdateAction {
        Update,
        Now,
        InThePast,
        JustStarted,
        ChangeState,
    }
    let action = match input.change_state {
        None => match input.progress {
            None => ProgressUpdateAction::ChangeState,
            Some(p) => {
                if p == dec!(100) {
                    match input.date {
                        None => ProgressUpdateAction::InThePast,
                        Some(u) => {
                            if get_current_date(&ss.timezone) == u {
                                if all_prev_seen.is_empty() {
                                    ProgressUpdateAction::Now
                                } else {
                                    ProgressUpdateAction::Update
                                }
                            } else {
                                ProgressUpdateAction::InThePast
                            }
                        }
                    }
                } else if all_prev_seen.is_empty() {
                    ProgressUpdateAction::JustStarted
                } else {
                    ProgressUpdateAction::Update
                }
            }
        },
        Some(_) => ProgressUpdateAction::ChangeState,
    };
    ryot_log!(debug, "Progress update action = {:?}", action);
    let err = || {
        Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
            error: ProgressUpdateErrorVariant::NoSeenInProgress,
        }))
    };
    let seen = match action {
        ProgressUpdateAction::Update => {
            let prev_seen = all_prev_seen[0].clone();
            let progress = input.progress.unwrap();
            let watched_on = prev_seen.provider_watched_on.clone();
            if prev_seen.progress == progress && watched_on == input.provider_watched_on {
                ryot_log!(debug, "No progress update required");
                return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                    error: ProgressUpdateErrorVariant::UpdateWithoutProgressUpdate,
                }));
            }
            let mut updated_at = prev_seen.updated_at.clone();
            let now = Utc::now();
            if prev_seen.progress != progress {
                updated_at.push(now);
            }
            let mut last_seen: seen::ActiveModel = prev_seen.into();
            last_seen.state = ActiveValue::Set(SeenState::InProgress);
            last_seen.progress = ActiveValue::Set(progress);
            last_seen.updated_at = ActiveValue::Set(updated_at);
            last_seen.provider_watched_on =
                ActiveValue::Set(input.provider_watched_on.or(watched_on));

            // This is needed for manga as some of the apps will update in weird orders
            // For example with komga mihon will update out of order to the server
            if input.manga_chapter_number.is_some() {
                last_seen.manga_extra_information =
                    ActiveValue::set(Some(SeenMangaExtraInformation {
                        chapter: input.manga_chapter_number,
                        volume: input.manga_volume_number,
                    }))
            }

            let ls = last_seen.update(&ss.db).await.unwrap();
            mark_entity_as_recently_consumed(user_id, &input.metadata_id, EntityLot::Metadata, ss)
                .await?;
            ls
        }
        ProgressUpdateAction::ChangeState => {
            let new_state = input.change_state.unwrap_or(SeenState::Dropped);
            let last_seen = Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(input.metadata_id.clone()))
                .order_by_desc(seen::Column::LastUpdatedOn)
                .one(&ss.db)
                .await
                .unwrap();
            match last_seen {
                Some(ls) => {
                    let watched_on = ls.provider_watched_on.clone();
                    let mut updated_at = ls.updated_at.clone();
                    let now = Utc::now();
                    updated_at.push(now);
                    let mut last_seen: seen::ActiveModel = ls.into();
                    last_seen.state = ActiveValue::Set(new_state);
                    last_seen.updated_at = ActiveValue::Set(updated_at);
                    last_seen.provider_watched_on =
                        ActiveValue::Set(input.provider_watched_on.or(watched_on));
                    last_seen.update(&ss.db).await.unwrap()
                }
                None => {
                    return err();
                }
            }
        }
        ProgressUpdateAction::Now
        | ProgressUpdateAction::InThePast
        | ProgressUpdateAction::JustStarted => {
            let meta = Metadata::find_by_id(&input.metadata_id)
                .one(&ss.db)
                .await
                .unwrap()
                .unwrap();
            ryot_log!(
                debug,
                "Progress update for meta {:?} ({:?})",
                meta.title,
                meta.lot
            );

            let show_ei = if matches!(meta.lot, MediaLot::Show) {
                let season = input.show_season_number.ok_or_else(|| {
                    Error::new("Season number is required for show progress update")
                })?;
                let episode = input.show_episode_number.ok_or_else(|| {
                    Error::new("Episode number is required for show progress update")
                })?;
                Some(SeenShowExtraInformation { season, episode })
            } else {
                None
            };
            let podcast_ei = if matches!(meta.lot, MediaLot::Podcast) {
                let episode = input.podcast_episode_number.ok_or_else(|| {
                    Error::new("Episode number is required for podcast progress update")
                })?;
                Some(SeenPodcastExtraInformation { episode })
            } else {
                None
            };
            let anime_ei = if matches!(meta.lot, MediaLot::Anime) {
                Some(SeenAnimeExtraInformation {
                    episode: input.anime_episode_number,
                })
            } else {
                None
            };
            let manga_ei = if matches!(meta.lot, MediaLot::Manga) {
                Some(SeenMangaExtraInformation {
                    chapter: input.manga_chapter_number,
                    volume: input.manga_volume_number,
                })
            } else {
                None
            };
            let finished_on = match action {
                ProgressUpdateAction::JustStarted => None,
                _ => input.date,
            };
            ryot_log!(debug, "Progress update finished on = {:?}", finished_on);
            let (progress, mut started_on) = match action {
                ProgressUpdateAction::JustStarted => {
                    mark_entity_as_recently_consumed(
                        user_id,
                        &input.metadata_id,
                        EntityLot::Metadata,
                        ss,
                    )
                    .await?;
                    (
                        input.progress.unwrap_or(dec!(0)),
                        Some(Utc::now().date_naive()),
                    )
                }
                _ => (dec!(100), None),
            };
            if matches!(action, ProgressUpdateAction::InThePast) && input.start_date.is_some() {
                started_on = input.start_date;
            }
            ryot_log!(debug, "Progress update percentage = {:?}", progress);
            let seen_insert = seen::ActiveModel {
                progress: ActiveValue::Set(progress),
                started_on: ActiveValue::Set(started_on),
                finished_on: ActiveValue::Set(finished_on),
                user_id: ActiveValue::Set(user_id.to_owned()),
                state: ActiveValue::Set(SeenState::InProgress),
                show_extra_information: ActiveValue::Set(show_ei),
                anime_extra_information: ActiveValue::Set(anime_ei),
                manga_extra_information: ActiveValue::Set(manga_ei),
                podcast_extra_information: ActiveValue::Set(podcast_ei),
                metadata_id: ActiveValue::Set(input.metadata_id.clone()),
                provider_watched_on: ActiveValue::Set(input.provider_watched_on),
                ..Default::default()
            };
            seen_insert.insert(&ss.db).await.unwrap()
        }
    };
    ryot_log!(debug, "Progress update = {:?}", seen);
    let id = seen.id.clone();
    if seen.state == SeenState::Completed && respect_cache {
        ss.cache_service
            .set_key(
                cache_and_lock_key,
                ApplicationCacheValue::ProgressUpdateCache(EmptyCacheValue::default()),
            )
            .await?;
    }
    if seen.state == SeenState::Completed {
        ss.perform_application_job(ApplicationJob::Lp(LpApplicationJob::HandleOnSeenComplete(
            seen.id.clone(),
        )))
        .await?;
    }
    deploy_after_handle_media_seen_tasks(seen, ss).await?;
    Ok(ProgressUpdateResultUnion::Ok(StringIdObject { id }))
}

fn convert_review_into_input(
    review: &ImportOrExportItemRating,
    preferences: &UserPreferences,
    entity_id: String,
    entity_lot: EntityLot,
) -> Option<CreateOrUpdateReviewInput> {
    if review.review.is_none() && review.rating.is_none() {
        ryot_log!(debug, "Skipping review since it has no content");
        return None;
    }
    let rating = match preferences.general.review_scale {
        UserReviewScale::OutOfTen => review.rating.map(|rating| rating / dec!(10)),
        UserReviewScale::OutOfFive => review.rating.map(|rating| rating / dec!(20)),
        UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => review.rating,
    };
    let text = review.review.clone().and_then(|r| r.text);
    let is_spoiler = review.review.clone().map(|r| r.spoiler.unwrap_or(false));
    let date = review.review.clone().map(|r| r.date);
    Some(CreateOrUpdateReviewInput {
        rating,
        text,
        is_spoiler,
        visibility: review.review.clone().and_then(|r| r.visibility),
        date: date.flatten(),
        entity_id,
        entity_lot,
        show_season_number: review.show_season_number,
        show_episode_number: review.show_episode_number,
        podcast_episode_number: review.podcast_episode_number,
        manga_chapter_number: review.manga_chapter_number,
        ..Default::default()
    })
}

pub async fn create_user_measurement(
    user_id: &String,
    mut input: user_measurement::Model,
    ss: &Arc<SupportingService>,
) -> Result<DateTimeUtc> {
    input.user_id = user_id.to_owned();

    let mut user = user_by_id(user_id, ss).await?;

    let mut needs_to_update_preferences = false;
    for measurement in input.information.statistics.iter() {
        let already_in_preferences = user
            .preferences
            .fitness
            .measurements
            .statistics
            .iter()
            .any(|stat| stat.name == measurement.name);
        if !already_in_preferences {
            user.preferences
                .fitness
                .measurements
                .statistics
                .push(UserStatisticsMeasurement {
                    name: measurement.name.clone(),
                    ..Default::default()
                });
            needs_to_update_preferences = true;
        }
    }

    if needs_to_update_preferences {
        let mut user_model: user::ActiveModel = user.clone().into();
        user_model.preferences = ActiveValue::Set(user.preferences);
        user_model.update(&ss.db).await?;
    }

    let um: user_measurement::ActiveModel = input.into();
    let um = um.insert(&ss.db).await?;
    expire_user_measurements_list_cache(user_id, ss).await?;
    Ok(um.timestamp)
}

fn get_best_set_index(records: &[WorkoutSetRecord]) -> Option<usize> {
    let record = records.iter().enumerate().max_by_key(|(_, record)| {
        record.statistic.duration.unwrap_or(dec!(0))
            + record.statistic.distance.unwrap_or(dec!(0))
            + record.statistic.reps.unwrap_or(dec!(0))
            + record.statistic.weight.unwrap_or(dec!(0))
    });
    record.and_then(|(_, r)| records.iter().position(|l| l.statistic == r.statistic))
}

fn get_index_of_highest_pb(
    records: &[WorkoutSetRecord],
    pb_type: &WorkoutSetPersonalBest,
) -> Option<usize> {
    let record = records
        .iter()
        .max_by_key(|record| get_personal_best(record, pb_type).unwrap_or(dec!(0)));
    record.and_then(|r| records.iter().position(|l| l.statistic == r.statistic))
}

fn calculate_one_rm(value: &WorkoutSetRecord) -> Option<Decimal> {
    let weight = value.statistic.weight?;
    let reps = value.statistic.reps?;
    let val = match reps < dec!(10) {
        true => (weight * dec!(36.0)).checked_div(dec!(37.0) - reps), // Brzycki
        false => weight.checked_mul((dec!(1).checked_add(reps.checked_div(dec!(30))?))?), // Epley
    };
    val.filter(|v| v <= &dec!(0))
}

fn calculate_volume(value: &WorkoutSetRecord) -> Option<Decimal> {
    Some(value.statistic.weight? * value.statistic.reps?)
}

fn calculate_pace(value: &WorkoutSetRecord) -> Option<Decimal> {
    value
        .statistic
        .distance?
        .checked_div(value.statistic.duration?)
}

fn get_personal_best(
    value: &WorkoutSetRecord,
    pb_type: &WorkoutSetPersonalBest,
) -> Option<Decimal> {
    match pb_type {
        WorkoutSetPersonalBest::Reps => value.statistic.reps,
        WorkoutSetPersonalBest::Pace => calculate_pace(value),
        WorkoutSetPersonalBest::OneRm => calculate_one_rm(value),
        WorkoutSetPersonalBest::Time => value.statistic.duration,
        WorkoutSetPersonalBest::Weight => value.statistic.weight,
        WorkoutSetPersonalBest::Volume => calculate_volume(value),
        WorkoutSetPersonalBest::Distance => value.statistic.distance,
    }
}

/// Set the invalid statistics to `None` according to the type of exercise.
fn clean_values(value: &mut UserWorkoutSetRecord, exercise_lot: &ExerciseLot) {
    let mut stats = WorkoutSetStatistic::default();
    match exercise_lot {
        ExerciseLot::Reps => {
            stats.reps = value.statistic.reps;
        }
        ExerciseLot::Duration => {
            stats.duration = value.statistic.duration;
        }
        ExerciseLot::RepsAndDuration => {
            stats.reps = value.statistic.reps;
            stats.duration = value.statistic.duration;
        }
        ExerciseLot::DistanceAndDuration => {
            stats.distance = value.statistic.distance;
            stats.duration = value.statistic.duration;
        }
        ExerciseLot::RepsAndWeight => {
            stats.reps = value.statistic.reps;
            stats.weight = value.statistic.weight;
        }
        ExerciseLot::RepsAndDurationAndDistance => {
            stats.reps = value.statistic.reps;
            stats.duration = value.statistic.duration;
            stats.distance = value.statistic.distance;
        }
    }
    value.statistic = stats;
}

pub async fn get_focused_workout_summary(
    exercises: &[ProcessedExercise],
    ss: &Arc<SupportingService>,
) -> WorkoutFocusedSummary {
    let db_exercises = Exercise::find()
        .filter(exercise::Column::Id.is_in(exercises.iter().map(|e| e.id.clone())))
        .all(&ss.db)
        .await
        .unwrap();
    let mut lots = HashMap::new();
    let mut levels = HashMap::new();
    let mut forces = HashMap::new();
    let mut muscles = HashMap::new();
    let mut equipments = HashMap::new();
    for (idx, ex) in exercises.iter().enumerate() {
        let exercise = db_exercises.iter().find(|e| e.id == ex.id).unwrap();
        lots.entry(exercise.lot).or_insert(vec![]).push(idx);
        levels.entry(exercise.level).or_insert(vec![]).push(idx);
        if let Some(force) = exercise.force {
            forces.entry(force).or_insert(vec![]).push(idx);
        }
        if let Some(equipment) = exercise.equipment {
            equipments.entry(equipment).or_insert(vec![]).push(idx);
        }
        exercise.muscles.iter().for_each(|m| {
            muscles.entry(*m).or_insert(vec![]).push(idx);
        });
    }
    let lots = lots
        .into_iter()
        .map(|(lot, exercises)| WorkoutLotFocusedSummary { lot, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let levels = levels
        .into_iter()
        .map(|(level, exercises)| WorkoutLevelFocusedSummary { level, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let forces = forces
        .into_iter()
        .map(|(force, exercises)| WorkoutForceFocusedSummary { force, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let muscles = muscles
        .into_iter()
        .map(|(muscle, exercises)| WorkoutMuscleFocusedSummary { muscle, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let equipments = equipments
        .into_iter()
        .map(|(equipment, exercises)| WorkoutEquipmentFocusedSummary {
            equipment,
            exercises,
        })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    WorkoutFocusedSummary {
        lots,
        levels,
        forces,
        muscles,
        equipments,
    }
}

/// Create a workout in the database and also update user and exercise associations.
pub async fn create_or_update_user_workout(
    user_id: &String,
    input: UserWorkoutInput,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let end_time = input.end_time;
    let mut duration: i32 = match input.duration {
        Some(d) => d.try_into().unwrap(),
        None => end_time
            .signed_duration_since(input.start_time)
            .num_seconds()
            .try_into()
            .unwrap(),
    };
    let mut input = input;
    let (new_workout_id, to_update_workout) = match &input.update_workout_id {
        Some(id) => {
            // DEV: Unwrap to make sure we error out early if the workout to edit does not exist
            let model = Workout::find_by_id(id).one(&ss.db).await?.unwrap();
            duration = model.duration;
            (id.to_owned(), Some(model))
        }
        None => (
            input
                .create_workout_id
                .clone()
                .unwrap_or_else(|| format!("wor_{}", nanoid!(12))),
            None,
        ),
    };
    ryot_log!(debug, "Creating workout with id = {}", new_workout_id);
    let mut exercises = vec![];
    let mut workout_totals = vec![];
    if input.exercises.is_empty() {
        return Err(Error::new("This workout has no associated exercises"));
    }
    let mut first_set_confirmed_at = input
        .exercises
        .first()
        .unwrap()
        .sets
        .first()
        .unwrap()
        .confirmed_at;
    for (exercise_idx, ex) in input.exercises.iter_mut().enumerate() {
        if ex.sets.is_empty() {
            return Err(Error::new("This exercise has no associated sets"));
        }
        let Some(db_ex) = Exercise::find_by_id(ex.exercise_id.clone())
            .one(&ss.db)
            .await?
        else {
            ryot_log!(debug, "Exercise with id = {} not found", ex.exercise_id);
            continue;
        };
        let mut sets = vec![];
        let mut totals = WorkoutOrExerciseTotals::default();
        let association = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(ex.exercise_id.clone()))
            .one(&ss.db)
            .await
            .ok()
            .flatten();
        let history_item = UserToExerciseHistoryExtraInformation {
            idx: exercise_idx,
            workout_end_on: end_time,
            workout_id: new_workout_id.clone(),
            ..Default::default()
        };
        let asc = match association {
            Some(e) => e,
            None => {
                let timestamp = first_set_confirmed_at.unwrap_or(end_time);
                let user_to_ex = user_to_entity::ActiveModel {
                    created_on: ActiveValue::Set(timestamp),
                    user_id: ActiveValue::Set(user_id.clone()),
                    last_updated_on: ActiveValue::Set(timestamp),
                    exercise_id: ActiveValue::Set(Some(ex.exercise_id.clone())),
                    exercise_extra_information: ActiveValue::Set(Some(
                        UserToExerciseExtraInformation::default(),
                    )),
                    ..Default::default()
                };
                user_to_ex.insert(&ss.db).await.unwrap()
            }
        };
        let last_updated_on = asc.last_updated_on;
        let mut extra_info = asc.exercise_extra_information.clone().unwrap_or_default();
        extra_info.history.insert(0, history_item);
        let mut to_update: user_to_entity::ActiveModel = asc.into();
        to_update.exercise_num_times_interacted =
            ActiveValue::Set(Some(extra_info.history.len().try_into().unwrap()));
        to_update.exercise_extra_information = ActiveValue::Set(Some(extra_info));
        to_update.last_updated_on =
            ActiveValue::Set(first_set_confirmed_at.unwrap_or(last_updated_on));
        let association = to_update.update(&ss.db).await?;
        totals.rest_time = ex
            .sets
            .iter()
            .map(|s| s.rest_time.unwrap_or_default())
            .sum();
        ex.sets
            .sort_unstable_by_key(|s| s.confirmed_at.unwrap_or_default());
        for set in ex.sets.iter_mut() {
            first_set_confirmed_at = set.confirmed_at;
            clean_values(set, &db_ex.lot);
            if let Some(r) = set.statistic.reps {
                totals.reps += r;
                if let Some(w) = set.statistic.weight {
                    totals.weight += w * r;
                }
            }
            if let Some(d) = set.statistic.duration {
                totals.duration += d;
            }
            if let Some(d) = set.statistic.distance {
                totals.distance += d;
            }
            let mut totals = WorkoutSetTotals::default();
            if let (Some(we), Some(re)) = (&set.statistic.weight, &set.statistic.reps) {
                totals.weight = Some(we * re);
            }
            let mut value = WorkoutSetRecord {
                lot: set.lot,
                rpe: set.rpe,
                totals: Some(totals),
                note: set.note.clone(),
                rest_time: set.rest_time,
                personal_bests: Some(vec![]),
                confirmed_at: set.confirmed_at,
                statistic: set.statistic.clone(),
                rest_timer_started_at: set.rest_timer_started_at,
            };
            value.statistic.one_rm = calculate_one_rm(&value);
            value.statistic.pace = calculate_pace(&value);
            value.statistic.volume = calculate_volume(&value);
            sets.push(value);
        }
        let mut personal_bests = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default()
            .personal_bests;
        let types_of_prs = db_ex.lot.meta();
        for best_type in types_of_prs.iter() {
            let set_idx = get_index_of_highest_pb(&sets, best_type).unwrap();
            let possible_record = personal_bests
                .iter()
                .find(|pb| pb.lot == *best_type)
                .and_then(|record| record.sets.first());
            let set = sets.get_mut(set_idx).unwrap();
            if let Some(r) = possible_record {
                if let Some(workout) = Workout::find_by_id(r.workout_id.clone())
                    .one(&ss.db)
                    .await?
                {
                    let workout_set = workout
                        .information
                        .exercises
                        .get(r.exercise_idx)
                        .and_then(|exercise| exercise.sets.get(r.set_idx));
                    let workout_set = match workout_set {
                        Some(s) => s,
                        None => {
                            ryot_log!(debug, "Workout set {} does not exist", r.set_idx);
                            continue;
                        }
                    };
                    if get_personal_best(set, best_type) > get_personal_best(workout_set, best_type)
                    {
                        if let Some(ref mut set_personal_bests) = set.personal_bests {
                            set_personal_bests.push(*best_type);
                        }
                        totals.personal_bests_achieved += 1;
                    }
                }
            } else {
                if let Some(ref mut set_personal_bests) = set.personal_bests {
                    set_personal_bests.push(*best_type);
                }
                totals.personal_bests_achieved += 1;
            }
        }
        workout_totals.push(totals.clone());
        for (set_idx, set) in sets.iter().enumerate() {
            if let Some(set_personal_bests) = &set.personal_bests {
                for best in set_personal_bests.iter() {
                    let to_insert_record = ExerciseBestSetRecord {
                        set_idx,
                        exercise_idx,
                        workout_id: new_workout_id.clone(),
                    };
                    if let Some(record) = personal_bests.iter_mut().find(|pb| pb.lot == *best) {
                        let mut data = record.sets.clone();
                        data.insert(0, to_insert_record);
                        record.sets = data;
                    } else {
                        personal_bests.push(UserToExerciseBestSetExtraInformation {
                            lot: *best,
                            sets: vec![to_insert_record],
                        });
                    }
                }
            }
        }
        let best_set = get_best_set_index(&sets).and_then(|i| sets.get(i).cloned());
        let mut association_extra_information = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default();
        association_extra_information.history[0].best_set = best_set.clone();
        let mut association: user_to_entity::ActiveModel = association.into();
        association_extra_information.lifetime_stats += totals.clone();
        association_extra_information.personal_bests = personal_bests;
        association.exercise_extra_information =
            ActiveValue::Set(Some(association_extra_information));
        association.update(&ss.db).await?;
        exercises.push((
            best_set,
            db_ex.lot,
            ProcessedExercise {
                sets,
                id: db_ex.id,
                lot: db_ex.lot,
                total: Some(totals),
                notes: ex.notes.clone(),
                assets: ex.assets.clone(),
                unit_system: ex.unit_system,
            },
        ));
    }
    input.supersets.retain(|s| {
        s.exercises.len() > 1
            && s.exercises
                .iter()
                .all(|s| exercises.get(*s as usize).is_some())
    });
    let summary_total = workout_totals.into_iter().sum();
    let processed_exercises = exercises
        .clone()
        .into_iter()
        .map(|(_, _, ex)| ex)
        .collect_vec();
    let focused = get_focused_workout_summary(&processed_exercises, ss).await;
    let model = workout::Model {
        end_time,
        duration,
        name: input.name,
        user_id: user_id.clone(),
        id: new_workout_id.clone(),
        start_time: input.start_time,
        template_id: input.template_id,
        repeated_from: input.repeated_from,
        calories_burnt: input.calories_burnt,
        information: WorkoutInformation {
            assets: input.assets,
            comment: input.comment,
            supersets: input.supersets,
            exercises: processed_exercises,
        },
        summary: WorkoutSummary {
            focused,
            total: Some(summary_total),
            exercises: exercises
                .clone()
                .into_iter()
                .map(|(best_set, lot, e)| WorkoutSummaryExercise {
                    best_set,
                    lot: Some(lot),
                    id: e.id.clone(),
                    num_sets: e.sets.len(),
                    unit_system: e.unit_system,
                })
                .collect(),
        },
    };
    let mut insert: workout::ActiveModel = model.into();
    if let Some(old_workout) = to_update_workout.clone() {
        insert.end_time = ActiveValue::Set(old_workout.end_time);
        insert.start_time = ActiveValue::Set(old_workout.start_time);
        insert.repeated_from = ActiveValue::Set(old_workout.repeated_from.clone());
        old_workout.delete(&ss.db).await?;
    }
    let data = insert.insert(&ss.db).await?;
    match to_update_workout {
        Some(_) => schedule_user_for_workout_revision(user_id, ss).await?,
        None => {
            if input.create_workout_id.is_none() {
                send_notification_for_user(
                    user_id,
                    ss,
                    &(
                        format!("New workout created - {}", data.name),
                        UserNotificationContent::NewWorkoutCreated,
                    ),
                )
                .await?
            }
        }
    };
    expire_user_workouts_list_cache(user_id, ss).await?;
    Ok(data.id)
}

async fn create_collection_and_add_entity_to_it(
    user_id: &String,
    entity_id: String,
    entity_lot: EntityLot,
    collection_name: String,
    ss: &Arc<SupportingService>,
    import_failed_set: &mut Vec<ImportFailedItem>,
) {
    if let Err(e) = create_or_update_collection(
        user_id,
        ss,
        CreateOrUpdateCollectionInput {
            name: collection_name.clone(),
            ..Default::default()
        },
    )
    .await
    {
        import_failed_set.push(ImportFailedItem {
            identifier: collection_name.clone(),
            step: ImportFailStep::DatabaseCommit,
            error: Some(format!("Failed to create collection {}", e.message)),
            ..Default::default()
        });
    }
    if let Err(e) = add_entity_to_collection(
        user_id,
        ChangeCollectionToEntityInput {
            entity_id,
            entity_lot,
            creator_user_id: user_id.clone(),
            collection_name: collection_name.to_string(),
            ..Default::default()
        },
        ss,
    )
    .await
    {
        import_failed_set.push(ImportFailedItem {
            identifier: collection_name.clone(),
            step: ImportFailStep::DatabaseCommit,
            error: Some(format!("Failed to add entity to collection {}", e.message)),
            ..Default::default()
        });
    };
}

pub fn generate_exercise_id(name: &str, lot: ExerciseLot, user_id: &str) -> String {
    format!("{}_{}_{}", name, lot, user_id)
}

pub async fn create_custom_exercise(
    user_id: &String,
    input: exercise::Model,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let mut input = input;
    input.source = ExerciseSource::Custom;
    input.created_by_user_id = Some(user_id.clone());
    input.id = generate_exercise_id(&input.name, input.lot, user_id);
    let input: exercise::ActiveModel = input.into();

    let exercise = input.insert(&ss.db).await?;
    ryot_log!(debug, "Created custom exercise with id = {}", exercise.id);
    add_entity_to_collection(
        &user_id.clone(),
        ChangeCollectionToEntityInput {
            entity_id: exercise.id.clone(),
            entity_lot: EntityLot::Exercise,
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
            ..Default::default()
        },
        ss,
    )
    .await?;
    Ok(exercise.id)
}

pub async fn process_import<F>(
    user_id: &String,
    respect_cache: bool,
    mut import: ImportResult,
    ss: &Arc<SupportingService>,
    on_item_processed: impl Fn(Decimal) -> F,
) -> Result<(ImportResult, ImportResultResponse)>
where
    F: Future<Output = Result<()>>,
{
    let preferences = user_by_id(user_id, ss).await?.preferences;

    let mut aggregated_metadata: HashMap<
        (MediaSource, String, MediaLot),
        ImportOrExportMetadataItem,
    > = HashMap::new();
    let mut other_items = Vec::new();

    for item in import.completed {
        match item {
            ImportCompletedItem::Metadata(mut current_metadata) => {
                let key = (
                    current_metadata.source,
                    current_metadata.identifier.clone(),
                    current_metadata.lot,
                );
                match aggregated_metadata.entry(key) {
                    Entry::Occupied(mut entry) => {
                        let existing_metadata = entry.get_mut();
                        existing_metadata
                            .seen_history
                            .append(&mut current_metadata.seen_history);
                        existing_metadata
                            .reviews
                            .append(&mut current_metadata.reviews);
                        existing_metadata
                            .collections
                            .append(&mut current_metadata.collections);
                    }
                    Entry::Vacant(entry) => {
                        entry.insert(current_metadata);
                    }
                }
            }
            other => {
                other_items.push(other);
            }
        }
    }

    import.completed = aggregated_metadata
        .into_values()
        .map(ImportCompletedItem::Metadata)
        .chain(other_items.into_iter())
        .collect();

    import.completed.retain(|i| match i {
        ImportCompletedItem::Metadata(m) => {
            !m.seen_history.is_empty() || !m.reviews.is_empty() || !m.collections.is_empty()
        }
        ImportCompletedItem::Person(p) => !p.reviews.is_empty() || !p.collections.is_empty(),
        ImportCompletedItem::MetadataGroup(m) => !m.reviews.is_empty() || !m.collections.is_empty(),
        _ => true,
    });

    import.completed.shuffle(&mut rand::rng());

    // DEV: We need to make sure that exercises are created first because workouts are
    // dependent on them.
    import.completed.sort_by_key(|i| match i {
        ImportCompletedItem::Exercise(_) => 0,
        _ => 1,
    });

    let source_result = import.clone();
    let total = import.completed.len();

    let mut need_to_schedule_user_for_workout_revision = false;

    for (idx, item) in import.completed.into_iter().enumerate() {
        ryot_log!(
            debug,
            "Processing item ({}) {}/{}",
            item.to_string(),
            idx + 1,
            total,
        );
        match item {
            ImportCompletedItem::Empty => {}
            ImportCompletedItem::Metadata(metadata) => {
                let db_metadata_id = match commit_metadata(
                    PartialMetadataWithoutId {
                        lot: metadata.lot,
                        source: metadata.source,
                        title: metadata.source_id.clone(),
                        identifier: metadata.identifier.clone(),
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(m) => m.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            lot: Some(metadata.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_string(),
                        });
                        continue;
                    }
                };
                let mut was_updated_successfully = false;
                for attempt in 0..MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE {
                    let is_partial = Metadata::find_by_id(&db_metadata_id)
                        .select_only()
                        .column(metadata::Column::IsPartial)
                        .into_tuple::<bool>()
                        .one(&ss.db)
                        .await?
                        .unwrap_or(true);
                    if is_partial {
                        deploy_update_metadata_job(&db_metadata_id, ss).await?;
                        let sleep_time = u64::pow(2, (attempt + 1).try_into().unwrap());
                        ryot_log!(debug, "Sleeping for {}s before metadata check", sleep_time);
                        sleep_for_n_seconds(sleep_time).await;
                    } else {
                        was_updated_successfully = true;
                        break;
                    }
                }
                if !was_updated_successfully {
                    import.failed.push(ImportFailedItem {
                        lot: Some(metadata.lot),
                        identifier: db_metadata_id.clone(),
                        step: ImportFailStep::MediaDetailsFromProvider,
                        error: Some("Progress update *might* be wrong".to_owned()),
                    });
                }
                for seen in metadata.seen_history.iter() {
                    let progress = match seen.progress {
                        Some(_p) => seen.progress,
                        None => Some(dec!(100)),
                    };
                    if let Err(e) = progress_update(
                        user_id,
                        respect_cache,
                        ProgressUpdateInput {
                            progress,
                            date: seen.ended_on,
                            start_date: seen.started_on,
                            metadata_id: db_metadata_id.clone(),
                            show_season_number: seen.show_season_number,
                            show_episode_number: seen.show_episode_number,
                            manga_volume_number: seen.manga_volume_number,
                            anime_episode_number: seen.anime_episode_number,
                            manga_chapter_number: seen.manga_chapter_number,
                            podcast_episode_number: seen.podcast_episode_number,
                            provider_watched_on: seen.provider_watched_on.clone(),
                            ..Default::default()
                        },
                        ss,
                    )
                    .await
                    {
                        import.failed.push(ImportFailedItem {
                            lot: Some(metadata.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_owned(),
                            error: Some(e.message),
                        });
                    };
                }
                for review in metadata.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                lot: Some(metadata.lot),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata.source_id.to_owned(),
                                error: Some(e.message),
                            });
                        };
                    }
                }
                for col in metadata.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::MetadataGroup(metadata_group) => {
                let db_metadata_group_id = match commit_metadata_group(
                    CommitMetadataGroupInput {
                        name: metadata_group.title.clone(),
                        unique: UniqueMediaIdentifier {
                            lot: metadata_group.lot,
                            source: metadata_group.source,
                            identifier: metadata_group.identifier.clone(),
                        },
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(m) => m.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            lot: Some(metadata_group.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata_group.title.to_string(),
                        });
                        continue;
                    }
                };
                deploy_update_metadata_group_job(&db_metadata_group_id, ss).await?;
                for review in metadata_group.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                lot: Some(metadata_group.lot),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata_group.title.to_owned(),
                                error: Some(e.message),
                            });
                        };
                    }
                }
                for col in metadata_group.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::Person(person) => {
                let db_person_id = match commit_person(
                    CommitPersonInput {
                        source: person.source,
                        name: person.name.clone(),
                        identifier: person.identifier.clone(),
                        source_specifics: person.source_specifics.clone(),
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(p) => p.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            identifier: person.name.to_string(),
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                        continue;
                    }
                };
                deploy_update_person_job(&db_person_id, ss).await?;
                for review in person.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_person_id.clone(),
                        EntityLot::Person,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                error: Some(e.message),
                                identifier: person.name.to_owned(),
                                step: ImportFailStep::DatabaseCommit,
                                ..Default::default()
                            });
                        };
                    }
                }
                for col in person.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_person_id.clone(),
                        EntityLot::Person,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::Collection(col_details) => {
                if let Err(e) = create_or_update_collection(user_id, ss, col_details.clone()).await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.message),
                        identifier: col_details.name.clone(),
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::Exercise(exercise) => {
                if let Err(e) = create_custom_exercise(user_id, exercise.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.message),
                        identifier: exercise.name.clone(),
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::Workout(workout) => {
                need_to_schedule_user_for_workout_revision = true;
                if let Err(err) = create_or_update_user_workout(user_id, workout.clone(), ss).await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.message),
                        identifier: workout.name,
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::ApplicationWorkout(workout) => {
                need_to_schedule_user_for_workout_revision = true;
                let workout_input = db_workout_to_workout_input(workout.details);
                match create_or_update_user_workout(user_id, workout_input.clone(), ss).await {
                    Err(err) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(err.message),
                            identifier: workout_input.name,
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                    }
                    Ok(workout_id) => {
                        for col in workout.collections.into_iter() {
                            create_collection_and_add_entity_to_it(
                                user_id,
                                workout_id.clone(),
                                EntityLot::Workout,
                                col,
                                ss,
                                &mut import.failed,
                            )
                            .await;
                        }
                    }
                }
            }
            ImportCompletedItem::Measurement(measurement) => {
                if let Err(err) = create_user_measurement(user_id, measurement.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.message),
                        step: ImportFailStep::DatabaseCommit,
                        identifier: measurement.timestamp.to_string(),
                        ..Default::default()
                    });
                }
            }
        }

        on_item_processed(
            Decimal::from_usize(idx + 1).unwrap() / Decimal::from_usize(total).unwrap() * dec!(100),
        )
        .await?;
    }

    if need_to_schedule_user_for_workout_revision {
        schedule_user_for_workout_revision(user_id, ss).await?;
    }

    let details = ImportResultResponse {
        failed_items: import.failed,
        import: ImportDetails { total },
    };

    Ok((source_result, details))
}

pub fn db_workout_to_workout_input(user_workout: workout::Model) -> UserWorkoutInput {
    UserWorkoutInput {
        name: user_workout.name,
        end_time: user_workout.end_time,
        start_time: user_workout.start_time,
        template_id: user_workout.template_id,
        assets: user_workout.information.assets,
        create_workout_id: Some(user_workout.id),
        repeated_from: user_workout.repeated_from,
        comment: user_workout.information.comment,
        calories_burnt: user_workout.calories_burnt,
        duration: Some(user_workout.duration.into()),
        supersets: user_workout.information.supersets,
        exercises: user_workout
            .information
            .exercises
            .into_iter()
            .map(|e| UserExerciseInput {
                notes: e.notes,
                assets: e.assets,
                exercise_id: e.id,
                unit_system: e.unit_system,
                sets: e
                    .sets
                    .into_iter()
                    .map(|s| UserWorkoutSetRecord {
                        lot: s.lot,
                        rpe: s.rpe,
                        note: s.note,
                        rest_time: s.rest_time,
                        statistic: s.statistic,
                        confirmed_at: s.confirmed_at,
                        rest_timer_started_at: s.rest_timer_started_at,
                    })
                    .collect(),
            })
            .collect(),
        ..Default::default()
    }
}

pub async fn add_entity_to_collection(
    user_id: &String,
    input: ChangeCollectionToEntityInput,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let collection = Collection::find()
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .filter(collection::Column::Name.eq(input.collection_name))
        .one(&ss.db)
        .await
        .unwrap()
        .unwrap();
    let mut updated: collection::ActiveModel = collection.into();
    updated.last_updated_on = ActiveValue::Set(Utc::now());
    let collection = updated.update(&ss.db).await.unwrap();
    let column = get_cte_column_from_lot(input.entity_lot);
    let resp = if let Some(etc) = CollectionToEntity::find()
        .filter(collection_to_entity::Column::CollectionId.eq(collection.id.clone()))
        .filter(column.eq(input.entity_id.clone()))
        .one(&ss.db)
        .await?
    {
        let mut to_update: collection_to_entity::ActiveModel = etc.into();
        to_update.last_updated_on = ActiveValue::Set(Utc::now());
        to_update.update(&ss.db).await?
    } else {
        let mut created_collection = collection_to_entity::ActiveModel {
            collection_id: ActiveValue::Set(collection.id),
            information: ActiveValue::Set(input.information),
            ..Default::default()
        };
        let id = input.entity_id.clone();
        match input.entity_lot {
            EntityLot::Metadata => created_collection.metadata_id = ActiveValue::Set(Some(id)),
            EntityLot::Person => created_collection.person_id = ActiveValue::Set(Some(id)),
            EntityLot::MetadataGroup => {
                created_collection.metadata_group_id = ActiveValue::Set(Some(id))
            }
            EntityLot::Exercise => created_collection.exercise_id = ActiveValue::Set(Some(id)),
            EntityLot::Workout => created_collection.workout_id = ActiveValue::Set(Some(id)),
            EntityLot::WorkoutTemplate => {
                created_collection.workout_template_id = ActiveValue::Set(Some(id))
            }
            EntityLot::Collection | EntityLot::Review | EntityLot::UserMeasurement => {
                unreachable!()
            }
        }
        let created = created_collection.insert(&ss.db).await?;
        ryot_log!(debug, "Created collection to entity: {:?}", created);
        match input.entity_lot {
            EntityLot::Workout
            | EntityLot::WorkoutTemplate
            | EntityLot::Review
            | EntityLot::UserMeasurement => {}
            _ => {
                associate_user_with_entity(user_id, &input.entity_id, input.entity_lot, ss)
                    .await
                    .ok();
            }
        }
        created
    };
    mark_entity_as_recently_consumed(user_id, &input.entity_id, input.entity_lot, ss).await?;
    ss.perform_application_job(ApplicationJob::Lp(
        LpApplicationJob::HandleEntityAddedToCollectionEvent(resp.id),
    ))
    .await?;
    expire_user_collections_list_cache(user_id, ss).await?;
    Ok(true)
}

pub async fn get_identifier_from_book_isbn(
    isbn: &str,
    hardcover_service: &HardcoverService,
    google_books_service: &GoogleBooksService,
    open_library_service: &OpenlibraryService,
) -> Option<(String, MediaSource)> {
    if let Some(id) = hardcover_service.id_from_isbn(isbn).await {
        return Some((id, MediaSource::Hardcover));
    }
    if let Some(id) = google_books_service.id_from_isbn(isbn).await {
        return Some((id, MediaSource::GoogleBooks));
    }
    if let Some(id) = open_library_service.id_from_isbn(isbn).await {
        return Some((id, MediaSource::Openlibrary));
    }
    None
}

pub async fn expire_user_collections_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let cache_key = ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
        input: (),
        user_id: user_id.to_owned(),
    });
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::ByKey(cache_key))
        .await?;
    Ok(())
}

pub async fn expire_user_workouts_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserWorkoutsList,
        })
        .await?;
    Ok(())
}

pub async fn expire_user_measurements_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserMeasurementsList,
        })
        .await?;
    Ok(())
}

pub async fn expire_user_workout_templates_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserWorkoutTemplatesList,
        })
        .await?;
    Ok(())
}

pub async fn expire_user_metadata_list_cache(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserMetadataList,
        })
        .await?;
    Ok(())
}

pub async fn create_or_update_collection(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: CreateOrUpdateCollectionInput,
) -> Result<StringIdObject> {
    ryot_log!(debug, "Creating or updating collection: {:?}", input);
    let txn = ss.db.begin().await?;
    let meta = Collection::find()
        .filter(collection::Column::Name.eq(input.name.clone()))
        .filter(collection::Column::UserId.eq(user_id))
        .one(&txn)
        .await
        .unwrap();
    let mut new_name = input.name.clone();
    let created = match meta {
        Some(m) if input.update_id.is_none() => m.id,
        _ => {
            let id = match input.update_id {
                None => ActiveValue::NotSet,
                Some(i) => {
                    let already = Collection::find_by_id(i.clone())
                        .one(&txn)
                        .await
                        .unwrap()
                        .unwrap();
                    if DefaultCollection::iter()
                        .map(|s| s.to_string())
                        .contains(&already.name)
                    {
                        new_name = already.name;
                    }
                    ActiveValue::Unchanged(i.clone())
                }
            };
            let col = collection::ActiveModel {
                id,
                name: ActiveValue::Set(new_name),
                user_id: ActiveValue::Set(user_id.to_owned()),
                last_updated_on: ActiveValue::Set(Utc::now()),
                description: ActiveValue::Set(input.description),
                information_template: ActiveValue::Set(input.information_template),
                ..Default::default()
            };
            let inserted = col
                .save(&txn)
                .await
                .map_err(|_| Error::new("There was an error creating the collection".to_owned()))?;
            let id = inserted.id.unwrap();
            let result = UserToEntity::delete_many()
                .filter(user_to_entity::Column::CollectionId.eq(&id))
                .exec(&txn)
                .await?;
            ryot_log!(debug, "Deleted old user to entity: {:?}", result);
            let mut collaborators = HashSet::from([user_id.to_owned()]);
            if let Some(input_collaborators) = input.collaborators {
                collaborators.extend(input_collaborators);
            }
            ryot_log!(debug, "Collaborators: {:?}", collaborators);
            for c in collaborators {
                UserToEntity::insert(user_to_entity::ActiveModel {
                    user_id: ActiveValue::Set(c.clone()),
                    last_updated_on: ActiveValue::Set(Utc::now()),
                    collection_id: ActiveValue::Set(Some(id.clone())),
                    collection_extra_information: match &c == user_id {
                        true => ActiveValue::Set(input.extra_information.clone()),
                        _ => Default::default(),
                    },
                    ..Default::default()
                })
                .on_conflict(
                    OnConflict::new()
                        .exprs([
                            Expr::col(user_to_entity::Column::UserId),
                            Expr::col(user_to_entity::Column::CollectionId),
                        ])
                        .update_columns([
                            user_to_entity::Column::CollectionExtraInformation,
                            user_to_entity::Column::LastUpdatedOn,
                        ])
                        .to_owned(),
                )
                .exec_without_returning(&txn)
                .await?;
            }
            id
        }
    };
    txn.commit().await?;
    expire_user_collections_list_cache(user_id, ss).await?;
    Ok(StringIdObject { id: created })
}

pub async fn remove_entity_from_collection(
    user_id: &String,
    input: ChangeCollectionToEntityInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    let collect = Collection::find()
        .left_join(UserToEntity)
        .filter(collection::Column::Name.eq(input.collection_name))
        .filter(user_to_entity::Column::UserId.eq(input.creator_user_id))
        .one(&ss.db)
        .await
        .unwrap()
        .unwrap();
    let column = get_cte_column_from_lot(input.entity_lot);
    CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::CollectionId.eq(collect.id.clone()))
        .filter(column.eq(input.entity_id.clone()))
        .exec(&ss.db)
        .await?;
    if input.entity_lot != EntityLot::Workout && input.entity_lot != EntityLot::WorkoutTemplate {
        associate_user_with_entity(user_id, &input.entity_id, input.entity_lot, ss)
            .await
            .ok();
    }
    expire_user_collections_list_cache(user_id, ss).await?;
    Ok(StringIdObject { id: collect.id })
}

pub async fn user_metadata_list(
    user_id: &String,
    input: UserMetadataListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserMetadataListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserMetadataList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((id, cached)) = cc.get_value::<UserMetadataListResponse>(key.clone()).await {
        return Ok(CachedResponse {
            cache_id: id,
            response: cached,
        });
    }
    let preferences = user_by_id(user_id, ss).await?.preferences;

    let avg_rating_col = "user_average_rating";
    let cloned_user_id_1 = user_id.clone();
    let cloned_user_id_2 = user_id.clone();

    let order_by = input
        .sort
        .clone()
        .map(|a| graphql_to_db_order(a.order))
        .unwrap_or(Order::Asc);
    let review_scale = match preferences.general.review_scale {
        UserReviewScale::OutOfTen => 10,
        UserReviewScale::OutOfFive => 20,
        UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => 1,
    };
    let take = input
        .search
        .clone()
        .and_then(|s| s.take)
        .unwrap_or(preferences.general.list_page_size);
    let page: u64 = input
        .search
        .clone()
        .and_then(|s| s.page)
        .unwrap_or(1)
        .try_into()
        .unwrap();
    let paginator = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .expr_as(
            Func::round_with_precision(
                Func::avg(
                    Expr::col((AliasedReview::Table, AliasedReview::Rating)).div(review_scale),
                ),
                review_scale,
            ),
            avg_rating_col,
        )
        .group_by(metadata::Column::Id)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .apply_if(input.lot, |query, v| {
            query.filter(metadata::Column::Lot.eq(v))
        })
        .inner_join(UserToEntity)
        .join(
            JoinType::LeftJoin,
            metadata::Relation::Review
                .def()
                .on_condition(move |_left, right| {
                    Condition::all().add(
                        Expr::col((right, review::Column::UserId)).eq(cloned_user_id_1.clone()),
                    )
                }),
        )
        .join(
            JoinType::LeftJoin,
            metadata::Relation::Seen
                .def()
                .on_condition(move |_left, right| {
                    Condition::all()
                        .add(Expr::col((right, seen::Column::UserId)).eq(cloned_user_id_2.clone()))
                }),
        )
        .apply_if(input.search.and_then(|s| s.query), |query, v| {
            query.filter(
                Condition::any()
                    .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(&v)))
                    .add(Expr::col(metadata::Column::Description).ilike(ilike_sql(&v))),
            )
        })
        .apply_if(
            input.filter.clone().and_then(|f| f.date_range),
            |outer_query, outer_value| {
                outer_query
                    .apply_if(outer_value.start_date, |inner_query, inner_value| {
                        inner_query.filter(seen::Column::FinishedOn.gte(inner_value))
                    })
                    .apply_if(outer_value.end_date, |inner_query, inner_value| {
                        inner_query.filter(seen::Column::FinishedOn.lte(inner_value))
                    })
            },
        )
        .apply_if(
            input.filter.clone().and_then(|f| f.collections),
            |query, v| {
                apply_collection_filter(
                    metadata::Column::Id,
                    query,
                    collection_to_entity::Column::MetadataId,
                    v,
                )
            },
        )
        .apply_if(input.filter.and_then(|f| f.general), |query, v| match v {
            MediaGeneralFilter::All => query.filter(metadata::Column::Id.is_not_null()),
            MediaGeneralFilter::Rated => query.filter(review::Column::Id.is_not_null()),
            MediaGeneralFilter::Unrated => query.filter(review::Column::Id.is_null()),
            MediaGeneralFilter::Unfinished => query.filter(
                Expr::expr(
                    Expr::val(UserToMediaReason::Finished.to_string())
                        .eq(PgFunc::any(Expr::col(user_to_entity::Column::MediaReason))),
                )
                .not(),
            ),
            s => query.filter(seen::Column::State.eq(match s {
                MediaGeneralFilter::Dropped => SeenState::Dropped,
                MediaGeneralFilter::OnAHold => SeenState::OnAHold,
                _ => unreachable!(),
            })),
        })
        .apply_if(input.sort.map(|s| s.by), |query, v| match v {
            MediaSortBy::Title => query.order_by(metadata::Column::Title, order_by),
            MediaSortBy::Random => query.order_by(Expr::expr(Func::random()), order_by),
            MediaSortBy::TimesConsumed => query.order_by(seen::Column::Id.count(), order_by),
            MediaSortBy::LastUpdated => query
                .order_by(user_to_entity::Column::LastUpdatedOn, order_by)
                .group_by(user_to_entity::Column::LastUpdatedOn),
            MediaSortBy::ReleaseDate => query.order_by_with_nulls(
                metadata::Column::PublishYear,
                order_by,
                NullOrdering::Last,
            ),
            MediaSortBy::LastSeen => query.order_by_with_nulls(
                seen::Column::FinishedOn.max(),
                order_by,
                NullOrdering::Last,
            ),
            MediaSortBy::UserRating => query.order_by_with_nulls(
                Expr::col(Alias::new(avg_rating_col)),
                order_by,
                NullOrdering::Last,
            ),
            MediaSortBy::ProviderRating => query.order_by_with_nulls(
                metadata::Column::ProviderRating,
                order_by,
                NullOrdering::Last,
            ),
        })
        .into_tuple::<String>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut items = vec![];
    for c in paginator.fetch_page(page - 1).await? {
        items.push(c);
    }
    let response = SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages {
                Some((page + 1).try_into().unwrap())
            } else {
                None
            },
        },
    };
    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserMetadataList(response.clone()),
        )
        .await?;
    Ok(CachedResponse { cache_id, response })
}

pub async fn user_metadata_groups_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMetadataGroupsListInput,
) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserMetadataGroupsList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((cache_id, response)) = cc.get_value(key.clone()).await {
        return Ok(CachedResponse { cache_id, response });
    }

    let preferences = user_by_id(user_id, ss).await?.preferences;
    let page: u64 = input
        .search
        .clone()
        .and_then(|f| f.page)
        .unwrap_or(1)
        .try_into()
        .unwrap();
    let alias = "parts";
    let metadata_group_parts_col = Expr::col(Alias::new(alias));
    let (order_by, sort_order) = match input.sort {
        None => (metadata_group_parts_col, Order::Desc),
        Some(ord) => (
            match ord.by {
                PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                PersonAndMetadataGroupsSortBy::AssociatedEntityCount => metadata_group_parts_col,
                PersonAndMetadataGroupsSortBy::Name => Expr::col(metadata_group::Column::Title),
            },
            graphql_to_db_order(ord.order),
        ),
    };
    let take = input
        .search
        .clone()
        .and_then(|s| s.take)
        .unwrap_or(preferences.general.list_page_size);
    let paginator = MetadataGroup::find()
        .select_only()
        .column(metadata_group::Column::Id)
        .group_by(metadata_group::Column::Id)
        .inner_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .filter(metadata_group::Column::Id.is_not_null())
        .apply_if(input.search.and_then(|f| f.query), |query, v| {
            query.filter(
                Condition::all().add(Expr::col(metadata_group::Column::Title).ilike(ilike_sql(&v))),
            )
        })
        .apply_if(
            input.filter.clone().and_then(|f| f.collections),
            |query, v| {
                apply_collection_filter(
                    metadata_group::Column::Id,
                    query,
                    collection_to_entity::Column::MetadataGroupId,
                    v,
                )
            },
        )
        .order_by(order_by, sort_order)
        .into_tuple::<String>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut items = vec![];
    for c in paginator.fetch_page(page - 1).await? {
        items.push(c);
    }
    let response = SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages {
                Some((page + 1).try_into().unwrap())
            } else {
                None
            },
        },
    };
    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserMetadataGroupsList(response.clone()),
        )
        .await?;
    Ok(CachedResponse { cache_id, response })
}

pub async fn user_people_list(
    user_id: &String,
    input: UserPeopleListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserPeopleListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserPeopleList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.clone(),
    });
    if let Some((cache_id, response)) = cc.get_value::<UserPeopleListResponse>(key.clone()).await {
        return Ok(CachedResponse { cache_id, response });
    }

    let preferences = user_by_id(user_id, ss).await?.preferences;
    let page: u64 = input
        .search
        .clone()
        .and_then(|f| f.page)
        .unwrap_or(1)
        .try_into()
        .unwrap();
    let (order_by, sort_order) = match input.sort {
        None => (
            Expr::col(person::Column::AssociatedEntityCount),
            Order::Desc,
        ),
        Some(ord) => (
            match ord.by {
                PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                PersonAndMetadataGroupsSortBy::Name => Expr::col(person::Column::Name),
                PersonAndMetadataGroupsSortBy::AssociatedEntityCount => {
                    Expr::col(person::Column::AssociatedEntityCount)
                }
            },
            graphql_to_db_order(ord.order),
        ),
    };
    let take = input
        .search
        .clone()
        .and_then(|s| s.take)
        .unwrap_or(preferences.general.list_page_size);
    let creators_paginator = Person::find()
        .apply_if(input.search.clone().and_then(|s| s.query), |query, v| {
            query.filter(Condition::all().add(Expr::col(person::Column::Name).ilike(ilike_sql(&v))))
        })
        .apply_if(
            input.filter.clone().and_then(|f| f.collections),
            |query, v| {
                apply_collection_filter(
                    person::Column::Id,
                    query,
                    collection_to_entity::Column::PersonId,
                    v,
                )
            },
        )
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .left_join(MetadataToPerson)
        .inner_join(UserToEntity)
        .group_by(person::Column::Id)
        .group_by(person::Column::Name)
        .order_by(order_by, sort_order)
        .into_tuple::<String>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = creators_paginator.num_items_and_pages().await?;
    let mut items = vec![];
    for cr in creators_paginator.fetch_page(page - 1).await? {
        items.push(cr);
    }
    let response = SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages {
                Some((page + 1).try_into().unwrap())
            } else {
                None
            },
        },
    };
    let cache_id = cc
        .set_key(key, ApplicationCacheValue::UserPeopleList(response.clone()))
        .await?;
    Ok(CachedResponse { cache_id, response })
}

pub async fn user_workouts_list(
    user_id: &String,
    input: UserTemplatesOrWorkoutsListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserWorkoutsListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserWorkoutsList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((cache_id, response)) = cc.get_value(key.clone()).await {
        return Ok(CachedResponse { cache_id, response });
    }

    let preferences = user_by_id(user_id, ss).await?.preferences;
    let page = input.search.page.unwrap_or(1);
    let take = input
        .search
        .take
        .unwrap_or(preferences.general.list_page_size);
    let paginator = Workout::find()
        .select_only()
        .column(workout::Column::Id)
        .filter(workout::Column::UserId.eq(user_id))
        .apply_if(input.search.query, |query, v| {
            query.filter(Expr::col(workout::Column::Name).ilike(ilike_sql(&v)))
        })
        .apply_if(input.sort, |query, v| {
            query.order_by(
                match v.by {
                    UserTemplatesOrWorkoutsListSortBy::Random => Expr::expr(Func::random()),
                    UserTemplatesOrWorkoutsListSortBy::Time => Expr::col(workout::Column::EndTime),
                },
                graphql_to_db_order(v.order),
            )
        })
        .into_tuple::<String>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
    let response = SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages.try_into().unwrap() {
                Some(page + 1)
            } else {
                None
            },
        },
    };
    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserWorkoutsList(response.clone()),
        )
        .await?;
    Ok(CachedResponse { cache_id, response })
}

pub async fn user_workout_templates_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserTemplatesOrWorkoutsListInput,
) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserWorkoutTemplatesList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((cache_id, response)) = cc.get_value(key.clone()).await {
        return Ok(CachedResponse { cache_id, response });
    }

    let preferences = user_by_id(user_id, ss).await?.preferences;
    let page = input.search.page.unwrap_or(1);
    let take = input
        .search
        .take
        .unwrap_or(preferences.general.list_page_size);
    let paginator = WorkoutTemplate::find()
        .select_only()
        .column(workout_template::Column::Id)
        .filter(workout_template::Column::UserId.eq(user_id))
        .apply_if(input.search.query, |query, v| {
            query.filter(Expr::col(workout_template::Column::Name).ilike(ilike_sql(&v)))
        })
        .apply_if(input.sort, |query, v| {
            query.order_by(
                match v.by {
                    UserTemplatesOrWorkoutsListSortBy::Random => Expr::expr(Func::random()),
                    UserTemplatesOrWorkoutsListSortBy::Time => {
                        Expr::col(workout_template::Column::CreatedOn)
                    }
                },
                graphql_to_db_order(v.order),
            )
        })
        .into_tuple::<String>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
    let response = SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages.try_into().unwrap() {
                Some(page + 1)
            } else {
                None
            },
        },
    };
    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserWorkoutTemplatesList(response.clone()),
        )
        .await?;
    Ok(CachedResponse { cache_id, response })
}

pub async fn user_exercises_list(
    user_id: &String,
    input: UserExercisesListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserExercisesListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserExercisesList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((cache_id, response)) = cc.get_value(key.clone()).await {
        return Ok(CachedResponse { cache_id, response });
    }

    let preferences = user_by_id(user_id, ss).await?.preferences;
    let user_id = user_id.to_owned();
    let take = input
        .search
        .take
        .unwrap_or(preferences.general.list_page_size);
    let page = input.search.page.unwrap_or(1);
    let ex = Alias::new("exercise");
    let etu = Alias::new("user_to_entity");
    let order_by_col = match input.sort_by {
        None => Expr::col((ex, exercise::Column::Id)),
        Some(sb) => match sb {
            // DEV: This is just a small hack to reduce duplicated code. We
            // are ordering by name for the other `sort_by` anyway.
            ExerciseSortBy::Name => Expr::val("1"),
            ExerciseSortBy::Random => Expr::expr(Func::random()),
            ExerciseSortBy::TimesPerformed => Expr::expr(Func::coalesce([
                Expr::col((
                    etu.clone(),
                    user_to_entity::Column::ExerciseNumTimesInteracted,
                ))
                .into(),
                Expr::val(0).into(),
            ])),
            ExerciseSortBy::LastPerformed => Expr::expr(Func::coalesce([
                Expr::col((etu.clone(), user_to_entity::Column::LastUpdatedOn)).into(),
                // DEV: For some reason this does not work without explicit casting on postgres
                Func::cast_as(Expr::val("1900-01-01"), Alias::new("timestamptz")).into(),
            ])),
        },
    };
    let paginator = Exercise::find()
        .select_only()
        .column(exercise::Column::Id)
        .filter(
            exercise::Column::Source
                .eq(ExerciseSource::Github)
                .or(exercise::Column::CreatedByUserId.eq(&user_id)),
        )
        .apply_if(input.filter, |query, q| {
            query
                .apply_if(q.lot, |q, v| q.filter(exercise::Column::Lot.eq(v)))
                .apply_if(q.muscle, |q, v| {
                    q.filter(Expr::val(v).eq(PgFunc::any(Expr::col(exercise::Column::Muscles))))
                })
                .apply_if(q.level, |q, v| q.filter(exercise::Column::Level.eq(v)))
                .apply_if(q.force, |q, v| q.filter(exercise::Column::Force.eq(v)))
                .apply_if(q.mechanic, |q, v| {
                    q.filter(exercise::Column::Mechanic.eq(v))
                })
                .apply_if(q.equipment, |q, v| {
                    q.filter(exercise::Column::Equipment.eq(v))
                })
                .apply_if(q.collection, |q, v| {
                    q.left_join(CollectionToEntity)
                        .filter(collection_to_entity::Column::CollectionId.eq(v))
                })
        })
        .apply_if(input.search.query, |query, v| {
            query.filter(
                Condition::any()
                    .add(
                        Expr::col((AliasedExercise::Table, AliasedExercise::Id))
                            .ilike(ilike_sql(&v)),
                    )
                    .add(Expr::col(exercise::Column::Name).ilike(slugify(v))),
            )
        })
        .join(
            JoinType::LeftJoin,
            user_to_entity::Relation::Exercise
                .def()
                .rev()
                .on_condition(move |_left, right| {
                    Condition::all()
                        .add(Expr::col((right, user_to_entity::Column::UserId)).eq(&user_id))
                }),
        )
        .order_by_desc(order_by_col)
        .order_by_asc(exercise::Column::Id)
        .into_tuple::<String>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut items = vec![];
    for ex in paginator.fetch_page((page - 1).try_into().unwrap()).await? {
        items.push(ex);
    }
    let response = SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages.try_into().unwrap() {
                Some(page + 1)
            } else {
                None
            },
        },
    };
    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserExercisesList(response.clone()),
        )
        .await?;
    Ok(CachedResponse { cache_id, response })
}

pub async fn user_measurements_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMeasurementsListInput,
) -> Result<CachedResponse<UserMeasurementsListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserMeasurementsList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((cache_id, response)) = cc.get_value(key.clone()).await {
        return Ok(CachedResponse { cache_id, response });
    }

    let resp = UserMeasurement::find()
        .apply_if(input.start_time, |query, v| {
            query.filter(user_measurement::Column::Timestamp.gte(v))
        })
        .apply_if(input.end_time, |query, v| {
            query.filter(user_measurement::Column::Timestamp.lte(v))
        })
        .filter(user_measurement::Column::UserId.eq(user_id))
        .order_by_asc(user_measurement::Column::Timestamp)
        .all(&ss.db)
        .await?;

    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserMeasurementsList(resp.clone()),
        )
        .await?;
    Ok(CachedResponse {
        cache_id,
        response: resp,
    })
}

pub async fn generic_metadata(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<MetadataBaseData> {
    let Some(mut meta) = Metadata::find_by_id(metadata_id).one(&ss.db).await.unwrap() else {
        return Err(Error::new("The record does not exist".to_owned()));
    };
    let genres = meta
        .find_related(Genre)
        .order_by_asc(genre::Column::Name)
        .into_model::<GenreListItem>()
        .all(&ss.db)
        .await
        .unwrap();
    #[derive(Debug, FromQueryResult)]
    struct PartialCreator {
        id: String,
        name: String,
        role: String,
        assets: EntityAssets,
        character: Option<String>,
    }
    let crts = MetadataToPerson::find()
        .expr(Expr::col(Asterisk))
        .filter(metadata_to_person::Column::MetadataId.eq(&meta.id))
        .join(
            JoinType::Join,
            metadata_to_person::Relation::Person
                .def()
                .on_condition(|left, right| {
                    Condition::all().add(
                        Expr::col((left, metadata_to_person::Column::PersonId))
                            .equals((right, person::Column::Id)),
                    )
                }),
        )
        .order_by_asc(metadata_to_person::Column::Index)
        .into_model::<PartialCreator>()
        .all(&ss.db)
        .await?;
    let mut creators: HashMap<String, Vec<_>> = HashMap::new();
    for cr in crts {
        let creator = MetadataCreator {
            name: cr.name,
            id: Some(cr.id),
            character: cr.character,
            image: cr.assets.remote_images.first().cloned(),
        };
        creators
            .entry(cr.role)
            .and_modify(|e| {
                e.push(creator.clone());
            })
            .or_insert(vec![creator.clone()]);
    }
    if let Some(free_creators) = &meta.free_creators {
        for cr in free_creators.clone() {
            let creator = MetadataCreator {
                name: cr.name,
                image: cr.image,
                ..Default::default()
            };
            creators
                .entry(cr.role)
                .and_modify(|e| {
                    e.push(creator.clone());
                })
                .or_insert(vec![creator.clone()]);
        }
    }
    if let Some(ref mut d) = meta.description {
        *d = markdown_to_html_opts(
            d,
            &Options {
                compile: CompileOptions {
                    allow_dangerous_html: true,
                    allow_dangerous_protocol: true,
                    ..CompileOptions::default()
                },
                ..Options::default()
            },
        )
        .unwrap();
    }
    let creators = creators
        .into_iter()
        .sorted_by(|(k1, _), (k2, _)| k1.cmp(k2))
        .map(|(name, items)| MetadataCreatorGroupedByRole { name, items })
        .collect_vec();
    let suggestions = MetadataToMetadata::find()
        .select_only()
        .column(metadata_to_metadata::Column::ToMetadataId)
        .filter(metadata_to_metadata::Column::FromMetadataId.eq(&meta.id))
        .filter(metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion))
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    Ok(MetadataBaseData {
        genres,
        creators,
        model: meta,
        suggestions,
    })
}

pub async fn associate_user_with_entity(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let user_to_entity_model =
        get_user_to_entity_association(&ss.db, user_id, entity_id, entity_lot).await;

    let entity_id_owned = entity_id.to_owned();

    match user_to_entity_model {
        Some(u) => {
            let mut to_update: user_to_entity::ActiveModel = u.into();
            to_update.last_updated_on = ActiveValue::Set(Utc::now());
            to_update.needs_to_be_updated = ActiveValue::Set(Some(true));
            to_update.update(&ss.db).await.unwrap();
        }
        None => {
            let mut new_user_to_entity = user_to_entity::ActiveModel {
                user_id: ActiveValue::Set(user_id.to_owned()),
                last_updated_on: ActiveValue::Set(Utc::now()),
                needs_to_be_updated: ActiveValue::Set(Some(true)),
                ..Default::default()
            };

            match entity_lot {
                EntityLot::Metadata => {
                    new_user_to_entity.metadata_id = ActiveValue::Set(Some(entity_id_owned))
                }
                EntityLot::Person => {
                    new_user_to_entity.person_id = ActiveValue::Set(Some(entity_id_owned))
                }
                EntityLot::Exercise => {
                    new_user_to_entity.exercise_id = ActiveValue::Set(Some(entity_id_owned))
                }
                EntityLot::MetadataGroup => {
                    new_user_to_entity.metadata_group_id = ActiveValue::Set(Some(entity_id_owned))
                }
                EntityLot::Collection
                | EntityLot::Workout
                | EntityLot::WorkoutTemplate
                | EntityLot::Review
                | EntityLot::UserMeasurement => {
                    unreachable!()
                }
            }
            new_user_to_entity.insert(&ss.db).await.unwrap();
        }
    };
    expire_user_metadata_list_cache(user_id, ss).await?;
    Ok(())
}
