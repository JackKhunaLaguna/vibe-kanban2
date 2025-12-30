import { Task, TaskWithAttemptStatus, Workspace } from 'shared/types';
import type { SharedTaskRecord } from '@/hooks/useProjectTasks';
import type { CompleteReview, Fix } from '@/components/dialogs';

// Extend nice-modal-react to provide type safety for modal arguments
declare module '@ebay/nice-modal-react' {
  interface ModalArgs {
    'create-pr': {
      attempt: Workspace;
      task: TaskWithAttemptStatus;
      projectId: string;
    };
    'share-task': {
      task: TaskWithAttemptStatus;
    };
    'transfer-shared-task': {
      sharedTask: SharedTaskRecord;
    };
    'review-modal': {
      isOpen: boolean;
      tasks: Task[];
      onClose: () => void;
      onStartReview: (taskIds: string[]) => Promise<CompleteReview>;
      onApplyFixes: (fixes: Fix[]) => Promise<void>;
    };
  }
}

export {};
