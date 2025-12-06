use std::sync::Arc;

use anyhow::{Result, bail};
use background_models::{ApplicationJob, HpApplicationJob};
use common_models::{
    BackgroundJob, EntityWithLot, MetadataGroupSearchInput, PeopleSearchInput, SearchInput,
};
use database_models::{prelude::User, user};
use database_utils::admin_account_guard;
use dependent_core_utils::core_details as dependent_core_details;
use dependent_entity_list_utils::{
    user_genres_list, user_metadata_groups_list, user_metadata_list,
};
use dependent_jobs_utils::deploy_background_job as dependent_deploy_background_job;
pub use dependent_jobs_utils::deploy_update_media_entity_job;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, CoreDetails, EmptyCacheValue,
    GenreDetails, GraphqlPersonDetails, MetadataGroupDetails, MetadataGroupSearchResponse,
    MetadataSearchInput, MetadataSearchResponse, PeopleSearchResponse, SearchResults,
    TrendingMetadataIdsResponse, UserMetadataDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPersonDetails,
};
use dependent_notification_utils::{
    update_metadata_and_notify_users, update_metadata_group_and_notify_users,
    update_person_and_notify_users,
};
use enum_models::EntityLot;
use media_models::{
    CreateReviewCommentInput, GenreDetailsInput, GraphqlMetadataDetails, MetadataLookupResponse,
    MetadataProgressUpdateInput, ReviewPostedEvent,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc, prelude::Expr};
use supporting_service::SupportingService;
use uuid::Uuid;

pub async fn core_details(ss: &Arc<SupportingService>) -> Result<CoreDetails> {
    dependent_core_details(ss).await
}

pub async fn deploy_bulk_metadata_progress_update(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: Vec<MetadataProgressUpdateInput>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Hp(
        HpApplicationJob::BulkMetadataProgressUpdate(user_id, input),
    ))
    .await?;
    Ok(true)
}

pub async fn expire_cache_key(ss: &Arc<SupportingService>, cache_id: Uuid) -> Result<bool> {
    miscellaneous_general_service::expire_cache_key(ss, cache_id).await
}

pub async fn deploy_background_job(
    ss: &Arc<SupportingService>,
    user_id: &String,
    job_name: BackgroundJob,
) -> Result<bool> {
    dependent_deploy_background_job(user_id, job_name, ss).await
}

pub async fn generate_log_download_url(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<String> {
    admin_account_guard(user_id, ss).await?;

    let token = Uuid::new_v4().to_string();
    let key = ApplicationCacheKey::LogDownloadToken(token.clone());
    let value = ApplicationCacheValue::LogDownloadToken(EmptyCacheValue::default());

    cache_service::set_key(ss, key, value).await?;

    let download_url = format!("{}/backend/logs/download/{}", ss.config.frontend.url, token);

    Ok(download_url)
}

#[cfg(debug_assertions)]
pub async fn development_mutation(_ss: &Arc<SupportingService>) -> Result<bool> {
    Ok(true)
}

pub async fn metadata_details(
    ss: &Arc<SupportingService>,
    metadata_id: &String,
) -> Result<CachedResponse<GraphqlMetadataDetails>> {
    dependent_details_utils::metadata_details(ss, metadata_id).await
}

pub async fn user_metadata_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_id: String,
) -> Result<CachedResponse<UserMetadataDetails>> {
    miscellaneous_entity_user_details_service::user_metadata_details(ss, user_id, metadata_id).await
}

pub async fn user_person_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    person_id: String,
) -> Result<CachedResponse<UserPersonDetails>> {
    miscellaneous_entity_user_details_service::user_person_details(ss, user_id, person_id).await
}

pub async fn user_metadata_group_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_group_id: String,
) -> Result<CachedResponse<UserMetadataGroupDetails>> {
    miscellaneous_entity_user_details_service::user_metadata_group_details(
        ss,
        user_id,
        metadata_group_id,
    )
    .await
}

pub async fn is_entity_recently_consumed(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: EntityWithLot,
) -> Result<bool> {
    miscellaneous_entity_user_details_service::get_entity_recently_consumed(&user_id, input, ss)
        .await
}

pub async fn user_metadata_list_query(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserMetadataListInput,
) -> Result<CachedResponse<UserMetadataListResponse>> {
    user_metadata_list(&user_id, input, ss).await
}

pub async fn bulk_metadata_progress_update_for_user(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: Vec<MetadataProgressUpdateInput>,
) -> Result<()> {
    miscellaneous_progress_service::bulk_metadata_progress_update(ss, &user_id, input).await
}

pub async fn mark_entity_as_partial(
    ss: &Arc<SupportingService>,
    input: EntityWithLot,
) -> Result<bool> {
    miscellaneous_general_service::mark_entity_as_partial(ss, input).await
}

pub async fn merge_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    merge_from: String,
    merge_into: String,
) -> Result<bool> {
    miscellaneous_metadata_operations_service::merge_metadata(ss, user_id, merge_from, merge_into)
        .await
}

pub async fn disassociate_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_id: String,
) -> Result<bool> {
    miscellaneous_metadata_operations_service::disassociate_metadata(ss, user_id, metadata_id).await
}

pub async fn metadata_search(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: MetadataSearchInput,
) -> Result<CachedResponse<MetadataSearchResponse>> {
    miscellaneous_search_service::metadata_search(ss, user_id, input).await
}

pub async fn people_search(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: PeopleSearchInput,
) -> Result<CachedResponse<PeopleSearchResponse>> {
    miscellaneous_search_service::people_search(ss, user_id, input).await
}

pub async fn metadata_group_search(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: MetadataGroupSearchInput,
) -> Result<CachedResponse<MetadataGroupSearchResponse>> {
    miscellaneous_search_service::metadata_group_search(ss, user_id, input).await
}

pub async fn user_genres_list_query(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: Option<SearchInput>,
) -> Result<SearchResults<String>> {
    user_genres_list(ss, user_id, input).await
}

pub async fn user_metadata_groups_list_query(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserMetadataGroupsListInput,
) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
    user_metadata_groups_list(&user_id, ss, input).await
}

pub async fn person_details(
    ss: &Arc<SupportingService>,
    person_id: String,
) -> Result<CachedResponse<GraphqlPersonDetails>> {
    dependent_details_utils::person_details(&person_id, ss).await
}

pub async fn genre_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: GenreDetailsInput,
) -> Result<CachedResponse<GenreDetails>> {
    dependent_details_utils::genre_details(ss, user_id, input).await
}

pub async fn metadata_group_details(
    ss: &Arc<SupportingService>,
    metadata_group_id: String,
) -> Result<CachedResponse<MetadataGroupDetails>> {
    dependent_details_utils::metadata_group_details(ss, &metadata_group_id).await
}

pub async fn create_review_comment(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: CreateReviewCommentInput,
) -> Result<bool> {
    miscellaneous_review_service::create_review_comment(ss, user_id, input).await
}

pub async fn update_metadata_and_notify_users_for_id(
    ss: &Arc<SupportingService>,
    metadata_id: &String,
) -> Result<()> {
    update_metadata_and_notify_users(metadata_id, ss).await?;
    Ok(())
}

pub async fn update_person_and_notify_users_for_id(
    ss: &Arc<SupportingService>,
    person_id: &String,
) -> Result<()> {
    update_person_and_notify_users(person_id, ss).await?;
    Ok(())
}

pub async fn update_metadata_group_and_notify_users_for_id(
    ss: &Arc<SupportingService>,
    metadata_group_id: &String,
) -> Result<()> {
    update_metadata_group_and_notify_users(metadata_group_id, ss).await?;
    Ok(())
}

pub async fn update_media_details_and_notify_users(
    ss: &Arc<SupportingService>,
    input: EntityWithLot,
) -> Result<()> {
    match input.entity_lot {
        EntityLot::Metadata => update_metadata_and_notify_users_for_id(ss, &input.entity_id).await,
        EntityLot::Person => update_person_and_notify_users_for_id(ss, &input.entity_id).await,
        EntityLot::MetadataGroup => {
            update_metadata_group_and_notify_users_for_id(ss, &input.entity_id).await
        }
        _ => bail!(
            "Entity type {:?} is not supported for update jobs",
            input.entity_lot
        ),
    }
}

pub async fn trending_metadata(ss: &Arc<SupportingService>) -> Result<TrendingMetadataIdsResponse> {
    miscellaneous_trending_and_events_service::trending_metadata(ss).await
}

pub async fn handle_review_posted_event(
    ss: &Arc<SupportingService>,
    event: ReviewPostedEvent,
) -> Result<()> {
    miscellaneous_trending_and_events_service::handle_review_posted_event(ss, event).await
}

pub async fn update_user_last_activity_performed(
    ss: &Arc<SupportingService>,
    user_id: String,
    timestamp: DateTimeUtc,
) -> Result<()> {
    User::update_many()
        .filter(user::Column::Id.eq(user_id))
        .col_expr(user::Column::LastActivityOn, Expr::value(timestamp))
        .exec(&ss.db)
        .await?;
    Ok(())
}

pub async fn handle_metadata_eligible_for_smart_collection_moving(
    ss: &Arc<SupportingService>,
    metadata_id: String,
) -> Result<()> {
    miscellaneous_metadata_operations_service::handle_metadata_eligible_for_smart_collection_moving(
        ss,
        metadata_id,
    )
    .await
}

pub async fn invalidate_import_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    miscellaneous_background_service::invalidate_import_jobs(ss).await
}

pub async fn cleanup_user_and_metadata_association(ss: &Arc<SupportingService>) -> Result<()> {
    miscellaneous_background_service::cleanup_user_and_metadata_association(ss).await
}

pub async fn perform_background_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    miscellaneous_background_service::perform_background_jobs(ss).await
}

pub async fn metadata_lookup(
    ss: &Arc<SupportingService>,
    title: String,
) -> Result<CachedResponse<MetadataLookupResponse>> {
    miscellaneous_lookup_service::metadata_lookup(ss, title).await
}
