import type { Message, Session } from "../../../shared/types"

const MAX_EXCERPT_CHARS = 360
const MAX_TOTAL_CHARS = 3600

function messageText(message: Message): string {
  return String(message.content || "").replace(/\s+/g, " ").trim()
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 3).trim()}...`
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function extractAttachmentNames(messages: Message[]): string[] {
  return unique(messages.flatMap((message) =>
    ((message as unknown as { attachments?: Array<Record<string, unknown>> }).attachments || [])
      .map((attachment) => {
        const name = attachment.name
        const filePath = attachment.path || attachment.filePath
        return typeof filePath === "string" ? filePath : typeof name === "string" ? name : null
      })
      .filter((value): value is string => !!value)
  ))
}

function extractFileBadges(messages: Message[]): string[] {
  return unique(messages.flatMap((message) =>
    ((message as unknown as { badges?: Array<{ filePath?: unknown }> }).badges || [])
      .map((badge) => typeof badge.filePath === "string" ? badge.filePath : null)
      .filter((value): value is string => !!value)
  ))
}

function extractPathMentions(messages: Message[]): string[] {
  const pathPattern = /(?:^|\s)(\/[A-Za-z0-9._~+\-/%@()[\] ]{2,}|(?:[\w.-]+\/)+[\w._~+\-%@()[\]]+)/g
  const paths: string[] = []
  for (const message of messages) {
    const content = messageText(message)
    for (const match of content.matchAll(pathPattern)) {
      const value = (match[1] || "").replace(/[),.;:]+$/, "").trim()
      if (value && !value.startsWith("//")) paths.push(value)
    }
  }
  return unique(paths)
}

export function buildHandoffPackageMarkdown({
  session,
  branchMessageId,
}: {
  session: Session
  branchMessageId: string
}): string {
  const branchIndex = session.messages.findIndex((message) => message.id === branchMessageId)
  const sourceMessages = (branchIndex >= 0 ? session.messages.slice(0, branchIndex + 1) : session.messages)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => !(message as { isIntermediate?: boolean }).isIntermediate)

  const recentMessages = sourceMessages.slice(-6)
  const latestUserMessage = [...sourceMessages].reverse().find((message) => message.role === "user")
  const latestAssistantMessage = [...sourceMessages].reverse().find((message) => message.role === "assistant")
  const fileReferences = unique([
    ...extractAttachmentNames(sourceMessages),
    ...extractFileBadges(sourceMessages),
    ...extractPathMentions(sourceMessages),
  ]).slice(0, 16)

  const recentContext = recentMessages
    .map((message) => {
      const role = message.role === "user" ? "User" : "Assistant"
      return `- ${role}: ${truncate(messageText(message), MAX_EXCERPT_CHARS)}`
    })
    .join("\n\n")

  const handoff = [
    "# Handoff Package",
    "",
    `Parent session: ${session.name || session.id}`,
    `Parent session id: ${session.id}`,
    session.workingDirectory ? `Working directory: ${session.workingDirectory}` : null,
    session.enabledSourceSlugs && session.enabledSourceSlugs.length > 0
      ? `Enabled sources: ${session.enabledSourceSlugs.join(", ")}`
      : null,
    fileReferences.length > 0 ? `Referenced files: ${fileReferences.join(", ")}` : null,
    "",
    "## Current User Intent",
    "",
    latestUserMessage ? truncate(messageText(latestUserMessage), 700) : "(No user message available before this branch point.)",
    "",
    "## Latest Assistant State",
    "",
    latestAssistantMessage ? truncate(messageText(latestAssistantMessage), 700) : "(No assistant message available before this branch point.)",
    "",
    "## Recent Context Excerpts",
    "",
    recentContext || "(No recent context was available before this branch point.)",
  ].filter((line): line is string => line !== null).join("\n")

  return truncate(handoff, MAX_TOTAL_CHARS)
}

export function buildHandoffDraftInstruction(handoffPath?: string): string {
  const target = handoffPath || "this session's notes.md handoff package"
  return [
    `Read the handoff package first: ${target}`,
    "",
    "Then inspect the referenced files as needed and continue the task from that context.",
  ].join("\n")
}

export const buildCompactHandoffPrompt = buildHandoffPackageMarkdown
