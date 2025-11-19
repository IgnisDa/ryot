use std::sync::Arc;

use anyhow::{Result, bail};
use background_models::{ApplicationJob, HpApplicationJob};
use common_models::{
    BackgroundJob, MetadataGroupSearchInput, PeopleSearchInput, SearchInput, StringIdObject,
};
use database_models::{prelude::User, user};
use database_utils::admin_account_guard;
use dependent_core_utils::core_details;
use dependent_entity_list_utils::{
    user_genres_list, user_metadata_groups_list, user_metadata_list, user_people_list,
};
use dependent_jobs_utils::{
    deploy_background_job, deploy_update_metadata_group_job, deploy_update_metadata_job,
    deploy_update_person_job,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, CoreDetails, EmptyCacheValue,
    GenreDetails, GraphqlPersonDetails, MetadataGroupDetails, MetadataGroupSearchResponse,
    MetadataSearchInput, MetadataSearchResponse, PeopleSearchResponse, SearchResults,
    TrendingMetadataIdsResponse, UserMetadataDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse, UserPersonDetails,
};
use dependent_notification_utils::{
    update_metadata_and_notify_users, update_metadata_group_and_notify_users,
    update_person_and_notify_users,
};
use dependent_review_utils::post_review;
use enum_models::EntityLot;
use media_models::{
    CreateOrUpdateReviewInput, CreateReviewCommentInput, GenreDetailsInput, GraphqlCalendarEvent,
    GraphqlMetadataDetails, GroupedCalendarEvent, MarkEntityAsPartialInput, MetadataLookupResponse,
    MetadataProgressUpdateInput, ReviewPostedEvent, UpdateSeenItemInput, UserCalendarEventInput,
    UserUpcomingCalendarEventInput,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc, prelude::Expr};
use supporting_service::SupportingService;
use uuid::Uuid;

pub struct MiscellaneousService(pub Arc<SupportingService>);

impl MiscellaneousService {
    pub async fn core_details(&self) -> Result<CoreDetails> {
        core_details(&self.0).await
    }

    pub async fn metadata_details(
        &self,
        metadata_id: &String,
    ) -> Result<CachedResponse<GraphqlMetadataDetails>> {
        dependent_details_utils::metadata_details(&self.0, metadata_id).await
    }

    pub async fn user_metadata_details(
        &self,
        user_id: String,
        metadata_id: String,
    ) -> Result<CachedResponse<UserMetadataDetails>> {
        miscellaneous_entity_user_details_service::user_metadata_details(
            &self.0,
            user_id,
            metadata_id,
        )
        .await
    }

    pub async fn user_person_details(
        &self,
        user_id: String,
        person_id: String,
    ) -> Result<CachedResponse<UserPersonDetails>> {
        miscellaneous_entity_user_details_service::user_person_details(&self.0, user_id, person_id)
            .await
    }

    pub async fn user_metadata_group_details(
        &self,
        user_id: String,
        metadata_group_id: String,
    ) -> Result<CachedResponse<UserMetadataGroupDetails>> {
        miscellaneous_entity_user_details_service::user_metadata_group_details(
            &self.0,
            user_id,
            metadata_group_id,
        )
        .await
    }

    pub async fn is_entity_recently_consumed(
        &self,
        user_id: String,
        entity_id: String,
        entity_lot: EntityLot,
    ) -> Result<bool> {
        miscellaneous_entity_user_details_service::get_entity_recently_consumed(
            &user_id, &entity_id, entity_lot, &self.0,
        )
        .await
    }

    pub async fn user_calendar_events(
        &self,
        user_id: String,
        input: UserCalendarEventInput,
    ) -> Result<Vec<GroupedCalendarEvent>> {
        miscellaneous_calendar_service::user_calendar_events(user_id, input, &self.0).await
    }

    pub async fn user_upcoming_calendar_events(
        &self,
        user_id: String,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        miscellaneous_calendar_service::user_upcoming_calendar_events(&self.0, user_id, input).await
    }

    pub async fn user_metadata_list(
        &self,
        user_id: String,
        input: UserMetadataListInput,
    ) -> Result<CachedResponse<UserMetadataListResponse>> {
        user_metadata_list(&user_id, input, &self.0).await
    }

    pub async fn deploy_bulk_metadata_progress_update(
        &self,
        user_id: String,
        input: Vec<MetadataProgressUpdateInput>,
    ) -> Result<bool> {
        self.0
            .perform_application_job(ApplicationJob::Hp(
                HpApplicationJob::BulkMetadataProgressUpdate(user_id, input),
            ))
            .await?;
        Ok(true)
    }

    pub async fn bulk_metadata_progress_update(
        &self,
        user_id: String,
        input: Vec<MetadataProgressUpdateInput>,
    ) -> Result<()> {
        miscellaneous_progress_service::bulk_metadata_progress_update(&self.0, &user_id, input)
            .await
    }

    pub async fn expire_cache_key(&self, cache_id: Uuid) -> Result<bool> {
        miscellaneous_general_service::expire_cache_key(&self.0, cache_id).await
    }

    pub async fn deploy_background_job(
        &self,
        user_id: &String,
        job_name: BackgroundJob,
    ) -> Result<bool> {
        deploy_background_job(user_id, job_name, &self.0).await
    }

    pub async fn generate_log_download_token(&self, user_id: &String) -> Result<String> {
        admin_account_guard(user_id, &self.0).await?;

        let token = Uuid::new_v4().to_string();
        let key = ApplicationCacheKey::LogDownloadToken(token.clone());
        let value = ApplicationCacheValue::LogDownloadToken(EmptyCacheValue::default());

        cache_service::set_key(&self.0, key, value).await?;

        Ok(token)
    }

    pub async fn mark_entity_as_partial(&self, input: MarkEntityAsPartialInput) -> Result<bool> {
        miscellaneous_general_service::mark_entity_as_partial(&self.0, input).await
    }

    pub async fn update_seen_item(
        &self,
        user_id: String,
        input: UpdateSeenItemInput,
    ) -> Result<bool> {
        miscellaneous_progress_service::update_seen_item(&self.0, &user_id, input).await
    }

    pub async fn deploy_update_media_entity_job(
        &self,
        entity_id: String,
        entity_lot: EntityLot,
    ) -> Result<bool> {
        match entity_lot {
            EntityLot::Metadata => {
                deploy_update_metadata_job(&entity_id, &self.0).await?;
            }
            EntityLot::Person => {
                deploy_update_person_job(&entity_id, &self.0).await?;
            }
            EntityLot::MetadataGroup => {
                deploy_update_metadata_group_job(&entity_id, &self.0).await?;
            }
            _ => {
                bail!(format!(
                    "Entity type {:?} is not supported for update jobs",
                    entity_lot
                ));
            }
        }
        Ok(true)
    }

    pub async fn merge_metadata(
        &self,
        user_id: String,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        miscellaneous_metadata_operations_service::merge_metadata(
            &self.0, user_id, merge_from, merge_into,
        )
        .await
    }

    pub async fn disassociate_metadata(
        &self,
        user_id: String,
        metadata_id: String,
    ) -> Result<bool> {
        miscellaneous_metadata_operations_service::disassociate_metadata(
            &self.0,
            user_id,
            metadata_id,
        )
        .await
    }

    pub async fn metadata_search(
        &self,
        user_id: &String,
        input: MetadataSearchInput,
    ) -> Result<CachedResponse<MetadataSearchResponse>> {
        miscellaneous_search_service::metadata_search(&self.0, user_id, input).await
    }

    pub async fn people_search(
        &self,
        user_id: &String,
        input: PeopleSearchInput,
    ) -> Result<CachedResponse<PeopleSearchResponse>> {
        miscellaneous_search_service::people_search(&self.0, user_id, input).await
    }

    pub async fn metadata_group_search(
        &self,
        user_id: &String,
        input: MetadataGroupSearchInput,
    ) -> Result<CachedResponse<MetadataGroupSearchResponse>> {
        miscellaneous_search_service::metadata_group_search(&self.0, user_id, input).await
    }

    pub async fn create_or_update_review(
        &self,
        user_id: &String,
        input: CreateOrUpdateReviewInput,
    ) -> Result<StringIdObject> {
        post_review(user_id, input, &self.0).await
    }

    pub async fn delete_review(&self, user_id: String, review_id: String) -> Result<bool> {
        miscellaneous_review_service::delete_review(&self.0, user_id, review_id).await
    }

    pub async fn delete_seen_item(
        &self,
        user_id: &String,
        seen_id: String,
    ) -> Result<StringIdObject> {
        miscellaneous_progress_service::delete_seen_item(&self.0, user_id, seen_id).await
    }

    pub async fn user_genres_list(
        &self,
        user_id: String,
        input: Option<SearchInput>,
    ) -> Result<SearchResults<String>> {
        user_genres_list(&self.0, user_id, input).await
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

    pub async fn person_details(
        &self,
        person_id: String,
    ) -> Result<CachedResponse<GraphqlPersonDetails>> {
        dependent_details_utils::person_details(&person_id, &self.0).await
    }

    pub async fn genre_details(
        &self,
        user_id: String,
        input: GenreDetailsInput,
    ) -> Result<CachedResponse<GenreDetails>> {
        dependent_details_utils::genre_details(&self.0, user_id, input).await
    }

    pub async fn metadata_group_details(
        &self,
        metadata_group_id: String,
    ) -> Result<CachedResponse<MetadataGroupDetails>> {
        dependent_details_utils::metadata_group_details(&self.0, &metadata_group_id).await
    }

    pub async fn create_review_comment(
        &self,
        user_id: String,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        miscellaneous_review_service::create_review_comment(&self.0, user_id, input).await
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
        metadata_group_id: &String,
    ) -> Result<()> {
        update_metadata_group_and_notify_users(metadata_group_id, &self.0).await?;
        Ok(())
    }

    pub async fn trending_metadata(&self) -> Result<TrendingMetadataIdsResponse> {
        miscellaneous_trending_and_events_service::trending_metadata(&self.0).await
    }

    pub async fn handle_review_posted_event(&self, event: ReviewPostedEvent) -> Result<()> {
        miscellaneous_trending_and_events_service::handle_review_posted_event(&self.0, event).await
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

    pub async fn handle_metadata_eligible_for_smart_collection_moving(
        &self,
        metadata_id: String,
    ) -> Result<()> {
        miscellaneous_metadata_operations_service::handle_metadata_eligible_for_smart_collection_moving(&self.0, metadata_id).await
    }

    pub async fn invalidate_import_jobs(&self) -> Result<()> {
        miscellaneous_background_service::invalidate_import_jobs(&self.0).await
    }

    pub async fn cleanup_user_and_metadata_association(&self) -> Result<()> {
        miscellaneous_background_service::cleanup_user_and_metadata_association(&self.0).await
    }

    pub async fn perform_background_jobs(&self) -> Result<()> {
        miscellaneous_background_service::perform_background_jobs(&self.0).await
    }

    pub async fn metadata_lookup(
        &self,
        title: String,
    ) -> Result<CachedResponse<MetadataLookupResponse>> {
        miscellaneous_lookup_service::metadata_lookup(&self.0, title).await
    }

    #[cfg(debug_assertions)]
    pub async fn development_mutation(&self) -> Result<bool> {
        Ok(true)
    }
}
