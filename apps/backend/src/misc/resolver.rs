use std::sync::Arc;

use async_graphql::{Context, Error, InputObject, Object, Result, SimpleObject};
use rust_decimal::Decimal;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, QueryFilter, QueryOrder,
};

use crate::{
    entities::{
        collection,
        prelude::{Collection, Metadata, Review, User},
        review,
        utils::{SeenExtraInformation, SeenSeasonExtraInformation},
    },
    graphql::IdObject,
    media::resolver::{MediaSearchItem, MediaService},
    migrator::ReviewVisibility,
    utils::{user_id_from_ctx, NamedObject},
};

#[derive(Debug, SimpleObject)]
struct ReviewPostedBy {
    id: i32,
    name: String,
}

#[derive(Debug, SimpleObject)]
struct ReviewItem {
    id: i32,
    posted_on: DateTimeUtc,
    rating: Option<Decimal>,
    text: Option<String>,
    visibility: ReviewVisibility,
    season_number: Option<i32>,
    episode_number: Option<i32>,
    posted_by: ReviewPostedBy,
}

#[derive(Debug, InputObject)]
struct PostReviewInput {
    rating: Option<Decimal>,
    text: Option<String>,
    visibility: Option<ReviewVisibility>,
    metadata_id: i32,
    /// ID of the review if this is an update to an existing review
    review_id: Option<i32>,
    season_number: Option<i32>,
    episode_number: Option<i32>,
}

#[derive(Debug, SimpleObject)]
struct CollectionItem {
    collection_details: collection::Model,
    media_details: Vec<MediaSearchItem>,
}

#[derive(Debug, InputObject)]
struct ToggleMediaInCollection {
    collection_id: i32,
    media_id: i32,
}

#[derive(Default)]
pub struct MiscQuery;

#[Object]
impl MiscQuery {
    /// Get all the public reviews for a media item.
    async fn media_item_reviews(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<Vec<ReviewItem>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .media_item_reviews(&user_id, &metadata_id)
            .await
    }

    /// Get all collections for the currently logged in user
    async fn collections(&self, gql_ctx: &Context<'_>) -> Result<Vec<CollectionItem>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .collections(&user_id)
            .await
    }
}

#[derive(Default)]
pub struct MiscMutation;

#[Object]
impl MiscMutation {
    /// Create or update a review
    async fn post_review(&self, gql_ctx: &Context<'_>, input: PostReviewInput) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .post_review(&user_id, input)
            .await
    }

    /// Create a new collection for the logged in user
    async fn create_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: NamedObject,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .create_collection(&user_id, input)
            .await
    }

    /// Add a media item to a collection if it is not there, otherwise remove it.
    async fn toggle_media_in_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ToggleMediaInCollection,
    ) -> Result<bool> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .toggle_media_in_collection(&user_id, input)
            .await
    }
}

#[derive(Debug)]
pub struct MiscService {
    db: DatabaseConnection,
    media_service: Arc<MediaService>,
}

impl MiscService {
    pub fn new(db: &DatabaseConnection, media_service: &MediaService) -> Self {
        Self {
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl MiscService {
    async fn media_item_reviews(
        &self,
        user_id: &i32,
        metadata_id: &i32,
    ) -> Result<Vec<ReviewItem>> {
        let all_reviews = Review::find()
            .order_by_desc(review::Column::PostedOn)
            .filter(review::Column::MetadataId.eq(metadata_id.to_owned()))
            .find_also_related(User)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|(r, u)| {
                let (se, ep) = match r.extra_information {
                    Some(s) => match s {
                        SeenExtraInformation::Show(d) => (Some(d.season), Some(d.episode)),
                    },
                    None => (None, None),
                };
                let user = u.unwrap();
                ReviewItem {
                    id: r.id,
                    posted_on: r.posted_on,
                    rating: r.rating,
                    text: r.text,
                    visibility: r.visibility,
                    season_number: se,
                    episode_number: ep,
                    posted_by: ReviewPostedBy {
                        id: user.id,
                        name: user.name,
                    },
                }
            })
            .collect::<Vec<_>>();
        let all_reviews = all_reviews
            .into_iter()
            .filter(|r| match r.visibility {
                ReviewVisibility::Private => r.posted_by.id == *user_id,
                _ => true,
            })
            .collect();
        Ok(all_reviews)
    }

    async fn collections(&self, user_id: &i32) -> Result<Vec<CollectionItem>> {
        let collections = Collection::find()
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .find_with_related(Metadata)
            .all(&self.db)
            .await
            .unwrap();
        let mut data = vec![];
        for (col, metas) in collections.into_iter() {
            let mut meta_data = vec![];
            for meta in metas {
                let m = self.media_service.generic_metadata(meta.id).await?;
                meta_data.push(MediaSearchItem {
                    identifier: m.0.id.to_string(),
                    lot: m.0.lot,
                    title: m.0.title,
                    poster_images: m.2,
                    publish_year: m.0.publish_year,
                })
            }
            data.push(CollectionItem {
                collection_details: col,
                media_details: meta_data,
            });
        }
        Ok(data)
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
            user_id: ActiveValue::Set(user_id.to_owned()),
            metadata_id: ActiveValue::Set(input.metadata_id),
            extra_information: ActiveValue::NotSet,
            ..Default::default()
        };
        if let Some(v) = input.visibility {
            review_obj.visibility = ActiveValue::Set(v);
        }
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

    async fn create_collection(&self, user_id: &i32, input: NamedObject) -> Result<IdObject> {
        let col = collection::ActiveModel {
            name: ActiveValue::Set(input.name),
            user_id: ActiveValue::Set(user_id.to_owned()),
            ..Default::default()
        };
        let inserted = col
            .insert(&self.db)
            .await
            .map_err(|_| Error::new("There was an error creating the collection".to_owned()))?;
        Ok(IdObject { id: inserted.id })
    }

    async fn toggle_media_in_collection(
        &self,
        user_id: &i32,
        input: ToggleMediaInCollection,
    ) -> Result<bool> {
        todo!();
    }
}
