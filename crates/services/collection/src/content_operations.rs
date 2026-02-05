use std::sync::Arc;

use anyhow::{Result, bail};
use application_utils::graphql_to_db_order;
use common_models::{EntityWithLot, SearchDetails, UserLevelCacheKey};
use database_models::{
    collection_to_entity, exercise, metadata, metadata_group, person,
    prelude::{
        Collection, CollectionToEntity, Exercise, Metadata, MetadataGroup, Person, Workout,
        WorkoutTemplate,
    },
    workout_template,
};
use database_utils::{apply_columns_search, extract_pagination_params, item_reviews, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, BasicUserDetails, CachedResponse,
    CollectionContents, CollectionContentsInput, CollectionContentsResponse, SearchResults,
};
use enum_models::EntityLot;
use media_models::CollectionContentsSortBy;
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, PaginatorTrait, QueryFilter, QueryOrder,
    QueryTrait,
    sea_query::{Condition, Expr, Func},
};
use supporting_service::SupportingService;

pub async fn collection_contents(
    user_id: &String,
    input: CollectionContentsInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<CollectionContentsResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserCollectionContents(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        |val| ApplicationCacheValue::UserCollectionContents(Box::new(val)),
        || async {
            let (take, page) = extract_pagination_params(input.search.clone(), user_id, ss).await?;
            let search = input.search.unwrap_or_default();
            let sort = input.sort.unwrap_or_default();
            let filter = input.filter.unwrap_or_default();
            let maybe_collection = Collection::find_by_id(input.collection_id.clone())
                .one(&ss.db)
                .await?;
            let Some(details) = maybe_collection else {
                bail!("Collection not found");
            };
            let paginator = CollectionToEntity::find()
                .left_join(Metadata)
                .left_join(MetadataGroup)
                .left_join(Person)
                .left_join(Exercise)
                .left_join(Workout)
                .left_join(WorkoutTemplate)
                .filter(collection_to_entity::Column::CollectionId.eq(details.id.clone()))
                .apply_if(search.query, |query, v| {
                    apply_columns_search(
                        &v,
                        query,
                        [
                            Expr::col((metadata::Entity, metadata::Column::Title)),
                            Expr::col((metadata_group::Entity, metadata_group::Column::Title)),
                            Expr::col((person::Entity, person::Column::Name)),
                            Expr::col((exercise::Entity, exercise::Column::Id)),
                            Expr::col((workout_template::Entity, workout_template::Column::Name)),
                        ],
                    )
                })
                .apply_if(filter.metadata_lot, |query, v| {
                    query.filter(
                        Condition::any()
                            .add(Expr::col((metadata::Entity, metadata::Column::Lot)).eq(v)),
                    )
                })
                .apply_if(filter.entity_lot, |query, v| {
                    let f = match v {
                        EntityLot::Genre
                        | EntityLot::Review
                        | EntityLot::Collection
                        | EntityLot::UserMeasurement => {
                            // These entity types cannot be directly added to collections
                            unreachable!()
                        }
                        _ => v,
                    };
                    query.filter(collection_to_entity::Column::EntityLot.eq(f))
                })
                .order_by(
                    match sort.by {
                        CollectionContentsSortBy::Rank => {
                            Expr::col(collection_to_entity::Column::Rank)
                        }
                        CollectionContentsSortBy::Random => Expr::expr(Func::random()),
                        CollectionContentsSortBy::LastUpdatedOn => {
                            Expr::col(collection_to_entity::Column::LastUpdatedOn)
                        }
                        CollectionContentsSortBy::Date => Expr::expr(Func::coalesce([
                            Expr::col((metadata::Entity, metadata::Column::PublishDate)).into(),
                            Expr::col((person::Entity, person::Column::BirthDate)).into(),
                        ])),
                        CollectionContentsSortBy::Title => Expr::expr(Func::coalesce([
                            Expr::col((metadata::Entity, metadata::Column::Title)).into(),
                            Expr::col((metadata_group::Entity, metadata_group::Column::Title))
                                .into(),
                            Expr::col((person::Entity, person::Column::Name)).into(),
                            Expr::col((exercise::Entity, exercise::Column::Id)).into(),
                            Expr::col((workout_template::Entity, workout_template::Column::Name))
                                .into(),
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
            let results = SearchResults {
                items,
                details: SearchDetails {
                    total_items: number_of_items,
                    next_page: (page < number_of_pages).then(|| page + 1),
                },
            };
            let user = user_by_id(&details.user_id, ss).await?;
            let reviews = item_reviews(
                &details.user_id,
                &input.collection_id,
                EntityLot::Collection,
                true,
                ss,
            )
            .await?;
            let response = CollectionContents {
                reviews,
                results,
                details,
                total_items: number_of_items,
                user: BasicUserDetails {
                    id: user.id,
                    lot: user.lot,
                    name: user.name,
                    is_disabled: user.is_disabled,
                },
            };
            Ok(response)
        },
    )
    .await
}
