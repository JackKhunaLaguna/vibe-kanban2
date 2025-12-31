import { useState, useCallback } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { Loader2 } from 'lucide-react';
import { defineModal } from '@/lib/modals';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface FeatureBreakdown {
  tasks: Array<{
    title: string;
    description: string;
  }>;
}

export interface FeatureCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateTasks: (description: string) => Promise<FeatureBreakdown>;
}

type ModalState = 'input' | 'generating';

const PLACEHOLDER_TEXT = `Describe the feature you want to build in detail...

Examples:
• Build user authentication with login, signup, and password reset
• Create an analytics dashboard with charts and CSV export
• Add real-time chat with message history and notifications`;

const FeatureCreatorModalImpl = NiceModal.create<FeatureCreatorModalProps>(
  (props) => {
    const { onGenerateTasks } = props;
    const modal = useModal();

    const [modalState, setModalState] = useState<ModalState>('input');
    const [description, setDescription] = useState('');

    const isGenerating = modalState === 'generating';
    const canGenerate = description.trim().length > 0;

    const handleClose = useCallback(() => {
      if (isGenerating) return;
      modal.remove();
    }, [modal, isGenerating]);

    const handleGenerateTasks = useCallback(async () => {
      if (!canGenerate || isGenerating) return;

      setModalState('generating');

      try {
        const result = await onGenerateTasks(description.trim());
        modal.resolve(result);
        modal.remove();
      } catch {
        setModalState('input');
      }
    }, [canGenerate, isGenerating, description, onGenerateTasks, modal]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (canGenerate && !isGenerating) {
          handleGenerateTasks();
        }
      }
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => !open && handleClose()}
        className="w-full max-w-[min(90vw,32rem)]"
        uncloseable={isGenerating}
      >
        {modalState === 'input' && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Create Feature</DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={PLACEHOLDER_TEXT}
                className="min-h-[140px] resize-none"
                autoFocus
              />
              <div className="flex justify-end">
                <span className="text-xs text-muted-foreground">
                  {description.length} characters
                </span>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerateTasks}
                disabled={!canGenerate}
              >
                Generate Tasks
              </Button>
            </DialogFooter>
          </div>
        )}

        {modalState === 'generating' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <DialogHeader className="items-center">
              <DialogTitle>Analyzing Feature</DialogTitle>
            </DialogHeader>

            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />

            <div className="text-center space-y-1">
              <p className="text-sm text-foreground">
                AI is breaking down your feature into tasks...
              </p>
              <p className="text-xs text-muted-foreground">
                This may take 30-60 seconds
              </p>
            </div>
          </div>
        )}
      </Dialog>
    );
  }
);

export const FeatureCreatorModal = defineModal<
  FeatureCreatorModalProps,
  FeatureBreakdown
>(FeatureCreatorModalImpl);
