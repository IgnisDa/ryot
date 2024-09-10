use std::{iter::zip, sync::Arc};

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::{Error, Result};
use background::{ApplicationJob, CoreApplicationJob};
use chrono::Utc;
use common_models::{BackgroundJob, MediaStateChanged, StoredUrl, StringIdObject};
use common_utils::{ryot_log, SHOW_SPECIAL_SEASON_NAMES};
use database_models::{
    genre, metadata, metadata_group, metadata_to_genre, metadata_to_metadata, metadata_to_person,
    monitored_entity, person,
    prelude::{
        Collection, Genre, Metadata, MetadataGroup, MetadataToGenre, MetadataToMetadata,
        MetadataToPerson, MonitoredEntity, Person,
    },
    queued_notification, review,
};
use database_utils::{admin_account_guard, user_by_id, user_preferences_by_id};
use enums::{EntityLot, MediaLot, MediaSource, MetadataToMetadataRelation, Visibility};
use itertools::Itertools;
use media_models::{
    CommitMediaInput, CommitPersonInput, MediaDetails, MetadataImage, PartialMetadata,
    PartialMetadataPerson, PartialMetadataWithoutId, PostReviewInput, ReviewPostedEvent,
    SeenAnimeExtraInformation, SeenMangaExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation,
};
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
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::Expr, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};
use traits::{MediaProvider, TraceOk};
use user_models::UserReviewScale;

pub type Provider = Box<(dyn MediaProvider + Send + Sync)>;

pub async fn get_openlibrary_service(
    config: &Arc<config::AppConfig>,
) -> Result<OpenlibraryService> {
    Ok(OpenlibraryService::new(&config.books.openlibrary, config.frontend.page_size).await)
}

pub async fn get_isbn_service(config: &Arc<config::AppConfig>) -> Result<GoogleBooksService> {
    Ok(GoogleBooksService::new(&config.books.google_books, config.frontend.page_size).await)
}

pub async fn get_tmdb_non_media_service(
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
) -> Result<NonMediaTmdbService> {
    Ok(NonMediaTmdbService::new(
        &config.movies_and_shows.tmdb.access_token,
        config.movies_and_shows.tmdb.locale.clone(),
        timezone.clone(),
    )
    .await)
}

pub async fn get_metadata_provider(
    lot: MediaLot,
    source: MediaSource,
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
) -> Result<Provider> {
    let err = || Err(Error::new("This source is not supported".to_owned()));
    let service: Provider = match source {
        MediaSource::Vndb => {
            Box::new(VndbService::new(&config.visual_novels, config.frontend.page_size).await)
        }
        MediaSource::Openlibrary => Box::new(get_openlibrary_service(config).await?),
        MediaSource::Itunes => {
            Box::new(ITunesService::new(&config.podcasts.itunes, config.frontend.page_size).await)
        }
        MediaSource::GoogleBooks => Box::new(get_isbn_service(config).await?),
        MediaSource::Audible => Box::new(
            AudibleService::new(&config.audio_books.audible, config.frontend.page_size).await,
        ),
        MediaSource::Listennotes => {
            Box::new(ListennotesService::new(&config.podcasts, config.frontend.page_size).await)
        }
        MediaSource::Tmdb => match lot {
            MediaLot::Show => Box::new(
                TmdbShowService::new(
                    &config.movies_and_shows.tmdb,
                    timezone.clone(),
                    config.frontend.page_size,
                )
                .await,
            ),
            MediaLot::Movie => Box::new(
                TmdbMovieService::new(
                    &config.movies_and_shows.tmdb,
                    timezone.clone(),
                    config.frontend.page_size,
                )
                .await,
            ),
            _ => return err(),
        },
        MediaSource::Anilist => match lot {
            MediaLot::Anime => Box::new(
                AnilistAnimeService::new(
                    &config.anime_and_manga.anilist,
                    config.frontend.page_size,
                )
                .await,
            ),
            MediaLot::Manga => Box::new(
                AnilistMangaService::new(
                    &config.anime_and_manga.anilist,
                    config.frontend.page_size,
                )
                .await,
            ),
            _ => return err(),
        },
        MediaSource::Mal => match lot {
            MediaLot::Anime => Box::new(
                MalAnimeService::new(&config.anime_and_manga.mal, config.frontend.page_size).await,
            ),
            MediaLot::Manga => Box::new(
                MalMangaService::new(&config.anime_and_manga.mal, config.frontend.page_size).await,
            ),
            _ => return err(),
        },
        MediaSource::Igdb => {
            Box::new(IgdbService::new(&config.video_games, config.frontend.page_size).await)
        }
        MediaSource::MangaUpdates => Box::new(
            MangaUpdatesService::new(
                &config.anime_and_manga.manga_updates,
                config.frontend.page_size,
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
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
) -> Result<MediaDetails> {
    let provider = get_metadata_provider(lot, source, config, timezone).await?;
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
        title: mode.title,
        identifier: mode.identifier,
        lot: mode.lot,
        source: mode.source,
        image: data.image,
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
    db: &DatabaseConnection,
    perform_application_job: &MemoryStorage<ApplicationJob>,
) -> Result<()> {
    MetadataToPerson::delete_many()
        .filter(metadata_to_person::Column::MetadataId.eq(metadata_id))
        .exec(db)
        .await?;
    MetadataToGenre::delete_many()
        .filter(metadata_to_genre::Column::MetadataId.eq(metadata_id))
        .exec(db)
        .await?;
    MetadataToMetadata::delete_many()
        .filter(metadata_to_metadata::Column::FromMetadataId.eq(metadata_id))
        .filter(metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion))
        .exec(db)
        .await?;
    for (index, creator) in people.into_iter().enumerate() {
        associate_person_with_metadata(metadata_id, creator, index, db)
            .await
            .ok();
    }
    for genre in genres {
        associate_genre_with_metadata(genre, metadata_id, db)
            .await
            .ok();
    }
    for suggestion in suggestions {
        associate_suggestion_with_metadata(suggestion, metadata_id, db)
            .await
            .ok();
    }
    for group_identifier in groups {
        deploy_associate_group_with_metadata_job(
            lot,
            source,
            group_identifier,
            perform_application_job,
        )
        .await
        .ok();
    }
    Ok(())
}

pub async fn update_metadata(
    metadata_id: &String,
    force_update: bool,
    db: &DatabaseConnection,
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
    perform_application_job: &MemoryStorage<ApplicationJob>,
) -> Result<Vec<(String, MediaStateChanged)>> {
    let metadata = Metadata::find_by_id(metadata_id)
        .one(db)
        .await
        .unwrap()
        .unwrap();
    if !force_update {
        // check whether the metadata needs to be updated
        let provider =
            get_metadata_provider(metadata.lot, metadata.source, config, timezone).await?;
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
        .exec(db)
        .await?;
    let maybe_details = details_from_provider(
        metadata.lot,
        metadata.source,
        &metadata.identifier,
        config,
        timezone,
    )
    .await;
    let notifications = match maybe_details {
        Ok(details) => {
            let mut notifications = vec![];

            let meta = Metadata::find_by_id(metadata_id)
                .one(db)
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
            let metadata = meta.update(db).await.unwrap();

            change_metadata_associations(
                &metadata.id,
                metadata.lot,
                metadata.source,
                details.genres,
                details.suggestions,
                details.group_identifiers,
                details.people,
                db,
                perform_application_job,
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
    db: &DatabaseConnection,
    config: &Arc<config::AppConfig>,
) -> Result<()> {
    let (msg, change) = notification;
    let notification_preferences = user_preferences_by_id(db, user_id, config)
        .await?
        .notifications;
    if notification_preferences.enabled && notification_preferences.to_send.contains(change) {
        queue_notifications_to_user_platforms(user_id, msg, db)
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
    db: &DatabaseConnection,
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
    perform_application_job: &MemoryStorage<ApplicationJob>,
) -> Result<()> {
    let notifications = update_metadata(
        metadata_id,
        force_update,
        db,
        config,
        timezone,
        perform_application_job,
    )
    .await
    .unwrap();
    if !notifications.is_empty() {
        let users_to_notify =
            get_entities_monitored_by(metadata_id, EntityLot::Metadata, db).await?;
        for notification in notifications {
            for user_id in users_to_notify.iter() {
                queue_media_state_changed_notification_for_user(user_id, &notification, db, config)
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
    db: &DatabaseConnection,
    perform_application_job: &MemoryStorage<ApplicationJob>,
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
    let metadata = metadata.insert(db).await?;

    change_metadata_associations(
        &metadata.id,
        metadata.lot,
        metadata.source,
        details.genres.clone(),
        details.suggestions.clone(),
        details.group_identifiers.clone(),
        details.people.clone(),
        db,
        perform_application_job,
    )
    .await?;
    Ok(metadata)
}

pub async fn commit_metadata(
    input: CommitMediaInput,
    db: &DatabaseConnection,
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
    perform_application_job: &MemoryStorage<ApplicationJob>,
) -> Result<metadata::Model> {
    if let Some(m) = Metadata::find()
        .filter(metadata::Column::Lot.eq(input.lot))
        .filter(metadata::Column::Source.eq(input.source))
        .filter(metadata::Column::Identifier.eq(input.identifier.clone()))
        .one(db)
        .await?
    {
        if input.force_update.unwrap_or_default() {
            ryot_log!(debug, "Forcing update of metadata with id {}", m.id);
            update_metadata_and_notify_users(
                &m.id,
                true,
                db,
                config,
                timezone,
                perform_application_job,
            )
            .await?;
        }
        Ok(m)
    } else {
        let details =
            details_from_provider(input.lot, input.source, &input.identifier, config, timezone)
                .await?;
        let media = commit_metadata_internal(details, None, db, perform_application_job).await?;
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
    db: &DatabaseConnection,
    perform_application_job: &MemoryStorage<ApplicationJob>,
    perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
) -> Result<bool> {
    let core_storage = &mut perform_core_application_job.clone();
    let storage = &mut perform_application_job.clone();
    match job_name {
        BackgroundJob::UpdateAllMetadata
        | BackgroundJob::UpdateAllExercises
        | BackgroundJob::RecalculateCalendarEvents
        | BackgroundJob::PerformBackgroundTasks => {
            admin_account_guard(db, user_id).await?;
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
                .all(db)
                .await
                .unwrap();
            for metadata_id in many_metadata {
                deploy_update_metadata_job(&metadata_id, true, perform_application_job).await?;
            }
        }
        BackgroundJob::UpdateAllExercises => {
            perform_application_job
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
    input: PostReviewInput,
    db: &DatabaseConnection,
    config: &Arc<config::AppConfig>,
    perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
) -> Result<StringIdObject> {
    let preferences = user_preferences_by_id(db, user_id, config).await?;
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
                    UserReviewScale::OutOfHundred => r,
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
        EntityLot::Workout => unreachable!(),
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
    let insert = review_obj.save(db).await.unwrap();
    if insert.visibility.unwrap() == Visibility::Public {
        let entity_lot = insert.entity_lot.unwrap();
        let id = insert.entity_id.unwrap();
        let obj_title = match entity_lot {
            EntityLot::Metadata => Metadata::find_by_id(&id).one(db).await?.unwrap().title,
            EntityLot::MetadataGroup => {
                MetadataGroup::find_by_id(&id).one(db).await?.unwrap().title
            }
            EntityLot::Person => Person::find_by_id(&id).one(db).await?.unwrap().name,
            EntityLot::Collection => Collection::find_by_id(&id).one(db).await?.unwrap().name,
            EntityLot::Exercise => id.clone(),
            EntityLot::Workout => unreachable!(),
        };
        let user = user_by_id(db, &insert.user_id.unwrap()).await?;
        // DEV: Do not send notification if updating a review
        if input.review_id.is_none() {
            perform_core_application_job
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
    db: &DatabaseConnection,
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
) -> Result<(String, Vec<PartialMetadataWithoutId>)> {
    let existing_group = MetadataGroup::find()
        .filter(metadata_group::Column::Identifier.eq(identifier))
        .filter(metadata_group::Column::Lot.eq(lot))
        .filter(metadata_group::Column::Source.eq(source))
        .one(db)
        .await?;
    let provider = get_metadata_provider(lot, source, config, timezone).await?;
    let (group_details, associated_items) = provider.metadata_group_details(identifier).await?;
    let group_id = match existing_group {
        Some(eg) => eg.id,
        None => {
            let mut db_group: metadata_group::ActiveModel =
                group_details.into_model("".to_string(), None).into();
            db_group.id = ActiveValue::NotSet;
            let new_group = db_group.insert(db).await?;
            new_group.id
        }
    };
    Ok((group_id, associated_items))
}
