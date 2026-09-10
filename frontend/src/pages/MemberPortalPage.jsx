import { useEffect, useState } from 'react'

import MemberApp from '../member/MemberApp'
import WrongDoor from '../components/WrongDoor'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { staffPortalUrl } from '../lib/portal'

/**
 * The member's door. Only member records open it.
 *
 * A staff account signing in here is sent to its own entrance rather than
 * being told its password is wrong, which is the confusing half of getting
 * this separation right.
 */
export default function MemberPortalPage() {
  const { signOut } = useAuth()
  const [members, setMembers] = useState(null)
  const [staff, setStaff] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/member/')
      .then((mine) => setMembers(mine.members))
      .catch((err) =>
        apiFetch('/organizations/current/')
          .then(() => setStaff(true))
          .catch(() => setError(err.message)),
      )
  }, [])

  if (staff) {
    return (
      <WrongDoor
        heading="This is the member sign in"
        detail="That account runs this academy, so it belongs at the staff entrance."
        href={staffPortalUrl()}
        linkLabel="Go to staff sign in"
        onSignOut={signOut}
      />
    )
  }

  if (error) {
    return (
      <WrongDoor
        heading="No member record here"
        detail={`${error} Ask the academy to turn your login on — they do it from your member page.`}
        onSignOut={signOut}
      />
    )
  }

  if (!members) return <div className="centered"><p className="muted">Loading…</p></div>

  return <MemberApp members={members} onSignOut={signOut} />
}
