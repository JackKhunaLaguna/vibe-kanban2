import { useState, useCallback } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { Sparkles, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { tasksApi } from '@/lib/api';
import { TaskBreakdownList } from './TaskBreakdownList';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type {
  BreakdownTaskResponse,
  ConversationMessageRequest,
} from 'shared/types';

// Modal states
type ModalState = 'input' | 'generating' | 'review' | 'creating' | 'success';

export interface FeatureCreatorModalProps {
  projectId: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const FeatureCreatorModalImpl = NiceModal.create<FeatureCreatorModalProps>(
  (props) => {
    const { projectId } = props;
    const modal = useModal();

    // State management
    const [modalState, setModalState] = useState<ModalState>('input');
    const [featureDescription, setFeatureDescription] = useState('');
    const [refinementFeedback, setRefinementFeedback] = useState('');
    const [tasks, setTasks] = useState<BreakdownTaskResponse[]>([]);
    const [conversationHistory, setConversationHistory] = useState<
      ConversationMessage[]
    >([]);
    const [error, setError] = useState<string | null>(null);
    const [creationProgress, setCreationProgress] = useState({
      current: 0,
      total: 0,
    });

    // Reset state when closing
    const handleClose = useCallback(() => {
      setModalState('input');
      setFeatureDescription('');
      setRefinementFeedback('');
      setTasks([]);
      setConversationHistory([]);
      setError(null);
      setCreationProgress({ current: 0, total: 0 });
      modal.remove();
    }, [modal]);

    // Generate breakdown
    const handleGenerate = useCallback(async () => {
      if (!featureDescription.trim()) return;

      setError(null);
      setModalState('generating');

      try {
        // Convert conversation history to the API format
        const historyForApi: ConversationMessageRequest[] =
          conversationHistory.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));

        const response = await tasksApi.breakdown({
          featureDescription: featureDescription.trim(),
          projectId,
          conversationHistory:
            historyForApi.length > 0 ? historyForApi : undefined,
        });

        // Update conversation history
        setConversationHistory((prev) => [
          ...prev,
          { role: 'user', content: featureDescription.trim() },
          { role: 'assistant', content: JSON.stringify(response.tasks) },
        ]);

        setTasks(response.tasks);
        setModalState('review');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to generate breakdown'
        );
        setModalState('input');
      }
    }, [featureDescription, projectId, conversationHistory]);

    // Refine breakdown
    const handleRefine = useCallback(async () => {
      if (!refinementFeedback.trim()) return;

      setError(null);
      setModalState('generating');

      try {
        // Add refinement feedback to conversation and call API
        const historyForApi: ConversationMessageRequest[] =
          conversationHistory.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));

        const response = await tasksApi.breakdown({
          featureDescription: refinementFeedback.trim(),
          projectId,
          conversationHistory: historyForApi,
        });

        // Update conversation history
        setConversationHistory((prev) => [
          ...prev,
          { role: 'user', content: refinementFeedback.trim() },
          { role: 'assistant', content: JSON.stringify(response.tasks) },
        ]);

        setTasks(response.tasks);
        setRefinementFeedback('');
        setModalState('review');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to refine breakdown'
        );
        setModalState('review');
      }
    }, [refinementFeedback, projectId, conversationHistory]);

    // Create all tasks
    const handleCreateTasks = useCallback(async () => {
      if (tasks.length === 0) return;

      setError(null);
      setModalState('creating');
      setCreationProgress({ current: 0, total: tasks.length });

      try {
        const tasksToCreate = tasks.map((task) => ({
          title: task.title,
          description: task.description,
        }));

        await tasksApi.bulkCreate({
          projectId,
          tasks: tasksToCreate,
        });

        setCreationProgress({ current: tasks.length, total: tasks.length });
        setModalState('success');

        // Auto-close after success
        setTimeout(() => {
          handleClose();
        }, 1500);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to create tasks'
        );
        setModalState('review');
      }
    }, [tasks, projectId, handleClose]);

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (modalState === 'input' && featureDescription.trim()) {
            handleGenerate();
          } else if (modalState === 'review' && refinementFeedback.trim()) {
            handleRefine();
          }
        }
      },
      [modalState, featureDescription, refinementFeedback, handleGenerate, handleRefine]
    );

    // Render content based on state
    const renderContent = () => {
      switch (modalState) {
        case 'input':
          return (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="feature-input">Describe your feature</Label>
                <Textarea
                  id="feature-input"
                  value={featureDescription}
                  onChange={(e) => setFeatureDescription(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe the feature you want to implement. Be as detailed as possible about what it should do, how it should behave, and any technical considerations..."
                  className="min-h-[150px] resize-none"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Press Cmd/Ctrl + Enter to generate
                </p>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          );

        case 'generating':
          return (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Breaking down your feature into tasks...
              </p>
            </div>
          );

        case 'review':
          return (
            <div className="space-y-4">
              <TaskBreakdownList tasks={tasks} />

              <div className="border-t pt-4 space-y-2">
                <Label htmlFor="refinement-input">
                  Want to refine the breakdown?
                </Label>
                <Textarea
                  id="refinement-input"
                  value={refinementFeedback}
                  onChange={(e) => setRefinementFeedback(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Provide feedback to adjust the task breakdown (optional)..."
                  className="min-h-[80px] resize-none"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          );

        case 'creating':
          return (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Creating tasks... ({creationProgress.current}/
                {creationProgress.total})
              </p>
            </div>
          );

        case 'success':
          return (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm font-medium">
                {tasks.length} tasks created successfully!
              </p>
            </div>
          );
      }
    };

    // Render footer based on state
    const renderFooter = () => {
      switch (modalState) {
        case 'input':
          return (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!featureDescription.trim()}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Breakdown
              </Button>
            </>
          );

        case 'review':
          return (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleRefine}
                disabled={!refinementFeedback.trim()}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Refine
              </Button>
              <Button onClick={handleCreateTasks} disabled={tasks.length === 0}>
                Create {tasks.length} Tasks
              </Button>
            </>
          );

        case 'generating':
        case 'creating':
        case 'success':
          return null;
      }
    };

    return (
      <Dialog open={modal.visible} onOpenChange={() => handleClose()}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Create Feature
            </DialogTitle>
            <DialogDescription>
              {modalState === 'input' &&
                'Describe your feature and let AI break it down into implementable tasks.'}
              {modalState === 'generating' && 'Analyzing your feature...'}
              {modalState === 'review' &&
                'Review the generated tasks and refine if needed.'}
              {modalState === 'creating' && 'Creating your tasks...'}
              {modalState === 'success' && 'All done!'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">{renderContent()}</div>

          {renderFooter() && <DialogFooter>{renderFooter()}</DialogFooter>}
        </DialogContent>
      </Dialog>
    );
  }
);

export const FeatureCreatorModal = defineModal<FeatureCreatorModalProps, void>(
  FeatureCreatorModalImpl
);
