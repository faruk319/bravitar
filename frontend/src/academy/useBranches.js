import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

/** Branches for the current org, for the branch filter every module shares. */
export function useBranches() {
  const [branches, setBranches] = useState([])

  useEffect(() => {
    apiFetch('/organizations/current/branches/')
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [])

  return branches
}
