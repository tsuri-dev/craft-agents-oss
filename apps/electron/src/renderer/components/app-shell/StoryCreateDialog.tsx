import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import {
  selectedStoryIdAtom,
  storiesAtom,
  STORY_STATUSES,
  storyStatusById,
  type StoryStatusId,
} from '@/atoms/stories'
import { useRegisterModal } from '@/context/ModalContext'

interface StoryCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultStatus?: StoryStatusId
}

function createStoryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `story-${crypto.randomUUID()}`
  }
  return `story-${Date.now()}`
}

export function StoryCreateDialog({
  open,
  onOpenChange,
  defaultStatus = 'reviewed',
}: StoryCreateDialogProps) {
  const setStories = useSetAtom(storiesAtom)
  const setSelectedStoryId = useSetAtom(selectedStoryIdAtom)
  const [title, setTitle] = React.useState('')
  const [statusId, setStatusId] = React.useState<StoryStatusId>(defaultStatus)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const status = storyStatusById.get(statusId) ?? STORY_STATUSES[0]
  const StatusIcon = status.icon

  useRegisterModal(open, () => onOpenChange(false))

  React.useEffect(() => {
    if (!open) return
    setStatusId(defaultStatus)
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [defaultStatus, open])

  const handleSubmit = React.useCallback(() => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    const id = createStoryId()
    const now = new Date().toISOString()
    setStories((currentStories) => [
      {
        id,
        title: trimmedTitle,
        status: statusId,
        owner: 'Unassigned',
        cycle: 'Backlog',
        priority: 'P2',
        scope: 'Story',
        updatedAt: now,
        labels: [],
      },
      ...currentStories,
    ])
    setSelectedStoryId(id)
    setTitle('')
    onOpenChange(false)
  }, [onOpenChange, setSelectedStoryId, setStories, statusId, title])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>New Story</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground" htmlFor="story-title">
              Title
            </label>
            <Input
              id="story-title"
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Story title"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-[12px] font-medium text-muted-foreground">Status</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 rounded-md border border-foreground/15 bg-transparent px-3 text-left text-sm transition-colors hover:bg-foreground/[0.03]"
                >
                  <StatusIcon className="h-3.5 w-3.5" style={{ color: status.tone }} />
                  <span className="flex-1 truncate">{status.label}</span>
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="start" className="z-floating-menu w-48">
                {STORY_STATUSES.map((item) => {
                  const ItemIcon = item.icon
                  return (
                    <StyledDropdownMenuItem
                      key={item.id}
                      onClick={() => setStatusId(item.id)}
                      className={cn(item.id === statusId && 'bg-foreground/[0.03]')}
                    >
                      <ItemIcon className="h-3.5 w-3.5" style={{ color: item.tone }} />
                      <span className="flex-1">{item.label}</span>
                      {item.id === statusId && <Check className="h-3.5 w-3.5" />}
                    </StyledDropdownMenuItem>
                  )
                })}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
