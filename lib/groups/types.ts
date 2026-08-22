// Constituencies and bacentas. Pure types — no Appwrite imports, so this
// module is safe to pull into a browser bundle.
//
// Vocabulary, because the two are easy to confuse and the church does not:
//   constituency — where a member LIVES. Exactly one per member.
//   bacenta      — the work group a member SERVES in. Zero or many per member.
//   category     — a FAMILY of bacentas ("Choir" over Biazo / Living Waters).
//                  Optional: "Technical Team" is a bacenta with no family.

/** Which half of the app a leader is looking at. */
export type GroupKind = 'constituency' | 'bacenta'

export type Constituency = {
  $id: string
  name: string
  description: string | null
  /** Appwrite user `$id` of the head. Null until one is appointed. */
  head_user_id: string | null
  /** Denormalised for display, refreshed when the head changes. */
  head_name: string | null
  sort_order: number
  created_by: string | null
  $createdAt: string
}

export type BacentaCategory = {
  $id: string
  name: string
  description: string | null
  sort_order: number
  created_by: string | null
  $createdAt: string
}

export type Bacenta = {
  $id: string
  name: string
  /**
   * `null` is the STANDALONE bacenta — "Technical Team", which has members
   * directly under it rather than sibling groups. It is not a missing value.
   */
  category_id: string | null
  description: string | null
  head_user_id: string | null
  head_name: string | null
  sort_order: number
  created_by: string | null
  $createdAt: string
}

/** A row in a list, with the counts the UI needs and no extra round trip. */
export type ConstituencyWithCount = Constituency & { member_count: number }
export type BacentaWithCount = Bacenta & {
  member_count: number
  /** Resolved from `category_id`; null for a standalone bacenta. */
  category_name: string | null
}

/**
 * The shape the bacentas page renders: categories holding their bacentas, then
 * the standalone ones, then — deliberately visible rather than dropped —
 * anything pointing at a category that no longer exists.
 */
export type BacentaTree = {
  categories: { category: BacentaCategory; bacentas: BacentaWithCount[] }[]
  standalone: BacentaWithCount[]
  /** Bacentas whose `category_id` matches no category. Should be empty. */
  orphans: BacentaWithCount[]
}

// --- inputs -----------------------------------------------------------------

export type ConstituencyInput = {
  name: string
  description?: string | null
  head_user_id?: string | null
}

export type BacentaCategoryInput = {
  name: string
  description?: string | null
}

export type BacentaInput = {
  name: string
  /** Omit or pass null to create a standalone bacenta. */
  category_id?: string | null
  description?: string | null
  head_user_id?: string | null
}

/**
 * Bulk membership change.
 *
 *   add    — put these members in the group, leave everyone else alone
 *   remove — take these members out, leave everyone else alone
 *   set    — the group ends up being exactly these members
 *
 * `set` is destructive by design and is what the "replace the whole list"
 * control sends; `add` is what the group-select assigner sends, because the
 * common case is topping up an existing group, not rebuilding it.
 */
export type MembershipMode = 'add' | 'remove' | 'set'

export type MembershipInput = {
  member_ids: string[]
  mode: MembershipMode
}

export type MembershipResult = {
  added: number
  removed: number
  /** Size of the group after the change. */
  total: number
}

// --- responses --------------------------------------------------------------

export type ListConstituenciesResponse =
  | { ok: true; constituencies: ConstituencyWithCount[] }
  | { ok: false; error: string }

export type ConstituencyResponse =
  | { ok: true; constituency: Constituency }
  | { ok: false; error: string }

export type ListBacentasResponse =
  | { ok: true; categories: BacentaCategory[]; bacentas: BacentaWithCount[] }
  | { ok: false; error: string }

export type BacentaResponse = { ok: true; bacenta: Bacenta } | { ok: false; error: string }

export type BacentaCategoryResponse =
  | { ok: true; category: BacentaCategory }
  | { ok: false; error: string }

export type MembershipResponse =
  | ({ ok: true } & MembershipResult)
  | { ok: false; error: string }

/** One member as a group roster shows them. */
export type GroupMember = {
  $id: string
  full_name: string
  photo_file_id: string | null
  call_number: string
  whatsapp_number: string | null
  birth_month: number | null
  birth_day: number | null
  status: 'active' | 'inactive'
  home_service: 'first' | 'second'
  /** How many sessions this member has been marked present at, ever. */
  attendance_count: number
  /** The most recent date they were marked present, or null. */
  last_seen: string | null
}

export type GroupDetailResponse =
  | {
      ok: true
      kind: GroupKind
      group: Constituency | Bacenta
      members: GroupMember[]
    }
  | { ok: false; error: string }

/**
 * What a signed-in `leader` may see: only the groups that name them as head.
 * An admin gets the same shape covering everything, so one page renders both.
 */
export type MyGroupsResponse =
  | {
      ok: true
      constituencies: ConstituencyWithCount[]
      bacentas: BacentaWithCount[]
    }
  | { ok: false; error: string }

/** An account that can be appointed head of a group. */
export type LeaderAccount = {
  id: string
  name: string
  email: string
  /** Groups they already head, so the admin can see the load before adding. */
  heads: { kind: GroupKind; name: string }[]
}

export type ListLeadersResponse =
  | { ok: true; leaders: LeaderAccount[] }
  | { ok: false; error: string }

export type CreateLeaderResponse =
  | {
      ok: true
      leader: LeaderAccount
      /**
       * Shown ONCE and never stored. This app has no forgot-password flow, so
       * an admin who dismisses the dialog without copying it has to create a
       * new password in the Appwrite console rather than recover this one —
       * which is why the dialog says so before it will close.
       */
      password: string
    }
  | { ok: false; error: string }

export type SetLeaderPasswordResponse =
  | { ok: true; name: string; email: string; password: string }
  | { ok: false; error: string }
