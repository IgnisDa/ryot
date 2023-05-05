use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{ActiveModelTrait, ActiveValue, DatabaseConnection};

use crate::{
    entities::{
        review,
        utils::{SeenExtraInformation, SeenSeasonExtraInformation},
    },
    graphql::IdObject,
    migrator::Visibility,
    utils::user_id_from_ctx,
};

#[derive(Debug, InputObject)]
struct PostReviewInput {
    rating: Option<i32>,
    text: Option<String>,
    visibility: Visibility,
    metadata_id: i32,
    /// ID of the review if this is an update to an existing review
    review_id: Option<i32>,
    season_number: Option<i32>,
    episode_number: Option<i32>,
}

#[derive(Default)]
pub struct ReviewsQuery;

#[Object]
impl ReviewsQuery {
    /// Get all the reviews for a media item. Returns private ones if admin as well.
    async fn media_item_reviews(&self, gql_ctx: &Context<'_>) -> Result<Vec<review::Model>> {
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
    async fn post_review(&self, gql_ctx: &Context<'_>, input: PostReviewInput) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<ReviewsService>()
            .post_review(&user_id, input)
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

    async fn post_review(&self, user_id: &i32, input: PostReviewInput) -> Result<IdObject> {
        let review_id = match input.review_id {
            Some(i) => ActiveValue::Set(i),
            None => ActiveValue::NotSet,
        };
        let mut review_obj = review::ActiveModel {
            id: review_id,
            rating: ActiveValue::Set(input.rating),
            text: ActiveValue::Set(input.text),
            visibility: ActiveValue::Set(input.visibility),
            user_id: ActiveValue::Set(user_id.to_owned()),
            metadata_id: ActiveValue::Set(input.metadata_id),
            extra_information: ActiveValue::NotSet,
            ..Default::default()
        };
        if let (Some(s), Some(e)) = (input.season_number, input.episode_number) {
            review_obj.extra_information = ActiveValue::Set(Some(SeenExtraInformation::Show(
                SeenSeasonExtraInformation {
                    season: s,
                    episode: e,
                },
            )));
        }
        let insert = review_obj.save(&self.db).await.unwrap();
        Ok(IdObject {
            id: insert.id.unwrap(),
        })
    }
}
