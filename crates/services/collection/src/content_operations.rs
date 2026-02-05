use std::sync::Arc;

use anyhow::{Result, bail};
use application_utils::graphql_to_db_order;
use common_models::{EntityWithLot, SearchDetails, UserLevelCacheKey};
use database_models::{
    collection_entity_membership, collection_to_entity, exercise, metadata, metadata_group, person,
    prelude::{
        Collection, CollectionEntityMembership, CollectionToEntity, Exercise, Metadata,
        MetadataGroup, Person, Review, Seen, UserToEntity, Workout, WorkoutTemplate,
    },
    review, seen, user_to_entity, workout, workout_template,
};
use database_utils::{apply_columns_search, extract_pagination_params, item_reviews, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, BasicUserDetails, CachedResponse,
    CollectionContents, CollectionContentsInput, CollectionContentsResponse, SearchResults,
};
use enum_models::EntityLot;
use media_models::{
    CollectionContentsSortBy, MediaCollectionPresenceFilter, MediaCollectionStrategyFilter,
};
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, PaginatorTrait, QueryFilter, QueryOrder,
    QueryTrait,
    sea_query::{Condition, Expr, Func, NullOrdering, Query, SimpleExpr},
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

            let average_rating_subquery = Query::select()
                .expr(Func::avg(Expr::col((
                    review::Entity,
                    review::Column::Rating,
                ))))
                .from(Review)
                .and_where(Expr::col((review::Entity, review::Column::UserId)).eq(user_id))
                .and_where(
                    Expr::col((review::Entity, review::Column::EntityId)).equals((
                        collection_to_entity::Entity,
                        collection_to_entity::Column::EntityId,
                    )),
                )
                .and_where(
                    Expr::col((review::Entity, review::Column::EntityLot)).equals((
                        collection_to_entity::Entity,
                        collection_to_entity::Column::EntityLot,
                    )),
                )
                .and_where(Expr::col((review::Entity, review::Column::Rating)).is_not_null())
                .to_owned();

            let max_seen_finished_on_subquery = Query::select()
                .expr(Func::max(Expr::col((
                    seen::Entity,
                    seen::Column::FinishedOn,
                ))))
                .from(Seen)
                .and_where(Expr::col((seen::Entity, seen::Column::UserId)).eq(user_id))
                .and_where(Expr::col((seen::Entity, seen::Column::MetadataId)).equals((
                    collection_to_entity::Entity,
                    collection_to_entity::Column::MetadataId,
                )))
                .to_owned();

            let times_seen_subquery = Query::select()
                .expr(Func::count(Expr::col((seen::Entity, seen::Column::Id))))
                .from(Seen)
                .and_where(Expr::col((seen::Entity, seen::Column::UserId)).eq(user_id))
                .and_where(Expr::col((seen::Entity, seen::Column::MetadataId)).equals((
                    collection_to_entity::Entity,
                    collection_to_entity::Column::MetadataId,
                )))
                .to_owned();

            let exercise_last_performed_subquery = Query::select()
                .expr(Expr::col((
                    user_to_entity::Entity,
                    user_to_entity::Column::LastUpdatedOn,
                )))
                .from(UserToEntity)
                .and_where(
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::UserId)).eq(user_id),
                )
                .and_where(
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::EntityId)).equals((
                        collection_to_entity::Entity,
                        collection_to_entity::Column::EntityId,
                    )),
                )
                .and_where(
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::EntityLot)).equals(
                        (
                            collection_to_entity::Entity,
                            collection_to_entity::Column::EntityLot,
                        ),
                    ),
                )
                .to_owned();

            let exercise_times_performed_subquery = Query::select()
                .expr(Func::coalesce([
                    Expr::col((
                        user_to_entity::Entity,
                        user_to_entity::Column::ExerciseNumTimesInteracted,
                    ))
                    .into(),
                    Expr::val(0).into(),
                ]))
                .from(UserToEntity)
                .and_where(
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::UserId)).eq(user_id),
                )
                .and_where(
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::EntityId)).equals((
                        collection_to_entity::Entity,
                        collection_to_entity::Column::EntityId,
                    )),
                )
                .and_where(
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::EntityLot)).equals(
                        (
                            collection_to_entity::Entity,
                            collection_to_entity::Column::EntityLot,
                        ),
                    ),
                )
                .to_owned();

            let mut query = CollectionToEntity::find()
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
                .apply_if(filter.metadata.map(|d| d.lot), |query, v| {
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
                .apply_if(filter.date_range, |outer_query, outer_value| {
                    outer_query
                        .apply_if(outer_value.start_date, |inner_query, inner_value| {
                            inner_query.filter(
                                collection_to_entity::Column::LastUpdatedOn.gte(inner_value),
                            )
                        })
                        .apply_if(outer_value.end_date, |inner_query, inner_value| {
                            inner_query.filter(
                                collection_to_entity::Column::LastUpdatedOn.lte(inner_value),
                            )
                        })
                });

            if let Some(ref collections) = filter.collections
                && !collections.is_empty()
            {
                let (first_filter, remaining_filters) = collections.split_first().unwrap();

                let mut combined_condition: SimpleExpr = {
                    let exists_condition = Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(CollectionEntityMembership)
                            .and_where(
                                collection_entity_membership::Column::OriginCollectionId
                                    .eq(&first_filter.collection_id),
                            )
                            .and_where(collection_entity_membership::Column::UserId.eq(user_id))
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityId).equals((
                                    collection_to_entity::Entity,
                                    collection_to_entity::Column::EntityId,
                                )),
                            )
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityLot).equals(
                                    (
                                        collection_to_entity::Entity,
                                        collection_to_entity::Column::EntityLot,
                                    ),
                                ),
                            )
                            .to_owned(),
                    );
                    match first_filter.presence {
                        MediaCollectionPresenceFilter::PresentIn => exists_condition,
                        MediaCollectionPresenceFilter::NotPresentIn => exists_condition.not(),
                    }
                };

                for coll_filter in remaining_filters {
                    let exists_condition = Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(CollectionEntityMembership)
                            .and_where(
                                collection_entity_membership::Column::OriginCollectionId
                                    .eq(&coll_filter.collection_id),
                            )
                            .and_where(collection_entity_membership::Column::UserId.eq(user_id))
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityId).equals((
                                    collection_to_entity::Entity,
                                    collection_to_entity::Column::EntityId,
                                )),
                            )
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityLot).equals(
                                    (
                                        collection_to_entity::Entity,
                                        collection_to_entity::Column::EntityLot,
                                    ),
                                ),
                            )
                            .to_owned(),
                    );
                    let condition = match coll_filter.presence {
                        MediaCollectionPresenceFilter::PresentIn => exists_condition,
                        MediaCollectionPresenceFilter::NotPresentIn => exists_condition.not(),
                    };

                    combined_condition = match coll_filter.strategy {
                        MediaCollectionStrategyFilter::Or => combined_condition.or(condition),
                        MediaCollectionStrategyFilter::And => combined_condition.and(condition),
                    };
                }

                query = query.filter(combined_condition);
            }

            query = match sort.by {
                _ => query
                    .order_by_with_nulls(
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
                                Expr::col((workout::Entity, workout::Column::EndTime)).into(),
                                Expr::col((
                                    workout_template::Entity,
                                    workout_template::Column::CreatedOn,
                                ))
                                .into(),
                            ])),
                            CollectionContentsSortBy::Title => Expr::expr(Func::coalesce([
                                Expr::col((metadata::Entity, metadata::Column::Title)).into(),
                                Expr::col((metadata_group::Entity, metadata_group::Column::Title))
                                    .into(),
                                Expr::col((person::Entity, person::Column::Name)).into(),
                                Expr::col((exercise::Entity, exercise::Column::Id)).into(),
                                Expr::col((workout::Entity, workout::Column::Name)).into(),
                                Expr::col((
                                    workout_template::Entity,
                                    workout_template::Column::Name,
                                ))
                                .into(),
                            ])),
                            CollectionContentsSortBy::UserRating => {
                                Expr::expr(SimpleExpr::SubQuery(
                                    None,
                                    Box::new(average_rating_subquery.into_sub_query_statement()),
                                ))
                            }
                            CollectionContentsSortBy::LastConsumed => {
                                Expr::expr(SimpleExpr::SubQuery(
                                    None,
                                    Box::new(
                                        max_seen_finished_on_subquery.into_sub_query_statement(),
                                    ),
                                ))
                            }
                            CollectionContentsSortBy::ProviderRating => {
                                Expr::col((metadata::Entity, metadata::Column::ProviderRating))
                            }
                            CollectionContentsSortBy::AssociatedEntityCount => {
                                Expr::expr(Func::coalesce([
                                    Expr::col((
                                        person::Entity,
                                        person::Column::AssociatedEntityCount,
                                    ))
                                    .into(),
                                    Expr::col((
                                        metadata_group::Entity,
                                        metadata_group::Column::Parts,
                                    ))
                                    .into(),
                                ]))
                            }
                            CollectionContentsSortBy::LastPerformed => {
                                Expr::expr(SimpleExpr::SubQuery(
                                    None,
                                    Box::new(
                                        exercise_last_performed_subquery.into_sub_query_statement(),
                                    ),
                                ))
                            }
                            CollectionContentsSortBy::TimesPerformed => {
                                Expr::expr(SimpleExpr::SubQuery(
                                    None,
                                    Box::new(
                                        exercise_times_performed_subquery
                                            .into_sub_query_statement(),
                                    ),
                                ))
                            }
                            CollectionContentsSortBy::TimesConsumed => {
                                Expr::expr(SimpleExpr::SubQuery(
                                    None,
                                    Box::new(times_seen_subquery.into_sub_query_statement()),
                                ))
                            }
                        },
                        graphql_to_db_order(sort.order),
                        NullOrdering::Last,
                    )
                    .order_by(
                        collection_to_entity::Column::LastUpdatedOn,
                        sea_orm::Order::Desc,
                    ),
            };

            let paginator = query.paginate(&ss.db, take);
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
