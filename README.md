# bi-dwh-query-for-sequelize

[bi-dwh-query-core](https://github.com/two-six-code-management/bi-dwh-query-core)（BI集計の問い合わせを RDS と Amazon Athena のどちらでも実行できるようにする核）を、Sequelize で使うためのパッケージです。

- RDS のSQL実行役 `SequelizeRdsSqlRunner` を持ちます。
- 核の機能をすべて再エクスポートしています。このパッケージだけを入れれば、核の機能もここから import できます。

| 対応 | 版 |
| --- | --- |
| Sequelize | 4 以降（4 と 6 で確かめています） |
| DB | MySQL（mysql / mariadb）、PostgreSQL（postgres） |
| Node.js | 16.20 以上（ビルド・実行）。テストは 20 以上 |

## 導入

```jsonc
// package.json
{
  "dependencies": {
    "@aws-sdk/client-athena": "^3.552.0",
    "bi-dwh-query-for-sequelize": "github:two-six-code-management/bi-dwh-query-for-sequelize#v0.1.0"
  }
}
```

- GitHub のタグから入れます。`npm install` のときに `prepare` でビルドされます（核も同じです）。
- `@aws-sdk/client-athena` は、使う側で入れてください（Athena で実行するときに使います）。

## 使い方

```js
const {AthenaClient} = require('@aws-sdk/client-athena');
const {
    BI_PERIOD,
    SequelizeRdsSqlRunner,
    biSqlDate,
    createBiDataSource,
    readBiQueryConfig,
} = require('bi-dwh-query-for-sequelize');

const config = readBiQueryConfig(process.env, {
    engine: 'BI_QUERY_ENGINE',
    athenaWorkGroup: 'BI_ATHENA_WORKGROUP',
    athenaDatabase: 'BI_ATHENA_DATABASE',
    athenaCatalog: 'BI_ATHENA_CATALOG',
    rdsRetentionDays: 'BI_RDS_RETENTION_DAYS',
});

const salesBiDataSource = createBiDataSource({
    id: 'sales.aggregation',
    config,
    // Sequelize のインスタンスを渡す。DB の種類は dialect から決まる
    rdsRunner: new SequelizeRdsSqlRunner(sequelize),
    athena: {
        createClient: () => new AthenaClient({region: 'ap-northeast-1'}),
        schemaAliases: {aggregation: config.athena.database ?? ''},
    },
});

const rows = await salesBiDataSource.select({
    period: {from: '2026-10-01', to: '2026-10-31'},
    params: {from: biSqlDate('2026-10-01'), systems: ['alpha', 'beta']},
    sql: (dialect) => `
        SELECT f.system AS \`system\`, ${dialect.countIf('f.is_new')} AS \`newUsers\`
        FROM \`aggregation\`.\`access_logs\` f
        WHERE f.access_date >= :from AND f.system IN (:systems)
        GROUP BY f.system
    `,
});
```

- データソースは、使うときに初めて組み立てる（遅延させる）と、テストで差し替えやすくなります。
- SQLの書き方・実行先の決め方・Athena と PostgreSQL の注意点は、[核の README](https://github.com/two-six-code-management/bi-dwh-query-core#readme) を見てください。

## パラメータの渡し方

- 名前付きパラメータ（`:name`）と配列の展開（`IN (:ids)`・組）は、Sequelize の `replacements` に任せます。
- 空配列だけは `NULL` にして渡します。Sequelize は空配列を空文字にするため、`IN ()` の構文エラーになるからです。`IN (NULL)` は何にも当てはまりません（核の Athena への変換・TypeORM の実行役と同じです）。
- 値が無いときは `replacements` を付けません。空でも付けると、Sequelize が SQL 中のコロン（`'10:30'` など）を名前付きパラメータとして置き換えようとするためです。
- Sequelize は値をSQLへ埋め込むため、PostgreSQL でも `:x IS NULL` と書けます。

## 開発

```bash
npm install
npm run typecheck
npm test            # 単体テスト
npm run build
npm run format
```

### 結合テスト

実際の MySQL と PostgreSQL で、実行役を確かめます。方言の結果の確認は、bi-dwh-query-for-typeorm の結合テストで行っています。

```bash
docker run -d --rm --name bi-dwh-query-test-mysql -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=test -p 127.0.0.1:13307:3306 mysql:8.0
docker run -d --rm --name bi-dwh-query-test-postgres -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test -p 127.0.0.1:15433:5432 postgres:17

BI_DWH_TEST_MYSQL_URL=mysql://root:test@127.0.0.1:13307/test \
BI_DWH_TEST_POSTGRES_URL=postgres://postgres:test@127.0.0.1:15433/test \
npm run test:integration

docker stop bi-dwh-query-test-mysql bi-dwh-query-test-postgres
```

- 接続先の環境変数が無い DB のテストは skip します。
- Sequelize 4 では、結合テストと同じ内容を手元で確かめています（devDependencies には 6 だけを入れています）。

## 版の出し方

1. 核の版を上げたときは、`dependencies` の `bi-dwh-query-core` のタグを上げて `npm install` します。
2. `package.json` の `version` を上げてコミットし、`v<版>` のタグを付けてプッシュします。
