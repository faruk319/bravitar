/**
 * Two doors into one academy, and neither opens for the other's people.
 *
 * Staff — owners, managers, coaches — run the academy from the dashboard.
 * Members see their own record. They are separate rows already (Membership
 * is a login for somebody who runs the place, Student is an enrolment), so
 * the separation here is the surface: a different address, a different sign
 * in screen, and each one refusing the other's accounts by name.
 *
 * The same shape the established systems use: one identity, two portals.
 */

export const MEMBER_PATH = '/member'

export function isMemberPortal() {
  return window.location.pathname.startsWith(MEMBER_PATH)
}

function withPath(path) {
  const { protocol, host } = window.location
  return `${protocol}//${host}${path}`
}

export const memberPortalUrl = () => withPath(`${MEMBER_PATH}/`)
export const staffPortalUrl = () => withPath('/')
