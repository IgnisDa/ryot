use std::sync::Arc;

use application_utils::graphql_to_db_order;
use async_graphql::{Error, Result};
use common_models::{SearchDetails, UserLevelCacheKey};
use database_models::{
    collection_to_entity,
    prelude::{
        Collection, CollectionToEntity, Exercise, Metadata, MetadataGroup, Person, User, Workout,
    },
};
use database_utils::{ilike_sql, item_reviews, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, CollectionContents,
    CollectionContentsInput, CollectionContentsResponse,
};
use enum_models::EntityLot;
use media_models::{CollectionContentsSortBy, EntityWithLot};
use migrations::{AliasedExercise, AliasedMetadata, AliasedMetadataGroup, AliasedPerson};
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, ModelTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QueryTrait,
};
use sea_query::{Condition, Expr, Func, extension::postgres::PgExpr};
use supporting_service::SupportingService;

pub async fn collection_contents(
    user_id: &String,
    input: CollectionContentsInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<CollectionContentsResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserCollectionContents(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((id, cached)) = cc
        .get_value::<CollectionContentsResponse>(key.clone())
        .await
    {
        return Ok(CachedResponse {
            cache_id: id,
            response: cached,
        });
    }
    let preferences = user_by_id(user_id, ss).await?.preferences;
    let take = input
        .search
        .clone()
        .and_then(|s| s.take)
        .unwrap_or(preferences.general.list_page_size as u64);
    let search = input.search.unwrap_or_default();
    let sort = input.sort.unwrap_or_default();
    let filter = input.filter.unwrap_or_default();
    let page: u64 = search.page.unwrap_or(1).try_into().unwrap();
    let maybe_collection = Collection::find_by_id(input.collection_id.clone())
        .one(&ss.db)
        .await?;
    let Some(details) = maybe_collection else {
        return Err(Error::new("Collection not found".to_owned()));
    };
    let paginator = CollectionToEntity::find()
        .left_join(Metadata)
        .left_join(MetadataGroup)
        .left_join(Person)
        .left_join(Exercise)
        .left_join(Workout)
        .filter(collection_to_entity::Column::CollectionId.eq(details.id.clone()))
        .apply_if(search.query, |query, v| {
            query.filter(
                Condition::any()
                    .add(
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::Title))
                            .ilike(ilike_sql(&v)),
                    )
                    .add(
                        Expr::col((AliasedMetadataGroup::Table, AliasedMetadataGroup::Title))
                            .ilike(ilike_sql(&v)),
                    )
                    .add(
                        Expr::col((AliasedPerson::Table, AliasedPerson::Name)).ilike(ilike_sql(&v)),
                    )
                    .add(
                        Expr::col((AliasedExercise::Table, AliasedExercise::Id))
                            .ilike(ilike_sql(&v)),
                    ),
            )
        })
        .apply_if(filter.metadata_lot, |query, v| {
            query.filter(
                Condition::any()
                    .add(Expr::col((AliasedMetadata::Table, AliasedMetadata::Lot)).eq(v)),
            )
        })
        .apply_if(filter.entity_lot, |query, v| {
            let f = match v {
                EntityLot::Person => EntityLot::Person,
                EntityLot::Workout => EntityLot::Workout,
                EntityLot::Metadata => EntityLot::Metadata,
                EntityLot::Exercise => EntityLot::Exercise,
                EntityLot::MetadataGroup => EntityLot::MetadataGroup,
                EntityLot::WorkoutTemplate => EntityLot::WorkoutTemplate,
                EntityLot::Collection | EntityLot::Review | EntityLot::UserMeasurement => {
                    // These entity types cannot be directly added to collections
                    unreachable!()
                }
            };
            query.filter(collection_to_entity::Column::EntityLot.eq(f))
        })
        .order_by(
            match sort.by {
                CollectionContentsSortBy::Random => Expr::expr(Func::random()),
                CollectionContentsSortBy::LastUpdatedOn => {
                    Expr::col(collection_to_entity::Column::LastUpdatedOn)
                }
                CollectionContentsSortBy::Date => Expr::expr(Func::coalesce([
                    Expr::col((AliasedMetadata::Table, AliasedMetadata::PublishDate)).into(),
                    Expr::col((AliasedPerson::Table, AliasedPerson::BirthDate)).into(),
                ])),
                CollectionContentsSortBy::Title => Expr::expr(Func::coalesce([
                    Expr::col((AliasedMetadata::Table, AliasedMetadata::Title)).into(),
                    Expr::col((AliasedMetadataGroup::Table, AliasedMetadataGroup::Title)).into(),
                    Expr::col((AliasedPerson::Table, AliasedPerson::Name)).into(),
                    Expr::col((AliasedExercise::Table, AliasedExercise::Id)).into(),
                ])),
            },
            graphql_to_db_order(sort.order),
        )
        .paginate(&ss.db, take);
    let mut items = vec![];
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    for cte in paginator.fetch_page(page - 1).await? {
        items.push(EntityWithLot {
            entity_id: cte.entity_id,
            entity_lot: cte.entity_lot,
        });
    }
    let results = dependent_models::SearchResults {
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages {
                Some((page + 1).try_into().unwrap())
            } else {
                None
            },
        },
        items,
    };
    let user = details.find_related(User).one(&ss.db).await?.unwrap();
    let reviews = item_reviews(
        &details.user_id,
        &input.collection_id,
        EntityLot::Collection,
        true,
        ss,
    )
    .await?;
    let response = CollectionContents {
        user,
        reviews,
        results,
        details,
        total_items: number_of_items,
    };
    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserCollectionContents(Box::new(response.clone())),
        )
        .await?;
    Ok(CachedResponse { response, cache_id })
}
