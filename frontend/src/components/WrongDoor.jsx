/** Signed in, but at the wrong entrance. Says which one is right rather than
 *  leaving somebody retyping a password that was never the problem. */
export default function WrongDoor({ heading, detail, href, linkLabel, onSignOut }) {
  return (
    <div className="centered">
      <div className="card">
        <h2>{heading}</h2>
        <p className="muted">{detail}</p>
        <div className="row-actions">
          {href && <a href={href}>{linkLabel}</a>}
          <button type="button" className="link" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
