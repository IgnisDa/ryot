use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use application_utils::{
    get_current_date, get_podcast_episode_by_number, get_show_episode_by_numbers,
};
use async_graphql::{Error, Result};
use background_models::{ApplicationJob, HpApplicationJob, MpApplicationJob};
use chrono::{NaiveDate, Utc};
use common_models::{
    BackgroundJob, ChangeCollectionToEntityInput, DefaultCollection, EntityAssets,
    MetadataGroupSearchInput, MetadataSearchInput, PeopleSearchInput, ProgressUpdateCacheInput,
    SearchDetails, SearchInput, StringIdObject, UserLevelCacheKey,
};
use common_utils::{BULK_APPLICATION_UPDATE_CHUNK_SIZE, ryot_log};
use database_models::{
    access_link, calendar_event, collection, genre, metadata, metadata_group, monitored_entity,
    person,
    prelude::{
        AccessLink, CalendarEvent, Collection, CollectionToEntity, Genre, Metadata, MetadataGroup,
        MonitoredEntity, Person, Review, Seen, User, UserToEntity,
    },
    review, seen, user, user_to_entity,
};
use database_utils::{
    entity_in_collections, get_user_query, ilike_sql, revoke_access_link, user_by_id,
};
use dependent_models::{
    ApplicationCacheKey, CachedResponse, CoreDetails, ExpireCacheKeyInput, GenreDetails,
    GraphqlPersonDetails, MetadataGroupDetails, MetadataGroupSearchResponse,
    MetadataSearchResponse, PeopleSearchResponse, SearchResults, TrendingMetadataIdsResponse,
    UserMetadataDetails, UserMetadataGroupDetails, UserMetadataGroupsListInput,
    UserMetadataGroupsListResponse, UserMetadataListInput, UserMetadataListResponse,
    UserPeopleListInput, UserPeopleListResponse, UserPersonDetails,
};
use dependent_utils::{
    associate_user_with_entity, calculate_user_activities_and_summary,
    deploy_after_handle_media_seen_tasks, deploy_background_job, deploy_update_metadata_group_job,
    deploy_update_metadata_job, deploy_update_person_job, expire_user_metadata_list_cache,
    handle_after_metadata_seen_tasks, is_metadata_finished_by_user, post_review, progress_update,
    remove_entity_from_collection, send_notification_for_user, update_metadata_and_notify_users,
    update_metadata_group_and_notify_users, update_person_and_notify_users,
    user_metadata_groups_list, user_metadata_list, user_people_list,
};
use enum_models::{EntityLot, MediaLot, MediaSource, UserNotificationContent, UserToMediaReason};
use futures::future::join_all;
use itertools::Itertools;
use media_models::{
    CreateCustomMetadataInput, CreateOrUpdateReviewInput, CreateReviewCommentInput,
    GenreDetailsInput, GenreListItem, GraphqlCalendarEvent, GraphqlMetadataDetails,
    GroupedCalendarEvent, MarkEntityAsPartialInput, MetadataFreeCreator, PodcastSpecifics,
    ProgressUpdateInput, ReviewPostedEvent, SeenAnimeExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation, ShowSpecifics, UpdateCustomMetadataInput, UpdateSeenItemInput,
    UserCalendarEventInput, UserUpcomingCalendarEventInput,
};
use migrations::{
    AliasedCalendarEvent, AliasedMetadata, AliasedMetadataToGenre, AliasedUserToEntity,
};

use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseBackend, EntityTrait, FromQueryResult,
    ItemsAndPagesNumber, JoinType, ModelTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, RelationTrait, Statement, prelude::DateTimeUtc,
};
use sea_query::{
    Alias, Asterisk, Condition, Expr, Func, PgFunc, PostgresQueryBuilder, Query, SelectStatement,
    extension::postgres::PgExpr,
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::TraceOk;
use uuid::Uuid;

mod background_operations;
mod calendar_operations;
mod core_operations;
mod custom_metadata;
mod entity_details;
mod metadata_operations;
mod review_operations;
mod search_operations;
mod trending_and_events;
mod user_details;

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

    pub async fn deploy_update_metadata_job(&self, metadata_id: &String) -> Result<bool> {
        deploy_update_metadata_job(metadata_id, &self.0).await
    }

    pub async fn metadata_details(&self, metadata_id: &String) -> Result<GraphqlMetadataDetails> {
        entity_details::metadata_details(&self.0, metadata_id).await
    }

    pub async fn user_metadata_details(
        &self,
        user_id: String,
        metadata_id: String,
    ) -> Result<UserMetadataDetails> {
        user_details::user_metadata_details(self, &self.0, user_id, metadata_id).await
    }

    pub async fn user_person_details(
        &self,
        user_id: String,
        person_id: String,
    ) -> Result<UserPersonDetails> {
        user_details::user_person_details(&self.0, user_id, person_id).await
    }

    pub async fn user_metadata_group_details(
        &self,
        user_id: String,
        metadata_group_id: String,
    ) -> Result<UserMetadataGroupDetails> {
        user_details::user_metadata_group_details(&self.0, user_id, metadata_group_id).await
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
            m_assets: EntityAssets,
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
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::Assets)),
                        "m_assets",
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
                image = evt.m_assets.remote_images.first().cloned();
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
        calendar_operations::user_calendar_events(self, user_id, input).await
    }

    pub async fn user_upcoming_calendar_events(
        &self,
        user_id: String,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        calendar_operations::user_upcoming_calendar_events(self, &self.0, user_id, input).await
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
        core_operations::expire_cache_key(&self.0, cache_id).await
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
            expire_user_metadata_list_cache(&user_id, &self.0).await?;
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
        metadata_operations::merge_metadata(&self.0, user_id, merge_from, merge_into).await
    }

    pub async fn disassociate_metadata(
        &self,
        user_id: String,
        metadata_id: String,
    ) -> Result<bool> {
        metadata_operations::disassociate_metadata(&self.0, user_id, metadata_id).await
    }

    pub async fn metadata_search(
        &self,
        user_id: &String,
        input: MetadataSearchInput,
    ) -> Result<MetadataSearchResponse> {
        search_operations::metadata_search(&self.0, user_id, input).await
    }

    pub async fn people_search(
        &self,
        user_id: &String,
        input: PeopleSearchInput,
    ) -> Result<PeopleSearchResponse> {
        search_operations::people_search(&self.0, user_id, input).await
    }

    pub async fn metadata_group_search(
        &self,
        user_id: &String,
        input: MetadataGroupSearchInput,
    ) -> Result<MetadataGroupSearchResponse> {
        search_operations::metadata_group_search(&self.0, user_id, input).await
    }

    pub async fn create_or_update_review(
        &self,
        user_id: &String,
        input: CreateOrUpdateReviewInput,
    ) -> Result<StringIdObject> {
        post_review(user_id, input, &self.0).await
    }

    pub async fn delete_review(&self, user_id: String, review_id: String) -> Result<bool> {
        review_operations::delete_review(&self.0, user_id, review_id).await
    }

    pub async fn handle_after_media_seen_tasks(&self, seen: Box<seen::Model>) -> Result<()> {
        handle_after_metadata_seen_tasks(*seen, &self.0).await
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
        deploy_after_handle_media_seen_tasks(cloned_seen, &self.0).await?;
        associate_user_with_entity(user_id, &metadata_id, EntityLot::Metadata, &self.0).await?;
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
            assets: ActiveValue::Set(input.assets),
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
        custom_metadata::create_custom_metadata(
            &self.0,
            user_id,
            input,
            |input, identifier, user_id| {
                self.get_data_for_custom_metadata(input, identifier, user_id)
            },
        )
        .await
    }

    pub async fn update_custom_metadata(
        &self,
        user_id: &str,
        input: UpdateCustomMetadataInput,
    ) -> Result<bool> {
        custom_metadata::update_custom_metadata(
            &self.0,
            user_id,
            input,
            |input, identifier, user_id| {
                self.get_data_for_custom_metadata(input, identifier, user_id)
            },
        )
        .await
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
        entity_details::person_details(person_id, &self.0).await
    }

    pub async fn genre_details(
        &self,
        user_id: String,
        input: GenreDetailsInput,
    ) -> Result<GenreDetails> {
        entity_details::genre_details(&self.0, user_id, input).await
    }

    pub async fn metadata_group_details(
        &self,
        metadata_group_id: String,
    ) -> Result<MetadataGroupDetails> {
        entity_details::metadata_group_details(&self.0, metadata_group_id).await
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
        review_operations::create_review_comment(&self.0, user_id, input).await
    }

    pub async fn recalculate_calendar_events(&self) -> Result<()> {
        calendar_operations::recalculate_calendar_events(&self.0).await
    }

    async fn queue_notifications_for_released_media(&self) -> Result<()> {
        calendar_operations::queue_notifications_for_released_media(&self.0, |id, lot, tab| {
            self.get_entity_details_frontend_url(id, lot, tab)
        })
        .await
    }

    pub async fn update_metadata_and_notify_users(&self, metadata_id: &String) -> Result<()> {
        update_metadata_and_notify_users(metadata_id, &self.0).await?;
        Ok(())
    }

    pub async fn update_person_and_notify_users(&self, person_id: &String) -> Result<()> {
        update_person_and_notify_users(person_id, &self.0).await?;
        Ok(())
    }

    pub async fn update_metadata_group_and_notify_users(
        &self,
        metadata_group_id: String,
    ) -> Result<()> {
        update_metadata_group_and_notify_users(&metadata_group_id, &self.0).await?;
        Ok(())
    }

    pub async fn trending_metadata(&self) -> Result<TrendingMetadataIdsResponse> {
        trending_and_events::trending_metadata(&self.0).await
    }

    pub async fn handle_review_posted_event(&self, event: ReviewPostedEvent) -> Result<()> {
        trending_and_events::handle_review_posted_event(self, &self.0, event).await
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

    pub async fn sync_integrations_data_to_owned_collection(&self) -> Result<()> {
        self.0
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::SyncIntegrationsData))
            .await?;
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

    pub async fn perform_background_jobs(&self) -> Result<()> {
        background_operations::perform_background_jobs(self).await
    }

    #[cfg(debug_assertions)]
    pub async fn development_mutation(&self) -> Result<bool> {
        Ok(true)
    }
}
