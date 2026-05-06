import { useMemo } from "react"
import { parseLabelEntry } from "@craft-agent/shared/labels"
import { EntityListLabelBadge } from "@/components/ui/entity-list-label-badge"
import { useOptionalSessionListContext } from "@/context/SessionListContext"
import type { SessionMeta } from "@/atoms/sessions"
import type { LabelConfig } from "@craft-agent/shared/labels"

interface SessionBadgesProps {
  item: SessionMeta
  labels?: LabelConfig[]
  onLabelsChange?: (sessionId: string, labels: string[]) => void
}

export function SessionBadges({ item, labels, onLabelsChange }: SessionBadgesProps) {
  const ctx = useOptionalSessionListContext()
  const flatLabels = labels ?? ctx?.flatLabels ?? []
  const handleLabelsChange = onLabelsChange ?? ctx?.onLabelsChange

  const resolvedLabels = useMemo(() => {
    if (!item.labels || item.labels.length === 0 || flatLabels.length === 0) return []
    return item.labels
      .map(entry => {
        const parsed = parseLabelEntry(entry)
        const config = flatLabels.find(l => l.id === parsed.id)
        if (!config) return null
        return { config, rawValue: parsed.rawValue }
      })
      .filter((l): l is { config: LabelConfig; rawValue: string | undefined } => l != null)
  }, [item.labels, flatLabels])

  if (resolvedLabels.length === 0) return null

  return (
    <>
      {resolvedLabels.map(({ config, rawValue }, idx) => (
        <EntityListLabelBadge
          key={`${config.id}-${idx}`}
          label={config}
          rawValue={rawValue}
          sessionLabels={item.labels || []}
          onLabelsChange={(updated) => handleLabelsChange?.(item.id, updated)}
        />
      ))}
    </>
  )
}
