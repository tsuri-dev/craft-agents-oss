import { describe, expect, it } from "bun:test"
import type { Session } from "../../../shared/types"
import { buildHandoffDraftInstruction, buildHandoffPackageMarkdown } from "./branch-handoff"

describe("branch handoff", () => {
  it("builds a bounded handoff package up to the branch message", () => {
    const session = {
      id: "parent",
      workspaceId: "workspace",
      workspaceName: "Workspace",
      name: "Parent session",
      lastMessageAt: Date.now(),
      isProcessing: false,
      workingDirectory: "/repo",
      enabledSourceSlugs: ["github"],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Start task in apps/electron/src/renderer/App.tsx",
          timestamp: 1,
          badges: [{ type: "file", label: "App.tsx", rawText: "App.tsx", start: 0, end: 0, filePath: "/repo/apps/electron/src/renderer/App.tsx" }],
        },
        { id: "m2", role: "assistant", content: "Working on it", timestamp: 2 },
        { id: "m3", role: "user", content: "Do not include this", timestamp: 3 },
      ],
    } as Session

    const prompt = buildHandoffPackageMarkdown({ session, branchMessageId: "m2" })

    expect(prompt).toContain("# Handoff Package")
    expect(prompt).toContain("Parent session: Parent session")
    expect(prompt).toContain("Working directory: /repo")
    expect(prompt).toContain("Enabled sources: github")
    expect(prompt).toContain("Referenced files: /repo/apps/electron/src/renderer/App.tsx")
    expect(prompt).toContain("- User: Start task")
    expect(prompt).toContain("- Assistant: Working on it")
    expect(prompt).not.toContain("Do not include this")
  })

  it("keeps the handoff draft compact", () => {
    const session = {
      id: "parent",
      workspaceId: "workspace",
      workspaceName: "Workspace",
      lastMessageAt: Date.now(),
      isProcessing: false,
      messages: Array.from({ length: 30 }, (_, index) => ({
        id: `m${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index} ${"x".repeat(1000)}`,
        timestamp: index,
      })),
    } as Session

    const prompt = buildHandoffPackageMarkdown({ session, branchMessageId: "m29" })

    expect(prompt.length).toBeLessThanOrEqual(3600)
    expect(prompt).toContain("# Handoff Package")
  })

  it("builds a short draft instruction that points to the package file", () => {
    const prompt = buildHandoffDraftInstruction("/workspace/sessions/session-id/notes.md")

    expect(prompt).toContain("Read the handoff package first: /workspace/sessions/session-id/notes.md")
    expect(prompt.length).toBeLessThan(180)
  })
})
