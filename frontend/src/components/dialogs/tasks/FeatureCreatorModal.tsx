import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { Check, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { tasksApi } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CreateTask, Task } from 'shared/types';

// Types for task breakdown items from previous states
export interface TaskBreakdownItem {
  id: string;
  title: string;
  description: string;
}

// Types for tracking creation progress
export type TaskCreationStatus = 'pending' | 'creating' | 'success' | 'error';

export interface TaskCreationResult {
  item: TaskBreakdownItem;
  status: TaskCreationStatus;
  createdTaskId?: string;
  error?: string;
}

// Modal states
export type FeatureCreatorState =
  | 'input' // STATE 1
  | 'generating' // STATE 2
  | 'review' // STATE 3
  | 'creating'; // STATE 4

export interface FeatureCreatorModalProps {
  projectId: string;
  // Tasks from STATE 3 (Review state) - passed when user clicks "Create All Tasks"
  tasks: TaskBreakdownItem[];
  // Optional: callback when all tasks are created successfully
  onTasksCreated?: (createdTaskIds: string[]) => void;
}

const FeatureCreatorModalImpl = NiceModal.create<FeatureCreatorModalProps>(
  ({ projectId, tasks, onTasksCreated }) => {
    const modal = useModal();
    const { t } = useTranslation(['tasks']);

    // Creation progress state
    const [creationResults, setCreationResults] = useState<
      TaskCreationResult[]
    >(() =>
      tasks.map((item) => ({
        item,
        status: 'pending' as TaskCreationStatus,
      }))
    );
    const [isCreating, setIsCreating] = useState(false);
    const [creationComplete, setCreationComplete] = useState(false);
    const hasStartedRef = useRef(false);

    // Compute progress statistics
    const totalTasks = tasks.length;
    const completedTasks = creationResults.filter(
      (r) => r.status === 'success' || r.status === 'error'
    ).length;
    const successfulTasks = creationResults.filter(
      (r) => r.status === 'success'
    ).length;
    const failedTasks = creationResults.filter(
      (r) => r.status === 'error'
    ).length;
    const currentlyCreatingIndex = creationResults.findIndex(
      (r) => r.status === 'creating'
    );
    const progressPercent =
      totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    // Create a single task
    const createSingleTask = useCallback(
      async (item: TaskBreakdownItem): Promise<Task> => {
        const taskData: CreateTask = {
          project_id: projectId,
          title: item.title,
          description: item.description,
          status: null, // Will default to 'todo'
          parent_workspace_id: null,
          image_ids: null,
          shared_task_id: null,
        };
        return await tasksApi.create(taskData);
      },
      [projectId]
    );

    // Create all tasks sequentially
    const createAllTasks = useCallback(async () => {
      setIsCreating(true);

      const results: TaskCreationResult[] = [...creationResults];

      for (let i = 0; i < tasks.length; i++) {
        const item = tasks[i];

        // Update status to 'creating'
        results[i] = { ...results[i], status: 'creating' };
        setCreationResults([...results]);

        try {
          const createdTask = await createSingleTask(item);
          results[i] = {
            ...results[i],
            status: 'success',
            createdTaskId: createdTask.id,
          };
        } catch (error) {
          results[i] = {
            ...results[i],
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : t('featureCreator.creating.genericError'),
          };
        }

        setCreationResults([...results]);
      }

      setIsCreating(false);
      setCreationComplete(true);

      // Call success callback if all tasks were created successfully
      const createdIds = results
        .filter((r) => r.status === 'success' && r.createdTaskId)
        .map((r) => r.createdTaskId!);

      if (createdIds.length === tasks.length && onTasksCreated) {
        onTasksCreated(createdIds);
      }
    }, [tasks, creationResults, createSingleTask, onTasksCreated, t]);

    // Retry failed tasks
    const retryFailedTasks = useCallback(async () => {
      setIsCreating(true);
      setCreationComplete(false);

      const results: TaskCreationResult[] = [...creationResults];

      for (let i = 0; i < results.length; i++) {
        if (results[i].status !== 'error') continue;

        const item = results[i].item;

        // Update status to 'creating'
        results[i] = { ...results[i], status: 'creating', error: undefined };
        setCreationResults([...results]);

        try {
          const createdTask = await createSingleTask(item);
          results[i] = {
            ...results[i],
            status: 'success',
            createdTaskId: createdTask.id,
          };
        } catch (error) {
          results[i] = {
            ...results[i],
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : t('featureCreator.creating.genericError'),
          };
        }

        setCreationResults([...results]);
      }

      setIsCreating(false);
      setCreationComplete(true);

      // Call success callback if all tasks are now successful
      const createdIds = results
        .filter((r) => r.status === 'success' && r.createdTaskId)
        .map((r) => r.createdTaskId!);

      if (createdIds.length === tasks.length && onTasksCreated) {
        onTasksCreated(createdIds);
      }
    }, [creationResults, createSingleTask, onTasksCreated, tasks.length, t]);

    // Handle view tasks action
    const handleViewTasks = useCallback(() => {
      modal.remove();
    }, [modal]);

    // Start creation when modal opens (since we're in STATE 4)
    useEffect(() => {
      if (hasStartedRef.current) return;
      hasStartedRef.current = true;

      // Use a slight delay to let the modal render first
      const timer = setTimeout(() => {
        createAllTasks();
      }, 100);
      return () => clearTimeout(timer);
    }, [createAllTasks]);

    // Get status icon for a task
    const getStatusIcon = (status: TaskCreationStatus) => {
      switch (status) {
        case 'pending':
          return (
            <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
          );
        case 'creating':
          return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
        case 'success':
          return <Check className="h-5 w-5 text-green-500" />;
        case 'error':
          return <X className="h-5 w-5 text-destructive" />;
      }
    };

    // Determine the result message
    const getResultMessage = () => {
      if (!creationComplete) return null;

      if (failedTasks === 0) {
        return (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span>
              {t('featureCreator.creating.successMessage', {
                count: successfulTasks,
              })}
            </span>
          </div>
        );
      }

      if (successfulTasks === 0) {
        return (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{t('featureCreator.creating.allFailedMessage')}</span>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-5 w-5" />
          <span>
            {t('featureCreator.creating.partialSuccessMessage', {
              success: successfulTasks,
              total: totalTasks,
              failed: failedTasks,
            })}
          </span>
        </div>
      );
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={() => {
          // Cannot close during creation
          if (!isCreating) {
            modal.remove();
          }
        }}
        className="w-full max-w-[min(90vw,36rem)] max-h-[min(95vh,40rem)] flex flex-col overflow-hidden"
        uncloseable={isCreating}
      >
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>{t('featureCreator.creating.title')}</DialogTitle>
            <DialogDescription>
              {isCreating
                ? t('featureCreator.creating.statusCreating', {
                    current: currentlyCreatingIndex + 1,
                    total: totalTasks,
                  })
                : creationComplete
                  ? t('featureCreator.creating.statusComplete')
                  : t('featureCreator.creating.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {completedTasks} / {totalTasks}{' '}
                {t('featureCreator.creating.tasksCreated')}
              </p>
            </div>

            {/* Task list with status indicators */}
            <div className="max-h-[300px] overflow-y-auto border rounded-md">
              <ul className="divide-y">
                {creationResults.map((result, index) => (
                  <li
                    key={result.item.id}
                    className={cn(
                      'flex items-start gap-3 p-3 transition-colors',
                      result.status === 'creating' && 'bg-primary/5',
                      result.status === 'error' && 'bg-destructive/5'
                    )}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getStatusIcon(result.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          'text-sm font-medium truncate',
                          result.status === 'success' && 'text-muted-foreground'
                        )}
                      >
                        {result.item.title}
                      </p>
                      {result.error && (
                        <p className="text-xs text-destructive mt-1">
                          {result.error}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {index + 1}/{totalTasks}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Result message */}
            {creationComplete && (
              <div className="pt-2">{getResultMessage()}</div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {creationComplete ? (
              <>
                {failedTasks > 0 && (
                  <Button
                    variant="outline"
                    onClick={retryFailedTasks}
                    disabled={isCreating}
                  >
                    {t('featureCreator.creating.retryFailed')}
                  </Button>
                )}
                <Button onClick={handleViewTasks}>
                  {failedTasks === 0
                    ? t('featureCreator.creating.viewTasks')
                    : t('featureCreator.creating.close')}
                </Button>
              </>
            ) : (
              <Button disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('featureCreator.creating.creatingTasks')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const FeatureCreatorModal = defineModal<FeatureCreatorModalProps, void>(
  FeatureCreatorModalImpl
);
