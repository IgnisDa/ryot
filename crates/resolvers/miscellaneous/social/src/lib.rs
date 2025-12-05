use async_graphql::{Context, Object, Result};
use common_models::StringIdObject;
use dependent_models::{
    CachedResponse, GraphqlPersonDetails, UserPeopleListInput, UserPeopleListResponse,
    UserPersonDetails,
};
use media_models::{CreateOrUpdateReviewInput, CreateReviewCommentInput};
use traits::{AuthProvider, GraphqlResolverDependency};

#[derive(Default)]
pub struct MiscellaneousSocialQueryResolver;

impl AuthProvider for MiscellaneousSocialQueryResolver {}
impl GraphqlResolverDependency for MiscellaneousSocialQueryResolver {}

#[Object]
impl MiscellaneousSocialQueryResolver {
    /// Get details about a creator present in the database.
    async fn person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<CachedResponse<GraphqlPersonDetails>> {
        let service = self.dependency(gql_ctx);
        Ok(dependent_details_utils::person_details(&person_id, service).await?)
    }

    /// Get details that can be displayed to a user for a creator.
    async fn user_person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<CachedResponse<UserPersonDetails>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_entity_user_details_service::user_person_details(
                service, user_id, person_id,
            )
            .await?,
        )
    }

    /// Get paginated list of people.
    async fn user_people_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserPeopleListInput,
    ) -> Result<CachedResponse<UserPeopleListResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(dependent_entity_list_utils::user_people_list(&user_id, input, service).await?)
    }
}

#[derive(Default)]
pub struct MiscellaneousSocialMutationResolver;

impl AuthProvider for MiscellaneousSocialMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}
impl GraphqlResolverDependency for MiscellaneousSocialMutationResolver {}

#[Object]
impl MiscellaneousSocialMutationResolver {
    /// Create or update a review.
    async fn create_or_update_review(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateReviewInput,
    ) -> Result<StringIdObject> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(dependent_review_utils::create_or_update_review(&user_id, input, service).await?)
    }

    /// Delete a review if it belongs to the currently logged in user.
    async fn delete_review(&self, gql_ctx: &Context<'_>, review_id: String) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(miscellaneous_review_service::delete_review(service, user_id, review_id).await?)
    }

    /// Create, like or delete a comment on a review.
    async fn create_review_comment(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(miscellaneous_review_service::create_review_comment(service, user_id, input).await?)
    }
}
