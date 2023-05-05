use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::DatabaseConnection;

use crate::{entities::review, graphql::IdObject, utils::user_id_from_ctx};

#[derive(Default)]
pub struct ReviewsQuery;

#[Object]
impl ReviewsQuery {
    /// Get all the reviews for a media item. Returns private ones if admin as well.
    pub async fn media_item_reviews(&self, gql_ctx: &Context<'_>) -> Result<Vec<review::Model>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<ReviewsService>()
            .media_item_reviews(&user_id)
            .await
    }
}

#[derive(Default)]
pub struct ReviewsMutation;

#[Object]
impl ReviewsMutation {
    /// Create or update a review
    pub async fn post_review(&self, gql_ctx: &Context<'_>) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<ReviewsService>()
            .post_review(&user_id)
            .await
    }
}

#[derive(Debug)]
pub struct ReviewsService {
    db: DatabaseConnection,
}

impl ReviewsService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl ReviewsService {
    async fn media_item_reviews(&self, user_id: &i32) -> Result<Vec<review::Model>> {
        todo!();
    }

    async fn post_review(&self, user_id: &i32) -> Result<IdObject> {
        todo!();
    }
}

#[derive(Debug, InputObject)]
struct PostReviewInput {
    username: String,
    #[graphql(secret)]
    password: String,
}
