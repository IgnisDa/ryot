use std::{collections::HashMap, iter::zip, sync::Arc};

use anyhow::{bail, Result as AnyhowResult};
use apalis::prelude::{MemoryStorage, MessageQueue};
use application_utils::get_current_date;
use async_graphql::{Enum, Error, Result};
use background::{ApplicationJob, CoreApplicationJob};
use chrono::Utc;
use common_models::{
    ApplicationCacheKey, BackgroundJob, ChangeCollectionToEntityInput, DefaultCollection,
    MediaStateChanged, StoredUrl, StringIdObject,
};
use common_utils::{ryot_log, SHOW_SPECIAL_SEASON_NAMES};
use database_models::{
    genre, metadata, metadata_group, metadata_to_genre, metadata_to_metadata, metadata_to_person,
    monitored_entity, person,
    prelude::{
        Collection, Exercise, Genre, Metadata, MetadataGroup, MetadataToGenre, MetadataToMetadata,
        MetadataToPerson, MonitoredEntity, Person, Seen, UserToEntity, Workout,
    },
    queued_notification, review, seen, user_measurement, user_to_entity, workout,
};
use database_utils::{
    add_entity_to_collection, admin_account_guard, create_or_update_collection,
    deploy_job_to_re_evaluate_user_workouts, remove_entity_from_collection, user_by_id,
    user_preferences_by_id,
};
use dependent_models::ImportResult;
use enums::{EntityLot, MediaLot, MediaSource, MetadataToMetadataRelation, SeenState, Visibility};
use fitness_models::{
    ExerciseBestSetRecord, ProcessedExercise, UserExerciseInput,
    UserToExerciseBestSetExtraInformation, UserToExerciseExtraInformation,
    UserToExerciseHistoryExtraInformation, UserWorkoutInput, UserWorkoutSetRecord,
    WorkoutInformation, WorkoutOrExerciseTotals, WorkoutSetPersonalBest, WorkoutSetRecord,
    WorkoutSetTotals, WorkoutSummary, WorkoutSummaryExercise, LOT_MAPPINGS,
};
use importer_models::{ImportDetails, ImportFailStep, ImportFailedItem, ImportResultResponse};
use itertools::Itertools;
use media_models::{
    CommitCache, CommitMediaInput, CommitPersonInput, CreateOrUpdateCollectionInput,
    CreateOrUpdateReviewInput, ImportOrExportItemRating, MediaDetails, MetadataImage,
    PartialMetadata, PartialMetadataPerson, PartialMetadataWithoutId, ProgressUpdateError,
    ProgressUpdateErrorVariant, ProgressUpdateInput, ProgressUpdateResultUnion, ReviewPostedEvent,
    SeenAnimeExtraInformation, SeenMangaExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation,
};
use nanoid::nanoid;
use providers::{
    anilist::{AnilistAnimeService, AnilistMangaService},
    audible::AudibleService,
    google_books::GoogleBooksService,
    igdb::IgdbService,
    itunes::ITunesService,
    listennotes::ListennotesService,
    mal::{MalAnimeService, MalMangaService},
    manga_updates::MangaUpdatesService,
    openlibrary::OpenlibraryService,
    tmdb::{NonMediaTmdbService, TmdbMovieService, TmdbShowService},
    vndb::VndbService,
};
use rust_decimal::{
    prelude::{One, ToPrimitive},
    Decimal,
};
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::{DateTimeUtc, Expr},
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::{MediaProvider, TraceOk};
use user_models::{UserPreferences, UserReviewScale};

pub type Provider = Box<(dyn MediaProvider + Send + Sync)>;

pub async fn get_openlibrary_service(config: &config::AppConfig) -> Result<OpenlibraryService> {
    Ok(OpenlibraryService::new(&config.books.openlibrary, config.frontend.page_size).await)
}

pub async fn get_isbn_service(config: &config::AppConfig) -> Result<GoogleBooksService> {
    Ok(GoogleBooksService::new(&config.books.google_books, config.frontend.page_size).await)
}

pub async fn get_tmdb_non_media_service(
    ss: &Arc<SupportingService>,
) -> Result<NonMediaTmdbService> {
    Ok(NonMediaTmdbService::new(
        &ss.config.movies_and_shows.tmdb.access_token,
        ss.config.movies_and_shows.tmdb.locale.clone(),
        Arc::new(ss.timezone),
    )
    .await)
}

pub async fn get_metadata_provider(
    lot: MediaLot,
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<Provider> {
    let err = || Err(Error::new("This source is not supported".to_owned()));
    let service: Provider = match source {
        MediaSource::Vndb => {
            Box::new(VndbService::new(&ss.config.visual_novels, ss.config.frontend.page_size).await)
        }
        MediaSource::Openlibrary => Box::new(get_openlibrary_service(&ss.config).await?),
        MediaSource::Itunes => Box::new(
            ITunesService::new(&ss.config.podcasts.itunes, ss.config.frontend.page_size).await,
        ),
        MediaSource::GoogleBooks => Box::new(get_isbn_service(&ss.config).await?),
        MediaSource::Audible => Box::new(
            AudibleService::new(&ss.config.audio_books.audible, ss.config.frontend.page_size).await,
        ),
        MediaSource::Listennotes => Box::new(
            ListennotesService::new(&ss.config.podcasts, ss.config.frontend.page_size).await,
        ),
        MediaSource::Tmdb => match lot {
            MediaLot::Show => Box::new(
                TmdbShowService::new(
                    &ss.config.movies_and_shows.tmdb,
                    Arc::new(ss.timezone),
                    ss.config.frontend.page_size,
                )
                .await,
            ),
            MediaLot::Movie => Box::new(
                TmdbMovieService::new(
                    &ss.config.movies_and_shows.tmdb,
                    Arc::new(ss.timezone),
                    ss.config.frontend.page_size,
                )
                .await,
            ),
            _ => return err(),
        },
        MediaSource::Anilist => match lot {
            MediaLot::Anime => Box::new(
                AnilistAnimeService::new(
                    &ss.config.anime_and_manga.anilist,
                    ss.config.frontend.page_size,
                )
                .await,
            ),
            MediaLot::Manga => Box::new(
                AnilistMangaService::new(
                    &ss.config.anime_and_manga.anilist,
                    ss.config.frontend.page_size,
                )
                .await,
            ),
            _ => return err(),
        },
        MediaSource::Mal => match lot {
            MediaLot::Anime => Box::new(
                MalAnimeService::new(&ss.config.anime_and_manga.mal, ss.config.frontend.page_size)
                    .await,
            ),
            MediaLot::Manga => Box::new(
                MalMangaService::new(&ss.config.anime_and_manga.mal, ss.config.frontend.page_size)
                    .await,
            ),
            _ => return err(),
        },
        MediaSource::Igdb => {
            Box::new(IgdbService::new(&ss.config.video_games, ss.config.frontend.page_size).await)
        }
        MediaSource::MangaUpdates => Box::new(
            MangaUpdatesService::new(
                &ss.config.anime_and_manga.manga_updates,
                ss.config.frontend.page_size,
            )
            .await,
        ),
        MediaSource::Custom => return err(),
    };
    Ok(service)
}

pub async fn details_from_provider(
    lot: MediaLot,
    source: MediaSource,
    identifier: &str,
    ss: &Arc<SupportingService>,
) -> Result<MediaDetails> {
    let provider = get_metadata_provider(lot, source, ss).await?;
    let results = provider.metadata_details(identifier).await?;
    Ok(results)
}

pub async fn commit_person(
    input: CommitPersonInput,
    db: &DatabaseConnection,
) -> Result<StringIdObject> {
    if let Some(p) = Person::find()
        .filter(person::Column::Source.eq(input.source))
        .filter(person::Column::Identifier.eq(input.identifier.clone()))
        .apply_if(input.source_specifics.clone(), |query, v| {
            query.filter(person::Column::SourceSpecifics.eq(v))
        })
        .one(db)
        .await?
        .map(|p| StringIdObject { id: p.id })
    {
        Ok(p)
    } else {
        let person = person::ActiveModel {
            identifier: ActiveValue::Set(input.identifier),
            source: ActiveValue::Set(input.source),
            source_specifics: ActiveValue::Set(input.source_specifics),
            name: ActiveValue::Set(input.name),
            is_partial: ActiveValue::Set(Some(true)),
            ..Default::default()
        };
        let person = person.insert(db).await?;
        Ok(StringIdObject { id: person.id })
    }
}

async fn associate_person_with_metadata(
    metadata_id: &str,
    person: PartialMetadataPerson,
    index: usize,
    db: &DatabaseConnection,
) -> Result<()> {
    let role = person.role.clone();
    let db_person = commit_person(
        CommitPersonInput {
            identifier: person.identifier.clone(),
            source: person.source,
            source_specifics: person.source_specifics,
            name: person.name,
        },
        db,
    )
    .await?;
    let intermediate = metadata_to_person::ActiveModel {
        metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        person_id: ActiveValue::Set(db_person.id),
        role: ActiveValue::Set(role),
        index: ActiveValue::Set(Some(index.try_into().unwrap())),
        character: ActiveValue::Set(person.character),
    };
    intermediate.insert(db).await.ok();
    Ok(())
}

async fn associate_genre_with_metadata(
    name: String,
    metadata_id: &str,
    db: &DatabaseConnection,
) -> Result<()> {
    let db_genre = if let Some(c) = Genre::find()
        .filter(genre::Column::Name.eq(&name))
        .one(db)
        .await
        .unwrap()
    {
        c
    } else {
        let c = genre::ActiveModel {
            name: ActiveValue::Set(name),
            ..Default::default()
        };
        c.insert(db).await.unwrap()
    };
    let intermediate = metadata_to_genre::ActiveModel {
        metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        genre_id: ActiveValue::Set(db_genre.id),
    };
    intermediate.insert(db).await.ok();
    Ok(())
}

pub async fn create_partial_metadata(
    data: PartialMetadataWithoutId,
    db: &DatabaseConnection,
) -> Result<PartialMetadata> {
    let mode = if let Some(c) = Metadata::find()
        .filter(metadata::Column::Identifier.eq(&data.identifier))
        .filter(metadata::Column::Lot.eq(data.lot))
        .filter(metadata::Column::Source.eq(data.source))
        .one(db)
        .await
        .unwrap()
    {
        c
    } else {
        let image = data.image.clone().map(|i| {
            vec![MetadataImage {
                url: StoredUrl::Url(i),
            }]
        });
        let c = metadata::ActiveModel {
            title: ActiveValue::Set(data.title),
            identifier: ActiveValue::Set(data.identifier),
            lot: ActiveValue::Set(data.lot),
            source: ActiveValue::Set(data.source),
            images: ActiveValue::Set(image),
            is_partial: ActiveValue::Set(Some(true)),
            ..Default::default()
        };
        c.insert(db).await?
    };
    let model = PartialMetadata {
        id: mode.id,
        lot: mode.lot,
        image: data.image,
        title: mode.title,
        source: mode.source,
        identifier: mode.identifier,
        is_recommendation: mode.is_recommendation,
    };
    Ok(model)
}

async fn associate_suggestion_with_metadata(
    data: PartialMetadataWithoutId,
    metadata_id: &str,
    db: &DatabaseConnection,
) -> Result<()> {
    let db_partial_metadata = create_partial_metadata(data, db).await?;
    let intermediate = metadata_to_metadata::ActiveModel {
        from_metadata_id: ActiveValue::Set(metadata_id.to_owned()),
        to_metadata_id: ActiveValue::Set(db_partial_metadata.id),
        relation: ActiveValue::Set(MetadataToMetadataRelation::Suggestion),
        ..Default::default()
    };
    intermediate.insert(db).await.ok();
    Ok(())
}

async fn deploy_associate_group_with_metadata_job(
    lot: MediaLot,
    source: MediaSource,
    identifier: String,
    perform_application_job: &MemoryStorage<ApplicationJob>,
) -> Result<()> {
    perform_application_job
        .clone()
        .enqueue(ApplicationJob::AssociateGroupWithMetadata(
            lot, source, identifier,
        ))
        .await
        .unwrap();
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn change_metadata_associations(
    metadata_id: &String,
    lot: MediaLot,
    source: MediaSource,
    genres: Vec<String>,
    suggestions: Vec<PartialMetadataWithoutId>,
    groups: Vec<String>,
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
    for (index, creator) in people.into_iter().enumerate() {
        associate_person_with_metadata(metadata_id, creator, index, &ss.db)
            .await
            .ok();
    }
    for genre in genres {
        associate_genre_with_metadata(genre, metadata_id, &ss.db)
            .await
            .ok();
    }
    for suggestion in suggestions {
        associate_suggestion_with_metadata(suggestion, metadata_id, &ss.db)
            .await
            .ok();
    }
    for group_identifier in groups {
        deploy_associate_group_with_metadata_job(
            lot,
            source,
            group_identifier,
            &ss.perform_application_job,
        )
        .await
        .ok();
    }
    Ok(())
}

pub async fn update_metadata(
    metadata_id: &String,
    force_update: bool,
    ss: &Arc<SupportingService>,
) -> Result<Vec<(String, MediaStateChanged)>> {
    let metadata = Metadata::find_by_id(metadata_id)
        .one(&ss.db)
        .await
        .unwrap()
        .unwrap();
    if !force_update {
        // check whether the metadata needs to be updated
        let provider = get_metadata_provider(metadata.lot, metadata.source, ss).await?;
        if let Ok(false) = provider
            .metadata_updated_since(&metadata.identifier, metadata.last_updated_on)
            .await
        {
            ryot_log!(
                debug,
                "Metadata {:?} does not need to be updated",
                metadata_id
            );
            return Ok(vec![]);
        }
    }
    ryot_log!(debug, "Updating metadata for {:?}", metadata_id);
    Metadata::update_many()
        .filter(metadata::Column::Id.eq(metadata_id))
        .col_expr(metadata::Column::IsPartial, Expr::value(false))
        .exec(&ss.db)
        .await?;
    let maybe_details =
        details_from_provider(metadata.lot, metadata.source, &metadata.identifier, ss).await;
    let notifications = match maybe_details {
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
                        MediaStateChanged::MetadataStatusChanged,
                    ));
                }
            }
            if let (Some(p1), Some(p2)) = (meta.publish_year, details.publish_year) {
                if p1 != p2 {
                    notifications.push((
                        format!("Publish year from {:#?} to {:#?}", p1, p2),
                        MediaStateChanged::MetadataReleaseDateChanged,
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
                        MediaStateChanged::MetadataNumberOfSeasonsChanged,
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
                                MediaStateChanged::MetadataEpisodeReleased,
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
                                        MediaStateChanged::MetadataEpisodeNameChanged,
                                    ));
                                }
                                if before_episode.poster_images != after_episode.poster_images {
                                    notifications.push((
                                        format!(
                                            "Episode image changed for S{}E{}",
                                            s1.season_number, before_episode.episode_number
                                        ),
                                        MediaStateChanged::MetadataEpisodeImagesChanged,
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
                                            MediaStateChanged::MetadataReleaseDateChanged,
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
                            MediaStateChanged::MetadataChaptersOrEpisodesChanged,
                        ));
                    }
                }
            };
            if let (Some(m1), Some(m2)) = (&meta.manga_specifics, &details.manga_specifics) {
                if let (Some(c1), Some(c2)) = (m1.chapters, m2.chapters) {
                    if c1 != c2 {
                        notifications.push((
                            format!("Number of chapters changed from {:#?} to {:#?}", c1, c2),
                            MediaStateChanged::MetadataChaptersOrEpisodesChanged,
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
                        MediaStateChanged::MetadataEpisodeReleased,
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
                                MediaStateChanged::MetadataEpisodeNameChanged,
                            ));
                        }
                        if before_episode.thumbnail != after_episode.thumbnail {
                            notifications.push((
                                format!("Episode image changed for EP{}", before_episode.number),
                                MediaStateChanged::MetadataEpisodeImagesChanged,
                            ));
                        }
                    }
                }
            };

            let notifications = notifications
                .into_iter()
                .map(|n| (format!("{} for {:?}.", n.0, meta.title), n.1))
                .collect_vec();

            let mut images = vec![];
            images.extend(details.url_images.into_iter().map(|i| MetadataImage {
                url: StoredUrl::Url(i.image),
            }));
            images.extend(details.s3_images.into_iter().map(|i| MetadataImage {
                url: StoredUrl::S3(i.image),
            }));
            let free_creators = if details.creators.is_empty() {
                None
            } else {
                Some(details.creators)
            };
            let watch_providers = if details.watch_providers.is_empty() {
                None
            } else {
                Some(details.watch_providers)
            };

            let mut meta: metadata::ActiveModel = meta.into();
            meta.last_updated_on = ActiveValue::Set(Utc::now());
            meta.title = ActiveValue::Set(details.title);
            meta.is_nsfw = ActiveValue::Set(details.is_nsfw);
            meta.is_partial = ActiveValue::Set(Some(false));
            meta.provider_rating = ActiveValue::Set(details.provider_rating);
            meta.description = ActiveValue::Set(details.description);
            meta.images = ActiveValue::Set(Some(images));
            meta.videos = ActiveValue::Set(Some(details.videos));
            meta.production_status = ActiveValue::Set(details.production_status);
            meta.original_language = ActiveValue::Set(details.original_language);
            meta.publish_year = ActiveValue::Set(details.publish_year);
            meta.publish_date = ActiveValue::Set(details.publish_date);
            meta.free_creators = ActiveValue::Set(free_creators);
            meta.watch_providers = ActiveValue::Set(watch_providers);
            meta.anime_specifics = ActiveValue::Set(details.anime_specifics);
            meta.audio_book_specifics = ActiveValue::Set(details.audio_book_specifics);
            meta.manga_specifics = ActiveValue::Set(details.manga_specifics);
            meta.movie_specifics = ActiveValue::Set(details.movie_specifics);
            meta.podcast_specifics = ActiveValue::Set(details.podcast_specifics);
            meta.show_specifics = ActiveValue::Set(details.show_specifics);
            meta.book_specifics = ActiveValue::Set(details.book_specifics);
            meta.video_game_specifics = ActiveValue::Set(details.video_game_specifics);
            meta.visual_novel_specifics = ActiveValue::Set(details.visual_novel_specifics);
            meta.external_identifiers = ActiveValue::Set(details.external_identifiers);
            let metadata = meta.update(&ss.db).await.unwrap();

            change_metadata_associations(
                &metadata.id,
                metadata.lot,
                metadata.source,
                details.genres,
                details.suggestions,
                details.group_identifiers,
                details.people,
                ss,
            )
            .await?;
            notifications
        }
        Err(e) => {
            ryot_log!(
                error,
                "Error while updating metadata = {:?}: {:?}",
                metadata_id,
                e
            );
            vec![]
        }
    };
    ryot_log!(debug, "Updated metadata for {:?}", metadata_id);
    Ok(notifications)
}

pub async fn get_entities_monitored_by(
    entity_id: &String,
    entity_lot: EntityLot,
    db: &DatabaseConnection,
) -> Result<Vec<String>> {
    let all_entities = MonitoredEntity::find()
        .select_only()
        .column(monitored_entity::Column::UserId)
        .filter(monitored_entity::Column::EntityId.eq(entity_id))
        .filter(monitored_entity::Column::EntityLot.eq(entity_lot))
        .into_tuple::<String>()
        .all(db)
        .await?;
    Ok(all_entities)
}

pub async fn queue_notifications_to_user_platforms(
    user_id: &String,
    msg: &str,
    db: &DatabaseConnection,
) -> Result<bool> {
    let user_details = user_by_id(db, user_id).await?;
    if user_details.preferences.notifications.enabled {
        let insert_data = queued_notification::ActiveModel {
            user_id: ActiveValue::Set(user_id.to_owned()),
            message: ActiveValue::Set(msg.to_owned()),
            ..Default::default()
        };
        insert_data.insert(db).await?;
    } else {
        ryot_log!(debug, "User has disabled notifications");
    }
    Ok(true)
}

pub async fn queue_media_state_changed_notification_for_user(
    user_id: &String,
    notification: &(String, MediaStateChanged),
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let (msg, change) = notification;
    let notification_preferences = user_preferences_by_id(user_id, ss).await?.notifications;
    if notification_preferences.enabled && notification_preferences.to_send.contains(change) {
        queue_notifications_to_user_platforms(user_id, msg, &ss.db)
            .await
            .trace_ok();
    } else {
        ryot_log!(
            debug,
            "User id = {user_id} has disabled notifications for {change}"
        );
    }
    Ok(())
}

pub async fn update_metadata_and_notify_users(
    metadata_id: &String,
    force_update: bool,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let notifications = update_metadata(metadata_id, force_update, ss)
        .await
        .unwrap();
    if !notifications.is_empty() {
        let users_to_notify =
            get_entities_monitored_by(metadata_id, EntityLot::Metadata, &ss.db).await?;
        for notification in notifications {
            for user_id in users_to_notify.iter() {
                queue_media_state_changed_notification_for_user(user_id, &notification, ss)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(())
}

pub async fn commit_metadata_internal(
    details: MediaDetails,
    is_partial: Option<bool>,
    ss: &Arc<SupportingService>,
) -> Result<metadata::Model> {
    let mut images = vec![];
    images.extend(details.url_images.into_iter().map(|i| MetadataImage {
        url: StoredUrl::Url(i.image),
    }));
    images.extend(details.s3_images.into_iter().map(|i| MetadataImage {
        url: StoredUrl::S3(i.image),
    }));
    let metadata = metadata::ActiveModel {
        lot: ActiveValue::Set(details.lot),
        source: ActiveValue::Set(details.source),
        title: ActiveValue::Set(details.title),
        description: ActiveValue::Set(details.description),
        publish_year: ActiveValue::Set(details.publish_year),
        publish_date: ActiveValue::Set(details.publish_date),
        images: ActiveValue::Set(Some(images)),
        videos: ActiveValue::Set(Some(details.videos)),
        identifier: ActiveValue::Set(details.identifier),
        audio_book_specifics: ActiveValue::Set(details.audio_book_specifics),
        anime_specifics: ActiveValue::Set(details.anime_specifics),
        book_specifics: ActiveValue::Set(details.book_specifics),
        manga_specifics: ActiveValue::Set(details.manga_specifics),
        movie_specifics: ActiveValue::Set(details.movie_specifics),
        podcast_specifics: ActiveValue::Set(details.podcast_specifics),
        show_specifics: ActiveValue::Set(details.show_specifics),
        video_game_specifics: ActiveValue::Set(details.video_game_specifics),
        visual_novel_specifics: ActiveValue::Set(details.visual_novel_specifics),
        provider_rating: ActiveValue::Set(details.provider_rating),
        production_status: ActiveValue::Set(details.production_status),
        original_language: ActiveValue::Set(details.original_language),
        external_identifiers: ActiveValue::Set(details.external_identifiers),
        is_nsfw: ActiveValue::Set(details.is_nsfw),
        is_partial: ActiveValue::Set(is_partial),
        free_creators: ActiveValue::Set(if details.creators.is_empty() {
            None
        } else {
            Some(details.creators)
        }),
        watch_providers: ActiveValue::Set(if details.watch_providers.is_empty() {
            None
        } else {
            Some(details.watch_providers)
        }),
        ..Default::default()
    };
    let metadata = metadata.insert(&ss.db).await?;

    change_metadata_associations(
        &metadata.id,
        metadata.lot,
        metadata.source,
        details.genres.clone(),
        details.suggestions.clone(),
        details.group_identifiers.clone(),
        details.people.clone(),
        ss,
    )
    .await?;
    Ok(metadata)
}

pub async fn commit_metadata(
    input: CommitMediaInput,
    ss: &Arc<SupportingService>,
) -> Result<metadata::Model> {
    if let Some(m) = Metadata::find()
        .filter(metadata::Column::Lot.eq(input.lot))
        .filter(metadata::Column::Source.eq(input.source))
        .filter(metadata::Column::Identifier.eq(input.identifier.clone()))
        .one(&ss.db)
        .await?
    {
        let cached_metadata = CommitCache {
            id: m.id.clone(),
            lot: EntityLot::Metadata,
        };
        if ss.commit_cache.get(&cached_metadata).await.is_some() {
            return Ok(m);
        }
        ss.commit_cache.insert(cached_metadata.clone(), ()).await;
        if input.force_update.unwrap_or_default() {
            ryot_log!(debug, "Forcing update of metadata with id {}", &m.id);
            update_metadata_and_notify_users(&m.id, true, ss).await?;
        }
        ss.commit_cache.remove(&cached_metadata).await;
        Ok(m)
    } else {
        let details = details_from_provider(input.lot, input.source, &input.identifier, ss).await?;
        let media = commit_metadata_internal(details, None, ss).await?;
        Ok(media)
    }
}

pub async fn deploy_update_metadata_job(
    metadata_id: &String,
    force_update: bool,
    perform_application_job: &MemoryStorage<ApplicationJob>,
) -> Result<bool> {
    perform_application_job
        .clone()
        .enqueue(ApplicationJob::UpdateMetadata(
            metadata_id.to_owned(),
            force_update,
        ))
        .await
        .unwrap();
    Ok(true)
}

pub async fn deploy_background_job(
    user_id: &String,
    job_name: BackgroundJob,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let core_storage = &mut ss.perform_core_application_job.clone();
    let storage = &mut ss.perform_application_job.clone();
    match job_name {
        BackgroundJob::UpdateAllMetadata
        | BackgroundJob::UpdateAllExercises
        | BackgroundJob::RecalculateCalendarEvents
        | BackgroundJob::PerformBackgroundTasks => {
            admin_account_guard(&ss.db, user_id).await?;
        }
        _ => {}
    }
    match job_name {
        BackgroundJob::UpdateAllMetadata => {
            let many_metadata = Metadata::find()
                .select_only()
                .column(metadata::Column::Id)
                .order_by_asc(metadata::Column::LastUpdatedOn)
                .into_tuple::<String>()
                .all(&ss.db)
                .await
                .unwrap();
            for metadata_id in many_metadata {
                deploy_update_metadata_job(&metadata_id, true, storage).await?;
            }
        }
        BackgroundJob::UpdateAllExercises => {
            storage
                .enqueue(ApplicationJob::UpdateExerciseLibrary)
                .await
                .unwrap();
        }
        BackgroundJob::RecalculateCalendarEvents => {
            storage
                .enqueue(ApplicationJob::RecalculateCalendarEvents)
                .await
                .unwrap();
        }
        BackgroundJob::PerformBackgroundTasks => {
            storage
                .enqueue(ApplicationJob::PerformBackgroundTasks)
                .await
                .unwrap();
        }
        BackgroundJob::SyncIntegrationsData => {
            core_storage
                .enqueue(CoreApplicationJob::SyncIntegrationsData(user_id.to_owned()))
                .await
                .unwrap();
        }
        BackgroundJob::CalculateUserActivitiesAndSummary => {
            storage
                .enqueue(ApplicationJob::RecalculateUserActivitiesAndSummary(
                    user_id.to_owned(),
                    true,
                ))
                .await
                .unwrap();
        }
        BackgroundJob::ReEvaluateUserWorkouts => {
            storage
                .enqueue(ApplicationJob::ReEvaluateUserWorkouts(user_id.to_owned()))
                .await
                .unwrap();
        }
    };
    Ok(true)
}

pub async fn post_review(
    user_id: &String,
    input: CreateOrUpdateReviewInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    let preferences = user_preferences_by_id(user_id, ss).await?;
    if preferences.general.disable_reviews {
        return Err(Error::new("Reviews are disabled"));
    }
    let show_ei = if let (Some(season), Some(episode)) =
        (input.show_season_number, input.show_episode_number)
    {
        Some(SeenShowExtraInformation { season, episode })
    } else {
        None
    };
    let podcast_ei = input
        .podcast_episode_number
        .map(|episode| SeenPodcastExtraInformation { episode });
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
        EntityLot::Workout | EntityLot::WorkoutTemplate => unreachable!(),
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
        let obj_title = match entity_lot {
            EntityLot::Metadata => Metadata::find_by_id(&id).one(&ss.db).await?.unwrap().title,
            EntityLot::MetadataGroup => {
                MetadataGroup::find_by_id(&id)
                    .one(&ss.db)
                    .await?
                    .unwrap()
                    .title
            }
            EntityLot::Person => Person::find_by_id(&id).one(&ss.db).await?.unwrap().name,
            EntityLot::Collection => Collection::find_by_id(&id).one(&ss.db).await?.unwrap().name,
            EntityLot::Exercise => id.clone(),
            EntityLot::Workout | EntityLot::WorkoutTemplate => unreachable!(),
        };
        let user = user_by_id(&ss.db, &insert.user_id.unwrap()).await?;
        // DEV: Do not send notification if updating a review
        if input.review_id.is_none() {
            ss.perform_core_application_job
                .clone()
                .enqueue(CoreApplicationJob::ReviewPosted(ReviewPostedEvent {
                    obj_title,
                    entity_lot,
                    obj_id: id,
                    username: user.name,
                    review_id: insert.id.clone().unwrap(),
                }))
                .await
                .unwrap();
        }
    }
    Ok(StringIdObject {
        id: insert.id.unwrap(),
    })
}

pub async fn commit_metadata_group_internal(
    identifier: &String,
    lot: MediaLot,
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<(String, Vec<PartialMetadataWithoutId>)> {
    let existing_group = MetadataGroup::find()
        .filter(metadata_group::Column::Identifier.eq(identifier))
        .filter(metadata_group::Column::Lot.eq(lot))
        .filter(metadata_group::Column::Source.eq(source))
        .one(&ss.db)
        .await?;
    let provider = get_metadata_provider(lot, source, ss).await?;
    let (group_details, associated_items) = provider.metadata_group_details(identifier).await?;
    let group_id = match existing_group {
        Some(eg) => eg.id,
        None => {
            let mut db_group: metadata_group::ActiveModel =
                group_details.into_model("".to_string(), None).into();
            db_group.id = ActiveValue::NotSet;
            let new_group = db_group.insert(&ss.db).await?;
            new_group.id
        }
    };
    Ok((group_id, associated_items))
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

pub async fn after_media_seen_tasks(seen: seen::Model, ss: &Arc<SupportingService>) -> Result<()> {
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
            &ss.db,
            &seen.user_id,
            ChangeCollectionToEntityInput {
                creator_user_id: seen.user_id.clone(),
                collection_name: collection_name.to_string(),
                entity_id: seen.metadata_id.clone(),
                entity_lot: EntityLot::Metadata,
                ..Default::default()
            },
        )
    };
    remove_entity_from_collection(&DefaultCollection::Watchlist.to_string())
        .await
        .ok();
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
    Ok(())
}

pub async fn progress_update(
    input: ProgressUpdateInput,
    user_id: &String,
    // update only if media has not been consumed for this user in the last `n` duration
    respect_cache: bool,
    ss: &Arc<SupportingService>,
) -> Result<ProgressUpdateResultUnion> {
    let cache = ApplicationCacheKey::ProgressUpdateCache {
        user_id: user_id.to_owned(),
        metadata_id: input.metadata_id.clone(),
        show_season_number: input.show_season_number,
        show_episode_number: input.show_episode_number,
        manga_volume_number: input.manga_volume_number,
        manga_chapter_number: input.manga_chapter_number,
        anime_episode_number: input.anime_episode_number,
        podcast_episode_number: input.podcast_episode_number,
    };
    let in_cache = ss.cache_service.get(cache.clone()).await?;
    if respect_cache && in_cache.is_some() {
        ryot_log!(debug, "Seen is already in cache");
        return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
            error: ProgressUpdateErrorVariant::AlreadySeen,
        }));
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
            if progress == dec!(100) {
                last_seen.finished_on = ActiveValue::Set(Some(now.date_naive()));
            }

            // This is needed for manga as some of the apps will update in weird orders
            // For example with komga mihon will update out of order to the server
            if input.manga_chapter_number.is_some() {
                last_seen.manga_extra_information =
                    ActiveValue::set(Some(SeenMangaExtraInformation {
                        chapter: input.manga_chapter_number,
                        volume: input.manga_volume_number,
                    }))
            }

            last_seen.update(&ss.db).await.unwrap()
        }
        ProgressUpdateAction::ChangeState => {
            let new_state = input.change_state.unwrap_or(SeenState::Dropped);
            let last_seen = Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(input.metadata_id))
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
            let finished_on = if action == ProgressUpdateAction::JustStarted {
                None
            } else {
                input.date
            };
            ryot_log!(debug, "Progress update finished on = {:?}", finished_on);
            let (progress, started_on) = if matches!(action, ProgressUpdateAction::JustStarted) {
                (
                    input.progress.unwrap_or(dec!(0)),
                    Some(Utc::now().date_naive()),
                )
            } else {
                (dec!(100), None)
            };
            ryot_log!(debug, "Progress update percentage = {:?}", progress);
            let seen_insert = seen::ActiveModel {
                progress: ActiveValue::Set(progress),
                user_id: ActiveValue::Set(user_id.to_owned()),
                metadata_id: ActiveValue::Set(input.metadata_id),
                started_on: ActiveValue::Set(started_on),
                finished_on: ActiveValue::Set(finished_on),
                state: ActiveValue::Set(SeenState::InProgress),
                provider_watched_on: ActiveValue::Set(input.provider_watched_on),
                show_extra_information: ActiveValue::Set(show_ei),
                podcast_extra_information: ActiveValue::Set(podcast_ei),
                anime_extra_information: ActiveValue::Set(anime_ei),
                manga_extra_information: ActiveValue::Set(manga_ei),
                ..Default::default()
            };
            seen_insert.insert(&ss.db).await.unwrap()
        }
    };
    ryot_log!(debug, "Progress update = {:?}", seen);
    let id = seen.id.clone();
    if seen.state == SeenState::Completed && respect_cache {
        ss.cache_service
            .set_with_expiry(cache, ss.config.server.progress_update_threshold)
            .await?;
    }
    after_media_seen_tasks(seen, ss).await?;
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
    db: &DatabaseConnection,
) -> Result<DateTimeUtc> {
    input.user_id = user_id.to_owned();
    let um: user_measurement::ActiveModel = input.into();
    let um = um.insert(db).await?;
    Ok(um.timestamp)
}

fn get_best_set_index(records: &[WorkoutSetRecord]) -> Option<usize> {
    records
        .iter()
        .enumerate()
        .max_by_key(|(_, record)| {
            record.statistic.duration.unwrap_or(dec!(0))
                + record.statistic.distance.unwrap_or(dec!(0))
                + record.statistic.reps.unwrap_or(dec!(0))
                + record.statistic.weight.unwrap_or(dec!(0))
        })
        .map(|(index, _)| index)
}

fn get_index_of_highest_pb(
    records: &[WorkoutSetRecord],
    pb_type: &WorkoutSetPersonalBest,
) -> Option<usize> {
    let record = records.iter().reduce(|record1, record2| {
        let pb1 = record1.get_personal_best(pb_type);
        let pb2 = record2.get_personal_best(pb_type);
        match (pb1, pb2) {
            (Some(pb1), Some(pb2)) => {
                if pb1 > pb2 {
                    record1
                } else {
                    record2
                }
            }
            _ => record1,
        }
    });
    record.and_then(|r| records.iter().position(|l| l == r))
}

/// Create a workout in the database and also update user and exercise associations.
pub async fn create_or_update_workout(
    input: UserWorkoutInput,
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> AnyhowResult<String> {
    let end_time = input.end_time;
    let mut input = input;
    let (new_workout_id, to_update_workout) = match &input.update_workout_id {
        Some(id) => (
            id.to_owned(),
            // DEV: Unwrap to make sure we error out early if the workout to edit does not exist
            Some(Workout::find_by_id(id).one(&ss.db).await?.unwrap()),
        ),
        None => (
            input
                .create_workout_id
                .unwrap_or_else(|| format!("wor_{}", nanoid!(12))),
            None,
        ),
    };
    ryot_log!(debug, "Creating new workout with id = {}", new_workout_id);
    let mut exercises = vec![];
    let mut workout_totals = vec![];
    if input.exercises.is_empty() {
        bail!("This workout has no associated exercises")
    }
    let mut first_set_of_exercise_confirmed_at = input
        .exercises
        .first()
        .unwrap()
        .sets
        .first()
        .unwrap()
        .confirmed_at;
    for (exercise_idx, ex) in input.exercises.iter_mut().enumerate() {
        if ex.sets.is_empty() {
            bail!("This exercise has no associated sets")
        }
        let db_ex = match Exercise::find_by_id(ex.exercise_id.clone())
            .one(&ss.db)
            .await?
        {
            None => {
                ryot_log!(error, "Exercise with id = {} not found", ex.exercise_id);
                continue;
            }
            Some(e) => e,
        };
        let mut sets = vec![];
        let mut total = WorkoutOrExerciseTotals::default();
        let association = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(ex.exercise_id.clone()))
            .one(&ss.db)
            .await
            .ok()
            .flatten();
        let history_item = UserToExerciseHistoryExtraInformation {
            best_set: None,
            idx: exercise_idx,
            workout_id: new_workout_id.clone(),
            workout_end_on: end_time,
        };
        let association = match association {
            None => {
                let user_to_ex = user_to_entity::ActiveModel {
                    user_id: ActiveValue::Set(user_id.clone()),
                    exercise_id: ActiveValue::Set(Some(ex.exercise_id.clone())),
                    exercise_extra_information: ActiveValue::Set(Some(
                        UserToExerciseExtraInformation {
                            history: vec![history_item],
                            lifetime_stats: WorkoutOrExerciseTotals::default(),
                            personal_bests: vec![],
                        },
                    )),
                    created_on: ActiveValue::Set(
                        first_set_of_exercise_confirmed_at.unwrap_or(end_time),
                    ),
                    exercise_num_times_interacted: ActiveValue::Set(Some(1)),
                    ..Default::default()
                };
                user_to_ex.insert(&ss.db).await.unwrap()
            }
            Some(e) => {
                let last_updated_on = e.last_updated_on;
                let mut extra_info = e.exercise_extra_information.clone().unwrap_or_default();
                extra_info.history.insert(0, history_item);
                let mut to_update: user_to_entity::ActiveModel = e.into();
                to_update.exercise_num_times_interacted =
                    ActiveValue::Set(Some(extra_info.history.len().try_into().unwrap()));
                to_update.exercise_extra_information = ActiveValue::Set(Some(extra_info));
                to_update.last_updated_on =
                    ActiveValue::Set(first_set_of_exercise_confirmed_at.unwrap_or(last_updated_on));
                to_update.update(&ss.db).await?
            }
        };
        if let Some(d) = ex.rest_time {
            total.rest_time += d * (ex.sets.len() - 1) as u16;
        }
        ex.sets
            .sort_unstable_by_key(|s| s.confirmed_at.unwrap_or_default());
        for set in ex.sets.iter_mut() {
            let mut actual_rest_time = None;
            if exercise_idx != 0
                && set.confirmed_at.is_some()
                && first_set_of_exercise_confirmed_at.is_some()
            {
                actual_rest_time = Some(
                    (set.confirmed_at.unwrap() - first_set_of_exercise_confirmed_at.unwrap())
                        .num_seconds(),
                );
            }
            first_set_of_exercise_confirmed_at = set.confirmed_at;
            set.remove_invalids(&db_ex.lot);
            if let Some(r) = set.statistic.reps {
                total.reps += r;
                if let Some(w) = set.statistic.weight {
                    total.weight += w * r;
                }
            }
            if let Some(d) = set.statistic.duration {
                total.duration += d;
            }
            if let Some(d) = set.statistic.distance {
                total.distance += d;
            }
            let mut totals = WorkoutSetTotals::default();
            if let (Some(we), Some(re)) = (&set.statistic.weight, &set.statistic.reps) {
                totals.weight = Some(we * re);
            }
            let mut value = WorkoutSetRecord {
                lot: set.lot,
                actual_rest_time,
                totals: Some(totals),
                note: set.note.clone(),
                personal_bests: Some(vec![]),
                confirmed_at: set.confirmed_at,
                statistic: set.statistic.clone(),
            };
            value.statistic.one_rm = value.calculate_one_rm();
            value.statistic.pace = value.calculate_pace();
            value.statistic.volume = value.calculate_volume();
            sets.push(value);
        }
        let mut personal_bests = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default()
            .personal_bests;
        let types_of_prs = LOT_MAPPINGS
            .iter()
            .find(|lm| lm.0 == db_ex.lot)
            .map(|lm| lm.1)
            .unwrap();
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
                    let workout_set =
                        workout.information.exercises[r.exercise_idx].sets[r.set_idx].clone();
                    if set.get_personal_best(best_type) > workout_set.get_personal_best(best_type) {
                        if let Some(ref mut set_personal_bests) = set.personal_bests {
                            set_personal_bests.push(*best_type);
                        }
                        total.personal_bests_achieved += 1;
                    }
                }
            } else {
                if let Some(ref mut set_personal_bests) = set.personal_bests {
                    set_personal_bests.push(*best_type);
                }
                total.personal_bests_achieved += 1;
            }
        }
        workout_totals.push(total.clone());
        for (set_idx, set) in sets.iter().enumerate() {
            if let Some(set_personal_bests) = &set.personal_bests {
                for best in set_personal_bests.iter() {
                    let to_insert_record = ExerciseBestSetRecord {
                        workout_id: new_workout_id.clone(),
                        exercise_idx,
                        set_idx,
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
        association_extra_information.lifetime_stats += total.clone();
        association_extra_information.personal_bests = personal_bests;
        association.exercise_extra_information =
            ActiveValue::Set(Some(association_extra_information));
        association.update(&ss.db).await?;
        exercises.push((
            best_set,
            db_ex.lot,
            ProcessedExercise {
                sets,
                lot: db_ex.lot,
                name: db_ex.id,
                total: Some(total),
                notes: ex.notes.clone(),
                rest_time: ex.rest_time,
                assets: ex.assets.clone(),
                superset_with: ex.superset_with.clone(),
            },
        ));
    }
    let summary_total = workout_totals.into_iter().sum();
    let model = workout::Model {
        end_time,
        name: input.name,
        user_id: user_id.clone(),
        id: new_workout_id.clone(),
        start_time: input.start_time,
        repeated_from: input.repeated_from,
        summary: WorkoutSummary {
            total: Some(summary_total),
            exercises: exercises
                .clone()
                .into_iter()
                .map(|(best_set, lot, e)| WorkoutSummaryExercise {
                    best_set,
                    lot: Some(lot),
                    id: e.name.clone(),
                    num_sets: e.sets.len(),
                })
                .collect(),
        },
        information: WorkoutInformation {
            comment: input.comment,
            assets: input.assets,
            exercises: exercises.into_iter().map(|(_, _, ex)| ex).collect(),
        },
        template_id: input.template_id,
        duration: 0,
    };
    let mut insert: workout::ActiveModel = model.into();
    insert.duration = ActiveValue::NotSet;
    if let Some(old_workout) = to_update_workout.clone() {
        insert.end_time = ActiveValue::Set(old_workout.end_time);
        insert.start_time = ActiveValue::Set(old_workout.start_time);
        insert.repeated_from = ActiveValue::Set(old_workout.repeated_from.clone());
        old_workout.delete(&ss.db).await?;
    }
    let data = insert.insert(&ss.db).await?;
    if to_update_workout.is_some() {
        deploy_job_to_re_evaluate_user_workouts(user_id, &ss.perform_application_job).await;
    }
    Ok(data.id)
}

async fn create_collection_and_add_entity_to_it(
    ss: &Arc<SupportingService>,
    user_id: &String,
    collection_name: String,
    entity_id: String,
    entity_lot: EntityLot,
) -> Result<()> {
    create_or_update_collection(
        &ss.db,
        user_id,
        CreateOrUpdateCollectionInput {
            name: collection_name.clone(),
            ..Default::default()
        },
    )
    .await?;
    add_entity_to_collection(
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
    .ok();
    Ok(())
}

pub async fn process_import(
    user_id: &String,
    import: ImportResult,
    ss: &Arc<SupportingService>,
) -> Result<ImportResultResponse> {
    let mut import = import;
    let preferences = user_by_id(&ss.db, user_id).await?.preferences;
    for m in import.metadata.iter_mut() {
        m.seen_history.sort_by(|a, b| {
            a.ended_on
                .unwrap_or_default()
                .cmp(&b.ended_on.unwrap_or_default())
        });
    }

    let total = import.collections.len()
        + import.metadata.len()
        + import.metadata_groups.len()
        + import.people.len()
        + import.workouts.len()
        + import.measurements.len();

    for (idx, col_details) in import.collections.into_iter().enumerate() {
        create_or_update_collection(&ss.db, user_id, col_details).await?;
        ryot_log!(debug, "Collection {} created", idx);
    }

    for (idx, item) in import.metadata.into_iter().enumerate() {
        ryot_log!(
            debug,
            "Importing media with identifier = {:#?}",
            item.source_id
        );
        let rev_length = item.reviews.len();
        let identifier = item.identifier.clone();
        let data = commit_metadata(
            CommitMediaInput {
                identifier,
                lot: item.lot,
                source: item.source,
                force_update: None,
            },
            ss,
        )
        .await;
        let metadata = match data {
            Ok(r) => r,
            Err(e) => {
                ryot_log!(error, "{e:?}");
                import.failed_items.push(ImportFailedItem {
                    lot: Some(item.lot),
                    step: ImportFailStep::MediaDetailsFromProvider,
                    identifier: item.source_id.to_owned(),
                    error: Some(e.message),
                });
                continue;
            }
        };
        for seen in item.seen_history.iter() {
            let progress = if seen.progress.is_some() {
                seen.progress
            } else {
                Some(dec!(100))
            };
            if let Err(e) = progress_update(
                ProgressUpdateInput {
                    metadata_id: metadata.id.clone(),
                    progress,
                    date: seen.ended_on,
                    show_season_number: seen.show_season_number,
                    show_episode_number: seen.show_episode_number,
                    podcast_episode_number: seen.podcast_episode_number,
                    anime_episode_number: seen.anime_episode_number,
                    manga_chapter_number: seen.manga_chapter_number,
                    manga_volume_number: seen.manga_volume_number,
                    provider_watched_on: seen.provider_watched_on.clone(),
                    change_state: None,
                },
                user_id,
                false,
                ss,
            )
            .await
            {
                import.failed_items.push(ImportFailedItem {
                    lot: Some(item.lot),
                    step: ImportFailStep::SeenHistoryConversion,
                    identifier: item.source_id.to_owned(),
                    error: Some(e.message),
                });
            };
        }
        for review in item.reviews.iter() {
            if let Some(input) = convert_review_into_input(
                review,
                &preferences,
                metadata.id.clone(),
                EntityLot::Metadata,
            ) {
                if let Err(e) = post_review(user_id, input, ss).await {
                    import.failed_items.push(ImportFailedItem {
                        lot: Some(item.lot),
                        step: ImportFailStep::ReviewConversion,
                        identifier: item.source_id.to_owned(),
                        error: Some(e.message),
                    });
                };
            }
        }
        for col in item.collections.into_iter() {
            create_collection_and_add_entity_to_it(
                ss,
                user_id,
                col,
                metadata.id.clone(),
                EntityLot::Metadata,
            )
            .await?;
        }
        ryot_log!(
            debug,
            "Imported item: {idx}, lot: {lot}, history count: {hist}, review count: {rev}",
            idx = idx + 1,
            lot = item.lot,
            hist = item.seen_history.len(),
            rev = rev_length,
        );
    }
    for (idx, item) in import.metadata_groups.into_iter().enumerate() {
        ryot_log!(
            debug,
            "Importing media group with identifier = {iden}",
            iden = &item.title
        );
        let rev_length = item.reviews.len();
        let data =
            commit_metadata_group_internal(&item.identifier, item.lot, item.source, ss).await;
        let metadata_group_id = match data {
            Ok(r) => r.0,
            Err(e) => {
                ryot_log!(error, "{e:?}");
                import.failed_items.push(ImportFailedItem {
                    lot: Some(item.lot),
                    step: ImportFailStep::MediaDetailsFromProvider,
                    identifier: item.title.to_owned(),
                    error: Some(e.message),
                });
                continue;
            }
        };
        for review in item.reviews.iter() {
            if let Some(input) = convert_review_into_input(
                review,
                &preferences,
                metadata_group_id.clone(),
                EntityLot::MetadataGroup,
            ) {
                if let Err(e) = post_review(user_id, input, ss).await {
                    import.failed_items.push(ImportFailedItem {
                        lot: Some(item.lot),
                        step: ImportFailStep::ReviewConversion,
                        identifier: item.title.to_owned(),
                        error: Some(e.message),
                    });
                };
            }
        }
        for col in item.collections.into_iter() {
            create_collection_and_add_entity_to_it(
                ss,
                user_id,
                col,
                metadata_group_id.clone(),
                EntityLot::MetadataGroup,
            )
            .await?;
        }
        ryot_log!(
            debug,
            "Imported item: {idx}, lot: {lot}, review count: {rev}",
            idx = idx + 1,
            lot = item.lot,
            rev = rev_length,
        );
    }
    for (idx, item) in import.people.into_iter().enumerate() {
        let person = commit_person(
            CommitPersonInput {
                identifier: item.identifier.clone(),
                name: item.name.clone(),
                source: item.source,
                source_specifics: item.source_specifics.clone(),
            },
            &ss.db,
        )
        .await?;
        for review in item.reviews.iter() {
            if let Some(input) = convert_review_into_input(
                review,
                &preferences,
                person.id.clone(),
                EntityLot::Person,
            ) {
                if let Err(e) = post_review(user_id, input, ss).await {
                    import.failed_items.push(ImportFailedItem {
                        lot: None,
                        step: ImportFailStep::ReviewConversion,
                        identifier: item.name.to_owned(),
                        error: Some(e.message),
                    });
                };
            }
        }
        for col in item.collections.into_iter() {
            create_collection_and_add_entity_to_it(
                ss,
                user_id,
                col,
                person.id.clone(),
                EntityLot::Person,
            )
            .await?;
        }
        ryot_log!(
            debug,
            "Imported person: {idx}, name: {name}",
            idx = idx + 1,
            name = item.name,
        );
    }
    for (idx, workout) in import.workouts.into_iter().enumerate() {
        if let Err(err) = create_or_update_workout(workout, user_id, ss).await {
            import.failed_items.push(ImportFailedItem {
                lot: None,
                step: ImportFailStep::InputTransformation,
                identifier: "Exercise".to_string(),
                error: Some(err.to_string()),
            });
        }
        ryot_log!(debug, "Workout {} created", idx);
    }
    for (idx, workout) in import.application_workouts.into_iter().enumerate() {
        let workout_input = db_workout_to_workout_input(workout.details);
        match create_or_update_workout(workout_input, user_id, ss).await {
            Err(err) => {
                import.failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: "Exercise".to_string(),
                    error: Some(err.to_string()),
                });
            }
            Ok(workout_id) => {
                for col in workout.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        ss,
                        user_id,
                        col,
                        workout_id.clone(),
                        EntityLot::Workout,
                    )
                    .await?;
                }
            }
        }
        ryot_log!(debug, "Workout {} created", idx);
    }
    for (idx, measurement) in import.measurements.into_iter().enumerate() {
        if let Err(err) = create_user_measurement(user_id, measurement, &ss.db).await {
            import.failed_items.push(ImportFailedItem {
                lot: None,
                step: ImportFailStep::InputTransformation,
                identifier: "Measurement".to_string(),
                error: Some(err.message),
            });
        }
        ryot_log!(debug, "Measurement {} created", idx);
    }

    // TODO: Allow importing exercises

    let details = ImportResultResponse {
        import: ImportDetails { total },
        failed_items: import.failed_items,
    };

    Ok(details)
}

pub fn db_workout_to_workout_input(user_workout: workout::Model) -> UserWorkoutInput {
    UserWorkoutInput {
        name: user_workout.name,
        create_workout_id: Some(user_workout.id),
        update_workout_id: None,
        default_rest_timer: None,
        end_time: user_workout.end_time,
        update_workout_template_id: None,
        start_time: user_workout.start_time,
        template_id: user_workout.template_id,
        assets: user_workout.information.assets,
        repeated_from: user_workout.repeated_from,
        comment: user_workout.information.comment,
        exercises: user_workout
            .information
            .exercises
            .into_iter()
            .map(|e| UserExerciseInput {
                exercise_id: e.name,
                sets: e
                    .sets
                    .into_iter()
                    .map(|s| UserWorkoutSetRecord {
                        lot: s.lot,
                        note: s.note,
                        statistic: s.statistic,
                        confirmed_at: s.confirmed_at,
                    })
                    .collect(),
                notes: e.notes,
                rest_time: e.rest_time,
                assets: e.assets,
                superset_with: e.superset_with,
            })
            .collect(),
    }
}
