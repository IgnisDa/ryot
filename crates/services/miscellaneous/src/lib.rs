use std::sync::Arc;

use async_graphql::Result;
use background_models::{ApplicationJob, HpApplicationJob};
use common_models::{
    BackgroundJob, MetadataGroupSearchInput, MetadataSearchInput, PeopleSearchInput, SearchInput,
    StringIdObject,
};
use database_models::{
    metadata,
    prelude::{MetadataGroup, Person, User},
    user,
};
use dependent_models::{
    CachedResponse, CoreDetails, GenreDetails, GraphqlPersonDetails, MetadataGroupDetails,
    MetadataGroupSearchResponse, MetadataSearchResponse, PeopleSearchResponse, SearchResults,
    TrendingMetadataIdsResponse, UserMetadataDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse, UserPersonDetails,
};
use dependent_utils::{
    deploy_background_job, deploy_update_metadata_group_job, deploy_update_metadata_job,
    deploy_update_person_job, post_review, update_metadata_and_notify_users,
    update_metadata_group_and_notify_users, update_person_and_notify_users,
    user_metadata_groups_list, user_metadata_list, user_people_list,
};
use media_models::{
    CreateCustomMetadataInput, CreateOrUpdateReviewInput, CreateReviewCommentInput,
    GenreDetailsInput, GraphqlCalendarEvent, GraphqlMetadataDetails, GroupedCalendarEvent,
    MarkEntityAsPartialInput, ProgressUpdateInput, ReviewPostedEvent, UpdateCustomMetadataInput,
    UpdateSeenItemInput, UserCalendarEventInput, UserUpcomingCalendarEventInput,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc};
use sea_query::Expr;
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
        user_details::user_metadata_details(&self.0, user_id, metadata_id).await
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

    pub async fn user_calendar_events(
        &self,
        user_id: String,
        input: UserCalendarEventInput,
    ) -> Result<Vec<GroupedCalendarEvent>> {
        calendar_operations::user_calendar_events(user_id, input, &self.0).await
    }

    pub async fn user_upcoming_calendar_events(
        &self,
        user_id: String,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        calendar_operations::user_upcoming_calendar_events(&self.0, user_id, input).await
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
        progress_operations::bulk_progress_update(&self.0, &user_id, input).await
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

    pub async fn mark_entity_as_partial(&self, input: MarkEntityAsPartialInput) -> Result<bool> {
        core_operations::mark_entity_as_partial(&self.0, input).await
    }

    pub async fn update_seen_item(
        &self,
        user_id: String,
        input: UpdateSeenItemInput,
    ) -> Result<bool> {
        progress_operations::update_seen_item(&self.0, &user_id, input).await
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

    pub async fn delete_seen_item(
        &self,
        user_id: &String,
        seen_id: String,
    ) -> Result<StringIdObject> {
        progress_operations::delete_seen_item(&self.0, user_id, seen_id).await
    }

    pub async fn create_custom_metadata(
        &self,
        user_id: String,
        input: CreateCustomMetadataInput,
    ) -> Result<metadata::Model> {
        custom_metadata::create_custom_metadata(&self.0, user_id, input).await
    }

    pub async fn update_custom_metadata(
        &self,
        user_id: &str,
        input: UpdateCustomMetadataInput,
    ) -> Result<bool> {
        custom_metadata::update_custom_metadata(&self.0, user_id, input).await
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
        trending_and_events::trending_metadata(&self.0).await
    }

    pub async fn handle_review_posted_event(&self, event: ReviewPostedEvent) -> Result<()> {
        trending_and_events::handle_review_posted_event(&self.0, event).await
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
        background_operations::perform_background_jobs(&self.0).await
    }

    #[cfg(debug_assertions)]
    pub async fn development_mutation(&self) -> Result<bool> {
        Ok(true)
    }
}
