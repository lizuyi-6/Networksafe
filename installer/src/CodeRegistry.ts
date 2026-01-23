
export const ERROR_CODES: Record<string, number> = {
    // 10xxx: File System Errors
    'EACCES: permission denied': 10001,
    'ENOENT: no such file or directory': 10002,
    'EISDIR: illegal operation on a directory': 10003,

    // 11xxx: Network/Process Errors
    'EADDRINUSE': 11001,
    'ECONNREFUSED': 11002,
    'PORT_IN_USE': 11003,

    // 12xxx: Dependency Errors
    'MODULE_NOT_FOUND': 12001,
    'COMMAND_NOT_FOUND': 12002,
};

export const COMMAND_CODES: Record<string, number> = {
    // 20xxx: Fix Commands
    'sudo chmod 666 /etc/security/config.json': 20001,
    'sudo chown $USER /etc/security/config.json': 20002,
    'fuser -k 3000/tcp': 20003,
    'npm install': 20004,
};

export class CodeRegistry {
    /**
     * Tries to find a predefined code for an error string.
     * Logic: Checks if any known error signature is contained in the log.
     */
    static compressError(fullLog: string): { code: number } | { full: string } {
        for (const [signature, code] of Object.entries(ERROR_CODES)) {
            if (fullLog.includes(signature)) {
                return { code };
            }
        }
        return { full: fullLog };
    }

    /**
     * Tries to find a predefined code for a executed command.
     */
    static compressCommand(cmd: string): { code: number } | { full: string } {
        // Exact match for commands usually
        if (COMMAND_CODES[cmd]) {
            return { code: COMMAND_CODES[cmd] };
        }

        // Fuzzy match (simplified)
        for (const [signature, code] of Object.entries(COMMAND_CODES)) {
            if (cmd.startsWith(signature)) {
                return { code };
            }
        }

        return { full: cmd };
    }
}
