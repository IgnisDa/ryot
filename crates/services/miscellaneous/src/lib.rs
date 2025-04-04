use std::{
    cmp::Reverse,
    collections::{HashMap, HashSet},
    sync::Arc,
};

use application_utils::{
    calculate_average_rating, get_current_date, get_podcast_episode_by_number,
    get_show_episode_by_numbers,
};
use async_graphql::{Error, Result};
use background_models::{ApplicationJob, HpApplicationJob, MpApplicationJob};
use chrono::{Days, Duration, NaiveDate, Utc};
use common_models::{
    BackgroundJob, ChangeCollectionToEntityInput, DefaultCollection, IdAndNamedObject,
    MetadataGroupSearchInput, MetadataSearchInput, PeopleSearchInput, ProgressUpdateCacheInput,
    SearchDetails, SearchInput, StoredUrl, StringIdObject, UserLevelCacheKey,
};
use common_utils::{
    BULK_APPLICATION_UPDATE_CHUNK_SIZE, BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE,
    SHOW_SPECIAL_SEASON_NAMES, get_first_and_last_day_of_month, ryot_log,
};
use convert_case::{Case, Casing};
use database_models::{
    access_link, application_cache, calendar_event, collection, collection_to_entity,
    functions::{associate_user_with_entity, get_user_to_entity_association},
    genre, import_report, metadata, metadata_group, metadata_group_to_person, metadata_to_genre,
    metadata_to_metadata, metadata_to_metadata_group, metadata_to_person, monitored_entity, person,
    prelude::{
        AccessLink, ApplicationCache, CalendarEvent, Collection, CollectionToEntity, Genre,
        ImportReport, Metadata, MetadataGroup, MetadataGroupToPerson, MetadataToGenre,
        MetadataToMetadata, MetadataToMetadataGroup, MetadataToPerson, MonitoredEntity, Person,
        Review, Seen, User, UserToEntity,
    },
    review, seen, user, user_to_entity,
};
use database_utils::{
    calculate_user_activities_and_summary, entity_in_collections,
    entity_in_collections_with_collection_to_entity_ids, get_user_query, ilike_sql, item_reviews,
    revoke_access_link, user_by_id,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheKeyDiscriminants, ApplicationCacheValue, CachedResponse,
    CoreDetails, ExpireCacheKeyInput, GenreDetails, GraphqlPersonDetails, MetadataBaseData,
    MetadataGroupDetails, MetadataGroupSearchResponse, MetadataSearchResponse,
    PeopleSearchResponse, SearchResults, TrendingMetadataIdsResponse, UserMetadataDetails,
    UserMetadataGroupDetails, UserMetadataGroupsListInput, UserMetadataGroupsListResponse,
    UserMetadataListInput, UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse,
    UserPersonDetails,
};
use dependent_utils::{
    add_entity_to_collection, change_metadata_associations, commit_metadata, commit_metadata_group,
    commit_person, create_partial_metadata, deploy_after_handle_media_seen_tasks,
    deploy_background_job, deploy_update_metadata_group_job, deploy_update_metadata_job,
    deploy_update_person_job, first_metadata_image_as_url, get_entity_recently_consumed,
    get_entity_title_from_id_and_lot, get_google_books_service, get_hardcover_service,
    get_metadata_provider, get_openlibrary_service, get_tmdb_non_media_service,
    get_users_and_cte_monitoring_entity, get_users_monitoring_entity,
    handle_after_media_seen_tasks, is_metadata_finished_by_user, metadata_images_as_urls,
    post_review, progress_update, refresh_collection_to_entity_association,
    remove_entity_from_collection, send_notification_for_user, update_metadata_and_notify_users,
    user_metadata_groups_list, user_metadata_list, user_people_list,
};
use enum_meta::Meta;
use enum_models::{
    EntityLot, MediaLot, MediaSource, MetadataToMetadataRelation, SeenState,
    UserNotificationContent, UserToMediaReason,
};
use futures::{TryStreamExt, future::join_all};
use itertools::Itertools;
use markdown::{CompileOptions, Options, to_html_with_options as markdown_to_html_opts};
use media_models::{
    CommitMediaInput, CommitPersonInput, CreateCustomMetadataInput, CreateOrUpdateReviewInput,
    CreateReviewCommentInput, GenreDetailsInput, GenreListItem, GraphqlCalendarEvent,
    GraphqlMediaAssets, GraphqlMetadataDetails, GraphqlMetadataGroup, GraphqlVideoAsset,
    GroupedCalendarEvent, ImportOrExportItemReviewComment, MarkEntityAsPartialInput,
    MediaAssociatedPersonStateChanges, MetadataCreator, MetadataCreatorGroupedByRole,
    MetadataFreeCreator, MetadataImage, MetadataPartialDetails, MetadataVideo, MetadataVideoSource,
    PersonDetailsGroupedByRole, PersonDetailsItemWithCharacter, PodcastSpecifics,
    ProgressUpdateInput, ReviewPostedEvent, SeenAnimeExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation, ShowSpecifics, UniqueMediaIdentifier, UpdateCustomMetadataInput,
    UpdateSeenItemInput, UserCalendarEventInput, UserMediaNextEntry,
    UserMetadataDetailsEpisodeProgress, UserMetadataDetailsShowSeasonProgress,
    UserUpcomingCalendarEventInput,
};
use migrations::{
    AliasedCalendarEvent, AliasedMetadata, AliasedMetadataToGenre, AliasedSeen, AliasedUserToEntity,
};
use nanoid::nanoid;
use providers::{
    anilist::NonMediaAnilistService, audible::AudibleService, igdb::IgdbService,
    itunes::ITunesService, listennotes::ListennotesService, mal::NonMediaMalService,
    manga_updates::MangaUpdatesService, vndb::VndbService, youtube_music::YoutubeMusicService,
};
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, DatabaseBackend,
    DatabaseConnection, EntityTrait, FromQueryResult, ItemsAndPagesNumber, Iterable, JoinType,
    ModelTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
    RelationTrait, Statement, TransactionTrait, prelude::DateTimeUtc, query::UpdateMany,
};
use sea_query::{
    Alias, Asterisk, Condition, Expr, Func, PgFunc, PostgresQueryBuilder, Query, SelectStatement,
    extension::postgres::PgExpr,
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::{MediaProvider, TraceOk};
use user_models::DashboardElementLot;
use uuid::Uuid;

type Provider = Box<(dyn MediaProvider + Send + Sync)>;

pub struct MiscellaneousService(pub Arc<SupportingService>);

impl MiscellaneousService {
    pub async fn revoke_invalid_access_tokens(&self) -> Result<()> {
        let access_links = AccessLink::find()
            .select_only()
            .column(access_link::Column::Id)
            .filter(
                Condition::any()
                    .add(
                        Expr::col(access_link::Column::TimesUsed)
                            .gte(Expr::col(access_link::Column::MaximumUses)),
                    )
                    .add(access_link::Column::ExpiresOn.lte(Utc::now())),
            )
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for access_link in access_links {
            revoke_access_link(&self.0.db, access_link).await?;
        }
        Ok(())
    }

    pub async fn core_details(&self) -> Result<CoreDetails> {
        self.0.core_details().await
    }

    async fn metadata_assets(&self, meta: &metadata::Model) -> Result<GraphqlMediaAssets> {
        let images = metadata_images_as_urls(&meta.images, &self.0.file_storage_service).await;
        let mut videos = vec![];
        if let Some(vids) = &meta.videos {
            for v in vids.clone() {
                let url = self
                    .0
                    .file_storage_service
                    .get_stored_asset(v.identifier)
                    .await;
                videos.push(GraphqlVideoAsset {
                    source: v.source,
                    video_id: url,
                })
            }
        }
        Ok(GraphqlMediaAssets { images, videos })
    }

    async fn generic_metadata(&self, metadata_id: &String) -> Result<MetadataBaseData> {
        let Some(mut meta) = Metadata::find_by_id(metadata_id)
            .one(&self.0.db)
            .await
            .unwrap()
        else {
            return Err(Error::new("The record does not exist".to_owned()));
        };
        let genres = meta
            .find_related(Genre)
            .order_by_asc(genre::Column::Name)
            .into_model::<GenreListItem>()
            .all(&self.0.db)
            .await
            .unwrap();
        #[derive(Debug, FromQueryResult)]
        struct PartialCreator {
            id: String,
            name: String,
            images: Option<Vec<MetadataImage>>,
            role: String,
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
            .all(&self.0.db)
            .await?;
        let mut creators: HashMap<String, Vec<_>> = HashMap::new();
        for cr in crts {
            let image = first_metadata_image_as_url(&cr.images, &self.0.file_storage_service).await;
            let creator = MetadataCreator {
                image,
                name: cr.name,
                id: Some(cr.id),
                character: cr.character,
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
            .filter(
                metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion),
            )
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        let assets = self.metadata_assets(&meta).await.unwrap();
        Ok(MetadataBaseData {
            model: meta,
            creators,
            assets,
            genres,
            suggestions,
        })
    }

    pub async fn metadata_partial_details(
        &self,
        metadata_id: &String,
    ) -> Result<MetadataPartialDetails> {
        let mut metadata = Metadata::find_by_id(metadata_id)
            .select_only()
            .columns([
                metadata::Column::Id,
                metadata::Column::Lot,
                metadata::Column::Title,
                metadata::Column::Images,
                metadata::Column::PublishYear,
            ])
            .into_model::<MetadataPartialDetails>()
            .one(&self.0.db)
            .await
            .unwrap()
            .ok_or_else(|| Error::new("The record does not exist".to_owned()))?;
        metadata.image =
            first_metadata_image_as_url(&metadata.images, &self.0.file_storage_service).await;
        Ok(metadata)
    }

    pub async fn deploy_update_metadata_job(&self, metadata_id: &String) -> Result<bool> {
        deploy_update_metadata_job(metadata_id, &self.0).await
    }

    pub async fn metadata_details(&self, metadata_id: &String) -> Result<GraphqlMetadataDetails> {
        let MetadataBaseData {
            model,
            creators,
            assets,
            genres,
            suggestions,
        } = self.generic_metadata(metadata_id).await?;

        let mut group = vec![];
        let associations = MetadataToMetadataGroup::find()
            .filter(metadata_to_metadata_group::Column::MetadataId.eq(metadata_id))
            .find_also_related(MetadataGroup)
            .all(&self.0.db)
            .await?;
        for association in associations {
            let grp = association.1.unwrap();
            group.push(GraphqlMetadataGroup {
                id: grp.id,
                name: grp.title,
                part: association.0.part,
            });
        }

        let watch_providers = model.watch_providers.unwrap_or_default();

        let resp = GraphqlMetadataDetails {
            group,
            assets,
            genres,
            creators,
            suggestions,
            id: model.id,
            lot: model.lot,
            watch_providers,
            title: model.title,
            source: model.source,
            is_nsfw: model.is_nsfw,
            source_url: model.source_url,
            is_partial: model.is_partial,
            identifier: model.identifier,
            description: model.description,
            publish_date: model.publish_date,
            publish_year: model.publish_year,
            book_specifics: model.book_specifics,
            show_specifics: model.show_specifics,
            movie_specifics: model.movie_specifics,
            music_specifics: model.music_specifics,
            manga_specifics: model.manga_specifics,
            anime_specifics: model.anime_specifics,
            provider_rating: model.provider_rating,
            production_status: model.production_status,
            original_language: model.original_language,
            podcast_specifics: model.podcast_specifics,
            created_by_user_id: model.created_by_user_id,
            external_identifiers: model.external_identifiers,
            video_game_specifics: model.video_game_specifics,
            audio_book_specifics: model.audio_book_specifics,
            visual_novel_specifics: model.visual_novel_specifics,
        };
        Ok(resp)
    }

    pub async fn user_metadata_details(
        &self,
        user_id: String,
        metadata_id: String,
    ) -> Result<UserMetadataDetails> {
        let media_details = self.generic_metadata(&metadata_id).await?;
        let collections =
            entity_in_collections(&self.0.db, &user_id, &metadata_id, EntityLot::Metadata).await?;
        let reviews =
            item_reviews(&user_id, &metadata_id, EntityLot::Metadata, true, &self.0).await?;
        let (_, history) = is_metadata_finished_by_user(&user_id, &metadata_id, &self.0.db).await?;
        let in_progress = history
            .iter()
            .find(|h| h.state == SeenState::InProgress || h.state == SeenState::OnAHold)
            .cloned();
        let next_entry = history.first().and_then(|h| {
            if let Some(s) = &media_details.model.show_specifics {
                let all_episodes = s
                    .seasons
                    .iter()
                    .map(|s| (s.season_number, &s.episodes))
                    .collect_vec()
                    .into_iter()
                    .flat_map(|(s, e)| {
                        e.iter().map(move |e| UserMediaNextEntry {
                            season: Some(s),
                            episode: Some(e.episode_number),
                            ..Default::default()
                        })
                    })
                    .collect_vec();
                let next = all_episodes.iter().position(|e| {
                    e.season == Some(h.show_extra_information.as_ref().unwrap().season)
                        && e.episode == Some(h.show_extra_information.as_ref().unwrap().episode)
                });
                Some(all_episodes.get(next? + 1)?.clone())
            } else if let Some(p) = &media_details.model.podcast_specifics {
                let all_episodes = p
                    .episodes
                    .iter()
                    .map(|e| UserMediaNextEntry {
                        episode: Some(e.number),
                        ..Default::default()
                    })
                    .collect_vec();
                let next = all_episodes.iter().position(|e| {
                    e.episode == Some(h.podcast_extra_information.as_ref().unwrap().episode)
                });
                Some(all_episodes.get(next? + 1)?.clone())
            } else if let Some(_anime_spec) = &media_details.model.anime_specifics {
                h.anime_extra_information.as_ref().and_then(|hist| {
                    hist.episode.map(|e| UserMediaNextEntry {
                        episode: Some(e + 1),
                        ..Default::default()
                    })
                })
            } else if let Some(_manga_spec) = &media_details.model.manga_specifics {
                h.manga_extra_information.as_ref().and_then(|hist| {
                    hist.chapter
                        .map(|e| UserMediaNextEntry {
                            chapter: Some(e.floor() + dec!(1)),
                            ..Default::default()
                        })
                        .or(hist.volume.map(|e| UserMediaNextEntry {
                            volume: Some(e + 1),
                            ..Default::default()
                        }))
                })
            } else {
                None
            }
        });
        let metadata_alias = Alias::new("m");
        let seen_alias = Alias::new("s");
        let seen_select = Query::select()
            .expr_as(
                Expr::col((metadata_alias.clone(), AliasedMetadata::Id)),
                Alias::new("metadata_id"),
            )
            .expr_as(
                Func::count(Expr::col((seen_alias.clone(), AliasedSeen::MetadataId))),
                Alias::new("num_times_seen"),
            )
            .from_as(AliasedMetadata::Table, metadata_alias.clone())
            .join_as(
                JoinType::LeftJoin,
                AliasedSeen::Table,
                seen_alias.clone(),
                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                    .equals((seen_alias.clone(), AliasedSeen::MetadataId)),
            )
            .and_where(Expr::col((metadata_alias.clone(), AliasedMetadata::Id)).eq(&metadata_id))
            .group_by_col((metadata_alias.clone(), AliasedMetadata::Id))
            .to_owned();
        let stmt = self.get_db_stmt(seen_select);
        let seen_by = self
            .0
            .db
            .query_one(stmt)
            .await?
            .map(|qr| qr.try_get_by_index::<i64>(1).unwrap())
            .unwrap();
        let seen_by: usize = seen_by.try_into().unwrap();
        let user_to_meta =
            get_user_to_entity_association(&self.0.db, &user_id, &metadata_id, EntityLot::Metadata)
                .await;
        let average_rating = calculate_average_rating(&reviews);
        let seen_by_user_count = history.len();
        let show_progress = if let Some(show_specifics) = media_details.model.show_specifics {
            let mut seasons = vec![];
            for season in show_specifics.seasons {
                let mut episodes = vec![];
                for episode in season.episodes {
                    let seen = history
                        .iter()
                        .filter(|h| {
                            h.show_extra_information.as_ref().is_some_and(|s| {
                                s.season == season.season_number
                                    && s.episode == episode.episode_number
                            })
                        })
                        .collect_vec();
                    episodes.push(UserMetadataDetailsEpisodeProgress {
                        episode_number: episode.episode_number,
                        times_seen: seen.len(),
                    })
                }
                let times_season_seen = episodes
                    .iter()
                    .map(|e| e.times_seen)
                    .min()
                    .unwrap_or_default();
                seasons.push(UserMetadataDetailsShowSeasonProgress {
                    episodes,
                    times_seen: times_season_seen,
                    season_number: season.season_number,
                })
            }
            Some(seasons)
        } else {
            None
        };
        let podcast_progress =
            if let Some(podcast_specifics) = media_details.model.podcast_specifics {
                let mut episodes = vec![];
                for episode in podcast_specifics.episodes {
                    let seen = history
                        .iter()
                        .filter(|h| {
                            h.podcast_extra_information
                                .as_ref()
                                .is_some_and(|s| s.episode == episode.number)
                        })
                        .collect_vec();
                    episodes.push(UserMetadataDetailsEpisodeProgress {
                        episode_number: episode.number,
                        times_seen: seen.len(),
                    })
                }
                Some(episodes)
            } else {
                None
            };
        let is_recently_consumed =
            get_entity_recently_consumed(&user_id, &metadata_id, EntityLot::Metadata, &self.0)
                .await?;
        Ok(UserMetadataDetails {
            reviews,
            history,
            next_entry,
            collections,
            in_progress,
            show_progress,
            average_rating,
            podcast_progress,
            seen_by_user_count,
            is_recently_consumed,
            seen_by_all_count: seen_by,
            has_interacted: user_to_meta.is_some(),
            media_reason: user_to_meta.and_then(|n| n.media_reason),
        })
    }

    pub async fn user_person_details(
        &self,
        user_id: String,
        person_id: String,
    ) -> Result<UserPersonDetails> {
        let reviews = item_reviews(&user_id, &person_id, EntityLot::Person, true, &self.0).await?;
        let collections =
            entity_in_collections(&self.0.db, &user_id, &person_id, EntityLot::Person).await?;
        let is_recently_consumed =
            get_entity_recently_consumed(&user_id, &person_id, EntityLot::Person, &self.0).await?;
        let average_rating = calculate_average_rating(&reviews);
        Ok(UserPersonDetails {
            reviews,
            collections,
            average_rating,
            is_recently_consumed,
        })
    }

    pub async fn user_metadata_group_details(
        &self,
        user_id: String,
        metadata_group_id: String,
    ) -> Result<UserMetadataGroupDetails> {
        let collections = entity_in_collections(
            &self.0.db,
            &user_id,
            &metadata_group_id,
            EntityLot::MetadataGroup,
        )
        .await?;
        let reviews = item_reviews(
            &user_id,
            &metadata_group_id,
            EntityLot::MetadataGroup,
            true,
            &self.0,
        )
        .await?;
        let is_recently_consumed = get_entity_recently_consumed(
            &user_id,
            &metadata_group_id,
            EntityLot::MetadataGroup,
            &self.0,
        )
        .await?;
        let average_rating = calculate_average_rating(&reviews);
        Ok(UserMetadataGroupDetails {
            reviews,
            collections,
            average_rating,
            is_recently_consumed,
        })
    }

    async fn get_calendar_events(
        &self,
        user_id: String,
        only_monitored: bool,
        start_date: Option<NaiveDate>,
        end_date: Option<NaiveDate>,
        media_limit: Option<u64>,
        deduplicate: Option<bool>,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        #[derive(Debug, FromQueryResult, Clone)]
        struct CalEvent {
            id: String,
            date: NaiveDate,
            m_lot: MediaLot,
            m_title: String,
            metadata_id: String,
            m_images: Option<Vec<MetadataImage>>,
            m_show_specifics: Option<ShowSpecifics>,
            m_podcast_specifics: Option<PodcastSpecifics>,
            metadata_show_extra_information: Option<SeenShowExtraInformation>,
            metadata_anime_extra_information: Option<SeenAnimeExtraInformation>,
            metadata_podcast_extra_information: Option<SeenPodcastExtraInformation>,
        }

        let stmt = Query::select()
            .column(Asterisk)
            .from_subquery(
                CalendarEvent::find()
                    .apply_if(deduplicate.filter(|&d| d), |query, _v| {
                        query
                            .distinct_on([(
                                AliasedCalendarEvent::Table,
                                AliasedCalendarEvent::MetadataId,
                            )])
                            .order_by_asc(Expr::col((
                                AliasedCalendarEvent::Table,
                                AliasedCalendarEvent::MetadataId,
                            )))
                    })
                    .column_as(
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::Lot)),
                        "m_lot",
                    )
                    .column_as(
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::Title)),
                        "m_title",
                    )
                    .column_as(
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::Images)),
                        "m_images",
                    )
                    .column_as(
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::ShowSpecifics)),
                        "m_show_specifics",
                    )
                    .column_as(
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::PodcastSpecifics)),
                        "m_podcast_specifics",
                    )
                    .filter(
                        Expr::col((AliasedUserToEntity::Table, AliasedUserToEntity::UserId))
                            .eq(&user_id),
                    )
                    .inner_join(Metadata)
                    .join_rev(
                        JoinType::Join,
                        UserToEntity::belongs_to(CalendarEvent)
                            .from(user_to_entity::Column::MetadataId)
                            .to(calendar_event::Column::MetadataId)
                            .on_condition(move |left, _right| {
                                Condition::all().add_option(match only_monitored {
                                    true => Some(
                                        Expr::val(UserToMediaReason::Monitoring.to_string()).eq(
                                            PgFunc::any(Expr::col((
                                                left,
                                                user_to_entity::Column::MediaReason,
                                            ))),
                                        ),
                                    ),
                                    false => None,
                                })
                            })
                            .into(),
                    )
                    .order_by_asc(calendar_event::Column::Date)
                    .apply_if(start_date, |q, v| {
                        q.filter(calendar_event::Column::Date.gte(v))
                    })
                    .apply_if(end_date, |q, v| {
                        q.filter(calendar_event::Column::Date.lte(v))
                    })
                    .limit(media_limit)
                    .into_query(),
                Alias::new("sub_query"),
            )
            .order_by(Alias::new("date"), Order::Asc)
            .to_owned();
        let user_preferences = user_by_id(&user_id, &self.0).await?.preferences;
        let show_spoilers_in_calendar = user_preferences.general.show_spoilers_in_calendar;
        let all_events = CalEvent::find_by_statement(self.get_db_stmt(stmt))
            .all(&self.0.db)
            .await?;
        let mut events = vec![];
        for evt in all_events {
            let mut calc = GraphqlCalendarEvent {
                date: evt.date,
                metadata_lot: evt.m_lot,
                calendar_event_id: evt.id,
                metadata_text: evt.m_title,
                metadata_id: evt.metadata_id,
                ..Default::default()
            };
            let mut image = None;

            if let Some(s) = evt.metadata_show_extra_information {
                if let Some(sh) = evt.m_show_specifics {
                    if let Some((_, ep)) = get_show_episode_by_numbers(&sh, s.season, s.episode) {
                        image = ep.poster_images.first().cloned();
                        if show_spoilers_in_calendar {
                            calc.metadata_text = ep.name.clone();
                        }
                    }
                }
                calc.show_extra_information = Some(s);
            } else if let Some(p) = evt.metadata_podcast_extra_information {
                if let Some(po) = evt.m_podcast_specifics {
                    if let Some(ep) = get_podcast_episode_by_number(&po, p.episode) {
                        image = ep.thumbnail.clone();
                        if show_spoilers_in_calendar {
                            calc.metadata_text = ep.title.clone();
                        }
                    }
                };
                calc.podcast_extra_information = Some(p);
            } else if let Some(a) = evt.metadata_anime_extra_information {
                calc.anime_extra_information = Some(a);
            };

            if image.is_none() {
                image =
                    first_metadata_image_as_url(&evt.m_images, &self.0.file_storage_service).await
            }
            calc.metadata_image = image;
            events.push(calc);
        }
        Ok(events)
    }

    pub async fn user_calendar_events(
        &self,
        user_id: String,
        input: UserCalendarEventInput,
    ) -> Result<Vec<GroupedCalendarEvent>> {
        let (start_date, end_date) = get_first_and_last_day_of_month(input.year, input.month);
        let events = self
            .get_calendar_events(user_id, false, Some(start_date), Some(end_date), None, None)
            .await?;
        let grouped_events = events
            .into_iter()
            .chunk_by(|event| event.date)
            .into_iter()
            .map(|(date, events)| GroupedCalendarEvent {
                date,
                events: events.collect(),
            })
            .collect();
        Ok(grouped_events)
    }

    pub async fn user_upcoming_calendar_events(
        &self,
        user_id: String,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        let start_date = Utc::now().date_naive();
        let (media_limit, end_date) = match input {
            UserUpcomingCalendarEventInput::NextMedia(l) => (Some(l), None),
            UserUpcomingCalendarEventInput::NextDays(d) => {
                (None, start_date.checked_add_days(Days::new(d)))
            }
        };
        let preferences = user_by_id(&user_id, &self.0).await?.preferences.general;
        let element = preferences
            .dashboard
            .iter()
            .find(|e| matches!(e.section, DashboardElementLot::Upcoming));
        let events = self
            .get_calendar_events(
                user_id,
                true,
                Some(start_date),
                end_date,
                media_limit,
                element.and_then(|e| e.deduplicate_media),
            )
            .await?;
        Ok(events)
    }

    pub async fn user_metadata_list(
        &self,
        user_id: String,
        input: UserMetadataListInput,
    ) -> Result<CachedResponse<UserMetadataListResponse>> {
        user_metadata_list(&user_id, input, &self.0).await
    }

    pub async fn deploy_bulk_progress_update(
        &self,
        user_id: String,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<bool> {
        self.0
            .perform_application_job(ApplicationJob::Hp(HpApplicationJob::BulkProgressUpdate(
                user_id, input,
            )))
            .await?;
        Ok(true)
    }

    pub async fn bulk_progress_update(
        &self,
        user_id: String,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<()> {
        for seen in input {
            progress_update(&user_id, false, seen, &self.0)
                .await
                .trace_ok();
        }
        Ok(())
    }

    pub async fn expire_cache_key(&self, cache_id: Uuid) -> Result<bool> {
        self.0
            .cache_service
            .expire_key(ExpireCacheKeyInput::ById(cache_id))
            .await
    }

    pub async fn deploy_background_job(
        &self,
        user_id: &String,
        job_name: BackgroundJob,
    ) -> Result<bool> {
        deploy_background_job(user_id, job_name, &self.0).await
    }

    pub async fn mark_entity_as_partial(
        &self,
        _user_id: &str,
        input: MarkEntityAsPartialInput,
    ) -> Result<bool> {
        match input.entity_lot {
            EntityLot::Metadata => {
                Metadata::update_many()
                    .filter(metadata::Column::Id.eq(&input.entity_id))
                    .col_expr(metadata::Column::IsPartial, Expr::value(true))
                    .exec(&self.0.db)
                    .await?;
            }
            EntityLot::MetadataGroup => {
                MetadataGroup::update_many()
                    .filter(metadata_group::Column::Id.eq(&input.entity_id))
                    .col_expr(metadata_group::Column::IsPartial, Expr::value(true))
                    .exec(&self.0.db)
                    .await?;
            }
            EntityLot::Person => {
                Person::update_many()
                    .filter(person::Column::Id.eq(&input.entity_id))
                    .col_expr(person::Column::IsPartial, Expr::value(true))
                    .exec(&self.0.db)
                    .await?;
            }
            _ => return Err(Error::new("Invalid entity lot".to_owned())),
        }
        Ok(true)
    }

    async fn cleanup_user_and_metadata_association(&self) -> Result<()> {
        let all_users = get_user_query()
            .select_only()
            .column(user::Column::Id)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await
            .unwrap();
        for user_id in all_users {
            let collections = Collection::find()
                .column(collection::Column::Id)
                .column(collection::Column::UserId)
                .left_join(UserToEntity)
                .filter(user_to_entity::Column::UserId.eq(&user_id))
                .all(&self.0.db)
                .await
                .unwrap();
            let monitoring_collection_id = collections
                .iter()
                .find(|c| {
                    c.name == DefaultCollection::Monitoring.to_string() && c.user_id == user_id
                })
                .map(|c| c.id.clone())
                .unwrap();
            let watchlist_collection_id = collections
                .iter()
                .find(|c| {
                    c.name == DefaultCollection::Watchlist.to_string() && c.user_id == user_id
                })
                .map(|c| c.id.clone())
                .unwrap();
            let owned_collection_id = collections
                .iter()
                .find(|c| c.name == DefaultCollection::Owned.to_string() && c.user_id == user_id)
                .map(|c| c.id.clone())
                .unwrap();
            let reminder_collection_id = collections
                .iter()
                .find(|c| {
                    c.name == DefaultCollection::Reminders.to_string() && c.user_id == user_id
                })
                .map(|c| c.id.clone())
                .unwrap();
            let all_user_to_entities = UserToEntity::find()
                .filter(user_to_entity::Column::NeedsToBeUpdated.eq(true))
                .filter(user_to_entity::Column::UserId.eq(&user_id))
                .all(&self.0.db)
                .await
                .unwrap();
            for ute in all_user_to_entities {
                let mut new_reasons = HashSet::new();
                let (entity_id, entity_lot) = if let Some(metadata_id) = ute.metadata_id.clone() {
                    let (is_finished, seen_history) =
                        is_metadata_finished_by_user(&ute.user_id, &metadata_id, &self.0.db)
                            .await?;
                    if !seen_history.is_empty() {
                        new_reasons.insert(UserToMediaReason::Seen);
                    }
                    if !seen_history.is_empty() && is_finished {
                        new_reasons.insert(UserToMediaReason::Finished);
                    }
                    (metadata_id, EntityLot::Metadata)
                } else if let Some(person_id) = ute.person_id.clone() {
                    (person_id, EntityLot::Person)
                } else if let Some(metadata_group_id) = ute.metadata_group_id.clone() {
                    (metadata_group_id, EntityLot::MetadataGroup)
                } else {
                    ryot_log!(debug, "Skipping user_to_entity = {:?}", ute.id);
                    continue;
                };

                let collections_part_of =
                    entity_in_collections(&self.0.db, &user_id, &entity_id, entity_lot)
                        .await?
                        .into_iter()
                        .map(|c| c.id)
                        .collect_vec();
                if Review::find()
                    .filter(review::Column::UserId.eq(&ute.user_id))
                    .filter(
                        review::Column::MetadataId
                            .eq(ute.metadata_id.clone())
                            .or(review::Column::MetadataGroupId.eq(ute.metadata_group_id.clone()))
                            .or(review::Column::PersonId.eq(ute.person_id.clone())),
                    )
                    .count(&self.0.db)
                    .await
                    .unwrap()
                    > 0
                {
                    new_reasons.insert(UserToMediaReason::Reviewed);
                }
                let is_in_collection = !collections_part_of.is_empty();
                let is_monitoring = collections_part_of.contains(&monitoring_collection_id);
                let is_watchlist = collections_part_of.contains(&watchlist_collection_id);
                let is_owned = collections_part_of.contains(&owned_collection_id);
                let has_reminder = collections_part_of.contains(&reminder_collection_id);
                if is_in_collection {
                    new_reasons.insert(UserToMediaReason::Collection);
                }
                if is_monitoring {
                    new_reasons.insert(UserToMediaReason::Monitoring);
                }
                if is_watchlist {
                    new_reasons.insert(UserToMediaReason::Watchlist);
                }
                if is_owned {
                    new_reasons.insert(UserToMediaReason::Owned);
                }
                if has_reminder {
                    new_reasons.insert(UserToMediaReason::Reminder);
                }
                let previous_reasons =
                    HashSet::from_iter(ute.media_reason.clone().unwrap_or_default().into_iter());
                if new_reasons.is_empty() {
                    ryot_log!(debug, "Deleting user_to_entity = {id:?}", id = (&ute.id));
                    ute.delete(&self.0.db).await.unwrap();
                } else {
                    let mut ute: user_to_entity::ActiveModel = ute.into();
                    if new_reasons != previous_reasons {
                        ryot_log!(debug, "Updating user_to_entity = {id:?}", id = (&ute.id));
                        ute.media_reason =
                            ActiveValue::Set(Some(new_reasons.into_iter().collect()));
                    }
                    ute.needs_to_be_updated = ActiveValue::Set(None);
                    ute.update(&self.0.db).await.unwrap();
                }
            }
        }
        Ok(())
    }

    pub async fn update_seen_item(
        &self,
        user_id: String,
        input: UpdateSeenItemInput,
    ) -> Result<bool> {
        let Some(seen) = Seen::find_by_id(input.seen_id)
            .one(&self.0.db)
            .await
            .unwrap()
        else {
            return Err(Error::new("No seen found for this user and metadata"));
        };
        if seen.user_id != user_id {
            return Err(Error::new("No seen found for this user and metadata"));
        }
        let mut seen: seen::ActiveModel = seen.into();
        if let Some(started_on) = input.started_on {
            seen.started_on = ActiveValue::Set(Some(started_on));
        }
        if let Some(finished_on) = input.finished_on {
            seen.finished_on = ActiveValue::Set(Some(finished_on));
        }
        if let Some(provider_watched_on) = input.provider_watched_on {
            seen.provider_watched_on = ActiveValue::Set(Some(provider_watched_on));
        }
        if let Some(manual_time_spent) = input.manual_time_spent {
            seen.manual_time_spent = ActiveValue::Set(Some(manual_time_spent));
        }
        if let Some(review_id) = input.review_id {
            let (review, to_update_review_id) = match review_id.is_empty() {
                false => (
                    Review::find_by_id(&review_id)
                        .one(&self.0.db)
                        .await
                        .unwrap(),
                    Some(review_id),
                ),
                true => (None, None),
            };
            if let Some(review_item) = review {
                if review_item.user_id != user_id {
                    return Err(Error::new(
                        "You cannot associate a review with a seen item that is not yours",
                    ));
                }
            }
            seen.review_id = ActiveValue::Set(to_update_review_id);
        }
        let seen = seen.update(&self.0.db).await.unwrap();
        deploy_after_handle_media_seen_tasks(seen, &self.0).await?;
        Ok(true)
    }

    pub async fn deploy_update_person_job(&self, person_id: String) -> Result<bool> {
        let person = Person::find_by_id(person_id)
            .one(&self.0.db)
            .await
            .unwrap()
            .unwrap();
        deploy_update_person_job(&person.id, &self.0).await?;
        Ok(true)
    }

    pub async fn deploy_update_metadata_group_job(
        &self,
        metadata_group_id: String,
    ) -> Result<bool> {
        let metadata_group = MetadataGroup::find_by_id(metadata_group_id)
            .one(&self.0.db)
            .await
            .unwrap()
            .unwrap();
        deploy_update_metadata_group_job(&metadata_group.id, &self.0).await?;
        Ok(true)
    }

    pub async fn merge_metadata(
        &self,
        user_id: String,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        let txn = self.0.db.begin().await?;
        for old_seen in Seen::find()
            .filter(seen::Column::MetadataId.eq(&merge_from))
            .filter(seen::Column::UserId.eq(&user_id))
            .all(&txn)
            .await
            .unwrap()
        {
            let old_seen_active: seen::ActiveModel = old_seen.clone().into();
            let new_seen = seen::ActiveModel {
                id: ActiveValue::NotSet,
                last_updated_on: ActiveValue::NotSet,
                num_times_updated: ActiveValue::NotSet,
                metadata_id: ActiveValue::Set(merge_into.clone()),
                ..old_seen_active
            };
            new_seen.insert(&txn).await?;
            old_seen.delete(&txn).await?;
        }
        for old_review in Review::find()
            .filter(review::Column::MetadataId.eq(&merge_from))
            .filter(review::Column::UserId.eq(&user_id))
            .all(&txn)
            .await
            .unwrap()
        {
            let old_review_active: review::ActiveModel = old_review.clone().into();
            let new_review = review::ActiveModel {
                id: ActiveValue::NotSet,
                metadata_id: ActiveValue::Set(Some(merge_into.clone())),
                ..old_review_active
            };
            new_review.insert(&txn).await?;
            old_review.delete(&txn).await?;
        }
        let collections = Collection::find()
            .select_only()
            .column(collection::Column::Id)
            .left_join(UserToEntity)
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .into_tuple::<String>()
            .all(&txn)
            .await
            .unwrap();
        for item in CollectionToEntity::find()
            .filter(collection_to_entity::Column::MetadataId.eq(&merge_from))
            .filter(collection_to_entity::Column::CollectionId.is_in(collections))
            .all(&txn)
            .await?
            .into_iter()
        {
            if CollectionToEntity::find()
                .filter(collection_to_entity::Column::CollectionId.eq(item.collection_id.clone()))
                .filter(collection_to_entity::Column::MetadataId.eq(&merge_into))
                .count(&txn)
                .await?
                == 0
            {
                let mut item_active: collection_to_entity::ActiveModel = item.into();
                item_active.metadata_id = ActiveValue::Set(Some(merge_into.clone()));
                item_active.update(&txn).await?;
            }
        }
        if let Some(_association) =
            get_user_to_entity_association(&txn, &user_id, &merge_into, EntityLot::Metadata).await
        {
            let old_association =
                get_user_to_entity_association(&txn, &user_id, &merge_from, EntityLot::Metadata)
                    .await
                    .unwrap();
            let mut cloned: user_to_entity::ActiveModel = old_association.clone().into();
            cloned.needs_to_be_updated = ActiveValue::Set(Some(true));
            cloned.update(&txn).await?;
        } else {
            UserToEntity::update_many()
                .filter(user_to_entity::Column::MetadataId.eq(merge_from))
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .set(user_to_entity::ActiveModel {
                    metadata_id: ActiveValue::Set(Some(merge_into.clone())),
                    ..Default::default()
                })
                .exec(&txn)
                .await?;
        }
        txn.commit().await?;
        Ok(true)
    }

    pub async fn commit_metadata(&self, input: CommitMediaInput) -> Result<StringIdObject> {
        commit_metadata(input, &self.0).await
    }

    pub async fn commit_person(&self, input: CommitPersonInput) -> Result<StringIdObject> {
        commit_person(input, &self.0.db).await
    }

    pub async fn disassociate_metadata(
        &self,
        user_id: String,
        metadata_id: String,
    ) -> Result<bool> {
        let delete_review = Review::delete_many()
            .filter(review::Column::MetadataId.eq(&metadata_id))
            .filter(review::Column::UserId.eq(&user_id))
            .exec(&self.0.db)
            .await?;
        ryot_log!(debug, "Deleted {} reviews", delete_review.rows_affected);
        let delete_seen = Seen::delete_many()
            .filter(seen::Column::MetadataId.eq(&metadata_id))
            .filter(seen::Column::UserId.eq(&user_id))
            .exec(&self.0.db)
            .await?;
        ryot_log!(debug, "Deleted {} seen items", delete_seen.rows_affected);
        let collections_part_of = entity_in_collections_with_collection_to_entity_ids(
            &self.0.db,
            &user_id,
            &metadata_id,
            EntityLot::Metadata,
        )
        .await?
        .into_iter()
        .map(|(_, id)| id);
        let delete_collections = CollectionToEntity::delete_many()
            .filter(collection_to_entity::Column::Id.is_in(collections_part_of))
            .exec(&self.0.db)
            .await?;
        ryot_log!(
            debug,
            "Deleted {} collections",
            delete_collections.rows_affected
        );
        UserToEntity::delete_many()
            .filter(user_to_entity::Column::MetadataId.eq(metadata_id))
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .exec(&self.0.db)
            .await?;
        Ok(true)
    }

    pub async fn metadata_search(
        &self,
        user_id: &String,
        input: MetadataSearchInput,
    ) -> Result<MetadataSearchResponse> {
        let cc = &self.0.cache_service;
        let cache_key = ApplicationCacheKey::MetadataSearch(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        });
        if let Some((_id, cached)) = cc.get_value(cache_key.clone()).await {
            return Ok(cached);
        }
        let query = input.search.query.unwrap_or_default();
        if query.is_empty() {
            return Ok(SearchResults::default());
        }
        let preferences = user_by_id(user_id, &self.0).await?.preferences;
        let provider = get_metadata_provider(input.lot, input.source, &self.0).await?;
        let results = provider
            .metadata_search(&query, input.search.page, preferences.general.display_nsfw)
            .await?;
        cc.set_key(
            cache_key,
            ApplicationCacheValue::MetadataSearch(results.clone()),
        )
        .await?;
        Ok(results)
    }

    pub async fn people_search(
        &self,
        user_id: &String,
        input: PeopleSearchInput,
    ) -> Result<PeopleSearchResponse> {
        let cc = &self.0.cache_service;
        let cache_key = ApplicationCacheKey::PeopleSearch(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.clone(),
        });
        if let Some((_id, results)) = cc.get_value(cache_key.clone()).await {
            return Ok(results);
        }
        let query = input.search.query.unwrap_or_default();
        if query.is_empty() {
            return Ok(SearchResults::default());
        }
        let preferences = user_by_id(user_id, &self.0).await?.preferences;
        let provider = self.get_non_metadata_provider(input.source).await?;
        let results = provider
            .people_search(
                &query,
                input.search.page,
                preferences.general.display_nsfw,
                &input.source_specifics,
            )
            .await?;
        cc.set_key(
            cache_key,
            ApplicationCacheValue::PeopleSearch(results.clone()),
        )
        .await?;
        Ok(results)
    }

    pub async fn metadata_group_search(
        &self,
        user_id: &String,
        input: MetadataGroupSearchInput,
    ) -> Result<MetadataGroupSearchResponse> {
        let cc = &self.0.cache_service;
        let cache_key = ApplicationCacheKey::MetadataGroupSearch(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.clone(),
        });
        if let Some((_id, results)) = cc.get_value(cache_key.clone()).await {
            return Ok(results);
        }
        let query = input.search.query.unwrap_or_default();
        if query.is_empty() {
            return Ok(SearchResults::default());
        }
        let preferences = user_by_id(user_id, &self.0).await?.preferences;
        let provider = get_metadata_provider(input.lot, input.source, &self.0).await?;
        let results = provider
            .metadata_group_search(&query, input.search.page, preferences.general.display_nsfw)
            .await?;
        cc.set_key(
            cache_key,
            ApplicationCacheValue::MetadataGroupSearch(results.clone()),
        )
        .await?;
        Ok(results)
    }

    async fn get_non_metadata_provider(&self, source: MediaSource) -> Result<Provider> {
        let err = || Err(Error::new("This source is not supported".to_owned()));
        let service: Provider = match source {
            MediaSource::YoutubeMusic => Box::new(YoutubeMusicService::new().await),
            MediaSource::Hardcover => Box::new(get_hardcover_service(&self.0.config).await?),
            MediaSource::Vndb => Box::new(VndbService::new(&self.0.config.visual_novels).await),
            MediaSource::Openlibrary => Box::new(get_openlibrary_service(&self.0.config).await?),
            MediaSource::Itunes => {
                Box::new(ITunesService::new(&self.0.config.podcasts.itunes).await)
            }
            MediaSource::GoogleBooks => Box::new(get_google_books_service(&self.0.config).await?),
            MediaSource::Audible => {
                Box::new(AudibleService::new(&self.0.config.audio_books.audible).await)
            }
            MediaSource::Listennotes => Box::new(ListennotesService::new(self.0.clone()).await),
            MediaSource::Igdb => Box::new(IgdbService::new(self.0.clone()).await),
            MediaSource::MangaUpdates => Box::new(
                MangaUpdatesService::new(&self.0.config.anime_and_manga.manga_updates).await,
            ),
            MediaSource::Tmdb => Box::new(get_tmdb_non_media_service(&self.0).await?),
            MediaSource::Anilist => {
                Box::new(NonMediaAnilistService::new(&self.0.config.anime_and_manga.anilist).await)
            }
            MediaSource::Mal => Box::new(NonMediaMalService::new().await),
            MediaSource::Custom => return err(),
        };
        Ok(service)
    }

    pub async fn commit_metadata_group(&self, input: CommitMediaInput) -> Result<StringIdObject> {
        commit_metadata_group(input, &self.0).await
    }

    pub async fn create_or_update_review(
        &self,
        user_id: &String,
        input: CreateOrUpdateReviewInput,
    ) -> Result<StringIdObject> {
        post_review(user_id, input, &self.0).await
    }

    pub async fn delete_review(&self, user_id: String, review_id: String) -> Result<bool> {
        let review = Review::find()
            .filter(review::Column::Id.eq(review_id))
            .one(&self.0.db)
            .await
            .unwrap();
        match review {
            Some(r) => {
                if r.user_id == user_id {
                    associate_user_with_entity(&self.0.db, &user_id, &r.entity_id, r.entity_lot)
                        .await?;
                    r.delete(&self.0.db).await?;
                    Ok(true)
                } else {
                    Err(Error::new("This review does not belong to you".to_owned()))
                }
            }
            None => Ok(false),
        }
    }

    pub async fn handle_after_media_seen_tasks(&self, seen: Box<seen::Model>) -> Result<()> {
        handle_after_media_seen_tasks(*seen, &self.0).await
    }

    pub async fn delete_seen_item(
        &self,
        user_id: &String,
        seen_id: String,
    ) -> Result<StringIdObject> {
        let seen_item = Seen::find_by_id(seen_id).one(&self.0.db).await.unwrap();
        let Some(si) = seen_item else {
            return Err(Error::new("This seen item does not exist".to_owned()));
        };
        let cloned_seen = si.clone();
        let (ssn, sen) = match &si.show_extra_information {
            Some(d) => (Some(d.season), Some(d.episode)),
            None => (None, None),
        };
        let pen = si.podcast_extra_information.as_ref().map(|d| d.episode);
        let aen = si.anime_extra_information.as_ref().and_then(|d| d.episode);
        let mcn = si.manga_extra_information.as_ref().and_then(|d| d.chapter);
        let mvn = si.manga_extra_information.as_ref().and_then(|d| d.volume);
        let cache = ApplicationCacheKey::ProgressUpdateCache(UserLevelCacheKey {
            user_id: user_id.to_owned(),
            input: ProgressUpdateCacheInput {
                show_season_number: ssn,
                manga_volume_number: mvn,
                show_episode_number: sen,
                anime_episode_number: aen,
                manga_chapter_number: mcn,
                podcast_episode_number: pen,
                metadata_id: si.metadata_id.clone(),
                provider_watched_on: si.provider_watched_on.clone(),
            },
        });
        self.0
            .cache_service
            .expire_key(ExpireCacheKeyInput::ByKey(cache))
            .await?;
        let seen_id = si.id.clone();
        let metadata_id = si.metadata_id.clone();
        if &si.user_id != user_id {
            return Err(Error::new(
                "This seen item does not belong to this user".to_owned(),
            ));
        }
        si.delete(&self.0.db).await.trace_ok();
        associate_user_with_entity(&self.0.db, user_id, &metadata_id, EntityLot::Metadata).await?;
        deploy_after_handle_media_seen_tasks(cloned_seen, &self.0).await?;
        Ok(StringIdObject { id: seen_id })
    }

    async fn regenerate_user_summaries(&self) -> Result<()> {
        let all_users = get_user_query()
            .select_only()
            .column(user::Column::Id)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await
            .unwrap();
        for user_id in all_users {
            calculate_user_activities_and_summary(&user_id, &self.0, false).await?;
        }
        Ok(())
    }

    fn get_data_for_custom_metadata(
        &self,
        input: CreateCustomMetadataInput,
        identifier: String,
        user_id: &str,
    ) -> metadata::ActiveModel {
        let images = input
            .images
            .unwrap_or_default()
            .into_iter()
            .map(|i| MetadataImage {
                url: StoredUrl::S3(i),
            })
            .collect_vec();
        let videos = input
            .videos
            .unwrap_or_default()
            .into_iter()
            .map(|i| MetadataVideo {
                identifier: StoredUrl::S3(i),
                source: MetadataVideoSource::Custom,
            })
            .collect_vec();
        let free_creators = input
            .creators
            .unwrap_or_default()
            .into_iter()
            .map(|c| MetadataFreeCreator {
                name: c,
                role: "Creator".to_string(),
                ..Default::default()
            })
            .collect_vec();
        let is_partial = match input.lot {
            MediaLot::Show => input.show_specifics.is_none(),
            MediaLot::Book => input.book_specifics.is_none(),
            MediaLot::Music => input.music_specifics.is_none(),
            MediaLot::Anime => input.anime_specifics.is_none(),
            MediaLot::Manga => input.manga_specifics.is_none(),
            MediaLot::Movie => input.movie_specifics.is_none(),
            MediaLot::Podcast => input.podcast_specifics.is_none(),
            MediaLot::AudioBook => input.audio_book_specifics.is_none(),
            MediaLot::VideoGame => input.video_game_specifics.is_none(),
            MediaLot::VisualNovel => input.visual_novel_specifics.is_none(),
        };
        metadata::ActiveModel {
            lot: ActiveValue::Set(input.lot),
            title: ActiveValue::Set(input.title),
            identifier: ActiveValue::Set(identifier),
            is_nsfw: ActiveValue::Set(input.is_nsfw),
            source: ActiveValue::Set(MediaSource::Custom),
            is_partial: ActiveValue::Set(Some(is_partial)),
            description: ActiveValue::Set(input.description),
            publish_year: ActiveValue::Set(input.publish_year),
            show_specifics: ActiveValue::Set(input.show_specifics),
            book_specifics: ActiveValue::Set(input.book_specifics),
            manga_specifics: ActiveValue::Set(input.manga_specifics),
            anime_specifics: ActiveValue::Set(input.anime_specifics),
            movie_specifics: ActiveValue::Set(input.movie_specifics),
            music_specifics: ActiveValue::Set(input.music_specifics),
            podcast_specifics: ActiveValue::Set(input.podcast_specifics),
            created_by_user_id: ActiveValue::Set(Some(user_id.to_owned())),
            audio_book_specifics: ActiveValue::Set(input.audio_book_specifics),
            video_game_specifics: ActiveValue::Set(input.video_game_specifics),
            visual_novel_specifics: ActiveValue::Set(input.visual_novel_specifics),
            images: ActiveValue::Set(match images.is_empty() {
                true => None,
                false => Some(images),
            }),
            videos: ActiveValue::Set(match videos.is_empty() {
                true => None,
                false => Some(videos),
            }),
            free_creators: ActiveValue::Set(match free_creators.is_empty() {
                true => None,
                false => Some(free_creators),
            }),
            ..Default::default()
        }
    }

    pub async fn create_custom_metadata(
        &self,
        user_id: String,
        input: CreateCustomMetadataInput,
    ) -> Result<metadata::Model> {
        let identifier = nanoid!(10);
        let metadata = self.get_data_for_custom_metadata(input.clone(), identifier, &user_id);
        let metadata = metadata.insert(&self.0.db).await?;
        change_metadata_associations(
            &metadata.id,
            input.genres.unwrap_or_default(),
            vec![],
            vec![],
            vec![],
            &self.0,
        )
        .await?;
        add_entity_to_collection(
            &user_id,
            ChangeCollectionToEntityInput {
                entity_id: metadata.id.clone(),
                entity_lot: EntityLot::Metadata,
                creator_user_id: user_id.to_owned(),
                collection_name: DefaultCollection::Custom.to_string(),
                ..Default::default()
            },
            &self.0,
        )
        .await?;
        Ok(metadata)
    }

    pub async fn update_custom_metadata(
        &self,
        user_id: &str,
        input: UpdateCustomMetadataInput,
    ) -> Result<bool> {
        let metadata = Metadata::find_by_id(&input.existing_metadata_id)
            .one(&self.0.db)
            .await?
            .unwrap();
        if metadata.source != MediaSource::Custom {
            return Err(Error::new(
                "This metadata is not custom and cannot be updated",
            ));
        }
        if metadata.created_by_user_id != Some(user_id.to_owned()) {
            return Err(Error::new("You are not authorized to update this metadata"));
        }
        MetadataToGenre::delete_many()
            .filter(metadata_to_genre::Column::MetadataId.eq(&input.existing_metadata_id))
            .exec(&self.0.db)
            .await?;
        for image in metadata.images.clone().unwrap_or_default() {
            if let StoredUrl::S3(key) = image.url {
                self.0.file_storage_service.delete_object(key).await;
            }
        }
        for video in metadata.videos.clone().unwrap_or_default() {
            if let StoredUrl::S3(key) = video.identifier {
                self.0.file_storage_service.delete_object(key).await;
            }
        }
        let mut new_metadata =
            self.get_data_for_custom_metadata(input.update.clone(), metadata.identifier, user_id);
        new_metadata.id = ActiveValue::Unchanged(input.existing_metadata_id);
        let metadata = new_metadata.update(&self.0.db).await?;
        change_metadata_associations(
            &metadata.id,
            input.update.genres.unwrap_or_default(),
            vec![],
            vec![],
            vec![],
            &self.0,
        )
        .await?;
        Ok(true)
    }

    fn get_db_stmt(&self, stmt: SelectStatement) -> Statement {
        let (sql, values) = stmt.build(PostgresQueryBuilder {});
        Statement::from_sql_and_values(DatabaseBackend::Postgres, sql, values)
    }

    async fn get_monitored_entities(
        &self,
        entity_lot: EntityLot,
    ) -> Result<HashMap<String, HashSet<String>>> {
        let monitored_entities = MonitoredEntity::find()
            .filter(monitored_entity::Column::EntityLot.eq(entity_lot))
            .all(&self.0.db)
            .await?;
        let mut monitored_by = HashMap::new();
        for entity in monitored_entities {
            let user_ids = monitored_by
                .entry(entity.entity_id)
                .or_insert(HashSet::new());
            user_ids.insert(entity.user_id);
        }
        Ok(monitored_by)
    }

    async fn update_monitored_metadata_and_queue_notifications(&self) -> Result<()> {
        let m_map = self.get_monitored_entities(EntityLot::Metadata).await?;
        ryot_log!(
            debug,
            "Users to be notified for metadata state changes: {:?}",
            m_map
        );
        let chunks = m_map.keys().chunks(BULK_APPLICATION_UPDATE_CHUNK_SIZE);
        let items = chunks
            .into_iter()
            .map(|chunk| chunk.into_iter().collect_vec())
            .collect_vec();
        for chunk in items {
            let promises = chunk
                .into_iter()
                .map(|m| self.update_metadata_and_notify_users(m));
            join_all(promises).await;
        }
        Ok(())
    }

    async fn update_monitored_people_and_queue_notifications(&self) -> Result<()> {
        let p_map = self.get_monitored_entities(EntityLot::Person).await?;
        ryot_log!(
            debug,
            "Users to be notified for people state changes: {:?}",
            p_map
        );
        let chunks = p_map.keys().chunks(BULK_APPLICATION_UPDATE_CHUNK_SIZE);
        let items = chunks
            .into_iter()
            .map(|chunk| chunk.into_iter().collect_vec())
            .collect_vec();
        for chunk in items {
            let promises = chunk
                .into_iter()
                .map(|p| self.update_person_and_notify_users(p));
            join_all(promises).await;
        }
        Ok(())
    }

    pub async fn genres_list(
        &self,
        user_id: String,
        input: SearchInput,
    ) -> Result<SearchResults<String>> {
        let page: u64 = input.page.unwrap_or(1).try_into().unwrap();
        let preferences = user_by_id(&user_id, &self.0).await?.preferences;
        let num_items = "num_items";
        let query = Genre::find()
            .column_as(
                Expr::expr(Func::count(Expr::col((
                    AliasedMetadataToGenre::Table,
                    AliasedMetadataToGenre::MetadataId,
                )))),
                num_items,
            )
            .apply_if(input.query, |query, v| {
                query.filter(
                    Condition::all().add(Expr::col(genre::Column::Name).ilike(ilike_sql(&v))),
                )
            })
            .join(JoinType::Join, genre::Relation::MetadataToGenre.def())
            .group_by(Expr::tuple([
                Expr::col(genre::Column::Id).into(),
                Expr::col(genre::Column::Name).into(),
            ]))
            .order_by(Expr::col(Alias::new(num_items)), Order::Desc);
        let paginator = query
            .clone()
            .into_model::<GenreListItem>()
            .paginate(&self.0.db, preferences.general.list_page_size);
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        let mut items = vec![];
        for c in paginator.fetch_page(page - 1).await? {
            items.push(c.id);
        }
        Ok(SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages {
                    Some((page + 1).try_into().unwrap())
                } else {
                    None
                },
            },
            items,
        })
    }

    pub async fn user_metadata_groups_list(
        &self,
        user_id: String,
        input: UserMetadataGroupsListInput,
    ) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
        user_metadata_groups_list(&user_id, &self.0, input).await
    }

    pub async fn user_people_list(
        &self,
        user_id: String,
        input: UserPeopleListInput,
    ) -> Result<CachedResponse<UserPeopleListResponse>> {
        user_people_list(&user_id, input, &self.0).await
    }

    pub async fn person_details(&self, person_id: String) -> Result<GraphqlPersonDetails> {
        let mut details = Person::find_by_id(person_id.clone())
            .one(&self.0.db)
            .await?
            .unwrap();
        details.display_images =
            metadata_images_as_urls(&details.images, &self.0.file_storage_service).await;
        let metadata_associations = MetadataToPerson::find()
            .filter(metadata_to_person::Column::PersonId.eq(&person_id))
            .order_by_asc(metadata_to_person::Column::Index)
            .all(&self.0.db)
            .await?;
        let mut metadata_contents: HashMap<_, Vec<_>> = HashMap::new();
        for assoc in metadata_associations {
            let to_push = PersonDetailsItemWithCharacter {
                character: assoc.character,
                entity_id: assoc.metadata_id,
            };
            metadata_contents
                .entry(assoc.role)
                .and_modify(|e| e.push(to_push.clone()))
                .or_insert(vec![to_push]);
        }
        let associated_metadata = metadata_contents
            .into_iter()
            .map(|(name, items)| PersonDetailsGroupedByRole {
                count: items.len(),
                name,
                items,
            })
            .sorted_by_key(|f| Reverse(f.count))
            .collect_vec();
        let associated_metadata_groups = MetadataGroupToPerson::find()
            .filter(metadata_group_to_person::Column::PersonId.eq(person_id))
            .order_by_asc(metadata_group_to_person::Column::Index)
            .all(&self.0.db)
            .await?;
        let mut metadata_group_contents: HashMap<_, Vec<_>> = HashMap::new();
        for assoc in associated_metadata_groups {
            let to_push = PersonDetailsItemWithCharacter {
                entity_id: assoc.metadata_group_id,
                ..Default::default()
            };
            metadata_group_contents
                .entry(assoc.role)
                .and_modify(|e| e.push(to_push.clone()))
                .or_insert(vec![to_push]);
        }
        let associated_metadata_groups = metadata_group_contents
            .into_iter()
            .map(|(name, items)| PersonDetailsGroupedByRole {
                count: items.len(),
                name,
                items,
            })
            .sorted_by_key(|f| Reverse(f.count))
            .collect_vec();
        Ok(GraphqlPersonDetails {
            details,
            associated_metadata,
            associated_metadata_groups,
        })
    }

    pub async fn genre_details(
        &self,
        user_id: String,
        input: GenreDetailsInput,
    ) -> Result<GenreDetails> {
        let page = input.page.unwrap_or(1);
        let genre = Genre::find_by_id(input.genre_id.clone())
            .one(&self.0.db)
            .await?
            .unwrap();
        let preferences = user_by_id(&user_id, &self.0).await?.preferences;
        let paginator = MetadataToGenre::find()
            .filter(metadata_to_genre::Column::GenreId.eq(input.genre_id))
            .paginate(&self.0.db, preferences.general.list_page_size);
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        let mut contents = vec![];
        for association_items in paginator.fetch_page(page - 1).await? {
            contents.push(association_items.metadata_id);
        }
        Ok(GenreDetails {
            details: GenreListItem {
                id: genre.id,
                name: genre.name,
                num_items: Some(number_of_items.try_into().unwrap()),
            },
            contents: SearchResults {
                details: SearchDetails {
                    total: number_of_items.try_into().unwrap(),
                    next_page: if page < number_of_pages {
                        Some((page + 1).try_into().unwrap())
                    } else {
                        None
                    },
                },
                items: contents,
            },
        })
    }

    pub async fn metadata_group_details(
        &self,
        metadata_group_id: String,
    ) -> Result<MetadataGroupDetails> {
        let mut group = MetadataGroup::find_by_id(metadata_group_id)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Group not found"))?;
        let mut images = vec![];
        for image in group.images.clone().unwrap_or_default().iter() {
            images.push(
                self.0
                    .file_storage_service
                    .get_stored_asset(image.url.clone())
                    .await,
            );
        }
        group.display_images = images;
        let contents = MetadataToMetadataGroup::find()
            .select_only()
            .column(metadata_to_metadata_group::Column::MetadataId)
            .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(group.id.clone()))
            .order_by_asc(metadata_to_metadata_group::Column::Part)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        Ok(MetadataGroupDetails {
            details: group,
            contents,
        })
    }

    async fn queue_pending_reminders(&self) -> Result<()> {
        #[derive(Debug, Serialize, Deserialize)]
        #[serde(rename_all = "PascalCase")]
        struct UserMediaReminder {
            reminder: NaiveDate,
            text: String,
        }
        for (cte, col) in CollectionToEntity::find()
            .find_also_related(Collection)
            .filter(collection::Column::Name.eq(DefaultCollection::Reminders.to_string()))
            .all(&self.0.db)
            .await?
        {
            if let Some(reminder) = cte.information {
                let reminder: UserMediaReminder =
                    serde_json::from_str(&serde_json::to_string(&reminder)?)?;
                let col = col.unwrap();
                let related_users = col.find_related(UserToEntity).all(&self.0.db).await?;
                if get_current_date(&self.0.timezone) == reminder.reminder {
                    for user in related_users {
                        send_notification_for_user(
                            &user.user_id,
                            &self.0,
                            &(
                                reminder.text.clone(),
                                UserNotificationContent::NotificationFromReminderCollection,
                            ),
                        )
                        .await?;
                        remove_entity_from_collection(
                            &user.user_id,
                            ChangeCollectionToEntityInput {
                                creator_user_id: col.user_id.clone(),
                                collection_name: DefaultCollection::Reminders.to_string(),
                                entity_id: cte.entity_id.clone(),
                                entity_lot: cte.entity_lot,
                                ..Default::default()
                            },
                            &self.0,
                        )
                        .await?;
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn create_review_comment(
        &self,
        user_id: String,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        let review = Review::find_by_id(input.review_id)
            .one(&self.0.db)
            .await?
            .unwrap();
        let mut comments = review.comments.clone();
        if input.should_delete.unwrap_or_default() {
            let position = comments
                .iter()
                .position(|r| &r.id == input.comment_id.as_ref().unwrap())
                .unwrap();
            comments.remove(position);
        } else if input.increment_likes.unwrap_or_default() {
            let comment = comments
                .iter_mut()
                .find(|r| &r.id == input.comment_id.as_ref().unwrap())
                .unwrap();
            comment.liked_by.insert(user_id.clone());
        } else if input.decrement_likes.unwrap_or_default() {
            let comment = comments
                .iter_mut()
                .find(|r| &r.id == input.comment_id.as_ref().unwrap())
                .unwrap();
            comment.liked_by.remove(&user_id);
        } else {
            let user = user_by_id(&user_id, &self.0).await?;
            comments.push(ImportOrExportItemReviewComment {
                id: nanoid!(20),
                text: input.text.unwrap(),
                user: IdAndNamedObject {
                    id: user_id,
                    name: user.name,
                },
                liked_by: HashSet::new(),
                created_on: Utc::now(),
            });
        }
        let mut review: review::ActiveModel = review.into();
        review.comments = ActiveValue::Set(comments);
        review.update(&self.0.db).await?;
        Ok(true)
    }

    pub async fn recalculate_calendar_events(&self) -> Result<()> {
        let date_to_calculate_from = get_current_date(&self.0.timezone).pred_opt().unwrap();

        let selected_metadata = Metadata::find()
            .filter(metadata::Column::LastUpdatedOn.gte(date_to_calculate_from))
            .filter(
                metadata::Column::IsPartial
                    .eq(false)
                    .or(metadata::Column::IsPartial.is_null()),
            );

        let mut meta_stream = selected_metadata.clone().stream(&self.0.db).await?;

        while let Some(meta) = meta_stream.try_next().await? {
            ryot_log!(trace, "Processing metadata id = {:#?}", meta.id);
            let calendar_events = meta.find_related(CalendarEvent).all(&self.0.db).await?;
            for cal_event in calendar_events {
                let mut need_to_delete = true;
                if let Some(show) = cal_event.metadata_show_extra_information {
                    if let Some(show_info) = &meta.show_specifics {
                        if let Some((season, ep)) =
                            get_show_episode_by_numbers(show_info, show.season, show.episode)
                        {
                            if !SHOW_SPECIAL_SEASON_NAMES.contains(&season.name.as_str()) {
                                if let Some(publish_date) = ep.publish_date {
                                    if publish_date == cal_event.date {
                                        need_to_delete = false;
                                    }
                                }
                            }
                        }
                    }
                } else if let Some(podcast) = cal_event.metadata_podcast_extra_information {
                    if let Some(podcast_info) = &meta.podcast_specifics {
                        if let Some(ep) =
                            get_podcast_episode_by_number(podcast_info, podcast.episode)
                        {
                            if ep.publish_date == cal_event.date {
                                need_to_delete = false;
                            }
                        }
                    }
                } else if let Some(anime) = cal_event.metadata_anime_extra_information {
                    if let Some(anime_info) = &meta.anime_specifics {
                        if let Some(schedule) = &anime_info.airing_schedule {
                            schedule.iter().for_each(|s| {
                                if Some(s.episode) == anime.episode
                                    && s.airing_at == cal_event.timestamp
                                {
                                    need_to_delete = false;
                                }
                            });
                        }
                    }
                } else if let Some(date) = meta.publish_date {
                    if cal_event.date == date {
                        need_to_delete = false;
                    }
                };

                if need_to_delete {
                    ryot_log!(
                        debug,
                        "Need to delete calendar event id = {:#?} since it is outdated",
                        cal_event.id
                    );
                    CalendarEvent::delete_by_id(cal_event.id)
                        .exec(&self.0.db)
                        .await?;
                }
            }
        }

        ryot_log!(debug, "Finished deleting invalid calendar events");

        let mut metadata_stream = selected_metadata.stream(&self.0.db).await?;

        let mut calendar_events_inserts = vec![];
        let mut metadata_updates = vec![];
        while let Some(meta) = metadata_stream.try_next().await? {
            let calendar_event_template = calendar_event::ActiveModel {
                metadata_id: ActiveValue::Set(Some(meta.id.clone())),
                ..Default::default()
            };
            if let Some(ps) = &meta.podcast_specifics {
                for episode in ps.episodes.iter() {
                    let mut event = calendar_event_template.clone();
                    event.timestamp =
                        ActiveValue::Set(episode.publish_date.and_hms_opt(0, 0, 0).unwrap());
                    event.metadata_podcast_extra_information =
                        ActiveValue::Set(Some(SeenPodcastExtraInformation {
                            episode: episode.number,
                        }));
                    calendar_events_inserts.push(event);
                }
            } else if let Some(ss) = &meta.show_specifics {
                for season in ss.seasons.iter() {
                    if SHOW_SPECIAL_SEASON_NAMES.contains(&season.name.as_str()) {
                        continue;
                    }
                    for episode in season.episodes.iter() {
                        if let Some(date) = episode.publish_date {
                            let mut event = calendar_event_template.clone();
                            event.timestamp = ActiveValue::Set(date.and_hms_opt(0, 0, 0).unwrap());
                            event.metadata_show_extra_information =
                                ActiveValue::Set(Some(SeenShowExtraInformation {
                                    season: season.season_number,
                                    episode: episode.episode_number,
                                }));

                            calendar_events_inserts.push(event);
                        }
                    }
                }
            } else if let Some(ans) = &meta.anime_specifics {
                if let Some(schedule) = &ans.airing_schedule {
                    for episode in schedule.iter() {
                        let mut event = calendar_event_template.clone();
                        event.timestamp = ActiveValue::Set(episode.airing_at);
                        event.metadata_anime_extra_information =
                            ActiveValue::Set(Some(SeenAnimeExtraInformation {
                                episode: Some(episode.episode),
                            }));
                        calendar_events_inserts.push(event);
                    }
                }
            } else if let Some(publish_date) = meta.publish_date {
                let mut event = calendar_event_template.clone();
                event.timestamp = ActiveValue::Set(publish_date.and_hms_opt(0, 0, 0).unwrap());
                calendar_events_inserts.push(event);
            };
            metadata_updates.push(meta.id.clone());
        }
        for cal_insert in calendar_events_inserts {
            ryot_log!(debug, "Inserting calendar event: {:?}", cal_insert);
            cal_insert.insert(&self.0.db).await.ok();
        }
        ryot_log!(debug, "Finished updating calendar events");
        Ok(())
    }

    async fn queue_notifications_for_released_media(&self) -> Result<()> {
        let today = get_current_date(&self.0.timezone);
        let calendar_events = CalendarEvent::find()
            .filter(calendar_event::Column::Date.eq(today))
            .find_also_related(Metadata)
            .all(&self.0.db)
            .await?;
        let notifications = calendar_events
            .into_iter()
            .map(|(cal_event, meta)| {
                let meta = meta.unwrap();
                let url = self.get_entity_details_frontend_url(
                    meta.id.to_string(),
                    EntityLot::Metadata,
                    None,
                );
                let notification = if let Some(show) = cal_event.metadata_show_extra_information {
                    format!(
                        "S{}E{} of {} ({}) has been released today.",
                        show.season, show.episode, meta.title, url
                    )
                } else if let Some(podcast) = cal_event.metadata_podcast_extra_information {
                    format!(
                        "E{} of {} ({}) has been released today.",
                        podcast.episode, meta.title, url
                    )
                } else {
                    format!("{} ({}) has been released today.", meta.title, url)
                };
                (
                    meta.id.to_string(),
                    (notification, UserNotificationContent::MetadataPublished),
                )
            })
            .collect_vec();
        for (metadata_id, notification) in notifications.into_iter() {
            let users_to_notify =
                get_users_monitoring_entity(&metadata_id, EntityLot::Metadata, &self.0.db).await?;
            for user in users_to_notify {
                send_notification_for_user(&user, &self.0, &notification).await?;
            }
        }
        Ok(())
    }

    async fn update_person(
        &self,
        person_id: String,
    ) -> Result<Vec<(String, UserNotificationContent)>> {
        let person = Person::find_by_id(person_id.clone())
            .one(&self.0.db)
            .await?
            .unwrap();
        if !person.is_partial.unwrap_or_default() {
            return Ok(vec![]);
        }
        let mut notifications = vec![];
        let provider = self.get_non_metadata_provider(person.source).await?;
        let provider_person = provider
            .person_details(&person.identifier, &person.source_specifics)
            .await?;
        ryot_log!(debug, "Updating person for {:?}", person_id);
        let images = provider_person
            .images
            .map(|images| {
                images
                    .into_iter()
                    .map(|i| MetadataImage {
                        url: StoredUrl::Url(i),
                    })
                    .collect()
            })
            .filter(|i: &Vec<MetadataImage>| !i.is_empty());
        let mut current_state_changes = person.clone().state_changes.unwrap_or_default();
        let mut to_update_person: person::ActiveModel = person.clone().into();
        to_update_person.images = ActiveValue::Set(images);
        to_update_person.is_partial = ActiveValue::Set(Some(false));
        to_update_person.name = ActiveValue::Set(provider_person.name);
        to_update_person.last_updated_on = ActiveValue::Set(Utc::now());
        to_update_person.place = ActiveValue::Set(provider_person.place);
        to_update_person.gender = ActiveValue::Set(provider_person.gender);
        to_update_person.website = ActiveValue::Set(provider_person.website);
        to_update_person.source_url = ActiveValue::Set(provider_person.source_url);
        to_update_person.birth_date = ActiveValue::Set(provider_person.birth_date);
        to_update_person.death_date = ActiveValue::Set(provider_person.death_date);
        to_update_person.description = ActiveValue::Set(provider_person.description);
        to_update_person.alternate_names = ActiveValue::Set(provider_person.alternate_names);
        for data in provider_person.related_metadata.clone() {
            let title = data.metadata.title.clone();
            let pm = create_partial_metadata(data.metadata, &self.0.db).await?;
            let already_intermediate = MetadataToPerson::find()
                .filter(metadata_to_person::Column::MetadataId.eq(&pm.id))
                .filter(metadata_to_person::Column::PersonId.eq(&person_id))
                .filter(metadata_to_person::Column::Role.eq(&data.role))
                .one(&self.0.db)
                .await?;
            if already_intermediate.is_none() {
                let intermediate = metadata_to_person::ActiveModel {
                    role: ActiveValue::Set(data.role.clone()),
                    metadata_id: ActiveValue::Set(pm.id.clone()),
                    person_id: ActiveValue::Set(person.id.clone()),
                    character: ActiveValue::Set(data.character.clone()),
                    ..Default::default()
                };
                intermediate.insert(&self.0.db).await.unwrap();
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
                .one(&self.0.db)
                .await?
            {
                Some(m) => m.id,
                None => {
                    let m = metadata_group::ActiveModel {
                        is_partial: ActiveValue::Set(Some(true)),
                        lot: ActiveValue::Set(data.metadata_group.lot),
                        source: ActiveValue::Set(data.metadata_group.source),
                        title: ActiveValue::Set(data.metadata_group.title.clone()),
                        identifier: ActiveValue::Set(data.metadata_group.identifier.clone()),
                        images: ActiveValue::Set(
                            data.metadata_group.images.clone().filter(|i| !i.is_empty()),
                        ),
                        ..Default::default()
                    };
                    m.insert(&self.0.db).await?.id
                }
            };
            let already_intermediate = MetadataGroupToPerson::find()
                .filter(metadata_group_to_person::Column::Role.eq(&data.role))
                .filter(metadata_group_to_person::Column::PersonId.eq(&person_id))
                .filter(metadata_group_to_person::Column::MetadataGroupId.eq(&db_dg))
                .one(&self.0.db)
                .await?;
            if already_intermediate.is_none() {
                let intermediate = metadata_group_to_person::ActiveModel {
                    role: ActiveValue::Set(data.role.clone()),
                    metadata_group_id: ActiveValue::Set(db_dg),
                    index: ActiveValue::Set(idx.try_into().unwrap()),
                    person_id: ActiveValue::Set(person_id.to_owned()),
                };
                intermediate.insert(&self.0.db).await?;
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
        to_update_person.update(&self.0.db).await.unwrap();
        Ok(notifications)
    }

    pub async fn update_metadata_and_notify_users(&self, metadata_id: &String) -> Result<()> {
        update_metadata_and_notify_users(metadata_id, &self.0).await
    }

    pub async fn update_person_and_notify_users(&self, person_id: &String) -> Result<()> {
        let notifications = self.update_person(person_id.clone()).await?;
        if !notifications.is_empty() {
            let users_to_notify =
                get_users_and_cte_monitoring_entity(person_id, EntityLot::Person, &self.0.db)
                    .await?;
            for notification in notifications {
                for (user_id, cte_id) in users_to_notify.iter() {
                    send_notification_for_user(user_id, &self.0, &notification)
                        .await
                        .trace_ok();
                    refresh_collection_to_entity_association(cte_id, &self.0.db)
                        .await
                        .trace_ok();
                }
            }
        }
        Ok(())
    }

    pub async fn update_metadata_group(&self, metadata_group_id: &str) -> Result<()> {
        let eg = MetadataGroup::find_by_id(metadata_group_id)
            .one(&self.0.db)
            .await?
            .ok_or(Error::new("Group not found"))?;
        if !eg.is_partial.unwrap_or_default() {
            return Ok(());
        }
        let provider = get_metadata_provider(eg.lot, eg.source, &self.0).await?;
        let (group_details, associated_items) =
            provider.metadata_group_details(&eg.identifier).await?;
        let mut eg: metadata_group::ActiveModel = eg.into();
        eg.is_partial = ActiveValue::Set(None);
        eg.title = ActiveValue::Set(group_details.title);
        eg.parts = ActiveValue::Set(group_details.parts);
        eg.source_url = ActiveValue::Set(group_details.source_url);
        eg.description = ActiveValue::Set(group_details.description);
        eg.images = ActiveValue::Set(group_details.images.filter(|i| !i.is_empty()));
        let eg = eg.update(&self.0.db).await?;
        for (idx, media) in associated_items.into_iter().enumerate() {
            let db_partial_metadata = create_partial_metadata(media, &self.0.db).await?;
            MetadataToMetadataGroup::delete_many()
                .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(&eg.id))
                .filter(metadata_to_metadata_group::Column::MetadataId.eq(&db_partial_metadata.id))
                .exec(&self.0.db)
                .await
                .ok();
            let intermediate = metadata_to_metadata_group::ActiveModel {
                metadata_group_id: ActiveValue::Set(eg.id.clone()),
                metadata_id: ActiveValue::Set(db_partial_metadata.id),
                part: ActiveValue::Set((idx + 1).try_into().unwrap()),
            };
            intermediate.insert(&self.0.db).await.ok();
        }
        Ok(())
    }

    pub async fn trending_metadata(&self) -> Result<TrendingMetadataIdsResponse> {
        let key = ApplicationCacheKey::TrendingMetadataIds;
        let (_id, cached) = 'calc: {
            if let Some(x) = self
                .0
                .cache_service
                .get_value::<TrendingMetadataIdsResponse>(key)
                .await
            {
                break 'calc x;
            }
            let mut trending_ids = HashSet::new();
            let provider_configs = MediaLot::iter()
                .flat_map(|lot| lot.meta().into_iter().map(move |source| (lot, source)));

            for (lot, source) in provider_configs {
                let provider = match get_metadata_provider(lot, source, &self.0).await {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                let media = match provider.get_trending_media().await {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                for item in media {
                    if let Ok(metadata) = create_partial_metadata(item, &self.0.db).await {
                        trending_ids.insert(metadata.id);
                    }
                }
            }

            let vec = trending_ids.into_iter().collect_vec();
            let id = self
                .0
                .cache_service
                .set_key(
                    ApplicationCacheKey::TrendingMetadataIds,
                    ApplicationCacheValue::TrendingMetadataIds(vec.clone()),
                )
                .await?;
            (id, vec)
        };
        let actually_in_db = Metadata::find()
            .select_only()
            .column(metadata::Column::Id)
            .filter(metadata::Column::Id.is_in(cached))
            .order_by_desc(metadata::Column::LastUpdatedOn)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        Ok(actually_in_db)
    }

    pub async fn handle_review_posted_event(&self, event: ReviewPostedEvent) -> Result<()> {
        let monitored_by =
            get_users_monitoring_entity(&event.obj_id, event.entity_lot, &self.0.db).await?;
        let users = get_user_query()
            .select_only()
            .column(user::Column::Id)
            .filter(user::Column::Id.is_in(monitored_by))
            .filter(Expr::cust(format!(
                "(preferences -> 'notifications' -> 'to_send' ? '{}') = true",
                UserNotificationContent::ReviewPosted
            )))
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for user_id in users {
            let url = self.get_entity_details_frontend_url(
                event.obj_id.clone(),
                event.entity_lot,
                Some("reviews"),
            );
            send_notification_for_user(
                &user_id,
                &self.0,
                &(
                    format!(
                        "New review posted for {} ({}, {}) by {}.",
                        event.obj_title, event.entity_lot, url, event.username
                    ),
                    UserNotificationContent::ReviewPosted,
                ),
            )
            .await?;
        }
        Ok(())
    }

    fn get_entity_details_frontend_url(
        &self,
        id: String,
        entity_lot: EntityLot,
        default_tab: Option<&str>,
    ) -> String {
        let mut url = match entity_lot {
            EntityLot::Metadata => format!("media/item/{}", id),
            EntityLot::Collection => format!("collections/{}", id),
            EntityLot::Person => format!("media/people/item/{}", id),
            EntityLot::Workout => format!("fitness/workouts/{}", id),
            EntityLot::Exercise => format!("fitness/exercises/{}", id),
            EntityLot::MetadataGroup => format!("media/groups/item/{}", id),
            EntityLot::WorkoutTemplate => format!("fitness/templates/{}", id),
            EntityLot::Review | EntityLot::UserMeasurement => unreachable!(),
        };
        url = format!("{}/{}", self.0.config.frontend.url, url);
        if let Some(tab) = default_tab {
            url += format!("?defaultTab={}", tab).as_str()
        }
        url
    }

    async fn invalidate_import_jobs(&self) -> Result<()> {
        let all_jobs = ImportReport::find()
            .filter(
                import_report::Column::WasSuccess
                    .eq(false)
                    .or(import_report::Column::WasSuccess.is_null()),
            )
            .filter(import_report::Column::EstimatedFinishTime.lt(Utc::now()))
            .all(&self.0.db)
            .await?;
        for job in all_jobs {
            ryot_log!(debug, "Invalidating job with id = {id}", id = job.id);
            let mut job: import_report::ActiveModel = job.into();
            job.was_success = ActiveValue::Set(Some(false));
            job.save(&self.0.db).await?;
        }
        Ok(())
    }

    async fn remove_old_entities_from_monitoring_collection(&self) -> Result<()> {
        #[derive(Debug, FromQueryResult)]
        struct CustomQueryResponse {
            id: Uuid,
            entity_id: String,
            collection_id: String,
            entity_lot: EntityLot,
            created_on: DateTimeUtc,
            last_updated_on: DateTimeUtc,
        }
        let all_cte = CollectionToEntity::find()
            .select_only()
            .column(collection_to_entity::Column::Id)
            .column(collection_to_entity::Column::EntityId)
            .column_as(collection::Column::Id, "collection_id")
            .column(collection_to_entity::Column::EntityLot)
            .column(collection_to_entity::Column::CreatedOn)
            .column(collection_to_entity::Column::LastUpdatedOn)
            .inner_join(Collection)
            .filter(collection::Column::Name.eq(DefaultCollection::Monitoring.to_string()))
            .into_model::<CustomQueryResponse>()
            .all(&self.0.db)
            .await?;
        let mut to_delete = vec![];
        for cte in all_cte {
            let delta = cte.last_updated_on - cte.created_on;
            if delta.num_days().abs() > self.0.config.media.monitoring_remove_after_days {
                to_delete.push(cte);
            }
        }
        if to_delete.is_empty() {
            return Ok(());
        }
        for item in to_delete.iter() {
            let users_in_this_collection = UserToEntity::find()
                .filter(user_to_entity::Column::CollectionId.eq(&item.collection_id))
                .all(&self.0.db)
                .await?;
            let title =
                get_entity_title_from_id_and_lot(&item.entity_id, item.entity_lot, &self.0).await?;
            for user in users_in_this_collection {
                send_notification_for_user(
                    &user.user_id,
                    &self.0,
                    &(
                        format!("{} has been removed from the monitoring collection", title),
                        UserNotificationContent::EntityRemovedFromMonitoringCollection,
                    ),
                )
                .await?;
            }
        }
        let result = CollectionToEntity::delete_many()
            .filter(collection_to_entity::Column::Id.is_in(to_delete.into_iter().map(|c| c.id)))
            .exec(&self.0.db)
            .await?;
        ryot_log!(debug, "Deleted collection to entity: {:#?}", result);
        Ok(())
    }

    pub async fn remove_useless_data(&self) -> Result<()> {
        let metadata_to_delete = Metadata::find()
            .select_only()
            .column(metadata::Column::Id)
            .left_join(UserToEntity)
            .filter(user_to_entity::Column::MetadataId.is_null())
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for chunk in metadata_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
            ryot_log!(debug, "Deleting {} metadata items", chunk.len());
            Metadata::delete_many()
                .filter(metadata::Column::Id.is_in(chunk))
                .exec(&self.0.db)
                .await
                .trace_ok();
        }
        let people_to_delete = Person::find()
            .select_only()
            .column(person::Column::Id)
            .left_join(UserToEntity)
            .filter(user_to_entity::Column::PersonId.is_null())
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for chunk in people_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
            ryot_log!(debug, "Deleting {} people", chunk.len());
            Person::delete_many()
                .filter(person::Column::Id.is_in(chunk))
                .exec(&self.0.db)
                .await
                .trace_ok();
        }
        let metadata_groups_to_delete = MetadataGroup::find()
            .select_only()
            .column(metadata_group::Column::Id)
            .left_join(UserToEntity)
            .filter(user_to_entity::Column::MetadataGroupId.is_null())
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for chunk in metadata_groups_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
            ryot_log!(debug, "Deleting {} metadata groups", chunk.len());
            MetadataGroup::delete_many()
                .filter(metadata_group::Column::Id.is_in(chunk))
                .exec(&self.0.db)
                .await
                .trace_ok();
        }
        let genre_to_delete = Genre::find()
            .select_only()
            .column(genre::Column::Id)
            .left_join(MetadataToGenre)
            .filter(metadata_to_genre::Column::MetadataId.is_null())
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for chunk in genre_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
            ryot_log!(debug, "Deleting {} genres", chunk.len());
            Genre::delete_many()
                .filter(genre::Column::Id.is_in(chunk))
                .exec(&self.0.db)
                .await
                .trace_ok();
        }
        ryot_log!(debug, "Deleting revoked access tokens");
        AccessLink::delete_many()
            .filter(access_link::Column::IsRevoked.eq(true))
            .exec(&self.0.db)
            .await
            .trace_ok();
        ryot_log!(debug, "Deleting expired application caches");
        ApplicationCache::delete_many()
            .filter(application_cache::Column::ExpiresAt.lt(Utc::now()))
            .exec(&self.0.db)
            .await
            .trace_ok();
        Ok(())
    }

    async fn put_entities_in_partial_state(&self) -> Result<()> {
        async fn update_partial_states<Column1, Column2, Column3, T>(
            ute_filter_column: Column1,
            updater: UpdateMany<T>,
            entity_id_column: Column2,
            entity_update_column: Column3,
            db: &DatabaseConnection,
        ) -> Result<()>
        where
            Column1: ColumnTrait,
            Column2: ColumnTrait,
            Column3: ColumnTrait,
            T: EntityTrait,
        {
            let ids_to_update = UserToEntity::find()
                .select_only()
                .column(ute_filter_column)
                .filter(ute_filter_column.is_not_null())
                .into_tuple::<String>()
                .all(db)
                .await?;
            for chunk in ids_to_update.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
                ryot_log!(debug, "Entities to update: {:?}", chunk);
                updater
                    .clone()
                    .col_expr(entity_update_column, Expr::value(true))
                    .filter(entity_id_column.is_in(chunk))
                    .exec(db)
                    .await?;
            }
            Ok(())
        }
        update_partial_states(
            user_to_entity::Column::MetadataId,
            Metadata::update_many(),
            metadata::Column::Id,
            metadata::Column::IsPartial,
            &self.0.db,
        )
        .await?;
        update_partial_states(
            user_to_entity::Column::MetadataGroupId,
            MetadataGroup::update_many(),
            metadata_group::Column::Id,
            metadata_group::Column::IsPartial,
            &self.0.db,
        )
        .await?;
        update_partial_states(
            user_to_entity::Column::PersonId,
            Person::update_many(),
            person::Column::Id,
            person::Column::IsPartial,
            &self.0.db,
        )
        .await?;
        Ok(())
    }

    pub async fn sync_integrations_data_to_owned_collection(&self) -> Result<()> {
        self.0
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::SyncIntegrationsData))
            .await?;
        Ok(())
    }

    async fn queue_notifications_for_outdated_seen_entries(&self) -> Result<()> {
        if !self.0.is_server_key_validated().await? {
            return Ok(());
        }
        for state in [SeenState::InProgress, SeenState::OnAHold] {
            let days = match state {
                SeenState::InProgress => 7,
                SeenState::OnAHold => 14,
                _ => unreachable!(),
            };
            let threshold = Utc::now() - Duration::days(days);
            let seen_items = Seen::find()
                .filter(seen::Column::State.eq(state))
                .filter(seen::Column::LastUpdatedOn.lte(threshold))
                .all(&self.0.db)
                .await?;
            for seen_item in seen_items {
                let Some(metadata) = seen_item.find_related(Metadata).one(&self.0.db).await? else {
                    continue;
                };
                let state = seen_item
                    .state
                    .to_string()
                    .to_case(Case::Title)
                    .to_case(Case::Lower);
                send_notification_for_user(
                    &seen_item.user_id,
                    &self.0,
                    &(
                        format!(
                            "{} ({}) has been kept {} for more than {} days. Last updated on: {}.",
                            metadata.title,
                            metadata.lot,
                            state,
                            days,
                            seen_item.last_updated_on.date_naive()
                        ),
                        UserNotificationContent::OutdatedSeenEntries,
                    ),
                )
                .await?;
            }
        }
        Ok(())
    }

    pub async fn update_user_last_activity_performed(
        &self,
        user_id: String,
        timestamp: DateTimeUtc,
    ) -> Result<()> {
        User::update_many()
            .filter(user::Column::Id.eq(user_id))
            .col_expr(user::Column::LastActivityOn, Expr::value(timestamp))
            .exec(&self.0.db)
            .await?;
        Ok(())
    }

    pub async fn expire_cache_keys(&self) -> Result<()> {
        let user_ids = get_user_query()
            .select_only()
            .column(user::Column::Id)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for user_id in user_ids {
            self.0
                .cache_service
                .expire_key(ExpireCacheKeyInput::BySanitizedKey {
                    user_id: Some(user_id),
                    key: ApplicationCacheKeyDiscriminants::UserMetadataRecommendationsSet,
                })
                .await?;
        }
        Ok(())
    }

    pub async fn perform_background_jobs(&self) -> Result<()> {
        ryot_log!(debug, "Starting background jobs...");

        ryot_log!(trace, "Invalidating invalid media import jobs");
        self.invalidate_import_jobs().await.trace_ok();
        ryot_log!(trace, "Checking for updates for monitored media");
        self.update_monitored_metadata_and_queue_notifications()
            .await
            .trace_ok();
        ryot_log!(trace, "Checking for updates for monitored people");
        self.update_monitored_people_and_queue_notifications()
            .await
            .trace_ok();
        ryot_log!(trace, "Removing stale entities from Monitoring collection");
        self.remove_old_entities_from_monitoring_collection()
            .await
            .trace_ok();
        ryot_log!(trace, "Checking and queuing any pending reminders");
        self.queue_pending_reminders().await.trace_ok();
        ryot_log!(trace, "Recalculating calendar events");
        self.recalculate_calendar_events().await.trace_ok();
        ryot_log!(trace, "Queuing notifications for released media");
        self.queue_notifications_for_released_media()
            .await
            .trace_ok();
        ryot_log!(trace, "Cleaning up user and metadata association");
        self.cleanup_user_and_metadata_association()
            .await
            .trace_ok();
        ryot_log!(trace, "Removing old user summaries and regenerating them");
        self.regenerate_user_summaries().await.trace_ok();
        ryot_log!(trace, "Syncing integrations data to owned collection");
        self.sync_integrations_data_to_owned_collection()
            .await
            .trace_ok();
        ryot_log!(trace, "Queueing notifications for outdated seen entries");
        self.queue_notifications_for_outdated_seen_entries()
            .await
            .trace_ok();
        ryot_log!(trace, "Removing useless data");
        self.remove_useless_data().await.trace_ok();
        ryot_log!(trace, "Putting entities in partial state");
        self.put_entities_in_partial_state().await.trace_ok();
        // DEV: Invalid access tokens are revoked before being deleted, so we call this
        // function after removing useless data.
        ryot_log!(trace, "Revoking invalid access tokens");
        self.revoke_invalid_access_tokens().await.trace_ok();
        ryot_log!(trace, "Expiring cache keys");
        self.expire_cache_keys().await.trace_ok();

        ryot_log!(debug, "Completed background jobs...");
        Ok(())
    }

    #[cfg(debug_assertions)]
    pub async fn development_mutation(&self) -> Result<bool> {
        Ok(true)
    }
}
