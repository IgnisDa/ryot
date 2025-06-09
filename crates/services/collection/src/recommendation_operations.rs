use async_graphql::Result;
use common_models::SearchDetails;
use common_utils::{MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS, ryot_log};
use database_models::{metadata, prelude::Metadata};
use database_utils::{ilike_sql, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CollectionRecommendationsCachedInput,
    CollectionRecommendationsInput, SearchResults,
};
use dependent_utils::{generic_metadata, update_metadata_and_notify_users};
use sea_orm::{
    ColumnTrait, DatabaseBackend, EntityTrait, FromQueryResult, ItemsAndPagesNumber,
    PaginatorTrait, QueryFilter, QuerySelect, QueryTrait, Statement,
};
use sea_query::{Condition, Expr, extension::postgres::PgExpr};

use crate::CollectionService;

pub async fn collection_recommendations(
    service: &CollectionService,
    _user_id: &String,
    input: CollectionRecommendationsInput,
) -> Result<SearchResults<String>> {
    let cc = &service.0.cache_service;
    let cache_key =
        ApplicationCacheKey::CollectionRecommendations(CollectionRecommendationsCachedInput {
            collection_id: input.collection_id.clone(),
        });
    let required_set = 'calc: {
        if let Some((_cache_id, response)) = cc.get_value(cache_key.clone()).await {
            break 'calc response;
        }
        let mut data = vec![];
        #[derive(Debug, FromQueryResult)]
        struct CustomQueryResponse {
            metadata_id: String,
        }
        let mut args = vec![input.collection_id.into()];
        args.extend(
            MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS
                .into_iter()
                .map(|s| s.into()),
        );
        let media_items = CustomQueryResponse::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT "cte"."metadata_id"
FROM "collection_to_entity" "cte"
WHERE "cte"."collection_id" = $1 AND "cte"."metadata_id" IS NOT NULL
ORDER BY RANDOM() LIMIT 10;
        "#,
            args,
        ))
        .all(&service.0.db)
        .await?;
        ryot_log!(debug, "Media items: {:?}", media_items);
        for item in media_items {
            update_metadata_and_notify_users(&item.metadata_id, &service.0).await?;
            let generic = generic_metadata(&item.metadata_id, &service.0).await?;
            data.extend(generic.suggestions);
        }
        cc.set_key(
            cache_key,
            ApplicationCacheValue::CollectionRecommendations(data.clone()),
        )
        .await?;
        data
    };
    ryot_log!(debug, "Required set: {:?}", required_set);

    let preferences = user_by_id(_user_id, &service.0).await?.preferences;
    let search = input.search.unwrap_or_default();
    let take = search
        .take
        .unwrap_or(preferences.general.list_page_size as u64);
    let page: u64 = search.page.unwrap_or(1).try_into().unwrap();

    let paginator = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .filter(metadata::Column::Id.is_in(required_set))
        .apply_if(search.query, |query, v| {
            query.filter(
                Condition::any()
                    .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(&v)))
                    .add(Expr::col(metadata::Column::Description).ilike(ilike_sql(&v))),
            )
        })
        .into_tuple::<String>()
        .paginate(&service.0.db, take);

    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;

    let items = paginator.fetch_page(page - 1).await?;

    Ok(SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: if page < number_of_pages {
                Some((page + 1).try_into().unwrap())
            } else {
                None
            },
        },
    })
}
