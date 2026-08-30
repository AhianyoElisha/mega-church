// Who may send which category of SMS.
//
// Pure — no Appwrite, no request. The rule is a function of a label and a
// category so it can be unit-tested, and so the route reads as one call rather
// than as a condition somebody later "simplifies".

import type { SmsCategory } from '@/lib/appwrite/config'
import type { UserLabel } from '@/lib/auth/types'

/**
 * The categories each label may send.
 *
 * A MAP rather than a list of forbidden combinations, so a new SMS category is
 * refused to the treasurer by default the moment somebody adds one. That is the
 * same posture `shepherd` gets from appearing on GET handlers only: the default
 * is refusal, and a new thing does not have to be remembered.
 */
const SENDABLE: Partial<Record<UserLabel, readonly SmsCategory[]>> = {
  admin: ['birthday', 'tithe', 'general'],
  /**
   * The treasurer's whole job, and their whole reach.
   *
   * They may thank people for their tithe and nothing else. `birthday` is the
   * church's own voice on a member's own day, and `general` is an open cheque
   * against the SMS credit — neither is the treasurer's to spend, and both are
   * an administrator's.
   */
  treasurer: ['tithe'],
}

export type SmsSendCheck = { ok: true } | { ok: false; error: string; status: 403 }

/**
 * Authority over a category means BOTH sending it and authoring its templates,
 * and both read this one map.
 *
 * They are deliberately not two maps. The treasurer's remit is "tithe", not
 * "tithe sends but somebody else's tithe wording" — and a treasurer who may
 * send a message but not write one has to ask an administrator to type it for
 * them, which is the thing giving them the account was meant to stop.
 *
 * If the church ever wants send-without-author, split the map THEN. Splitting
 * it now would be inventing a distinction nobody has asked for and then having
 * to keep two lists in step.
 */

/**
 * May this account send this category?
 *
 * A refusal NAMES the category and says who can, rather than silently
 * downgrading the send to one that is allowed. The rule this follows is the one
 * a head's refused fields already follow: a caller told nothing assumes the
 * thing they asked for happened. Here that would mean a treasurer believing a
 * hundred birthday messages went out.
 */
export function canSendSmsCategory(label: UserLabel, category: SmsCategory): SmsSendCheck {
  const allowed = SENDABLE[label]
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: 'This account cannot send messages.',
    }
  }
  if (!allowed.includes(category)) {
    return {
      ok: false,
      status: 403,
      error:
        `This account can only send ${allowed.join(' and ')} messages, not ${category}. ` +
        'An administrator sends the rest.',
    }
  }
  return { ok: true }
}

/** The categories to OFFER this account, so the UI never shows a doomed choice. */
export function sendableCategories(label: UserLabel | undefined): readonly SmsCategory[] {
  return (label && SENDABLE[label]) ?? []
}

/**
 * May this account write a TEMPLATE in this category?
 *
 * Same authority as sending, read from the same map — see the note above. The
 * refusal names the category for the same reason the send one does: a treasurer
 * told only "forbidden" cannot tell whether the account is wrong, the category
 * is wrong, or the feature is broken.
 *
 * This governs CREATING a template. Editing and deleting an existing one stay
 * admin-only, because a template is shared: the church's standard tithe message
 * is the one the whole congregation receives, and changing it out from under an
 * administrator is a different act from adding one of your own.
 */
export function canManageTemplateCategory(
  label: UserLabel,
  category: SmsCategory,
): SmsSendCheck {
  const allowed = SENDABLE[label]
  if (!allowed) {
    return { ok: false, status: 403, error: 'This account cannot write message templates.' }
  }
  if (!allowed.includes(category)) {
    return {
      ok: false,
      status: 403,
      error:
        `This account can only write ${allowed.join(' and ')} templates, not ${category}. ` +
        'An administrator writes the rest.',
    }
  }
  return { ok: true }
}
