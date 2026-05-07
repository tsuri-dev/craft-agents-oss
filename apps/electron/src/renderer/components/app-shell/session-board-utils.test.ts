import { describe, expect, it } from "bun:test"
import type { SessionMeta } from "@/atoms/sessions"
import type { SessionStatus } from "@/config/session-status-config"
import {
  buildSessionBoardLabelColumns,
  buildSessionBoardColumns,
  buildSessionBoardProjectColumns,
  buildSessionBoardRecentColumns,
  computeBoardPosition,
  resolveBoardStatusId,
} from "./session-board-utils"

const statuses = [
  { id: "backlog", label: "Backlog", isDefault: true },
  { id: "todo", label: "Todo" },
  { id: "done", label: "Done" },
] as SessionStatus[]

function session(partial: Partial<SessionMeta> & { id: string }): SessionMeta {
  return {
    workspaceId: "workspace",
    ...partial,
  }
}

describe("session-board-utils", () => {
  it("falls back to the configured default status", () => {
    expect(resolveBoardStatusId(session({ id: "s1" }), statuses)).toBe("backlog")
    expect(resolveBoardStatusId(session({ id: "s2", sessionStatus: "missing" }), statuses)).toBe("backlog")
  })

  it("builds ordered columns from configured statuses", () => {
    const columns = buildSessionBoardColumns(
      [
        session({ id: "newer", sessionStatus: "todo", lastMessageAt: 20 }),
        session({ id: "older", sessionStatus: "todo", lastMessageAt: 10 }),
        session({ id: "manual", sessionStatus: "done", boardPosition: 2, lastMessageAt: 1 }),
      ],
      statuses,
    )

    expect(columns.map((column) => column.group.id)).toEqual(["backlog", "todo", "done"])
    expect(columns[1]!.sessions.map((item) => item.id)).toEqual(["newer", "older"])
    expect(columns[2]!.sessions.map((item) => item.id)).toEqual(["manual"])
  })

  it("hides configured columns without losing grouping logic", () => {
    const columns = buildSessionBoardColumns(
      [session({ id: "s1", sessionStatus: "todo" })],
      statuses,
      new Set(["todo"]),
    )

    expect(columns.map((column) => column.group.id)).toEqual(["backlog", "done"])
  })

  it("builds label columns and keeps unlabeled sessions visible", () => {
    const columns = buildSessionBoardLabelColumns(
      [
        session({ id: "with-label", labels: ["bug"] }),
        session({ id: "without-label" }),
      ],
      [
        { id: "bug", name: "Bug" },
        { id: "feature", name: "Feature" },
      ],
    )

    expect(columns.map((column) => column.group.id)).toEqual(["bug", "__unlabeled"])
    expect(columns[0]!.sessions.map((item) => item.id)).toEqual(["with-label"])
    expect(columns[1]!.sessions.map((item) => item.id)).toEqual(["without-label"])
  })

  it("builds project columns from valued project labels", () => {
    const columns = buildSessionBoardProjectColumns([
      session({ id: "craft-newer", labels: ["project::Craft Agents"], lastMessageAt: 20 }),
      session({ id: "craft-older", labels: ["project::Craft Agents"], lastMessageAt: 10 }),
      session({ id: "pi", labels: ["project::Pi"] }),
      session({ id: "none", labels: ["bug"] }),
    ])

    expect(columns.map((column) => column.group.id)).toEqual(["Craft Agents", "Pi", "__no_project__"])
    expect(columns[0]!.sessions.map((item) => item.id)).toEqual(["craft-newer", "craft-older"])
    expect(columns[2]!.sessions.map((item) => item.id)).toEqual(["none"])
  })

  it("builds recent seven day columns ordered by date and recent activity", () => {
    const now = new Date(2026, 4, 5, 12).getTime()
    const day = 24 * 60 * 60 * 1000
    const columns = buildSessionBoardRecentColumns([
      session({ id: "today-older", lastMessageAt: now - 3 * 60 * 60 * 1000 }),
      session({ id: "today-newer", lastMessageAt: now - 60 * 60 * 1000 }),
      session({ id: "yesterday", lastMessageAt: now - day }),
      session({ id: "stale", lastMessageAt: now - 7 * day }),
    ], now)

    expect(columns).toHaveLength(7)
    expect(columns.slice(0, 2).map((column) => column.group.label)).toEqual(["Today", "Yesterday"])
    expect(columns[0]!.sessions.map((item) => item.id)).toEqual(["today-newer", "today-older"])
    expect(columns[1]!.sessions.map((item) => item.id)).toEqual(["yesterday"])
    expect(columns.flatMap((column) => column.sessions.map((item) => item.id))).not.toContain("stale")
  })

  it("computes floating board positions from neighbors", () => {
    expect(computeBoardPosition([
      session({ id: "active" }),
      session({ id: "next", boardPosition: 10 }),
    ], "active")).toBe(9)

    expect(computeBoardPosition([
      session({ id: "prev", boardPosition: 10 }),
      session({ id: "active" }),
      session({ id: "next", boardPosition: 20 }),
    ], "active")).toBe(15)

    expect(computeBoardPosition([
      session({ id: "prev", boardPosition: 10 }),
      session({ id: "active" }),
    ], "active")).toBe(11)
  })
})
