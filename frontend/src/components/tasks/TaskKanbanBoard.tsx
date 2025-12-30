import { memo, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks';
import {
  type DragEndEvent,
  KanbanBoard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from '@/components/ui/shadcn-io/kanban';
import { TaskCard } from './TaskCard';
import type { TaskStatus, TaskWithAttemptStatus } from 'shared/types';
import { statusBoardColors, statusLabels } from '@/utils/statusLabels';
import type { SharedTaskRecord } from '@/hooks/useProjectTasks';
import { SharedTaskCard } from './SharedTaskCard';
import { ReviewButton } from '@/components/review/ReviewButton';
import { ReviewModal } from '@/components/dialogs/tasks/ReviewModal';

export type KanbanColumnItem =
  | {
      type: 'task';
      task: TaskWithAttemptStatus;
      sharedTask?: SharedTaskRecord;
    }
  | {
      type: 'shared';
      task: SharedTaskRecord;
    };

export type KanbanColumns = Record<TaskStatus, KanbanColumnItem[]>;

interface TaskKanbanBoardProps {
  columns: KanbanColumns;
  onDragEnd: (event: DragEndEvent) => void;
  onViewTaskDetails: (task: TaskWithAttemptStatus) => void;
  onViewSharedTask?: (task: SharedTaskRecord) => void;
  selectedTaskId?: string;
  selectedSharedTaskId?: string | null;
  onCreateTask?: () => void;
  projectId: string;
}

function TaskKanbanBoard({
  columns,
  onDragEnd,
  onViewTaskDetails,
  onViewSharedTask,
  selectedTaskId,
  selectedSharedTaskId,
  onCreateTask,
  projectId,
}: TaskKanbanBoardProps) {
  const { userId } = useAuth();

  // Get tasks in review for the review button
  const tasksInReview = useMemo(() => {
    const inReviewItems = columns.inreview || [];
    return inReviewItems
      .filter((item): item is { type: 'task'; task: TaskWithAttemptStatus; sharedTask?: SharedTaskRecord } =>
        item.type === 'task'
      )
      .map((item) => item.task);
  }, [columns.inreview]);

  const handleOpenReviewModal = useCallback(() => {
    if (tasksInReview.length > 0) {
      ReviewModal.show({ tasks: tasksInReview, projectId });
    }
  }, [tasksInReview, projectId]);

  return (
    <KanbanProvider onDragEnd={onDragEnd}>
      {Object.entries(columns).map(([status, items]) => {
        const statusKey = status as TaskStatus;

        // Add ReviewButton to the "In Review" column header
        const extraActions = statusKey === 'inreview' ? (
          <ReviewButton
            taskCount={tasksInReview.length}
            onClick={handleOpenReviewModal}
          />
        ) : undefined;

        return (
          <KanbanBoard key={status} id={statusKey}>
            <KanbanHeader
              name={statusLabels[statusKey]}
              color={statusBoardColors[statusKey]}
              onAddTask={onCreateTask}
              extraActions={extraActions}
            />
            <KanbanCards>
              {items.map((item, index) => {
                const isOwnTask =
                  item.type === 'task' &&
                  (!item.sharedTask?.assignee_user_id ||
                    !userId ||
                    item.sharedTask?.assignee_user_id === userId);

                if (isOwnTask) {
                  return (
                    <TaskCard
                      key={item.task.id}
                      task={item.task}
                      index={index}
                      status={statusKey}
                      onViewDetails={onViewTaskDetails}
                      isOpen={selectedTaskId === item.task.id}
                      projectId={projectId}
                      sharedTask={item.sharedTask}
                    />
                  );
                }

                const sharedTask =
                  item.type === 'shared' ? item.task : item.sharedTask!;

                return (
                  <SharedTaskCard
                    key={`shared-${item.task.id}`}
                    task={sharedTask}
                    index={index}
                    status={statusKey}
                    isSelected={selectedSharedTaskId === item.task.id}
                    onViewDetails={onViewSharedTask}
                  />
                );
              })}
            </KanbanCards>
          </KanbanBoard>
        );
      })}
    </KanbanProvider>
  );
}

export default memo(TaskKanbanBoard);
