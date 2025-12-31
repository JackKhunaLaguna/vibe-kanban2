/**
 * User Preferences Service
 *
 * Learns and stores user preferences over time, enabling the orchestrator
 * to adapt to user behavior and make intelligent suggestions.
 *
 * Confidence levels:
 * - 0.0-0.4: Low confidence, always ask user
 * - 0.5-0.7: Medium confidence, suggest with explanation
 * - 0.8-1.0: High confidence, auto-execute with notification
 */

// Preference categories
export type PreferenceCategory =
  | 'branch_strategy'
  | 'testing'
  | 'review'
  | 'orchestration';

// How the preference was learned
export type LearnedFrom = 'explicit' | 'behavior';

export interface Preference {
  id: string;
  userId: string;
  category: PreferenceCategory | string;
  key: string;
  value: string;
  learnedFrom: LearnedFrom;
  confidence: number; // 0.0 to 1.0
  updatedAt: Date;
}

// Confidence level thresholds
export const CONFIDENCE_THRESHOLDS = {
  LOW_MAX: 0.4,
  MEDIUM_MAX: 0.7,
  HIGH_MIN: 0.8,
} as const;

export type ConfidenceLevel = 'low' | 'medium' | 'high';

// Decision type to preference category mapping
const DECISION_CATEGORY_MAP: Record<string, PreferenceCategory> = {
  target_branch: 'branch_strategy',
  review_required: 'branch_strategy',
  auto_create_tests: 'testing',
  test_framework: 'testing',
  auto_approve_lints: 'review',
  manual_review_typescript: 'review',
  auto_start_waves: 'orchestration',
  pause_on_error: 'orchestration',
};

// Storage key for localStorage persistence
const STORAGE_KEY = 'user_preferences';

// Generate unique ID
function generateId(): string {
  return `pref_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Clamp value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * User Preferences Service
 *
 * Manages user preferences with persistence and learning capabilities.
 * Can be extended to use orchestratorDb when available.
 */
class UserPreferencesService {
  private preferences: Map<string, Preference> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Preference[];
        for (const pref of parsed) {
          // Restore Date object
          pref.updatedAt = new Date(pref.updatedAt);
          this.preferences.set(pref.id, pref);
        }
      }
    } catch (error) {
      console.error('Failed to load preferences from storage:', error);
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const prefs = Array.from(this.preferences.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      console.error('Failed to save preferences to storage:', error);
    }
  }

  private findPreference(
    userId: string,
    category: string,
    key: string
  ): Preference | null {
    for (const pref of this.preferences.values()) {
      if (
        pref.userId === userId &&
        pref.category === category &&
        pref.key === key
      ) {
        return pref;
      }
    }
    return null;
  }

  /**
   * Retrieves a specific preference
   * @returns The preference or null if not found
   */
  getPreference(
    userId: string,
    category: string,
    key: string
  ): Preference | null {
    return this.findPreference(userId, category, key);
  }

  /**
   * Stores or updates a preference
   * @param confidence - Default: 0.5 (medium confidence)
   */
  setPreference(
    userId: string,
    category: string,
    key: string,
    value: string,
    learnedFrom: LearnedFrom,
    confidence: number = 0.5
  ): void {
    const existing = this.findPreference(userId, category, key);
    const clampedConfidence = clamp(confidence, 0, 1);

    if (existing) {
      existing.value = value;
      existing.learnedFrom = learnedFrom;
      existing.confidence = clampedConfidence;
      existing.updatedAt = new Date();
    } else {
      const newPref: Preference = {
        id: generateId(),
        userId,
        category,
        key,
        value,
        learnedFrom,
        confidence: clampedConfidence,
        updatedAt: new Date(),
      };
      this.preferences.set(newPref.id, newPref);
    }

    this.saveToStorage();
  }

  /**
   * Gets all preferences for a user, optionally filtered by category
   */
  getAllPreferences(userId: string, category?: string): Preference[] {
    const results: Preference[] = [];

    for (const pref of this.preferences.values()) {
      if (pref.userId !== userId) continue;
      if (category && pref.category !== category) continue;
      results.push(pref);
    }

    return results.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  /**
   * Updates the confidence level of a preference
   * @param delta - Amount to change confidence (positive or negative)
   */
  updateConfidence(preferenceId: string, delta: number): void {
    const pref = this.preferences.get(preferenceId);
    if (!pref) return;

    pref.confidence = clamp(pref.confidence + delta, 0, 1);
    pref.updatedAt = new Date();
    this.saveToStorage();
  }

  /**
   * Learns from a user decision and updates relevant preferences
   *
   * - If choice matches existing preference: increase confidence
   * - If choice conflicts: decrease confidence
   * - If no preference exists: create new one with default confidence
   */
  learnFromDecision(
    userId: string,
    decisionType: string,
    choice: string
  ): void {
    const category = DECISION_CATEGORY_MAP[decisionType] || 'orchestration';
    const existing = this.findPreference(userId, category, decisionType);

    if (existing) {
      if (existing.value === choice) {
        // Choice matches preference - increase confidence
        this.updateConfidence(existing.id, 0.1);
      } else {
        // Choice conflicts - decrease confidence
        this.updateConfidence(existing.id, -0.15);

        // If confidence drops too low, update the value
        if (existing.confidence < 0.3) {
          existing.value = choice;
          existing.confidence = 0.4;
          existing.updatedAt = new Date();
          this.saveToStorage();
        }
      }
    } else {
      // Create new preference from behavior
      this.setPreference(userId, category, decisionType, choice, 'behavior');
    }
  }

  // ============ Helper Functions ============

  /**
   * Gets the confidence level category for a preference
   */
  getConfidenceLevel(preference: Preference): ConfidenceLevel {
    if (preference.confidence <= CONFIDENCE_THRESHOLDS.LOW_MAX) return 'low';
    if (preference.confidence <= CONFIDENCE_THRESHOLDS.MEDIUM_MAX)
      return 'medium';
    return 'high';
  }

  /**
   * Checks if a preference should auto-execute (high confidence)
   */
  shouldAutoExecute(preference: Preference): boolean {
    return preference.confidence >= CONFIDENCE_THRESHOLDS.HIGH_MIN;
  }

  /**
   * Checks if a preference should prompt the user (low confidence)
   */
  shouldPromptUser(preference: Preference): boolean {
    return preference.confidence <= CONFIDENCE_THRESHOLDS.LOW_MAX;
  }

  /**
   * Gets the preferred value if confidence is high enough
   * @param minConfidence - Minimum confidence required (default: 0.5)
   */
  getPreferredValue(
    userId: string,
    category: string,
    key: string,
    minConfidence: number = 0.5
  ): string | null {
    const pref = this.findPreference(userId, category, key);
    if (!pref || pref.confidence < minConfidence) return null;
    return pref.value;
  }

  /**
   * Bulk set preferences from explicit user configuration
   */
  setExplicitPreferences(
    userId: string,
    preferences: Array<{
      category: string;
      key: string;
      value: string;
    }>
  ): void {
    for (const { category, key, value } of preferences) {
      // Explicit preferences start with high confidence
      this.setPreference(userId, category, key, value, 'explicit', 0.9);
    }
  }

  /**
   * Removes a specific preference
   */
  removePreference(preferenceId: string): boolean {
    const deleted = this.preferences.delete(preferenceId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  /**
   * Clears all preferences for a user
   */
  clearUserPreferences(userId: string): void {
    const toDelete: string[] = [];

    for (const [id, pref] of this.preferences) {
      if (pref.userId === userId) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.preferences.delete(id);
    }

    this.saveToStorage();
  }

  /**
   * Gets a summary of preferences by category for a user
   */
  getPreferenceSummary(
    userId: string
  ): Record<string, { count: number; avgConfidence: number }> {
    const summary: Record<string, { total: number; sum: number }> = {};

    for (const pref of this.preferences.values()) {
      if (pref.userId !== userId) continue;

      if (!summary[pref.category]) {
        summary[pref.category] = { total: 0, sum: 0 };
      }
      summary[pref.category].total++;
      summary[pref.category].sum += pref.confidence;
    }

    const result: Record<string, { count: number; avgConfidence: number }> = {};
    for (const [category, data] of Object.entries(summary)) {
      result[category] = {
        count: data.total,
        avgConfidence: data.total > 0 ? data.sum / data.total : 0,
      };
    }

    return result;
  }

  /**
   * Exports all preferences (for backup or debugging)
   */
  exportPreferences(userId?: string): Preference[] {
    if (userId) {
      return this.getAllPreferences(userId);
    }
    return Array.from(this.preferences.values());
  }

  /**
   * Imports preferences (for restore or migration)
   */
  importPreferences(preferences: Preference[], overwrite: boolean = false): void {
    for (const pref of preferences) {
      if (overwrite || !this.preferences.has(pref.id)) {
        pref.updatedAt = new Date(pref.updatedAt);
        this.preferences.set(pref.id, pref);
      }
    }
    this.saveToStorage();
  }
}

// Singleton instance
export const userPreferencesService = new UserPreferencesService();

// Export class for testing or custom instances
export { UserPreferencesService };
