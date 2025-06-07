use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use async_graphql::Result;
use background_models::{ApplicationJob, HpApplicationJob, MpApplicationJob};
use chrono::{NaiveDate, Utc};
use common_models::{
    BackgroundJob, MetadataGroupSearchInput, MetadataSearchInput, PeopleSearchInput, SearchInput,
    StringIdObject,
};
use common_utils::{BULK_APPLICATION_UPDATE_CHUNK_SIZE, ryot_log};
use database_models::{
    access_link, metadata, monitored_entity,
    prelude::{AccessLink, MetadataGroup, MonitoredEntity, Person, User},
    seen, user,
};
use database_utils::{get_user_query, revoke_access_link};
use dependent_models::{
    CachedResponse, CoreDetails, GenreDetails, GraphqlPersonDetails, MetadataGroupDetails,
    MetadataGroupSearchResponse, MetadataSearchResponse, PeopleSearchResponse, SearchResults,
    TrendingMetadataIdsResponse, UserMetadataDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse, UserPersonDetails,
};
use dependent_utils::{
    calculate_user_activities_and_summary, deploy_background_job, deploy_update_metadata_group_job,
    deploy_update_metadata_job, deploy_update_person_job, handle_after_metadata_seen_tasks,
    post_review, update_metadata_and_notify_users, update_metadata_group_and_notify_users,
    update_person_and_notify_users, user_metadata_groups_list, user_metadata_list,
    user_people_list,
};
use enum_models::{EntityLot, MediaLot, MediaSource};
use futures::future::join_all;
use itertools::Itertools;
use media_models::{
    CreateCustomMetadataInput, CreateOrUpdateReviewInput, CreateReviewCommentInput,
    GenreDetailsInput, GraphqlCalendarEvent, GraphqlMetadataDetails, GroupedCalendarEvent,
    MarkEntityAsPartialInput, MetadataFreeCreator, ProgressUpdateInput, ReviewPostedEvent,
    UpdateCustomMetadataInput, UpdateSeenItemInput, UserCalendarEventInput,
    UserUpcomingCalendarEventInput,
};

use sea_orm::{
    ActiveValue, ColumnTrait, DatabaseBackend, EntityTrait, QueryFilter, QuerySelect, Statement,
    prelude::DateTimeUtc,
};
use sea_query::{Condition, Expr, PostgresQueryBuilder, SelectStatement};
use supporting_service::SupportingService;
use uuid::Uuid;

mod background_operations;
mod calendar_operations;
mod core_operations;
mod custom_metadata;
mod entity_details;
mod list_operations;
mod metadata_operations;
mod progress_operations;
mod review_operations;
mod search_operations;
mod trending_and_events;
mod user_details;
mod user_management;

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
        calendar_operations::get_calendar_events(
            self,
            &self.0,
            user_id,
            only_monitored,
            start_date,
            end_date,
            media_limit,
            deduplicate,
        )
        .await
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
        progress_operations::bulk_progress_update(&self.0, user_id, input).await
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
        user_id: &str,
        input: MarkEntityAsPartialInput,
    ) -> Result<bool> {
        core_operations::mark_entity_as_partial(&self.0, user_id, input).await
    }

    async fn cleanup_user_and_metadata_association(&self) -> Result<()> {
        user_management::cleanup_user_and_metadata_association(&self.0).await
    }

    pub async fn update_seen_item(
        &self,
        user_id: String,
        input: UpdateSeenItemInput,
    ) -> Result<bool> {
        progress_operations::update_seen_item(&self.0, user_id, input).await
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
        progress_operations::delete_seen_item(&self.0, user_id, seen_id).await
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
        list_operations::genres_list(&self.0, user_id, input).await
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
        calendar_operations::queue_pending_reminders(&self.0).await
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
