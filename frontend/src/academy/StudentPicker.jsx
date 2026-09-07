import { useEffect, useState } from 'react'

import { apiPage } from '../lib/api'

/** Type-to-search picker for choosing one member. */
export default function StudentPicker({ value, onChange, placeholder = 'Search members…' }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])

  useEffect(() => {
    if (!search) return
    const timer = setTimeout(() => {
      apiPage(`/students/?search=${encodeURIComponent(search)}`)
        .then((page) => setResults(page.items.slice(0, 8)))
        .catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [search])

  if (value) {
    return (
      <span className="picked">
        <strong>{value.full_name}</strong>
        <button type="button" className="link" onClick={() => onChange(null)}>change</button>
      </span>
    )
  }

  return (
    <span className="picker">
      <input
        type="search"
        placeholder={placeholder}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          if (!e.target.value) setResults([])
        }}
      />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((student) => (
            <li key={student.id}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  onChange(student)
                  setSearch('')
                  setResults([])
                }}
              >
                {student.full_name}
                {student.branch_name && <span className="muted small"> · {student.branch_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
