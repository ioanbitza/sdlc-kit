#!/usr/bin/env node
// PreToolUse Agent|Task: the spawn of a kit agent must fit the step. The builder needs a plan (approved when it carries a
// Status line) and approved requirements; the verifier may not be put on the builder's model (the model that wrote the
// code must not be the one that judges it). Isolation by code, not by a sentence in a prompt. Denial: exit 2.
import { join } from 'node:path';
import { readHookInput, projectRoot, deny, isMain, runGuard } from './hook-common.mjs';
import { loadRoles, roleName, roleOf, isJudge } from './roles.mjs';
import { readPlan, readText, requirementsApproved, APPROVED_STATUS, PLAN_FILE, REQUIREMENTS_FILE } from './scope.mjs';

export function decide(input, roles = loadRoles()) {
  if (input.tool_name !== 'Agent' && input.tool_name !== 'Task') return null;
  const caller = roleOf(input, roles);
  if (isJudge(caller)) return `${caller.name} delegates nothing: a judge reads and reports itself, it does not spawn an agent that could write for it.`;
  const t = input.tool_input ?? {};
  const name = roleName(t.subagent_type);
  const role = name ? roles.get(name) : null;
  if (!role) return null;
  const root = projectRoot(input);
  if (role.writes === 'slice') {
    if (!readPlan(root)) return `Denied: ${role.name} builds slices of ${PLAN_FILE}, and there is none; run /sdlc-kit:plan-slices first.`;
    if (!APPROVED_STATUS.test(readText(join(root, PLAN_FILE)))) return `Denied: ${PLAN_FILE} is not approved (no "Status: approved" line); the human approves the plan before anyone builds it.`;
    if (!requirementsApproved(root)) return `Denied: ${REQUIREMENTS_FILE} is not approved (Status: approved); the human approves the requirements before anyone builds.`;
  }
  if (role.name === 'verifier' && typeof t.model === 'string' && t.model.trim()) {
    const builder = [...roles.values()].find((r) => r.writes === 'slice');
    const requested = t.model.trim().toLowerCase();
    if (builder?.model && requested.includes(String(builder.model).toLowerCase())) {
      return `Denied: the verifier may not run on ${t.model}, the model that wrote the code (${builder.name}); leave the model unset so the verifier's own (${role.model ?? 'its frontmatter'}) applies.`;
    }
  }
  return null;
}

if (isMain(import.meta.url)) runGuard((input) => decide(input));
