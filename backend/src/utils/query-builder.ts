/**
 * 安全查询构建器
 * 防止SQL注入攻击
 */

import logger from './logger';

export interface QueryConditions {
    [key: string]: any;
}

export interface OrderBy {
    column: string;
    direction?: 'ASC' | 'DESC';
}

export interface QueryResult<Row = any> {
    rows: Row[];
}

export interface QueryExecutor {
    query(sql: string, values?: any[]): Promise<QueryResult>;
}

export class QueryBuilder {
    private pool: QueryExecutor;
    private table: string;
    private selectColumns: string[] = ['*'];
    private conditions: string[] = [];
    private values: any[] = [];
    private orderByClauses: string[] = [];
    private limitValue?: number;
    private offsetValue?: number;
    private paramIndex: number = 1;

    constructor(pool: QueryExecutor, table: string) {
        this.pool = pool;
        this.table = this.sanitizeIdentifier(table);
    }

    /**
     * 选择列
     */
    select(columns: string[]): this {
        this.selectColumns = columns.map(col => this.sanitizeIdentifier(col));
        return this;
    }

    /**
     * 添加 WHERE 条件 (AND)
     */
    where(column: string, operator: string, value: any): this {
        const safeColumn = this.sanitizeIdentifier(column);
        const safeOperator = this.sanitizeOperator(operator);

        this.conditions.push(`${safeColumn} ${safeOperator} $${this.paramIndex}`);
        this.values.push(value);
        this.paramIndex++;

        return this;
    }

    /**
     * 添加 WHERE 条件 (OR)
     */
    orWhere(column: string, operator: string, value: any): this {
        const safeColumn = this.sanitizeIdentifier(column);
        const safeOperator = this.sanitizeOperator(operator);

        if (this.conditions.length > 0) {
            this.conditions.push(`OR ${safeColumn} ${safeOperator} $${this.paramIndex}`);
        } else {
            this.conditions.push(`${safeColumn} ${safeOperator} $${this.paramIndex}`);
        }
        this.values.push(value);
        this.paramIndex++;

        return this;
    }

    /**
     * WHERE IN 条件
     */
    whereIn(column: string, values: any[]): this {
        if (!values.length) {
            throw new Error('whereIn requires at least one value');
        }

        const safeColumn = this.sanitizeIdentifier(column);
        const placeholders = values.map(() => `$${this.paramIndex++}`).join(', ');

        this.conditions.push(`${safeColumn} IN (${placeholders})`);
        this.values.push(...values);

        return this;
    }

    /**
     * WHERE NULL 条件
     */
    whereNull(column: string): this {
        const safeColumn = this.sanitizeIdentifier(column);
        this.conditions.push(`${safeColumn} IS NULL`);
        return this;
    }

    /**
     * WHERE NOT NULL 条件
     */
    whereNotNull(column: string): this {
        const safeColumn = this.sanitizeIdentifier(column);
        this.conditions.push(`${safeColumn} IS NOT NULL`);
        return this;
    }

    /**
     * LIKE 条件 (自动转义通配符)
     */
    whereLike(column: string, pattern: string): this {
        const safeColumn = this.sanitizeIdentifier(column);
        // 转义 LIKE 中的特殊字符
        const escapedPattern = pattern.replace(/([%_\\])/g, '\\$1');

        this.conditions.push(`${safeColumn} LIKE $${this.paramIndex}`);
        this.values.push(escapedPattern);
        this.paramIndex++;

        return this;
    }

    /**
     * 排序
     */
    orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
        const safeColumn = this.sanitizeIdentifier(column);
        const safeDirection = direction === 'DESC' ? 'DESC' : 'ASC';

        this.orderByClauses.push(`${safeColumn} ${safeDirection}`);
        return this;
    }

    /**
     * 限制返回数量
     */
    limit(count: number): this {
        if (!Number.isInteger(count) || count < 0) {
            throw new Error('Limit must be a non-negative integer');
        }
        this.limitValue = count;
        return this;
    }

    /**
     * 偏移量
     */
    offset(count: number): this {
        if (!Number.isInteger(count) || count < 0) {
            throw new Error('Offset must be a non-negative integer');
        }
        this.offsetValue = count;
        return this;
    }

    /**
     * 构建并执行查询
     */
    async execute(): Promise<QueryResult> {
        const sql = this.buildQuery();

        try {
            logger.debug('Executing query', { sql: sql.substring(0, 500) });
            const result = await this.pool.query(sql, this.values);
            return result;
        } catch (error: any) {
            logger.error('Query execution failed', { error: error.message, sql });
            throw error;
        }
    }

    /**
     * 获取单个结果
     */
    async first(): Promise<any | null> {
        this.limit(1);
        const result = await this.execute();
        return result.rows[0] || null;
    }

    /**
     * 获取所有结果
     */
    async get(): Promise<any[]> {
        const result = await this.execute();
        return result.rows;
    }

    /**
     * 获取计数
     */
    async count(): Promise<number> {
        const result = await this.pool.query(
            `SELECT COUNT(*) FROM ${this.table}`,
            []
        );
        return parseInt(result.rows[0].count, 10);
    }

    /**
     * 构建SQL查询字符串
     */
    private buildQuery(): string {
        let sql = `SELECT ${this.selectColumns.join(', ')} FROM ${this.table}`;

        if (this.conditions.length > 0) {
            sql += ' WHERE ' + this.conditions.join(' AND ');
        }

        if (this.orderByClauses.length > 0) {
            sql += ' ORDER BY ' + this.orderByClauses.join(', ');
        }

        if (this.limitValue !== undefined) {
            sql += ` LIMIT ${this.limitValue}`;
        }

        if (this.offsetValue !== undefined) {
            sql += ` OFFSET ${this.offsetValue}`;
        }

        return sql;
    }

    /**
     * 净化标识符 (表名、列名)
     */
    private sanitizeIdentifier(identifier: string): string {
        // 只允许字母数字和下划线
        const safePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
        if (!safePattern.test(identifier)) {
            throw new Error(`Invalid identifier: ${identifier}`);
        }
        return identifier;
    }

    /**
     * 净化操作符
     */
    private sanitizeOperator(operator: string): string {
        const allowedOperators = ['=', '!=', '<>', '<', '>', '<=', '>=', 'LIKE', 'ILIKE', 'NOT LIKE', 'NOT ILIKE', 'IN', 'NOT IN', 'IS', 'IS NOT'];
        const upperOp = operator.toUpperCase();
        if (!allowedOperators.includes(upperOp)) {
            throw new Error(`Invalid operator: ${operator}`);
        }
        return upperOp;
    }
}

export default QueryBuilder;
