use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::StringIdObject;
use dependent_models::{
    CachedResponse, GraphqlPersonDetails, UserPeopleListInput, UserPeopleListResponse,
    UserPersonDetails,
};
use media_models::{CreateOrUpdateReviewInput, CreateReviewCommentInput};
use miscellaneous_service::MiscellaneousService;
use traits::AuthProvider;

#[derive(Default)]
pub struct SocialQuery;

impl AuthProvider for SocialQuery {}

#[Object]
impl SocialQuery {
    /// Get details about a creator present in the database.
    async fn person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<GraphqlPersonDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.person_details(person_id).await?;
        Ok(response)
    }

    /// Get details that can be displayed to a user for a creator.
    async fn user_person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<UserPersonDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_person_details(user_id, person_id).await?;
        Ok(response)
    }

    /// Get paginated list of people.
    async fn user_people_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserPeopleListInput,
    ) -> Result<CachedResponse<UserPeopleListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_people_list(user_id, input).await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct SocialMutation;

impl AuthProvider for SocialMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl SocialMutation {
    /// Create or update a review.
    async fn create_or_update_review(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateReviewInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.create_or_update_review(&user_id, input).await?;
        Ok(response)
    }

    /// Delete a review if it belongs to the currently logged in user.
    async fn delete_review(&self, gql_ctx: &Context<'_>, review_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.delete_review(user_id, review_id).await?;
        Ok(response)
    }

    /// Create, like or delete a comment on a review.
    async fn create_review_comment(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.create_review_comment(user_id, input).await?;
        Ok(response)
    }
}
