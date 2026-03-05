/**
 * 路径验证中间件
 * 防止路径遍历攻击 (Path Traversal)
 */

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';

/**
 * 路径遍历防护选项
 */
export interface PathValidationOptions {
    /** 允许的根目录 */
    baseDir: string;
    /** 是否允许访问子目录 */
    allowSubdirectories?: boolean;
    /** 允许的扩展名列表 (可选) */
    allowedExtensions?: string[];
    /** 是否规范化路径 */
    normalize?: boolean;
    /** 参数名 (从 req.query 或 req.body 中获取) */
    paramName?: string;
    /** 是否必须存在 */
    mustExist?: boolean;
}

/**
 * 解析并验证路径
 */
export function resolveAndValidatePath(
    requestedPath: string,
    options: PathValidationOptions
): { valid: boolean; resolvedPath?: string; error?: string } {
    const {
        baseDir,
        allowSubdirectories = true,
        allowedExtensions,
        normalize = true,
        mustExist = false
    } = options;

    // 基础验证
    if (!requestedPath || typeof requestedPath !== 'string') {
        return { valid: false, error: 'backend.path_is_required' };
    }

    // 长度限制
    if (requestedPath.length > 4096) {
        return { valid: false, error: 'backend.path_too_long' };
    }

    // 检查路径遍历攻击特征
    const traversalPatterns = [
        /\.\.[\\\/]/,           // ../ 或 ..\
        /[\\\/]\.\.[\\\/]/,      // /../
        /%2e%2e[\\\/]/i,         // URL编码的 ../
        /%252e%252e[\\\/]/i,     // 双重URL编码
        /\x2e\x2e[\\\/]/,        // 十六进制编码
        /\.\.\.+/                // 多个点
    ];

    for (const pattern of traversalPatterns) {
        if (pattern.test(requestedPath)) {
            logger.warn(`Path traversal attempt detected: ${requestedPath}`);
            return { valid: false, error: 'backend.invalid_path_characters_detected' };
        }
    }

    // 规范化路径
    let resolvedPath: string;
    if (normalize) {
        // 先规范化，再解析为绝对路径
        const normalizedPath = path.normalize(requestedPath).replace(/\\/g, '/');
        resolvedPath = path.resolve(baseDir, normalizedPath);
    } else {
        resolvedPath = path.resolve(baseDir, requestedPath);
    }

    // 规范化基础目录
    const resolvedBase = path.resolve(baseDir);

    // 安全检查: 确保解析后的路径在允许目录内
    if (!resolvedPath.startsWith(resolvedBase)) {
        logger.warn(`Path traversal attempt: ${requestedPath} resolved to ${resolvedPath}, outside base ${resolvedBase}`);
        return { valid: false, error: 'backend.access_denied_path_outside_allowed_directory' };
    }

    // 子目录检查
    if (!allowSubdirectories) {
        const relativePath = path.relative(resolvedBase, resolvedPath);
        if (relativePath.includes(path.sep) || relativePath.includes('/')) {
            return { valid: false, error: 'backend.subdirectories_not_allowed' };
        }
    }

    // 扩展名检查
    if (allowedExtensions && allowedExtensions.length > 0) {
        const ext = path.extname(resolvedPath).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            return { valid: false, error: `File extension not allowed. Allowed: ${allowedExtensions.join(', ')}` };
        }
    }

    // 文件必须存在
    if (mustExist) {
        if (!fs.existsSync(resolvedPath)) {
            return { valid: false, error: 'backend.file_not_found' };
        }
    }

    return { valid: true, resolvedPath };
}

/**
 * Express 中间件 - 验证路径参数
 */
export function validatePath(options: PathValidationOptions) {
    const { paramName = 'path', mustExist = false } = options;

    return (req: Request, res: Response, next: NextFunction) => {
        // 从 query 或 body 获取路径
        const requestedPath = req.query[paramName] || req.body?.[paramName];

        if (!requestedPath || typeof requestedPath !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'backend.path_parameter_is_required',
                code: 'MISSING_PATH'
            });
        }

        const result = resolveAndValidatePath(requestedPath, {
            ...options,
            mustExist
        });

        if (!result.valid) {
            logger.warn(`Path validation failed: ${result.error}`, {
                path: requestedPath,
                ip: req.ip
            });

            return res.status(403).json({
                success: false,
                error: result.error,
                code: 'PATH_VALIDATION_FAILED'
            });
        }

        // 将验证后的路径附加到请求对象
        (req as any).validatedPath = result.resolvedPath;
        (req as any).validatedPathInfo = {
            original: requestedPath,
            resolved: result.resolvedPath
        };

        next();
    };
}

/**
 * 便捷方法 - 验证文件路径
 */
export function validateFilePath(baseDir: string, options: Partial<PathValidationOptions> = {}) {
    return validatePath({
        baseDir,
        allowedExtensions: options.allowedExtensions,
        mustExist: options.mustExist ?? true,
        paramName: options.paramName || 'path'
    });
}

export default {
    resolveAndValidatePath,
    validatePath,
    validateFilePath
};
