/**
 * Command Signing Service
 * SECURE FIX: Cryptographic signing of commands to prevent tampering
 * Prevents command injection and ensures command integrity
 */

import crypto from 'crypto';
import logger from '../utils/logger';
import agentAuthService from './agent-auth.service';
import redisService from './redis.service';
import nonceManager from './nonce-manager.service';

export interface SignedCommand {
  command: {
    type: string;
    payload?: any;
    timestamp: number;
    nonce: string;
  };
  signature: string;
  agentId: string;
}

export interface CommandValidationResult {
  valid: boolean;
  error?: string;
  command?: any;
}

/**
 * Command Signing Service
 */
export class CommandSigningService {
  /**
   * Sign a command for a specific agent
   */
  signCommand(agentId: string, commandType: string, payload?: any): SignedCommand {
    // Get agent's secret key
    const secretKey = agentAuthService.getAgentSecretKey(agentId);
    if (!secretKey) {
      throw new Error(`Cannot sign command: agent ${agentId} not found or revoked`);
    }

    // Create command with timestamp and nonce
    const nonce = crypto.randomBytes(16).toString('hex');
    const command = {
      type: commandType,
      payload,
      timestamp: Date.now(),
      nonce
    };

    // Create signature
    const message = JSON.stringify(command);
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(message)
      .digest('hex');

    logger.debug(`Command signed for ${agentId}: ${commandType}`, {
      timestamp: command.timestamp,
      nonce: command.nonce.substring(0, 8) + '...'
    });

    return {
      command,
      signature,
      agentId
    };
  }

  /**
   * Verify a signed command
   * Used by agents to verify commands from server
   */
  async verifyCommand(signedCommand: SignedCommand, secretKey: string): Promise<CommandValidationResult> {
    const { command, signature, agentId } = signedCommand;

    // Recreate signature
    const message = JSON.stringify(command);
    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(message)
      .digest('hex');

    // Verify signature using constant-time comparison
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );

      if (!isValid) {
        logger.warn(`Invalid command signature from ${agentId}`);
        return {
          valid: false,
          error: 'Invalid signature'
        };
      }
    } catch {
      return {
        valid: false,
        error: 'Signature verification failed'
      };
    }

    // Check timestamp (prevent replay attacks)
    // SECURITY FIX CVE-2026-202: Reduced to 30 seconds from 5 minutes
    const now = Date.now();
    const commandAge = now - command.timestamp;
    const MAX_AGE = 30 * 1000; // SECURITY FIX: 30 seconds (was 5 minutes)

    if (commandAge > MAX_AGE) {
      logger.warn(`Stale command received from ${agentId}`, {
        age: commandAge,
        timestamp: command.timestamp
      });
      return {
        valid: false,
        error: 'Command expired'
      };
    }

    // SECURITY FIX CVE-2026-202: Reduced clock skew tolerance from 60s to 5s
    if (command.timestamp > now + 5000) {
      logger.warn(`Future timestamp in command from ${agentId}`);
      return {
        valid: false,
        error: 'Invalid timestamp'
      };
    }

    // SECURITY FIX CVE-2026-204: Check nonce to prevent replay
    // SECURITY FIX RISK-002: Use nonce manager with Redis + memory fallback
    const nonceIsValid = await nonceManager.checkAndUseNonce(command.nonce, 600);

    if (!nonceIsValid) {
      logger.warn(`Replay attack detected - duplicate nonce from ${agentId}`);
      return {
        valid: false,
        error: 'Duplicate nonce'
      };
    }

    logger.debug(`Command verified for ${agentId}: ${command.type}`);

    return {
      valid: true,
      command
    };
  }

  /**
   * Generate admin signature for critical operations
   */
  signAdminCommand(command: any, adminSecret: string): string {
    const message = JSON.stringify({
      ...command,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    });

    return crypto
      .createHmac('sha256', adminSecret)
      .update(message)
      .digest('hex');
  }
}

export default new CommandSigningService();
