import {RDS_DATABASE_TYPE} from 'bi-dwh-query-core';
import type {
    RdsDatabaseType,
    RdsParamValue,
    RdsParams,
    RdsSqlRunner,
} from 'bi-dwh-query-core';

/** Sequelize の QueryTypes.SELECT（4〜6 で同じ文字列。Sequelize を import しないため値で持つ） */
const SELECT_QUERY_TYPE = 'SELECT';

/** この実行役が Sequelize の query へ渡すオプション */
export interface SequelizeSelectOptions {
    readonly replacements?: RdsParams;
    readonly type: typeof SELECT_QUERY_TYPE;
}

/**
 * Sequelize の接続のうち、この実行役が使う部分。
 * Sequelize 4 以降のインスタンスをそのまま渡せる（Sequelize の型には依存しない）
 */
export interface SequelizeLike {
    getDialect(): string;
    query(sql: string, options: SequelizeSelectOptions): Promise<unknown>;
}

/** Sequelize の dialect ごとの RDS の種類 */
const DATABASE_TYPES: ReadonlyMap<string, RdsDatabaseType> = new Map<
    string,
    RdsDatabaseType
>([
    ['mysql', RDS_DATABASE_TYPE.MYSQL],
    ['mariadb', RDS_DATABASE_TYPE.MYSQL],
    ['postgres', RDS_DATABASE_TYPE.POSTGRES],
]);

/**
 * Sequelize の dialect から、RDS の種類を決める
 * @param dialect Sequelize の dialect
 */
const resolveDatabaseType = (dialect: string): RdsDatabaseType => {
    const databaseType = DATABASE_TYPES.get(dialect);
    if (!databaseType) {
        throw new Error(
            `Sequelize の実行役: 対応していない DB です: ${dialect}（対応: ${[
                ...DATABASE_TYPES.keys(),
            ].join(', ')}）`
        );
    }
    return databaseType;
};

/**
 * 空配列を NULL にする（配列の中の空配列も）。
 * Sequelize は空配列を空文字にするため、IN (:ids) が IN () の構文エラーになる。
 * 核の Athena への変換・TypeORM の実行役と同じく、IN (NULL)（何にも当てはまらない）にする
 * @param value 値
 */
const replaceEmptyArray = (value: RdsParamValue): RdsParamValue => {
    if (!Array.isArray(value)) {
        return value;
    }
    return value.length === 0 ? null : value.map(replaceEmptyArray);
};

/**
 * RDS のSQL実行役の Sequelize 版（MySQL / PostgreSQL）。
 * 名前付きパラメータと配列の展開（IN (:ids)）は Sequelize の replacements に任せ、空配列だけ NULL にして渡す
 */
export class SequelizeRdsSqlRunner implements RdsSqlRunner {
    readonly databaseType: RdsDatabaseType;

    private readonly connection: SequelizeLike;

    /**
     * @param connection Sequelize のインスタンス
     */
    constructor(connection: SequelizeLike) {
        this.connection = connection;
        this.databaseType = resolveDatabaseType(connection.getDialect());
    }

    /**
     * SQLを SELECT として実行して行を返す。
     * 値が無いときは replacements を付けない。空でも付けると、Sequelize が
     * SQL中のコロン（'10:30' など）を名前付きパラメータとして置き換えようとするため。
     */
    async select<Row = Record<string, unknown>>(
        sql: string,
        params: RdsParams
    ): Promise<Row[]> {
        return (await this.connection.query(sql, {
            ...(Object.keys(params).length > 0
                ? {
                      replacements: Object.fromEntries(
                          Object.entries(params).map(([name, value]) => [
                              name,
                              replaceEmptyArray(value),
                          ])
                      ),
                  }
                : {}),
            type: SELECT_QUERY_TYPE,
        })) as Row[];
    }
}
