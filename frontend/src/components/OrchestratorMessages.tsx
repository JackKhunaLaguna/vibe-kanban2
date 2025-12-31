import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import WYSIWYGEditor from '@/components/ui/wysiwyg';
import {
  Bot,
  User,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

// Types

export interface ActionButton {
  label: string;
  action: string;
  style: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

export interface Message {
  id: string;
  role: 'user' | 'orchestrator';
  content: string;
  timestamp: Date;
  metadata?: {
    actionButtons?: ActionButton[];
    progressValue?: number;
    statusBadge?: { type: string; label: string };
    expandable?: boolean;
  };
}

export interface OrchestratorMessagesProps {
  messages: Message[];
  onActionClick: (action: string) => void;
}

// Utility functions

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Check if content has code blocks for special handling
function hasCodeBlocks(content: string): boolean {
  return /```[\s\S]*?```/.test(content);
}

// Progress indicator component
const ProgressIndicator = memo(function ProgressIndicator({
  value,
}: {
  value: number;
}) {
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div className="w-full mt-2">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>Progress</span>
        <span>{clampedValue}%</span>
      </div>
      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  );
});

// Status badge component
const StatusBadge = memo(function StatusBadge({
  type,
  label,
}: {
  type: string;
  label: string;
}) {
  const getStatusIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-3 h-3 mr-1" />;
      case 'error':
        return <AlertCircle className="w-3 h-3 mr-1" />;
      case 'warning':
        return <AlertTriangle className="w-3 h-3 mr-1" />;
      default:
        return null;
    }
  };

  const getVariant = (): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (type) {
      case 'success':
        return 'default';
      case 'error':
        return 'destructive';
      case 'warning':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getClassName = () => {
    switch (type) {
      case 'success':
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
      case 'warning':
        return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
      default:
        return '';
    }
  };

  return (
    <Badge variant={getVariant()} className={cn('text-xs', getClassName())}>
      {getStatusIcon()}
      {label}
    </Badge>
  );
});

// Action buttons component
const ActionButtons = memo(function ActionButtons({
  buttons,
  onActionClick,
}: {
  buttons: ActionButton[];
  onActionClick: (action: string) => void;
}) {
  const getButtonVariant = (
    style: ActionButton['style']
  ): 'default' | 'secondary' | 'destructive' => {
    switch (style) {
      case 'primary':
        return 'default';
      case 'secondary':
        return 'secondary';
      case 'danger':
        return 'destructive';
      default:
        return 'default';
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {buttons.map((button, index) => (
        <Button
          key={`${button.action}-${index}`}
          variant={getButtonVariant(button.style)}
          size="sm"
          onClick={() => {
            button.onClick();
            onActionClick(button.action);
          }}
        >
          {button.label}
        </Button>
      ))}
    </div>
  );
});

// Expandable content wrapper
const ExpandableContent = memo(function ExpandableContent({
  content,
  isExpanded,
  onToggle,
  maxHeight = 200,
}: {
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
  maxHeight?: number;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [shouldShowExpand, setShouldShowExpand] = useState(false);

  useEffect(() => {
    if (contentRef.current) {
      setShouldShowExpand(contentRef.current.scrollHeight > maxHeight);
    }
  }, [content, maxHeight]);

  return (
    <div>
      <div
        ref={contentRef}
        className={cn(
          'overflow-hidden transition-all duration-200',
          !isExpanded && shouldShowExpand && `max-h-[${maxHeight}px]`
        )}
        style={
          !isExpanded && shouldShowExpand ? { maxHeight: `${maxHeight}px` } : {}
        }
      >
        <WYSIWYGEditor
          value={content}
          disabled
          className="whitespace-pre-wrap break-words"
        />
      </div>
      {shouldShowExpand && (
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Show more
            </>
          )}
        </button>
      )}
    </div>
  );
});

// User message component
const UserMessage = memo(function UserMessage({
  message,
}: {
  message: Message;
}) {
  return (
    <div className="flex justify-end gap-3">
      <div className="flex flex-col items-end max-w-[80%]">
        <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-sm px-4 py-2">
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>
        <span className="text-xs text-muted-foreground mt-1">
          {formatRelativeTime(message.timestamp)}
        </span>
      </div>
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
        <User className="w-4 h-4 text-secondary-foreground" />
      </div>
    </div>
  );
});

// Orchestrator message component
const OrchestratorMessage = memo(function OrchestratorMessage({
  message,
  onActionClick,
}: {
  message: Message;
  onActionClick: (action: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandable = message.metadata?.expandable ?? hasCodeBlocks(message.content);

  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="w-4 h-4 text-primary" />
      </div>
      <div className="flex flex-col max-w-[80%] min-w-0">
        <div className="bg-card border border-border rounded-lg rounded-tl-sm px-4 py-3">
          {/* Status badge */}
          {message.metadata?.statusBadge && (
            <div className="mb-2">
              <StatusBadge
                type={message.metadata.statusBadge.type}
                label={message.metadata.statusBadge.label}
              />
            </div>
          )}

          {/* Message content */}
          {isExpandable ? (
            <ExpandableContent
              content={message.content}
              isExpanded={isExpanded}
              onToggle={() => setIsExpanded(!isExpanded)}
            />
          ) : (
            <WYSIWYGEditor
              value={message.content}
              disabled
              className="whitespace-pre-wrap break-words text-sm"
            />
          )}

          {/* Progress indicator */}
          {message.metadata?.progressValue !== undefined && (
            <ProgressIndicator value={message.metadata.progressValue} />
          )}

          {/* Action buttons */}
          {message.metadata?.actionButtons &&
            message.metadata.actionButtons.length > 0 && (
              <ActionButtons
                buttons={message.metadata.actionButtons}
                onActionClick={onActionClick}
              />
            )}
        </div>
        <span className="text-xs text-muted-foreground mt-1">
          {formatRelativeTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
});

// Single message renderer
const MessageRenderer = memo(function MessageRenderer({
  message,
  onActionClick,
}: {
  message: Message;
  onActionClick: (action: string) => void;
}) {
  if (message.role === 'user') {
    return <UserMessage message={message} />;
  }
  return <OrchestratorMessage message={message} onActionClick={onActionClick} />;
});

// Main component
function OrchestratorMessages({
  messages,
  onActionClick,
}: OrchestratorMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAutoScrollEnabled && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, isAutoScrollEnabled]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAutoScrollEnabled(isAtBottom);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p className="text-sm">No messages yet</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto scroll-smooth"
    >
      <div className="flex flex-col gap-4 p-4">
        {messages.map((message) => (
          <MessageRenderer
            key={message.id}
            message={message}
            onActionClick={onActionClick}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(OrchestratorMessages);
