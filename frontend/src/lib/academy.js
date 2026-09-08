const KEY = 'bravitar.academy'

/** The academy the user is looking at: a slug, 'all', or null for the only one. */
export function currentAcademy() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setCurrentAcademy(value) {
  try {
    if (value) localStorage.setItem(KEY, value)
    else localStorage.removeItem(KEY)
  } catch {
    // A browser refusing storage just means the choice doesn't outlive the tab.
  }
}

export function academyHeader() {
  const academy = currentAcademy()
  return academy ? { 'X-Academy': academy } : {}
}
