import type {
  OfficerKey,
  ProjectPermissions,
  ProjectRoleKind,
  RoleAssignmentConsent,
  RoleColor,
} from "@quagga/types";
import type { OfficerRequirement } from "@quagga/core";
import type {
  createRoleAction,
  renameRoleAction,
  removeRoleAction,
  setRoleAppearanceAction,
  setRolePermissionsAction,
  assignOfficerAction,
  unassignOfficerAction,
} from "@/app/(app)/camps/[slug]/actions";
import type { createRoleWithSetupAction } from "@/app/(app)/camps/[slug]/settings/roles/actions";

// View models + action types shared by the Roles & Officers settings screen
// (canvas ZyKzw desktop / TIrbC mobile). Kept in one module so the row
// components can be split out without circular imports.

export interface RoleVM {
  id: string;
  name: string;
  kind: ProjectRoleKind;
  color: RoleColor;
  emoji: string | null;
  permissions: ProjectPermissions;
  officerKey: OfficerKey | null;
  /** Members holding this role (baseline = every member — derived, never stored). */
  memberCount: number;
}

export interface MemberVM {
  membershipId: string;
  userId: string;
  displayName: string;
}

export interface OfficerAssignmentVM {
  membershipId: string;
  consent: RoleAssignmentConsent;
  orgVisible: boolean;
}

export interface OfficerVM {
  roleId: string;
  officerKey: OfficerKey;
  name: string;
  emoji: string | null;
  color: RoleColor;
  requirement: OfficerRequirement;
  assignments: OfficerAssignmentVM[];
}

export type CreateRoleAction = typeof createRoleAction;
export type CreateRoleWithSetupAction = typeof createRoleWithSetupAction;
export type RenameRoleAction = typeof renameRoleAction;
export type RemoveRoleAction = typeof removeRoleAction;
export type SetRoleAppearanceAction = typeof setRoleAppearanceAction;
export type SetRolePermissionsAction = typeof setRolePermissionsAction;
export type AssignOfficerAction = typeof assignOfficerAction;
export type UnassignOfficerAction = typeof unassignOfficerAction;

/**
 * What each officer is FOR (Quaggapedia receipts, quoted in questionnaire-spec
 * §"Officer roles"). Requirement state itself is never hardcoded here — it comes
 * from `officerRequirements()` in @quagga/core via the store.
 */
export const OFFICER_PURPOSE: Record<OfficerKey, string> = {
  lnt_officer:
    "Leave No Trace lead — AfrikaBurn's named contact for MOOP and pack-out.",
  safety_officer: "Manages the safety aspects of your camp.",
  fire_safety_officer:
    "Fire safety — extinguishers, flame effects, braais, fuel storage.",
  sound_officer:
    "Owns your amplified sound rig and its levels — required from sound level 2.",
  safety_monitor:
    "On-duty and visible during the burn (STAR: multiple and visible).",
};

/** Collapsed-row tag per kind (canvas: DEFAULT / BASELINE · EVERYONE / CUSTOM). */
export const KIND_TAG: Record<ProjectRoleKind, string> = {
  captain: "Default",
  baseline: "Baseline · everyone",
  default: "Default",
  custom: "Custom",
  officer: "Officer",
};
