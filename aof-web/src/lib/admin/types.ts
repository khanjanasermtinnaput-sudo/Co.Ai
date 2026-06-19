// ── Admin System — TypeScript types ───────────────────────────────────────────
// All types mirror the database schema in 0003_admin_system.sql.
// Imported by API routes, server utilities, and (non-sensitive) admin UI components.

import type { UserTier } from "@/store/auth-store";

// ── Roles ─────────────────────────────────────────────────────────────────────

/** Elevated roles stored in user_roles. USER is implicit (no row in the table). */
export type AdminRole = "OWNER" | "ADMIN" | "STAFF" | "BETA_TESTER" | "USER";

// ── Permissions ───────────────────────────────────────────────────────────────

export type AdminPermission =
  // Ownership
  | "transfer-ownership"
  | "grant-admin"
  | "remove-admin"
  | "emergency-controls"
  // User management
  | "manage-users"
  | "view-users"
  | "provide-support"
  // Subscriptions & codes
  | "manage-subscriptions"
  | "manage-codes"
  // Feature management
  | "manage-features"
  // Analytics & logs
  | "view-analytics"
  | "view-logs"
  // Beta
  | "access-beta"
  // Baseline
  | "standard-access";

// ── Beta features ─────────────────────────────────────────────────────────────

export type BetaFeature =
  | "titan-beta"
  | "cli-beta"
  | "coagentix-code-beta"
  | "experimental-models"
  | "early-access";

// ── Log severity & action categories ─────────────────────────────────────────

export type LogSeverity = "info" | "warning" | "error" | "critical";

/** Dot-namespaced action strings written to system_logs.action. */
export type LogAction =
  // User lifecycle
  | "user.login"
  | "user.logout"
  | "user.signup"
  | "user.update"
  | "user.delete"
  // Subscription management
  | "subscription.grant"
  | "subscription.revoke"
  | "subscription.expire"
  | "subscription.upgrade"
  | "subscription.downgrade"
  // Redeem codes
  | "redeem_code.create"
  | "redeem_code.use"
  | "redeem_code.disable"
  | "redeem_code.delete"
  // Beta access
  | "beta.grant"
  | "beta.revoke"
  // API / provider errors
  | "api.error"
  | "api.rate_limit"
  | "api.provider_fail"
  // Admin actions
  | "admin.role_grant"
  | "admin.role_revoke"
  | "admin.feature_flag_update"
  | "admin.announcement_create"
  | "admin.announcement_update"
  | "admin.announcement_delete"
  | "admin.emergency_action";

// ── Announcement ──────────────────────────────────────────────────────────────

export type AnnouncementType = "maintenance" | "feature" | "beta" | "promotion" | "info";
export type AnnouncementLocation = "homepage" | "dashboard" | "chat" | "coagentix-code";

// ── Database row types ────────────────────────────────────────────────────────

export interface UserRole {
  id: string;
  user_id: string;
  role: Exclude<AdminRole, "USER">;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
  notes: string | null;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: Exclude<UserTier, "GUEST">;
  source: string;
  redeem_code_id: string | null;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  notes: string | null;
}

export interface RedeemCode {
  id: string;
  code: string;
  description: string | null;
  plan: Exclude<UserTier, "GUEST">;
  duration_days: number | null;
  max_uses: number | null;
  use_count: number;
  single_use_per_user: boolean;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
}

export interface RedeemCodeUse {
  id: string;
  redeem_code_id: string;
  user_id: string;
  redeemed_at: string;
  subscription_id: string | null;
}

export interface BetaAccess {
  id: string;
  user_id: string;
  feature: BetaFeature;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
  notes: string | null;
}

export interface FeatureFlag {
  id: string;
  flag_key: string;
  description: string | null;
  enabled: boolean;
  target_plans: UserTier[] | null;
  target_roles: AdminRole[] | null;
  rollout_pct: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface SystemLog {
  id: string;
  actor_id: string | null;
  action: LogAction | string;
  target_id: string | null;
  target_type: string | null;
  metadata: Record<string, unknown> | null;
  severity: LogSeverity;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: AnnouncementType;
  show_on: AnnouncementLocation[];
  target_tiers: UserTier[] | null;
  cta_label: string | null;
  cta_url: string | null;
  dismissable: boolean;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiUsageMetric {
  id: string;
  user_id: string | null;
  provider: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  error_message: string | null;
  feature: string | null;
  route_target: string | null;
  created_at: string;
}

// ── Composite admin types ─────────────────────────────────────────────────────

/** Full user profile as shown in the Admin Panel user table. */
export interface AdminUser {
  /** Supabase auth.users.id */
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  /** Canonical plan from auth.users.app_metadata.tier */
  tier: UserTier;
  /** Effective admin role (USER when no row in user_roles) */
  role: AdminRole;
  /** Active subscription record, if any */
  active_subscription: Subscription | null;
  /** Beta features this user has been granted */
  beta_features: BetaFeature[];
  /** When this Supabase account was created */
  created_at: string;
  /** Last sign-in timestamp from Supabase auth */
  last_sign_in_at: string | null;
  /** Whether the account is banned in Supabase */
  is_banned: boolean;
}

/** Row shown in the user-with-role list (lighter than AdminUser). */
export interface UserWithRole {
  id: string;
  email: string;
  display_name: string | null;
  tier: UserTier;
  role: AdminRole;
  created_at: string;
  last_sign_in_at: string | null;
}

// ── Input types for admin operations ─────────────────────────────────────────

export interface GrantSubscriptionInput {
  user_id: string;
  plan: Exclude<UserTier, "GUEST">;
  /** Number of days until the subscription expires (omit for lifetime). */
  duration_days?: number;
  source?: string;
  notes?: string;
}

export interface RevokeSubscriptionInput {
  subscription_id: string;
  notes?: string;
}

export interface CreateRedeemCodeInput {
  code: string;
  plan: Exclude<UserTier, "GUEST">;
  description?: string;
  /** How many days the subscription lasts after redemption (omit = lifetime). */
  duration_days?: number;
  /** Maximum total redemptions (omit = unlimited). */
  max_uses?: number;
  /** Whether each user may only use this code once (default: true). */
  single_use_per_user?: boolean;
  /** ISO date string when the code expires (omit = never). */
  expires_at?: string;
}

export interface GrantBetaAccessInput {
  user_id: string;
  feature: BetaFeature;
  /** ISO date string when access expires (omit = never). */
  expires_at?: string;
  notes?: string;
}

export interface GrantRoleInput {
  user_id: string;
  role: Exclude<AdminRole, "USER">;
  /** ISO date string when the role expires (omit = never). */
  expires_at?: string;
  notes?: string;
}

export interface CreateFeatureFlagInput {
  flag_key: string;
  description?: string;
  enabled?: boolean;
  target_plans?: UserTier[];
  target_roles?: AdminRole[];
  rollout_pct?: number;
}

export interface UpdateFeatureFlagInput extends Partial<CreateFeatureFlagInput> {
  id: string;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  type?: AnnouncementType;
  show_on?: AnnouncementLocation[];
  target_tiers?: UserTier[];
  cta_label?: string;
  cta_url?: string;
  dismissable?: boolean;
  starts_at?: string;
  ends_at?: string;
}

// ── Pagination & filtering ────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export type SortDirection = "asc" | "desc";

export interface UserTableFilter {
  search?: string;
  tier?: UserTier;
  role?: AdminRole;
  has_beta?: BetaFeature;
  created_after?: string;
  created_before?: string;
}

export interface UserTableSort {
  field: "email" | "tier" | "role" | "created_at" | "last_sign_in_at";
  direction: SortDirection;
}

export interface SystemLogFilter {
  actor_id?: string;
  action?: string;
  target_id?: string;
  target_type?: string;
  severity?: LogSeverity;
  since?: string;
  until?: string;
}

export interface ApiUsageFilter {
  user_id?: string;
  provider?: string;
  model?: string;
  success?: boolean;
  since?: string;
  until?: string;
}

// ── Summary / analytics ───────────────────────────────────────────────────────

export interface UsageSummary {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  /** Breakdown keyed by provider slug */
  by_provider: Record<string, {
    requests: number;
    tokens: number;
    cost_usd: number;
  }>;
}

export interface TierDistribution {
  tier: UserTier;
  count: number;
  pct: number;
}

export interface AdminDashboardStats {
  total_users: number;
  active_subscriptions: number;
  active_announcements: number;
  enabled_feature_flags: number;
  tier_distribution: TierDistribution[];
  usage_last_24h: UsageSummary;
}
