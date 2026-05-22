/**
 * Agent Profiles Atom
 *
 * Stores workspace-scoped Agent Profiles for @agent mention autocomplete and
 * message badge extraction.
 */

import { atom } from 'jotai'
import type { AgentProfile } from '../../shared/agent-profiles'

export const agentProfilesAtom = atom<AgentProfile[]>([])
