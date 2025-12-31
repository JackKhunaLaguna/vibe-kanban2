/**
 * OrchestratorDb - IndexedDB-based storage for orchestrator data
 * Provides persistent storage for conversations and messages
 */

const DB_NAME = 'orchestrator_db';
const DB_VERSION = 1;

// Store names
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';

export interface ConversationRecord {
  id: string;
  userId: string;
  projectId: string;
  createdAt: Date;
  lastMessageAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'orchestrator';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

class OrchestratorDb {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  private async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open orchestrator database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create conversations store
        if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
          const conversationsStore = db.createObjectStore(CONVERSATIONS_STORE, {
            keyPath: 'id',
          });
          conversationsStore.createIndex('projectId', 'projectId', {
            unique: false,
          });
          conversationsStore.createIndex('userId', 'userId', { unique: false });
          conversationsStore.createIndex('lastMessageAt', 'lastMessageAt', {
            unique: false,
          });
        }

        // Create messages store
        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const messagesStore = db.createObjectStore(MESSAGES_STORE, {
            keyPath: 'id',
          });
          messagesStore.createIndex('conversationId', 'conversationId', {
            unique: false,
          });
          messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
          messagesStore.createIndex(
            'conversationId_timestamp',
            ['conversationId', 'timestamp'],
            { unique: false }
          );
        }
      };
    });

    return this.initPromise;
  }

  async createConversation(
    conversation: ConversationRecord
  ): Promise<ConversationRecord> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.add(conversation);

      request.onsuccess = () => resolve(conversation);
      request.onerror = () => {
        console.error('Failed to create conversation:', request.error);
        reject(request.error);
      };
    });
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CONVERSATIONS_STORE, 'readonly');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => {
        console.error('Failed to get conversation:', request.error);
        reject(request.error);
      };
    });
  }

  async getConversationsByProject(
    projectId: string
  ): Promise<ConversationRecord[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CONVERSATIONS_STORE, 'readonly');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onsuccess = () => {
        const conversations = request.result || [];
        // Sort by lastMessageAt descending
        conversations.sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime()
        );
        resolve(conversations);
      };
      request.onerror = () => {
        console.error('Failed to get conversations by project:', request.error);
        reject(request.error);
      };
    });
  }

  async updateConversation(
    conversation: ConversationRecord
  ): Promise<ConversationRecord> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.put(conversation);

      request.onsuccess = () => resolve(conversation);
      request.onerror = () => {
        console.error('Failed to update conversation:', request.error);
        reject(request.error);
      };
    });
  }

  async createMessage(message: MessageRecord): Promise<MessageRecord> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MESSAGES_STORE, 'readwrite');
      const store = transaction.objectStore(MESSAGES_STORE);
      const request = store.add(message);

      request.onsuccess = () => resolve(message);
      request.onerror = () => {
        console.error('Failed to create message:', request.error);
        reject(request.error);
      };
    });
  }

  async getMessagesByConversation(
    conversationId: string,
    limit?: number
  ): Promise<MessageRecord[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MESSAGES_STORE, 'readonly');
      const store = transaction.objectStore(MESSAGES_STORE);
      const index = store.index('conversationId');
      const request = index.getAll(conversationId);

      request.onsuccess = () => {
        let messages = request.result || [];
        // Sort by timestamp ascending
        messages.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        // Apply limit (return last N messages)
        if (limit && messages.length > limit) {
          messages = messages.slice(-limit);
        }
        resolve(messages);
      };
      request.onerror = () => {
        console.error('Failed to get messages:', request.error);
        reject(request.error);
      };
    });
  }

  async deleteConversation(id: string): Promise<void> {
    const db = await this.init();

    // Delete all messages for this conversation first
    const messages = await this.getMessagesByConversation(id);
    for (const message of messages) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(MESSAGES_STORE, 'readwrite');
        const store = transaction.objectStore(MESSAGES_STORE);
        const request = store.delete(message.id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    // Then delete the conversation
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error('Failed to delete conversation:', request.error);
        reject(request.error);
      };
    });
  }
}

// Export singleton instance
export const orchestratorDb = new OrchestratorDb();
