/**
 * Sequelize の実行役のテスト。Sequelize の接続は、記録するだけの偽物にする。
 * 実際の DB での確認は src/integration にある。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {RDS_DATABASE_TYPE, RdsQueryEngine, biSqlDate} from 'bi-dwh-query-core';
import {defineBiQueryEngineContract} from 'bi-dwh-query-core/testing';

import {SequelizeRdsSqlRunner} from './SequelizeRdsSqlRunner.js';
import type {
    SequelizeLike,
    SequelizeSelectOptions,
} from './SequelizeRdsSqlRunner.js';

const ROWS = Object.freeze([{users: 1}]);

const createConnection = (
    dialect = 'mysql',
    result: unknown = ROWS
): {
    connection: SequelizeLike;
    calls: Array<{sql: string; options: SequelizeSelectOptions}>;
} => {
    const calls: Array<{sql: string; options: SequelizeSelectOptions}> = [];
    return {
        calls,
        connection: {
            getDialect: () => dialect,
            query: async (sql, options) => {
                calls.push({sql, options});
                if (result instanceof Error) {
                    throw result;
                }
                return result;
            },
        },
    };
};

test('DB の種類を Sequelize の dialect から決める', () => {
    [
        ['mysql', RDS_DATABASE_TYPE.MYSQL],
        ['mariadb', RDS_DATABASE_TYPE.MYSQL],
        ['postgres', RDS_DATABASE_TYPE.POSTGRES],
    ].forEach(([dialect, expected]) =>
        assert.equal(
            new SequelizeRdsSqlRunner(
                createConnection(dialect as string).connection
            ).databaseType,
            expected,
            dialect
        )
    );
});

test('対応していない DB は、作るときに例外にする', () => {
    assert.throws(
        () => new SequelizeRdsSqlRunner(createConnection('mssql').connection),
        /mssql/
    );
});

test('値を replacements として渡し、SELECT として実行して行を返す', async () => {
    const {connection, calls} = createConnection();

    const rows = await new SequelizeRdsSqlRunner(connection).select(
        'SELECT * FROM t WHERE d >= :from',
        {from: '2026-10-01', ids: ['a']}
    );

    assert.deepEqual(rows, ROWS);
    assert.deepEqual(calls, [
        {
            sql: 'SELECT * FROM t WHERE d >= :from',
            options: {
                replacements: {from: '2026-10-01', ids: ['a']},
                type: 'SELECT',
            },
        },
    ]);
});

test('空配列は NULL にして渡す（Sequelize は空配列を空文字にし、IN () の構文エラーになるため）', async () => {
    const {connection, calls} = createConnection();

    await new SequelizeRdsSqlRunner(connection).select(
        'SELECT * FROM t WHERE s IN (:none) AND (n, s) IN (:pairs)',
        {none: [], pairs: [[1, 'x'], []]}
    );

    assert.deepEqual(calls[0]?.options.replacements, {
        none: null,
        pairs: [[1, 'x'], null],
    });
});

test('値が無いときは replacements を付けない（Sequelize が SQL 中のコロンを置き換えようとしないように）', async () => {
    const {connection, calls} = createConnection();

    await new SequelizeRdsSqlRunner(connection).select("SELECT '10:30'", {});

    assert.deepEqual(calls[0]?.options, {type: 'SELECT'});
});

test('RDS の実行エンジンに渡すと、DB の種類の方言になり、型付きの値は素の値で渡る', async () => {
    const {connection, calls} = createConnection('postgres');
    const engine = new RdsQueryEngine({
        runner: new SequelizeRdsSqlRunner(connection),
    });

    await engine.select('SELECT 1 WHERE d >= :from', {
        from: biSqlDate('2026-10-01'),
    });

    assert.equal(engine.dialect.booleanLiteral(true), 'TRUE');
    assert.deepEqual(calls[0]?.options.replacements, {from: '2026-10-01'});
});

defineBiQueryEngineContract('SequelizeRdsSqlRunner', {
    createReturning: (rows) =>
        new RdsQueryEngine({
            runner: new SequelizeRdsSqlRunner(
                createConnection('mysql', rows).connection
            ),
        }),
    createFailing: (error) =>
        new RdsQueryEngine({
            runner: new SequelizeRdsSqlRunner(
                createConnection('mysql', error).connection
            ),
        }),
});
