import { useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Menu, X } from "lucide-react";
import Brand from "./Brand";

export default function Header({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  return (
    <header>
      <Brand />
      <button
        className="menu"
        aria-label="Toggle navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? "open" : ""}>
        <a href="#how">How it works</a>
        
        {user ? (
          <>
            <Link className="nav-history" to="/dashboard#history">
              History
            </Link>
            <Link className="profile" to="/dashboard">
              {user.name?.slice(0, 1).toUpperCase()}
            </Link>
            <button className="link-button" onClick={onLogout}>
              <LogOut size={16} /> Log out
            </button>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link className="button small" to="/signup">
              Create account
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
