"use client"
import DashboardLayout from "@/components/DashboardLayout"
import SearchSelect from "@/components/SearchSelect"
import type { SelectOption } from "@/components/SearchSelect"
import { useAuthContext, type WugiRole } from "@/context/AuthContext"
import { useEffect, useState } from "react"
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore"
import { getFunctions, httpsCallable } from "firebase/functions"
import { db } from "@/lib/firebase"
import { useRouter } from "next/navigation"
import { logAudit } from "@/lib/auditLog"

type DashUser = { id:string; email:string; role:WugiRole; venueIds:string[]; eventIds:string[]; tableAccess:boolean; active:boolean; createdAt:string }

const ROLE_INFO: Record<string,{label:string;color:string;bg:string;desc:string}> = {
  super_admin: { label:"Super Admin",  color:"#92400e", bg:"#fef3c7", desc:"Full access to everything" },
  moderator:   { label:"Moderator",    color:"#1e40af", bg:"#dbeafe", desc:"Platform moderation" },
  support:     { label:"Support",      color:"#4b5563", bg:"#f3f4f6", desc:"Customer support access" },
  venue_admin: { label:"Venue Admin",  color:"#065f46", bg:"#d1fae5", desc:"Full access to assigned venues" },
  venue_staff: { label:"Venue Staff",  color:"#047857", bg:"#ecfdf5", desc:"Read-only for assigned venues" },
  event_admin: { label:"Event Admin",  color:"#1d4ed8", bg:"#eff6ff", desc:"Full access to assigned events" },
  event_staff: { label:"Event Staff",  color:"#3730a3", bg:"#eef2ff", desc:"Read-only for assigned events" },
}

const CREATABLE: Record<string,WugiRole[]> = {
  super_admin: ["super_admin","moderator","support","venue_admin","venue_staff","event_admin","event_staff"],
  moderator:   ["venue_admin","venue_staff","event_admin","event_staff"],
  venue_admin: ["venue_staff","event_admin","event_staff"],
}

const INPUT: React.CSSProperties = { padding:"9px 12px", borderRadius:8, border:"1px solid #e5e7eb", fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" }

export default function UsersPage() {
  const router = useRouter()
  const { user, loading, hasDashboardAccess, canManageUsers, role, profile } = useAuthContext()
  const [users, setUsers] = useState<DashUser[]>([])
  const [venues, setVenues] = useState<SelectOption[]>([])
  const [events, setEvents] = useState<SelectOption[]>([])
  const [modal, setModal] = useState(false)
  const [editUser, setEditUser] = useState<DashUser | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // New user form
  const [nEmail, setNEmail]       = useState("")
  const [nPassword, setNPassword] = useState("")
  const [nRole, setNRole]         = useState<WugiRole>("venue_staff")
  const [nVenueIds, setNVenueIds] = useState<string[]>([])
  const [nEventIds, setNEventIds] = useState<string[]>([])
  const [nTableAccess, setNTableAccess] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!hasDashboardAccess) router.replace("/unauthorized")
  }, [loading, user, hasDashboardAccess, router])

  useEffect(() => {
    if (!user) return
    const u1 = onSnapshot(collection(db, "users"), s =>
      setUsers(s.docs.map(d => ({
        id: d.id, email: d.data().email || "—",
        role: (d.data().role as WugiRole) || null,
        venueIds: d.data().venueIds || [],
        eventIds: d.data().eventIds || [],
        tableAccess: d.data().tableAccess || false,
        active: d.data().active !== false,
        createdAt: d.data().createdAt?.toDate?.()?.toLocaleDateString?.() || "—",
      })))
    )
    const u2 = onSnapshot(collection(db, "venues"), s =>
      setVenues(s.docs.map(d => ({ id: d.id, label: d.data().name || "Unnamed", sub: d.data().neighborhood || "" })).sort((a,b) => a.label.localeCompare(b.label)))
    )
    const u3 = onSnapshot(collection(db, "events"), s =>
      setEvents(s.docs.map(d => ({ id: d.id, label: d.data().title || "Untitled", sub: d.data().venue || "" })).sort((a,b) => a.label.localeCompare(b.label)))
    )
    return () => { u1(); u2(); u3() }
  }, [user])

  function resetForm() {
    setNEmail(""); setNPassword(""); setNRole("venue_staff")
    setNVenueIds([]); setNEventIds([]); setNTableAccess(false)
    setEditUser(null); setError("")
  }

  async function createUser() {
    if (!nEmail || !nPassword) { setError("Email and password required"); return }
    setSaving(true); setError("")
    try {
      const fn = httpsCallable(getFunctions(), "createDashboardUser")
      await fn({ email: nEmail, password: nPassword, role: nRole, venueIds: nVenueIds, eventIds: nEventIds, tableAccess: nTableAccess })
      await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "created_user", targetId: "", targetName: nEmail })
      setModal(false); resetForm()
    } catch(e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function updateUser(uid: string, updates: Partial<DashUser>) {
    await updateDoc(doc(db, "users", uid), { ...updates, updatedAt: serverTimestamp() })
    await logAudit({ adminId: user!.uid, adminEmail: user!.email!, action: "updated_user", targetId: uid, targetName: updates.email || uid })
  }

  async function toggleActive(u: DashUser) {
    await updateUser(u.id, { active: !u.active } as any)
  }

  const creatableRoles = CREATABLE[role || ""] || []
  const isSelf = (uid: string) => uid === user?.uid

  if (loading || !user || !hasDashboardAccess) return null

  const needsVenues = ["venue_admin","venue_staff","event_admin","event_staff"].includes(nRole || "")
  const needsEvents = ["event_admin","event_staff"].includes(nRole || "")
  const canHaveTableAccess = nRole === "event_admin"

  return (
    <DashboardLayout>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 style={{ fontSize:22, fontWeight:700, color:"#111827", margin:0 }}>Users</h1>
            <p style={{ fontSize:14, color:"#6b7280", marginTop:4 }}>{users.length} dashboard users</p>
          </div>
          {creatableRoles.length > 0 && (
            <button onClick={() => { resetForm(); setModal(true) }} style={{ padding:"10px 20px", borderRadius:8, background:"#111827", color:"#fff", border:"none", fontWeight:600, fontSize:14, cursor:"pointer" }}>
              + Add User
            </button>
          )}
        </div>

        {/* Role legend */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
          {Object.entries(ROLE_INFO).map(([r,info]) => (
            <span key={r} style={{ padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:600, background:info.bg, color:info.color }}>{info.label}</span>
          ))}
        </div>

        {/* Users table */}
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14 }}>
            <thead><tr style={{ background:"#f9fafb", borderBottom:"1px solid #e5e7eb" }}>
              {["User","Role","Venues / Events","Access","Status","Actions"].map(h =>
                <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontWeight:600, color:"#374151", fontSize:13 }}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {users.length===0 ? (
                <tr><td colSpan={6} style={{ padding:"40px 16px", textAlign:"center", color:"#9ca3af" }}>No users yet</td></tr>
              ) : users.map((u,i) => {
                const ri = ROLE_INFO[u.role || ""] || { label:"Unknown", color:"#6b7280", bg:"#f3f4f6" }
                return (
                  <tr key={u.id} style={{ borderBottom:i<users.length-1?"1px solid #f3f4f6":"none", opacity:u.active?1:0.55 }}>
                    <td style={{ padding:"12px 16px" }}>
                      <p style={{ margin:0, fontWeight:600, color:"#111827", fontSize:14 }}>{u.email}</p>
                      {isSelf(u.id) && <span style={{ fontSize:11, color:"#9ca3af" }}>you</span>}
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      <span style={{ padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:600, background:ri.bg, color:ri.color }}>{ri.label}</span>
                    </td>
                    <td style={{ padding:"12px 16px", fontSize:12, color:"#6b7280" }}>
                      {u.venueIds.length>0 && <div>{u.venueIds.length} venue{u.venueIds.length!==1?"s":""}</div>}
                      {u.eventIds.length>0 && <div>{u.eventIds.length} event{u.eventIds.length!==1?"s":""}</div>}
                      {u.venueIds.length===0 && u.eventIds.length===0 && "—"}
                    </td>
                    <td style={{ padding:"12px 16px", fontSize:12 }}>
                      {u.tableAccess && <span style={{ padding:"2px 8px", borderRadius:6, background:"#fef3c7", color:"#92400e", fontWeight:600 }}>Tables</span>}
                      {!u.tableAccess && "—"}
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      <span style={{ padding:"3px 8px", borderRadius:20, fontSize:12, fontWeight:600, background:u.active?"#dcfce7":"#f3f4f6", color:u.active?"#15803d":"#6b7280" }}>
                        {u.active?"Active":"Inactive"}
                      </span>
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      {!isSelf(u.id) && canManageUsers && (
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={() => toggleActive(u)} style={{ padding:"5px 10px", borderRadius:6, fontSize:12, border:"none", cursor:"pointer", background:u.active?"#fee2e2":"#dcfce7", color:u.active?"#b91c1c":"#15803d", fontWeight:600 }}>
                            {u.active?"Deactivate":"Activate"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create user modal */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={() => setModal(false)}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:540, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding:"24px 28px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>Add Dashboard User</h2>
              <button onClick={() => setModal(false)} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#9ca3af" }}>×</button>
            </div>
            <div style={{ padding:"24px 28px", display:"flex", flexDirection:"column", gap:16 }}>
              {error && <div style={{ padding:"10px 14px", background:"#fee2e2", borderRadius:8, color:"#b91c1c", fontSize:13 }}>{error}</div>}

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:6, gridColumn:"1/-1" }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Email *</label>
                  <input style={INPUT} type="email" value={nEmail} onChange={e=>setNEmail(e.target.value)} placeholder="user@example.com"/>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, gridColumn:"1/-1" }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Password *</label>
                  <input style={INPUT} type="password" value={nPassword} onChange={e=>setNPassword(e.target.value)} placeholder="Min 8 characters"/>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, gridColumn:"1/-1" }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Role</label>
                  <select style={INPUT} value={nRole || ""} onChange={e=>setNRole(e.target.value as WugiRole)}>
                    {creatableRoles.map(r => {
                      const info = ROLE_INFO[r || ""]
                      return <option key={r} value={r || ""}>{info?.label || r} — {info?.desc}</option>
                    })}
                  </select>
                </div>
              </div>

              {needsVenues && (
                <div>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151", display:"block", marginBottom:6 }}>Assign Venues</label>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {venues.map(v => {
                      const sel = nVenueIds.includes(v.id)
                      return <button key={v.id} type="button" onClick={() => setNVenueIds(ids => sel ? ids.filter(x=>x!==v.id) : [...ids,v.id])}
                        style={{ padding:"5px 12px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:sel?600:400, background:sel?"#064e3b":"#f3f4f6", color:sel?"#fff":"#374151", border:"1px solid "+(sel?"#064e3b":"#e5e7eb") }}>{v.label}</button>
                    })}
                  </div>
                  {nVenueIds.length===0 && <p style={{ fontSize:12, color:"#f59e0b", marginTop:6 }}>Select at least one venue</p>}
                </div>
              )}

              {needsEvents && (
                <div>
                  <label style={{ fontSize:13, fontWeight:600, color:"#374151", display:"block", marginBottom:6 }}>Assign Events</label>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, maxHeight:160, overflowY:"auto" }}>
                    {events.map(ev => {
                      const sel = nEventIds.includes(ev.id)
                      return <button key={ev.id} type="button" onClick={() => setNEventIds(ids => sel ? ids.filter(x=>x!==ev.id) : [...ids,ev.id])}
                        style={{ padding:"5px 12px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:sel?600:400, background:sel?"#1d4ed8":"#f3f4f6", color:sel?"#fff":"#374151", border:"1px solid "+(sel?"#1d4ed8":"#e5e7eb") }}>{ev.label}</button>
                    })}
                  </div>
                </div>
              )}

              {canHaveTableAccess && (
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:"#fef3c7", borderRadius:8 }}>
                  <input type="checkbox" id="tableAccess" checked={nTableAccess} onChange={e=>setNTableAccess(e.target.checked)} style={{ width:18, height:18, cursor:"pointer" }}/>
                  <label htmlFor="tableAccess" style={{ fontSize:14, cursor:"pointer", color:"#92400e", fontWeight:500 }}>
                    Grant table management access (can set up and sell VIP tables)
                  </label>
                </div>
              )}
            </div>
            <div style={{ padding:"16px 28px", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={() => { setModal(false); resetForm() }} style={{ padding:"10px 20px", borderRadius:8, background:"#f3f4f6", border:"none", cursor:"pointer", fontSize:14 }}>Cancel</button>
              <button onClick={createUser} disabled={saving} style={{ padding:"10px 24px", borderRadius:8, background:"#111827", color:"#fff", border:"none", cursor:"pointer", fontSize:14, fontWeight:600, opacity:saving?0.7:1 }}>
                {saving?"Creating...":"Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
