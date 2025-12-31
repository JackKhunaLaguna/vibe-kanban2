import { useState, useCallback } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { defineModal } from '@/lib/modals';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { TaskBreakdownList, type TaskBreakdownItem } from './TaskBreakdownList';

// Maximum number of refinement iterations allowed
const MAX_REFINEMENTS = 5;

// Types for conversation history tracking
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RefinementHistoryEntry {
  iteration: number;
  feedback: string;
  breakdown: TaskBreakdownItem[];
}

// Props for the modal
export interface FeatureCreatorModalProps {
  projectId: string;
  onGenerateTasks: (
    userInput: string,
    conversationHistory: ConversationMessage[]
  ) => Promise<TaskBreakdownItem[]>;
  onCreateTasks: (tasks: TaskBreakdownItem[]) => Promise<void>;
}

// Modal state enum
type ModalState = 'input' | 'generating' | 'review';

const FeatureCreatorModalImpl = NiceModal.create<FeatureCreatorModalProps>(
  ({ onGenerateTasks, onCreateTasks }) => {
    const modal = useModal();

    // Modal state
    const [state, setState] = useState<ModalState>('input');

    // User input for initial feature description
    const [featureInput, setFeatureInput] = useState('');

    // Current task breakdown
    const [breakdown, setBreakdown] = useState<TaskBreakdownItem[]>([]);

    // Refinement state
    const [refinementCount, setRefinementCount] = useState(0);
    const [refinementFeedback, setRefinementFeedback] = useState('');
    const [refinementHistory, setRefinementHistory] = useState<
      RefinementHistoryEntry[]
    >([]);

    // Conversation history for context-aware generation
    const [conversationHistory, setConversationHistory] = useState<
      ConversationMessage[]
    >([]);

    // Error state
    const [error, setError] = useState<string | null>(null);

    // Loading state for create tasks
    const [isCreating, setIsCreating] = useState(false);

    // Check if max refinements reached
    const maxRefinementsReached = refinementCount >= MAX_REFINEMENTS;

    // Handle initial generation
    const handleGenerate = useCallback(async () => {
      if (!featureInput.trim()) return;

      setState('generating');
      setError(null);

      try {
        // Add user message to conversation history
        const newHistory: ConversationMessage[] = [
          { role: 'user', content: featureInput.trim() },
        ];
        setConversationHistory(newHistory);

        const tasks = await onGenerateTasks(featureInput.trim(), newHistory);
        setBreakdown(tasks);

        // Add assistant response to history
        setConversationHistory([
          ...newHistory,
          {
            role: 'assistant',
            content: `Generated ${tasks.length} tasks: ${tasks.map((t) => t.title).join(', ')}`,
          },
        ]);

        setState('review');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to generate tasks'
        );
        setState('input');
      }
    }, [featureInput, onGenerateTasks]);

    // Handle refinement regeneration
    const handleRegenerate = useCallback(async () => {
      if (!refinementFeedback.trim() || maxRefinementsReached) return;

      setState('generating');
      setError(null);

      try {
        // Store previous breakdown in history
        setRefinementHistory((prev) => [
          ...prev,
          {
            iteration: refinementCount + 1,
            feedback: refinementFeedback.trim(),
            breakdown: [...breakdown],
          },
        ]);

        // Add refinement feedback to conversation history
        const newHistory: ConversationMessage[] = [
          ...conversationHistory,
          {
            role: 'user',
            content: `Please refine the breakdown based on this feedback: ${refinementFeedback.trim()}`,
          },
        ];
        setConversationHistory(newHistory);

        const tasks = await onGenerateTasks(refinementFeedback.trim(), newHistory);
        setBreakdown(tasks);

        // Add assistant response to history
        setConversationHistory([
          ...newHistory,
          {
            role: 'assistant',
            content: `Regenerated ${tasks.length} tasks: ${tasks.map((t) => t.title).join(', ')}`,
          },
        ]);

        setRefinementCount((prev) => prev + 1);
        setRefinementFeedback('');
        setState('review');
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to regenerate with changes'
        );
        setState('review');
      }
    }, [
      refinementFeedback,
      maxRefinementsReached,
      breakdown,
      refinementCount,
      conversationHistory,
      onGenerateTasks,
    ]);

    // Handle create all tasks
    const handleCreateTasks = useCallback(async () => {
      if (breakdown.length === 0) return;

      setIsCreating(true);
      setError(null);

      try {
        await onCreateTasks(breakdown);
        modal.remove();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to create tasks'
        );
      } finally {
        setIsCreating(false);
      }
    }, [breakdown, onCreateTasks, modal]);

    // Handle cancel
    const handleCancel = useCallback(() => {
      modal.remove();
    }, [modal]);

    // Render STATE 1 - Input
    const renderInputState = () => (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="feature-input" className="text-sm font-medium">
            Describe your feature
          </Label>
          <Textarea
            id="feature-input"
            value={featureInput}
            onChange={(e) => setFeatureInput(e.target.value)}
            placeholder="e.g., 'User authentication with email verification' or 'Shopping cart with checkout flow'"
            className="min-h-[120px] resize-none"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!featureInput.trim()}
          >
            Generate Breakdown
          </Button>
        </DialogFooter>
      </div>
    );

    // Render STATE 2 - Generating
    const renderGeneratingState = () => (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {refinementCount > 0
            ? 'Regenerating task breakdown...'
            : 'Generating task breakdown...'}
        </p>
      </div>
    );

    // Render STATE 3 - Review & Refine
    const renderReviewState = () => (
      <div className="space-y-4">
        {/* Task Breakdown List */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Tasks ({breakdown.length})
          </Label>
          <div className="max-h-[300px] overflow-y-auto">
            <TaskBreakdownList items={breakdown} />
          </div>
        </div>

        {/* Refinement Section */}
        <div className="space-y-3 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="refinement-input"
              className="text-sm font-medium"
            >
              Request Changes
            </Label>
            {refinementCount > 0 && (
              <span className="text-xs text-muted-foreground">
                Refinement iteration {refinementCount} of {MAX_REFINEMENTS}
              </span>
            )}
          </div>

          {/* Previous feedback history */}
          {refinementHistory.length > 0 && (
            <div className="space-y-1">
              {refinementHistory.map((entry, idx) => (
                <div
                  key={idx}
                  className="text-xs text-muted-foreground bg-muted/30 px-2 py-1 rounded"
                >
                  <span className="font-medium">Iteration {entry.iteration}:</span>{' '}
                  {entry.feedback}
                </div>
              ))}
            </div>
          )}

          <Textarea
            id="refinement-input"
            value={refinementFeedback}
            onChange={(e) => setRefinementFeedback(e.target.value)}
            placeholder="e.g., 'Make password reset email-based' or 'Add image upload support'"
            className="min-h-[80px] resize-none"
            disabled={maxRefinementsReached}
          />

          {maxRefinementsReached && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Max refinements reached. Create tasks or start over.
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={
              !refinementFeedback.trim() || maxRefinementsReached
            }
            className="w-full"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Regenerate with Changes
          </Button>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={handleCancel} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateTasks}
            disabled={breakdown.length === 0 || isCreating}
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create All Tasks'
            )}
          </Button>
        </DialogFooter>
      </div>
    );

    // Determine dialog title based on state
    const getDialogTitle = () => {
      switch (state) {
        case 'input':
          return 'Create Feature';
        case 'generating':
          return 'Generating...';
        case 'review':
          return 'Feature Breakdown';
      }
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => !open && handleCancel()}
        className="w-full max-w-[min(90vw,36rem)] max-h-[min(95vh,48rem)] flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{getDialogTitle()}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 px-6 pb-6 overflow-y-auto">
          {state === 'input' && renderInputState()}
          {state === 'generating' && renderGeneratingState()}
          {state === 'review' && renderReviewState()}
        </div>
      </Dialog>
    );
  }
);

export const FeatureCreatorModal = defineModal<FeatureCreatorModalProps, void>(
  FeatureCreatorModalImpl
);
