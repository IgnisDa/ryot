use std::sync::Arc;

use crate::{
    AliasedCollection, AliasedCollectionToEntity, AliasedReview, AliasedUser, AliasedUserToEntity,
    CollectionItem, SearchDetails, UserLevelCacheKey, graphql_to_db_order, ilike_sql,
};
use async_graphql::Result;
use database_models::{
    collection, collection_to_entity, metadata, prelude::*, review, seen, user_to_entity,
};
use database_utils::{apply_collection_filter, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, SearchResults,
    UserCollectionsListResponse, UserMetadataListInput, UserMetadataListResponse,
};
use enum_models::{SeenState, UserToMediaReason};
use media_models::{MediaGeneralFilter, MediaSortBy};
use sea_orm::Iterable;
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, ItemsAndPagesNumber, JoinType, Order, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, RelationTrait, prelude::Expr,
};
use sea_query::extension::postgres::PgExpr;
use sea_query::{Alias, Func, NullOrdering, PgFunc};
use supporting_service::SupportingService;
use user_models::UserReviewScale;

pub async fn user_metadata_list(
    user_id: &String,
    input: UserMetadataListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserMetadataListResponse>> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserMetadataList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });
    if let Some((id, cached)) = cc.get_value::<UserMetadataListResponse>(key.clone()).await {
        return Ok(CachedResponse {
            cache_id: id,
            response: cached,
        });
    }
    let preferences = user_by_id(user_id, ss).await?.preferences;

    let avg_rating_col = "user_average_rating";
    let cloned_user_id_1 = user_id.clone();
    let cloned_user_id_2 = user_id.clone();

    let order_by = input
        .sort
        .clone()
        .map(|a| graphql_to_db_order(a.order))
        .unwrap_or(Order::Asc);
    let review_scale = match preferences.general.review_scale {
        UserReviewScale::OutOfTen => 10,
        UserReviewScale::OutOfFive => 20,
        UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => 1,
    };
    let take = input
        .search
        .clone()
        .and_then(|s| s.take)
        .unwrap_or(preferences.general.list_page_size);
    let page: u64 = input
        .search
        .clone()
        .and_then(|s| s.page)
        .unwrap_or(1)
        .try_into()
        .unwrap();
    let paginator = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .expr_as(
            Func::round_with_precision(
                Func::avg(
                    Expr::col((AliasedReview::Table, AliasedReview::Rating)).div(review_scale),
                ),
                review_scale,
            ),
            avg_rating_col,
        )
        .group_by(metadata::Column::Id)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .apply_if(input.lot, |query, v| {
            query.filter(metadata::Column::Lot.eq(v))
        })
        .inner_join(UserToEntity)
        .join(
            JoinType::LeftJoin,
            metadata::Relation::Review
                .def()
                .on_condition(move |_left, right| {
                    Condition::all().add(
                        Expr::col((right, review::Column::UserId)).eq(cloned_user_id_1.clone()),
                    )
                }),
        )
        .join(
            JoinType::LeftJoin,
            metadata::Relation::Seen
                .def()
                .on_condition(move |_left, right| {
                    Condition::all()
                        .add(Expr::col((right, seen::Column::UserId)).eq(cloned_user_id_2.clone()))
                }),
        )
        .apply_if(input.search.and_then(|s| s.query), |query, v| {
            query.filter(
                Condition::any()
                    .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(&v)))
                    .add(Expr::col(metadata::Column::Description).ilike(ilike_sql(&v))),
            )
        })
        .apply_if(
            input.filter.clone().and_then(|f| f.date_range),
            |outer_query, outer_value| {
                outer_query
                    .apply_if(outer_value.start_date, |inner_query, inner_value| {
                        inner_query.filter(seen::Column::FinishedOn.gte(inner_value))
                    })
                    .apply_if(outer_value.end_date, |inner_query, inner_value| {
                        inner_query.filter(seen::Column::FinishedOn.lte(inner_value))
                    })
            },
        )
        .apply_if(
            input.filter.clone().and_then(|f| f.collections),
            |query, v| {
                apply_collection_filter(
                    metadata::Column::Id,
                    query,
                    collection_to_entity::Column::MetadataId,
                    v,
                )
            },
        )
        .apply_if(input.filter.and_then(|f| f.general), |query, v| match v {
            MediaGeneralFilter::All => query.filter(metadata::Column::Id.is_not_null()),
            MediaGeneralFilter::Rated => query.filter(review::Column::Id.is_not_null()),
            MediaGeneralFilter::Unrated => query.filter(review::Column::Id.is_null()),
            MediaGeneralFilter::Unfinished => query.filter(
                Expr::expr(
                    Expr::val(UserToMediaReason::Finished.to_string())
                        .eq(PgFunc::any(Expr::col(user_to_entity::Column::MediaReason))),
                )
                .not(),
            ),
            s => query.filter(seen::Column::State.eq(match s {
                MediaGeneralFilter::Dropped => SeenState::Dropped,
                MediaGeneralFilter::OnAHold => SeenState::OnAHold,
                _ => unreachable!(),
            })),
        })
        .apply_if(input.sort.map(|s| s.by), |query, v| match v {
            MediaSortBy::Title => query.order_by(metadata::Column::Title, order_by),
            MediaSortBy::Random => query.order_by(Expr::expr(Func::random()), order_by),
            MediaSortBy::TimesConsumed => query.order_by(seen::Column::Id.count(), order_by),
            MediaSortBy::LastUpdated => query
                .order_by(user_to_entity::Column::LastUpdatedOn, order_by)
                .group_by(user_to_entity::Column::LastUpdatedOn),
            MediaSortBy::ReleaseDate => query.order_by_with_nulls(
                metadata::Column::PublishYear,
                order_by,
                NullOrdering::Last,
            ),
            MediaSortBy::LastSeen => query.order_by_with_nulls(
                seen::Column::FinishedOn.max(),
                order_by,
                NullOrdering::Last,
            ),
            MediaSortBy::UserRating => query.order_by_with_nulls(
                Expr::col(Alias::new(avg_rating_col)),
                order_by,
                NullOrdering::Last,
            ),
            MediaSortBy::ProviderRating => query.order_by_with_nulls(
                metadata::Column::ProviderRating,
                order_by,
                NullOrdering::Last,
            ),
        })
        .into_tuple::<String>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut items = vec![];
    for c in paginator.fetch_page(page - 1).await? {
        items.push(c);
    }
    let response = SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages {
                Some((page + 1).try_into().unwrap())
            } else {
                None
            },
        },
    };
    let cache_id = cc
        .set_key(
            key,
            ApplicationCacheValue::UserMetadataList(response.clone()),
        )
        .await?;
    Ok(CachedResponse { cache_id, response })
}

pub async fn user_collections_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserCollectionsListResponse>> {
    let cc = &ss.cache_service;
    let cache_key = ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
        input: (),
        user_id: user_id.to_owned(),
    });
    if let Some((cache_id, response)) = cc.get_value(cache_key.clone()).await {
        return Ok(CachedResponse { cache_id, response });
    }
    let user_jsonb_build_object = PgFunc::json_build_object(vec![
        (
            Expr::val("id"),
            Expr::col((AliasedUser::Table, AliasedUser::Id)),
        ),
        (
            Expr::val("name"),
            Expr::col((AliasedUser::Table, AliasedUser::Name)),
        ),
    ]);
    let outer_collaborator = PgFunc::json_build_object(vec![
        (
            Expr::val("collaborator"),
            Expr::expr(user_jsonb_build_object.clone()),
        ),
        (
            Expr::val("extra_information"),
            Expr::col((
                AliasedUserToEntity::Table,
                AliasedUserToEntity::CollectionExtraInformation,
            )),
        ),
    ]);
    let collaborators_subquery = sea_query::Query::select()
        .from(UserToEntity)
        .expr(PgFunc::json_agg(outer_collaborator.clone()))
        .join(
            JoinType::InnerJoin,
            AliasedUser::Table,
            Expr::col((AliasedUserToEntity::Table, AliasedUserToEntity::UserId))
                .equals((AliasedUser::Table, AliasedUser::Id)),
        )
        .and_where(
            Expr::col((
                AliasedUserToEntity::Table,
                AliasedUserToEntity::CollectionId,
            ))
            .equals((AliasedCollection::Table, AliasedCollection::Id)),
        )
        .to_owned();
    let count_subquery = sea_query::Query::select()
        .expr(collection_to_entity::Column::Id.count())
        .from(CollectionToEntity)
        .and_where(
            Expr::col((
                AliasedCollectionToEntity::Table,
                AliasedCollectionToEntity::CollectionId,
            ))
            .equals((
                AliasedUserToEntity::Table,
                AliasedUserToEntity::CollectionId,
            )),
        )
        .to_owned();
    let response = Collection::find()
        .select_only()
        .column(collection::Column::Id)
        .column(collection::Column::Name)
        .column_as(
            collection::Column::Name
                .is_in(common_models::DefaultCollection::iter().map(|s| s.to_string()))
                .and(collection::Column::UserId.eq(user_id)),
            "is_default",
        )
        .column(collection::Column::InformationTemplate)
        .expr_as(
            sea_query::SimpleExpr::SubQuery(
                None,
                Box::new(count_subquery.into_sub_query_statement()),
            ),
            "count",
        )
        .expr_as(
            Func::coalesce([
                sea_query::SimpleExpr::SubQuery(
                    None,
                    Box::new(collaborators_subquery.into_sub_query_statement()),
                ),
                sea_query::SimpleExpr::FunctionCall(Func::cast_as(
                    Expr::val("[]"),
                    Alias::new("JSON"),
                )),
            ]),
            "collaborators",
        )
        .column(collection::Column::Description)
        .column_as(Expr::expr(user_jsonb_build_object), "creator")
        .order_by_desc(collection::Column::LastUpdatedOn)
        .left_join(User)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .into_model::<CollectionItem>()
        .all(&ss.db)
        .await
        .unwrap();
    let cache_id = cc
        .set_key(
            cache_key,
            ApplicationCacheValue::UserCollectionsList(response.clone()),
        )
        .await?;
    Ok(CachedResponse { cache_id, response })
}
