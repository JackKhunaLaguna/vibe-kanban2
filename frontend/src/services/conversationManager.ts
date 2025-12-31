/**
 * ConversationManager - Service for managing conversation history storage and retrieval
 * Bridges the chat UI and the database
 */

import {
  orchestratorDb,
  ConversationRecord,
  MessageRecord,
} from './orchestratorDb';

// Types as specified in requirements
export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'orchestrator';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface ConversationContext {
  messages: Array<{ role: string; content: string }>;
  conversationId: string;
  messageCount: number;
}

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MESSAGE_LIMIT = 50;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class ConversationManager {
  // In-memory caches for performance
  private conversationCache: Map<string, CacheEntry<ConversationRecord>> =
    new Map();
  private messagesCache: Map<string, CacheEntry<Message[]>> = new Map();
  private projectConversationCache: Map<string, CacheEntry<string | null>> =
    new Map();

  /**
   * Generate a unique ID for conversations and messages
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Check if a cache entry is still valid
   */
  private isCacheValid<T>(entry: CacheEntry<T> | undefined): boolean {
    if (!entry) return false;
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
  }

  /**
   * Invalidate cache entries for a conversation
   */
  private invalidateConversationCache(conversationId: string): void {
    this.messagesCache.delete(conversationId);
    this.conversationCache.delete(conversationId);
  }

  /**
   * Invalidate project conversation cache
   */
  private invalidateProjectCache(projectId: string): void {
    this.projectConversationCache.delete(projectId);
  }

  /**
   * Convert MessageRecord to Message interface
   */
  private toMessage(record: MessageRecord): Message {
    return {
      id: record.id,
      conversationId: record.conversationId,
      role: record.role,
      content: record.content,
      metadata: record.metadata,
      timestamp: new Date(record.timestamp),
    };
  }

  /**
   * A. startConversation - Creates new conversation in database
   * @param userId - The user ID
   * @param projectId - The project ID
   * @returns The conversation ID
   */
  async startConversation(userId: string, projectId: string): Promise<string> {
    const conversationId = this.generateId();
    const now = new Date();

    const conversation: ConversationRecord = {
      id: conversationId,
      userId,
      projectId,
      createdAt: now,
      lastMessageAt: now,
    };

    try {
      await orchestratorDb.createConversation(conversation);

      // Update caches
      this.conversationCache.set(conversationId, {
        data: conversation,
        timestamp: Date.now(),
      });
      this.invalidateProjectCache(projectId);

      return conversationId;
    } catch (error) {
      console.error('Failed to start conversation:', error);
      throw new Error(
        `Failed to start conversation: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * B. addMessage - Stores message in database and updates conversation last_message_at
   * @param conversationId - The conversation ID
   * @param role - The message role ('user' or 'orchestrator')
   * @param content - The message content
   * @param metadata - Optional metadata
   */
  async addMessage(
    conversationId: string,
    role: 'user' | 'orchestrator',
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const messageId = this.generateId();
    const now = new Date();

    const message: MessageRecord = {
      id: messageId,
      conversationId,
      role,
      content,
      metadata,
      timestamp: now,
    };

    try {
      // Create the message
      await orchestratorDb.createMessage(message);

      // Update conversation's lastMessageAt
      const conversation = await orchestratorDb.getConversation(conversationId);
      if (conversation) {
        conversation.lastMessageAt = now;
        await orchestratorDb.updateConversation(conversation);
        this.invalidateProjectCache(conversation.projectId);
      }

      // Invalidate message cache for this conversation
      this.invalidateConversationCache(conversationId);
    } catch (error) {
      console.error('Failed to add message:', error);
      throw new Error(
        `Failed to add message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * C. getConversationHistory - Retrieves recent messages
   * @param conversationId - The conversation ID
   * @param limit - Maximum number of messages to retrieve (default: 50)
   * @returns Array of messages ordered by timestamp, including metadata
   */
  async getConversationHistory(
    conversationId: string,
    limit: number = DEFAULT_MESSAGE_LIMIT
  ): Promise<Message[]> {
    // Check cache first
    const cacheKey = conversationId;
    const cached = this.messagesCache.get(cacheKey);
    if (this.isCacheValid(cached)) {
      const messages = cached!.data;
      // Apply limit to cached data
      return limit && messages.length > limit ? messages.slice(-limit) : messages;
    }

    try {
      const records = await orchestratorDb.getMessagesByConversation(
        conversationId,
        limit
      );
      const messages = records.map((r) => this.toMessage(r));

      // Update cache with full messages (without limit applied)
      this.messagesCache.set(conversationId, {
        data: messages,
        timestamp: Date.now(),
      });

      return messages;
    } catch (error) {
      console.error('Failed to get conversation history:', error);
      throw new Error(
        `Failed to get conversation history: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * D. getCurrentConversation - Gets active conversation for project
   * Creates a new one if none exists
   * @param projectId - The project ID
   * @returns The conversation ID or null
   */
  async getCurrentConversation(projectId: string): Promise<string | null> {
    // Check cache first
    const cached = this.projectConversationCache.get(projectId);
    if (this.isCacheValid(cached)) {
      return cached!.data;
    }

    try {
      const conversations =
        await orchestratorDb.getConversationsByProject(projectId);

      if (conversations.length === 0) {
        // No conversation exists - return null, caller can create one if needed
        this.projectConversationCache.set(projectId, {
          data: null,
          timestamp: Date.now(),
        });
        return null;
      }

      // Return the most recent conversation (already sorted by lastMessageAt desc)
      const latestConversationId = conversations[0].id;

      // Update cache
      this.projectConversationCache.set(projectId, {
        data: latestConversationId,
        timestamp: Date.now(),
      });

      return latestConversationId;
    } catch (error) {
      console.error('Failed to get current conversation:', error);
      throw new Error(
        `Failed to get current conversation: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * E. getContextForAI - Returns formatted context for Claude API
   * @param conversationId - The conversation ID
   * @returns ConversationContext with messages formatted for Claude API
   */
  async getContextForAI(conversationId: string): Promise<ConversationContext> {
    try {
      const messages = await this.getConversationHistory(conversationId);

      // Format messages for Claude API
      // Map 'orchestrator' role to 'assistant' for Claude API compatibility
      const formattedMessages = messages.map((msg) => ({
        role: msg.role === 'orchestrator' ? 'assistant' : msg.role,
        content: msg.content,
      }));

      return {
        messages: formattedMessages,
        conversationId,
        messageCount: messages.length,
      };
    } catch (error) {
      console.error('Failed to get context for AI:', error);
      throw new Error(
        `Failed to get context for AI: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Clear all caches - useful for testing or when data might be stale
   */
  clearCache(): void {
    this.conversationCache.clear();
    this.messagesCache.clear();
    this.projectConversationCache.clear();
  }

  /**
   * Get or create a conversation for a project
   * Convenience method that combines getCurrentConversation and startConversation
   * @param userId - The user ID
   * @param projectId - The project ID
   * @returns The conversation ID (existing or newly created)
   */
  async getOrCreateConversation(
    userId: string,
    projectId: string
  ): Promise<string> {
    const existingId = await this.getCurrentConversation(projectId);
    if (existingId) {
      return existingId;
    }
    return this.startConversation(userId, projectId);
  }
}

// Export singleton instance
export const conversationManager = new ConversationManager();

// Export class for testing purposes
export { ConversationManager };
