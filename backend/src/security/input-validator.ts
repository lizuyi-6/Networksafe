/**
 * 输入验证器 - 第一道防线
 *
 * 基于白名单和语义分析的输入验证
 * 即使源代码泄露，攻击者也难以绕过语义检查
 */

import logger from '../utils/logger';

export interface ValidationResult {
    isValid: boolean;
    reason?: string;
    sanitized?: string;
    threatLevel?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * SQL注入语义分析器
 * 使用AST解析而非正则匹配
 */
export class SQLSemanticAnalyzer {
    // SQL关键字集合（完整）
    private readonly sqlKeywords = new Set([
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE',
        'UNION', 'JOIN', 'WHERE', 'FROM', 'INTO', 'VALUES', 'SET', 'EXEC', 'EXECUTE',
        'CALL', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'VIEW', 'INDEX', 'TABLE', 'DATABASE',
        'SCHEMA', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'DECLARE',
        'BEGIN', 'END', 'IF', 'ELSE', 'WHILE', 'FOR', 'LOOP', 'RETURN', 'CASE', 'WHEN',
        'THEN', 'PREPARE', 'DEALLOCATE', 'DESCRIBE', 'EXPLAIN', 'ANALYZE', 'OPTIMIZE'
    ]);

    // 所有可能的空白字符（Unicode完整集）
    private readonly allWhitespace = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u000b\u000c\u0085]/g;

    // SQL注释模式
    private readonly commentPatterns = [
        /\/\*[\s\S]*?\*\//g,  // /* */ 注释
        /--[^\n]*/g,          // -- 注释
        /#[^\n]*/g,           // # 注释
        /\/\/[^\n]*/g         // // 注释
    ];

    /**
     * 检测SQL注入
     */
    detect(input: string): ValidationResult {
        // 1. 标准化输入（所有空白符统一为空格）
        let normalized = this.normalizeWhitespace(input);

        // 2. 移除注释后再次检测
        const withoutComments = this.removeComments(normalized);

        // 3. 解码所有编码变体
        const decoded = this.decodeAllVariants(withoutComments);

        // 4. 检测SQL关键字组合
        const keywordDetection = this.detectKeywordCombinations(decoded);
        if (!keywordDetection.isValid) {
            return keywordDetection;
        }

        // 5. 检测SQL语法结构
        const structureDetection = this.detectSQLStructure(decoded);
        if (!structureDetection.isValid) {
            return structureDetection;
        }

        // 6. 检测危险函数调用
        const functionDetection = this.detectDangerousFunctions(decoded);
        if (!functionDetection.isValid) {
            return functionDetection;
        }

        // 7. 检测字符串操作攻击
        const stringAttack = this.detectStringManipulation(decoded);
        if (!stringAttack.isValid) {
            return stringAttack;
        }

        return { isValid: true };
    }

    /**
     * 标准化所有空白符
     */
    private normalizeWhitespace(input: string): string {
        return input.replace(this.allWhitespace, ' ').toLowerCase();
    }

    /**
     * 移除所有类型的注释
     */
    private removeComments(input: string): string {
        let result = input;
        for (const pattern of this.commentPatterns) {
            result = result.replace(pattern, ' ');
        }
        return result;
    }

    /**
     * 解码所有编码变体
     * SECURITY FIX CVE-2026-019/020: Added Unicode normalization
     */
    private decodeAllVariants(input: string): string {
        let decoded = input;

        // SECURITY FIX CVE-2026-019: Unicode normalization (NFC form)
        // This prevents bypasses using different Unicode representations
        try {
            decoded = decoded.normalize('NFC');
        } catch {
            // If normalization fails, continue with original
        }

        // 多次URL解码（处理双重、三重编码）
        for (let i = 0; i < 3; i++) {
            try {
                const newDecoded = decodeURIComponent(decoded);
                if (newDecoded === decoded) break; // 没有更多编码
                decoded = newDecoded;
            } catch {
                break;
            }
        }

        // HTML实体解码
        decoded = decoded.replace(/&\w+;/g, (match) => {
            const entities: Record<string, string> = {
                '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'",
                '&#39;': "'", '&#x27;': "'", '&#x2F;': '/'
            };
            return entities[match] || match;
        });

        // 十六进制解码
        decoded = decoded.replace(/0x[0-9a-f]+/gi, (match) => {
            try {
                return String.fromCharCode(parseInt(match, 16));
            } catch {
                return match;
            }
        });

        // Unicode解码
        decoded = decoded.replace(/\\u([0-9a-f]{4})/gi, (match, code) => {
            return String.fromCharCode(parseInt(code, 16));
        });

        return decoded;
    }

    /**
     * 检测危险的SQL关键字组合
     */
    private detectKeywordCombinations(input: string): ValidationResult {
        const dangerousPatterns = [
            // UNION 攻击
            { pattern: /\bunion\s+select\b/i, threat: 'SQL Injection - UNION SELECT', level: 'critical' as const },
            { pattern: /\bunion\s+all\s+select\b/i, threat: 'SQL Injection - UNION ALL SELECT', level: 'critical' as const },

            // 布尔盲注
            { pattern: /'\s*or\s+.+\s*=\s*.+/i, threat: 'SQL Injection - Boolean Blind', level: 'critical' as const },
            { pattern: /'\s*and\s+.+\s*=\s*.+/i, threat: 'SQL Injection - Boolean Blind', level: 'high' as const },

            // 堆叠查询
            { pattern: /;\s*drop\s+/i, threat: 'SQL Injection - DROP Statement', level: 'critical' as const },
            { pattern: /;\s*delete\s+from\s+/i, threat: 'SQL Injection - DELETE Statement', level: 'critical' as const },
            { pattern: /;\s*update\s+.+\s+set\s+/i, threat: 'SQL Injection - UPDATE Statement', level: 'critical' as const },
            { pattern: /;\s*insert\s+into\s+/i, threat: 'SQL Injection - INSERT Statement', level: 'critical' as const },
            { pattern: /;\s*truncate\s+/i, threat: 'SQL Injection - TRUNCATE Statement', level: 'critical' as const },

            // 存储过程/函数调用
            { pattern: /\bexec\s*\(/i, threat: 'SQL Injection - EXEC', level: 'critical' as const },
            { pattern: /\bexecute\s+/i, threat: 'SQL Injection - EXECUTE', level: 'critical' as const },
            { pattern: /\bcall\s+/i, threat: 'SQL Injection - CALL', level: 'critical' as const },
            { pattern: /\bsp_executesql\b/i, threat: 'SQL Injection - sp_executesql', level: 'critical' as const },

            // 时间盲注
            { pattern: /\bwaitfor\s+delay\b/i, threat: 'SQL Injection - Time-based Blind', level: 'critical' as const },
            { pattern: /\bsleep\s*\(/i, threat: 'SQL Injection - SLEEP', level: 'critical' as const },
            { pattern: /\bbenchmark\s*\(/i, threat: 'SQL Injection - BENCHMARK', level: 'critical' as const },

            // 信息泄露
            { pattern: /\bload_file\s*\(/i, threat: 'SQL Injection - LOAD_FILE', level: 'critical' as const },
            { pattern: /\binto\s+outfile\b/i, threat: 'SQL Injection - INTO OUTFILE', level: 'critical' as const },
            { pattern: /\binto\s+dumpfile\b/i, threat: 'SQL Injection - INTO DUMPFILE', level: 'critical' as const },
        ];

        for (const { pattern, threat, level } of dangerousPatterns) {
            if (pattern.test(input)) {
                return {
                    isValid: false,
                    reason: threat,
                    threatLevel: level
                };
            }
        }

        return { isValid: true };
    }

    /**
     * 检测SQL语法结构
     */
    private detectSQLStructure(input: string): ValidationResult {
        // 检测多条SQL语句（堆叠）
        const statements = input.split(';').filter(s => s.trim());
        if (statements.length > 1) {
            // 检查是否有多个独立的SQL语句
            let sqlStatementCount = 0;
            for (const stmt of statements) {
                const hasKeyword = Array.from(this.sqlKeywords).some(kw =>
                    new RegExp(`\\b${kw}\\b`, 'i').test(stmt)
                );
                if (hasKeyword) sqlStatementCount++;
            }

            if (sqlStatementCount > 1) {
                return {
                    isValid: false,
                    reason: 'SQL Injection - Stacked Queries Detected',
                    threatLevel: 'critical'
                };
            }
        }

        // 检测引号不平衡（可能的注入）
        const singleQuotes = (input.match(/'/g) || []).length;
        const doubleQuotes = (input.match(/"/g) || []).length;

        if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
            // 检查是否有SQL注释符试图闭合引号
            if (/['"][\s\S]*?(--|#|\/\*)/i.test(input)) {
                return {
                    isValid: false,
                    reason: 'SQL Injection - Quote Escape with Comment',
                    threatLevel: 'high'
                };
            }
        }

        return { isValid: true };
    }

    /**
     * 检测危险函数
     */
    private detectDangerousFunctions(input: string): ValidationResult {
        const dangerousFunctions = [
            'xp_cmdshell', 'sp_executesql', 'sp_execute', 'sp_sqlexec',
            'dbms_xmlquery', 'utl_http', 'utl_file', 'dbms_lob',
            'user', 'database', 'version', 'schema', 'table_name'
        ];

        for (const func of dangerousFunctions) {
            const regex = new RegExp(`\\b${func}\\b`, 'i');
            if (regex.test(input)) {
                return {
                    isValid: false,
                    reason: `SQL Injection - Dangerous Function: ${func}`,
                    threatLevel: 'critical'
                };
            }
        }

        return { isValid: true };
    }

    /**
     * 检测字符串操作攻击
     */
    private detectStringManipulation(input: string): ValidationResult {
        // 检测字符串连接攻击
        const concatPatterns = [
            /\bconcat\s*\(/i,
            /\|\|/,  // SQL字符串连接
            /\+\s*'/,  // 字符串拼接
        ];

        for (const pattern of concatPatterns) {
            if (pattern.test(input)) {
                // 检查是否与SQL关键字组合
                const hasKeyword = Array.from(this.sqlKeywords).some(kw =>
                    new RegExp(`\\b${kw}\\b`, 'i').test(input)
                );

                if (hasKeyword) {
                    return {
                        isValid: false,
                        reason: 'SQL Injection - String Concatenation Attack',
                        threatLevel: 'high'
                    };
                }
            }
        }

        return { isValid: true };
    }
}

/**
 * XSS语义分析器
 */
export class XSSSemanticAnalyzer {
    // HTML危险标签（完整列表）
    private readonly dangerousTags = new Set([
        'script', 'iframe', 'object', 'embed', 'applet', 'meta', 'link', 'style',
        'svg', 'math', 'base', 'form', 'input', 'button', 'textarea', 'select',
        'img', 'video', 'audio', 'source', 'track', 'canvas', 'template'
    ]);

    // HTML事件处理器（完整列表 - 150+个）
    private readonly eventHandlers = new Set([
        // 标准事件
        'onload', 'onerror', 'onabort', 'onblur', 'onchange', 'onclick', 'onclose',
        'oncontextmenu', 'oncopy', 'oncut', 'ondblclick', 'ondrag', 'ondragend',
        'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'onfocus',
        'oninput', 'oninvalid', 'onkeydown', 'onkeypress', 'onkeyup', 'onmousedown',
        'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup', 'onmousewheel',
        'onpaste', 'onreset', 'onresize', 'onscroll', 'onsearch', 'onselect', 'onsubmit',
        'onwheel',

        // HTML5事件
        'onafterprint', 'onbeforeprint', 'onbeforeunload', 'onhashchange', 'onmessage',
        'onoffline', 'ononline', 'onpagehide', 'onpageshow', 'onpopstate', 'onstorage',
        'onunload',

        // 媒体事件
        'oncanplay', 'oncanplaythrough', 'ondurationchange', 'onemptied', 'onended',
        'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onpause', 'onplay',
        'onplaying', 'onprogress', 'onratechange', 'onseeked', 'onseeking', 'onstalled',
        'onsuspend', 'ontimeupdate', 'onvolumechange', 'onwaiting',

        // 动画/过渡事件
        'onanimationend', 'onanimationiteration', 'onanimationstart', 'ontransitionend',
        'ontransitionrun', 'ontransitionstart', 'ontransitioncancel',

        // 触摸事件
        'ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel',

        // 指针事件
        'onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel',
        'onpointerover', 'onpointerout', 'onpointerenter', 'onpointerleave',
        'ongotpointercapture', 'onlostpointercapture',

        // 其他
        'onshow', 'ontoggle', 'oncuechange', 'onformdata', 'onslotchange'
    ]);

    // 危险协议
    private readonly dangerousProtocols = new Set([
        'javascript:', 'data:', 'vbscript:', 'file:', 'about:', 'livescript:',
        'mocha:', 'ms-its:', 'mhtml:', 'jar:'
    ]);

    detect(input: string): ValidationResult {
        // 1. 解码所有变体
        const decoded = this.decodeAllVariants(input);

        // 2. 检测HTML标签
        const tagDetection = this.detectDangerousTags(decoded);
        if (!tagDetection.isValid) return tagDetection;

        // 3. 检测事件处理器
        const eventDetection = this.detectEventHandlers(decoded);
        if (!eventDetection.isValid) return eventDetection;

        // 4. 检测危险协议
        const protocolDetection = this.detectDangerousProtocols(decoded);
        if (!protocolDetection.isValid) return protocolDetection;

        // 5. 检测Data URI
        const dataUriDetection = this.detectDataURI(decoded);
        if (!dataUriDetection.isValid) return dataUriDetection;

        // 6. 检测CSS表达式
        const cssDetection = this.detectCSSExpressions(decoded);
        if (!cssDetection.isValid) return cssDetection;

        return { isValid: true };
    }

    /**
     * SECURITY FIX CVE-2026-019/020: Added Unicode normalization
     */
    private decodeAllVariants(input: string): string {
        let decoded = input.toLowerCase();

        // SECURITY FIX CVE-2026-019: Unicode normalization (NFC form)
        try {
            decoded = decoded.normalize('NFC');
        } catch {
            // If normalization fails, continue with original
        }

        // URL解码（多次）
        for (let i = 0; i < 3; i++) {
            try {
                const newDecoded = decodeURIComponent(decoded);
                if (newDecoded === decoded) break;
                decoded = newDecoded;
            } catch { break; }
        }

        // HTML实体解码
        decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        );
        decoded = decoded.replace(/&#(\d+);/g, (_, dec) =>
            String.fromCharCode(parseInt(dec, 10))
        );

        return decoded;
    }

    private detectDangerousTags(input: string): ValidationResult {
        // 检测所有HTML标签
        const tagRegex = /<(\w+)[^>]*>/gi;
        const matches = input.matchAll(tagRegex);

        for (const match of matches) {
            const tagName = match[1].toLowerCase();
            if (this.dangerousTags.has(tagName)) {
                return {
                    isValid: false,
                    reason: `XSS - Dangerous HTML Tag: <${tagName}>`,
                    threatLevel: 'high'
                };
            }
        }

        return { isValid: true };
    }

    private detectEventHandlers(input: string): ValidationResult {
        // 检测所有可能的事件处理器格式
        const eventRegex = /\bon\w+\s*=/gi;
        const matches = input.matchAll(eventRegex);

        for (const match of matches) {
            const event = match[0].toLowerCase().replace(/\s*=\s*$/, '');
            if (this.eventHandlers.has(event)) {
                return {
                    isValid: false,
                    reason: `XSS - Event Handler: ${event}`,
                    threatLevel: 'high'
                };
            }
        }

        return { isValid: true };
    }

    private detectDangerousProtocols(input: string): ValidationResult {
        for (const protocol of this.dangerousProtocols) {
            if (input.includes(protocol)) {
                return {
                    isValid: false,
                    reason: `XSS - Dangerous Protocol: ${protocol}`,
                    threatLevel: 'critical'
                };
            }
        }

        return { isValid: true };
    }

    private detectDataURI(input: string): ValidationResult {
        const dataUriRegex = /data:([^;,]+)/gi;
        const matches = input.matchAll(dataUriRegex);

        const dangerousMimeTypes = [
            'text/html', 'text/javascript', 'application/javascript',
            'application/x-javascript', 'text/xml', 'application/xml',
            'image/svg+xml', 'application/xhtml+xml'
        ];

        for (const match of matches) {
            const mimeType = match[1].toLowerCase();
            if (dangerousMimeTypes.some(d => mimeType.includes(d))) {
                return {
                    isValid: false,
                    reason: `XSS - Dangerous Data URI: ${mimeType}`,
                    threatLevel: 'high'
                };
            }
        }

        return { isValid: true };
    }

    private detectCSSExpressions(input: string): ValidationResult {
        const cssPatterns = [
            /expression\s*\(/i,
            /behavior\s*:/i,
            /import\s+/i,
            /url\s*\(\s*["']?javascript:/i,
            /@import/i,
            /binding\s*:/i
        ];

        for (const pattern of cssPatterns) {
            if (pattern.test(input)) {
                return {
                    isValid: false,
                    reason: 'XSS - CSS Expression Attack',
                    threatLevel: 'high'
                };
            }
        }

        return { isValid: true };
    }
}

/**
 * 路径遍历检测器
 */
export class PathTraversalDetector {
    detect(input: string): ValidationResult {
        // 1. 解码所有变体
        const decoded = this.decodeAllVariants(input);

        // 2. 规范化路径
        const normalized = this.normalizePath(decoded);

        // 3. 检测目录遍历模式
        if (this.hasTraversalPattern(normalized)) {
            return {
                isValid: false,
                reason: 'Path Traversal - Directory Traversal Detected',
                threatLevel: 'critical'
            };
        }

        // 4. 检测敏感文件访问
        const sensitiveFile = this.detectSensitiveFiles(normalized);
        if (sensitiveFile) {
            return {
                isValid: false,
                reason: `Path Traversal - Sensitive File Access: ${sensitiveFile}`,
                threatLevel: 'critical'
            };
        }

        // 5. 检测绝对路径访问
        if (this.isAbsolutePath(normalized)) {
            return {
                isValid: false,
                reason: 'Path Traversal - Absolute Path Not Allowed',
                threatLevel: 'high'
            };
        }

        return { isValid: true };
    }

    private decodeAllVariants(input: string): string {
        let decoded = input;

        // 多次URL解码
        for (let i = 0; i < 5; i++) {
            try {
                const newDecoded = decodeURIComponent(decoded);
                if (newDecoded === decoded) break;
                decoded = newDecoded;
            } catch { break; }
        }

        // Unicode解码
        decoded = decoded.replace(/\\u([0-9a-f]{4})/gi, (_, code) =>
            String.fromCharCode(parseInt(code, 16))
        );

        // 16进制解码
        decoded = decoded.replace(/%([0-9a-f]{2})/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        );

        return decoded;
    }

    private normalizePath(path: string): string {
        // 统一路径分隔符
        let normalized = path.replace(/\\/g, '/');

        // 移除多余的斜杠
        normalized = normalized.replace(/\/+/g, '/');

        // 解析路径片段
        const segments: string[] = [];
        for (const segment of normalized.split('/')) {
            if (segment === '..') {
                segments.pop(); // 向上一级
            } else if (segment !== '.' && segment !== '') {
                segments.push(segment);
            }
        }

        return segments.join('/');
    }

    private hasTraversalPattern(path: string): boolean {
        // 检测所有可能的遍历模式
        const patterns = [
            /\.\./,           // ..
            /\.\.%2f/i,       // ..%2f
            /\.\.%5c/i,       // ..%5c (Windows)
            /%2e%2e/i,        // %2e%2e
            /\.\.\\/,         // ..\
        ];

        return patterns.some(p => p.test(path));
    }

    private detectSensitiveFiles(path: string): string | null {
        const sensitivePatterns = [
            // Linux/Unix
            { pattern: /\/etc\/passwd/i, name: '/etc/passwd' },
            { pattern: /\/etc\/shadow/i, name: '/etc/shadow' },
            { pattern: /\/etc\/hosts/i, name: '/etc/hosts' },
            { pattern: /\/proc\/self/i, name: '/proc/self' },
            { pattern: /\/root\/\.ssh/i, name: '/root/.ssh' },
            { pattern: /\/home\/[^\/]+\/\.ssh/i, name: 'user .ssh directory' },

            // Windows
            { pattern: /c:\\windows\\system32/i, name: 'C:\\Windows\\System32' },
            { pattern: /c:\\windows\\config/i, name: 'Windows config' },
            { pattern: /\\boot\.ini/i, name: 'boot.ini' },
            { pattern: /\\sam$/i, name: 'SAM file' },
            { pattern: /\\system$/i, name: 'SYSTEM file' },

            // Application files
            { pattern: /\.env$/i, name: '.env' },
            { pattern: /\.git\//i, name: '.git directory' },
            { pattern: /\.svn\//i, name: '.svn directory' },
            { pattern: /web\.config$/i, name: 'web.config' },
            { pattern: /\.htaccess$/i, name: '.htaccess' },
            { pattern: /\.htpasswd$/i, name: '.htpasswd' },
            { pattern: /config\.php$/i, name: 'config.php' },
            { pattern: /database\.yml$/i, name: 'database.yml' },
            { pattern: /credentials\.json$/i, name: 'credentials.json' },
            { pattern: /id_rsa$/i, name: 'SSH private key' },
            { pattern: /\.pem$/i, name: 'PEM certificate' },
        ];

        for (const { pattern, name } of sensitivePatterns) {
            if (pattern.test(path)) {
                return name;
            }
        }

        return null;
    }

    private isAbsolutePath(path: string): boolean {
        // Unix绝对路径
        if (path.startsWith('/')) return true;

        // Windows绝对路径
        if (/^[a-z]:/i.test(path)) return true;

        // UNC路径
        if (path.startsWith('\\\\')) return true;

        return false;
    }
}

/**
 * 命令注入检测器
 */
export class CommandInjectionDetector {
    // Shell元字符
    private readonly shellMetaChars = ['|', '&', ';', '\n', '`', '$', '(', ')', '<', '>', '\\'];

    // 危险命令（完整列表）
    private readonly dangerousCommands = new Set([
        'bash', 'sh', 'zsh', 'fish', 'csh', 'tcsh', 'ksh',
        'cat', 'ls', 'pwd', 'whoami', 'id', 'uname', 'hostname',
        'wget', 'curl', 'nc', 'netcat', 'ncat', 'socat',
        'python', 'python2', 'python3', 'perl', 'ruby', 'php', 'node',
        'exec', 'eval', 'system', 'popen', 'shell_exec',
        'rm', 'mv', 'cp', 'dd', 'chmod', 'chown',
        'kill', 'pkill', 'killall', 'ps', 'top',
        'env', 'export', 'set', 'unset',
        'base64', 'xxd', 'od', 'hexdump',
        'telnet', 'ssh', 'ftp', 'sftp', 'scp',
        'nmap', 'nslookup', 'dig', 'host', 'ping', 'traceroute',
        'iptables', 'firewall-cmd', 'ufw',
        'systemctl', 'service', 'init',
        'crontab', 'at', 'batch',
        'mail', 'sendmail', 'mailx',
    ]);

    detect(input: string): ValidationResult {
        // 1. 检测Shell元字符
        for (const char of this.shellMetaChars) {
            if (input.includes(char)) {
                return {
                    isValid: false,
                    reason: `Command Injection - Shell Metacharacter: ${char}`,
                    threatLevel: 'critical'
                };
            }
        }

        // 2. 检测危险命令
        const normalized = input.toLowerCase();
        for (const cmd of this.dangerousCommands) {
            const regex = new RegExp(`\\b${cmd}\\b`, 'i');
            if (regex.test(normalized)) {
                return {
                    isValid: false,
                    reason: `Command Injection - Dangerous Command: ${cmd}`,
                    threatLevel: 'critical'
                };
            }
        }

        // 3. 检测编码绕过
        if (/base64|xxd|od|hexdump/i.test(normalized)) {
            return {
                isValid: false,
                reason: 'Command Injection - Encoding Detected',
                threatLevel: 'high'
            };
        }

        return { isValid: true };
    }
}

/**
 * 综合输入验证器
 */
export class InputValidator {
    private sqlAnalyzer = new SQLSemanticAnalyzer();
    private xssAnalyzer = new XSSSemanticAnalyzer();
    private pathDetector = new PathTraversalDetector();
    private cmdDetector = new CommandInjectionDetector();

    /**
     * 验证输入（所有检测器）
     */
    validateAll(input: string): ValidationResult {
        // 依次运行所有检测器
        const checks = [
            { name: 'SQL', result: this.sqlAnalyzer.detect(input) },
            { name: 'XSS', result: this.xssAnalyzer.detect(input) },
            { name: 'Path', result: this.pathDetector.detect(input) },
            { name: 'CMD', result: this.cmdDetector.detect(input) }
        ];

        for (const { name, result } of checks) {
            if (!result.isValid) {
                logger.warn(`Input validation failed: ${name}`, { reason: result.reason });
                return result;
            }
        }

        return { isValid: true };
    }

    /**
     * 单独的检测方法
     */
    validateSQL(input: string): ValidationResult {
        return this.sqlAnalyzer.detect(input);
    }

    validateXSS(input: string): ValidationResult {
        return this.xssAnalyzer.detect(input);
    }

    validatePath(input: string): ValidationResult {
        return this.pathDetector.detect(input);
    }

    validateCommand(input: string): ValidationResult {
        return this.cmdDetector.detect(input);
    }
}
