import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Minimize2, Settings, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NewCard, NewCardHeader, NewCardContent } from '@/components/ui/new-card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface OrchestratorPanelProps {
  isMinimized: boolean;
  onToggleMinimize: () => void;
  notificationCount: number;
}

const PANEL_WIDTH = 380;
const MINIMIZED_SIZE = 60;
const STORAGE_KEY = 'orchestratorPanel.minimized';

export function OrchestratorPanel({
  isMinimized,
  onToggleMinimize,
  notificationCount,
}: OrchestratorPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  // Handle swipe to minimize on mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return;

      const touchEndX = e.changedTouches[0].clientX;
      const deltaX = touchEndX - touchStartX.current;

      // Swipe right to minimize (threshold: 50px)
      if (deltaX > 50 && !isMinimized) {
        onToggleMinimize();
      }
      // Swipe left to expand
      else if (deltaX < -50 && isMinimized) {
        onToggleMinimize();
      }

      touchStartX.current = null;
    },
    [isMinimized, onToggleMinimize]
  );

  // Keyboard shortcut to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt/Option + O to toggle
      if (e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        onToggleMinimize();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleMinimize]);

  return (
    <AnimatePresence mode="wait">
      {isMinimized ? (
        <MinimizedPanel
          key="minimized"
          notificationCount={notificationCount}
          onExpand={onToggleMinimize}
        />
      ) : (
        <ExpandedPanel
          key="expanded"
          ref={panelRef}
          notificationCount={notificationCount}
          onMinimize={onToggleMinimize}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />
      )}
    </AnimatePresence>
  );
}

interface MinimizedPanelProps {
  notificationCount: number;
  onExpand: () => void;
}

function MinimizedPanel({ notificationCount, onExpand }: MinimizedPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, x: 20 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.8, x: 20 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="fixed right-4 bottom-4 z-50"
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onExpand}
              className={cn(
                'relative flex items-center justify-center',
                'bg-background border border-border rounded-full shadow-lg',
                'hover:bg-accent transition-colors duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
              )}
              style={{ width: MINIMIZED_SIZE, height: MINIMIZED_SIZE }}
              aria-label="Expand AI Orchestrator panel"
            >
              <Bot className="h-6 w-6 text-foreground" />
              {notificationCount > 0 && (
                <NotificationBadge count={notificationCount} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>AI Orchestrator (Alt+O)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </motion.div>
  );
}

interface ExpandedPanelProps {
  notificationCount: number;
  onMinimize: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}

const ExpandedPanel = React.forwardRef<HTMLDivElement, ExpandedPanelProps>(
  ({ notificationCount, onMinimize, onTouchStart, onTouchEnd }, ref) => {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 50 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50',
          'flex flex-col',
          'bg-background border-l border-border shadow-xl'
        )}
        style={{ width: PANEL_WIDTH }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <NewCard className="h-full">
          <NewCardHeader
            className="flex-shrink-0"
            actions={
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="icon"
                        onClick={() => {
                          // Placeholder for settings - will be implemented later
                        }}
                        aria-label="Orchestrator settings"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Settings</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="h-4 w-px bg-border" />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="icon"
                        onClick={onMinimize}
                        aria-label="Minimize panel"
                      >
                        <Minimize2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Minimize (Alt+O)
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            }
          >
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-foreground" />
              <span className="font-medium text-foreground">AI Orchestrator</span>
              {notificationCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-full bg-primary text-primary-foreground">
                  {notificationCount > 99 ? '99+' : notificationCount}
                </span>
              )}
            </div>
          </NewCardHeader>

          <NewCardContent className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Chat area - scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0 p-3">
              <ChatPlaceholder />
            </div>

            {/* Input section - fixed at bottom */}
            <div className="flex-shrink-0 border-t border-dashed p-3 bg-background">
              <InputPlaceholder />
            </div>
          </NewCardContent>
        </NewCard>
      </motion.div>
    );
  }
);

ExpandedPanel.displayName = 'ExpandedPanel';

interface NotificationBadgeProps {
  count: number;
}

function NotificationBadge({ count }: NotificationBadgeProps) {
  const displayCount = count > 99 ? '99+' : count;

  return (
    <span
      className={cn(
        'absolute -top-1 -right-1',
        'flex items-center justify-center',
        'min-w-[20px] h-5 px-1',
        'text-xs font-semibold',
        'bg-destructive text-destructive-foreground',
        'rounded-full'
      )}
      aria-label={`${count} notifications`}
    >
      {displayCount}
    </span>
  );
}

// Placeholder components for chat area and input
// These will be replaced with actual implementations in separate tasks
function ChatPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <MessageSquare className="h-12 w-12 mb-3 opacity-50" />
      <p className="text-sm text-center">
        Chat messages will appear here
      </p>
    </div>
  );
}

function InputPlaceholder() {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'flex-1 h-10 px-3',
          'flex items-center',
          'bg-muted border border-border rounded-md',
          'text-sm text-muted-foreground'
        )}
      >
        Type a message...
      </div>
      <Button disabled size="sm">
        Send
      </Button>
    </div>
  );
}

// Export storage key for external state management
export { STORAGE_KEY as ORCHESTRATOR_PANEL_STORAGE_KEY };
