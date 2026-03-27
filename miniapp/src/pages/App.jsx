import { useEffect, useState } from "react";
import { z } from "zod";
import {
  createUser,
  getSubmissionHistory,
  listAuditLogs,
  listOrganizations,
  listSubmissions,
  listUsers,
  updateUser
} from "../api/admin";
import { confirmSubmission, createDraftSubmission, listMySubmissions } from "../api/submissions";
import { useAuth } from "../hooks/useAuth";

const submissionSchema = z.object({
  meterNumber: z.string().trim().min(3, "Р’РІРµРґРёС‚Рµ РЅРѕРјРµСЂ РїСЂРёР±РѕСЂР°"),
  currentValue: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,3})?$/, "Р’РІРµРґРёС‚Рµ РєРѕСЂСЂРµРєС‚РЅРѕРµ С‡РёСЃР»РѕРІРѕРµ Р·РЅР°С‡РµРЅРёРµ")
});

function StatusScreen({ title, description, code }) {
  return (
    <div className="page">
      <div className="card">
        <h2>{title}</h2>
        <p style={{ whiteSpace: "pre-line" }}>{description}</p>
        {code ? <p>РљРѕРґ: {code}</p> : null}
      </div>
    </div>
  );
}

function UserPanel({ accessToken }) {
  const [form, setForm] = useState({ meterNumber: "", currentValue: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadRecent() {
    const data = await listMySubmissions(accessToken);
    setRecent(data.submissions || []);
  }

  async function submitDraft(event) {
    event.preventDefault();
    setError("");
    const parsed = submissionSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    try {
      setLoading(true);
      const response = await createDraftSubmission(parsed.data, accessToken);
      setPending(response.submission);
      await loadRecent();
    } catch (err) {
      setError(err.message || "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ С‡РµСЂРЅРѕРІРёРє");
    } finally {
      setLoading(false);
    }
  }

  async function confirmCurrent() {
    if (!pending) {
      return;
    }
    try {
      setLoading(true);
      await confirmSubmission(pending.id, accessToken);
      setPending(null);
      setForm({ meterNumber: "", currentValue: "" });
      await loadRecent();
    } catch (err) {
      setError(err.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґС‚РІРµСЂРґРёС‚СЊ Р·Р°СЏРІРєСѓ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecent();
  }, []);

  return (
    <div>
      <h3>РџРµСЂРµРґР°С‡Р° РїРѕРєР°Р·Р°РЅРёР№</h3>
      <form onSubmit={submitDraft}>
        <div className="field">
          <label htmlFor="meterNumber">РќРѕРјРµСЂ СЃС‡РµС‚С‡РёРєР°</label>
          <input
            id="meterNumber"
            value={form.meterNumber}
            onChange={(event) => setForm((prev) => ({ ...prev, meterNumber: event.target.value }))}
            placeholder="РќР°РїСЂРёРјРµСЂ 123456"
          />
        </div>
        <div className="field">
          <label htmlFor="currentValue">РўРµРєСѓС‰РµРµ Р·РЅР°С‡РµРЅРёРµ</label>
          <input
            id="currentValue"
            value={form.currentValue}
            onChange={(event) => setForm((prev) => ({ ...prev, currentValue: event.target.value }))}
            placeholder="РќР°РїСЂРёРјРµСЂ 88.5"
          />
        </div>
        <button className="button" type="submit" disabled={loading}>
          {loading ? "РЎРѕС…СЂР°РЅРµРЅРёРµ..." : "РЎРѕР·РґР°С‚СЊ Р·Р°СЏРІРєСѓ"}
        </button>
      </form>

      {error ? <div className="alert error">{error}</div> : null}

      {pending ? (
        <div className="alert info">
          <p>РџСЂРѕРІРµСЂСЊС‚Рµ РґР°РЅРЅС‹Рµ РїРµСЂРµРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµРј:</p>
          <p>РЎС‡РµС‚С‡РёРє: {pending.meterNumber}</p>
          <p>РџРѕРєР°Р·Р°РЅРёРµ: {pending.currentValue}</p>
          <button className="button secondary" type="button" onClick={confirmCurrent} disabled={loading}>
            РџРѕРґС‚РІРµСЂРґРёС‚СЊ РґР°РЅРЅС‹Рµ
          </button>
        </div>
      ) : null}

      <h3>РњРѕРё РїРѕСЃР»РµРґРЅРёРµ Р·Р°СЏРІРєРё</h3>
      <table>
        <thead>
          <tr>
            <th>Р”Р°С‚Р°</th>
            <th>РЎС‡РµС‚С‡РёРє</th>
            <th>Р—РЅР°С‡РµРЅРёРµ</th>
            <th>РЎС‚Р°С‚СѓСЃ</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((item) => (
            <tr key={item.id}>
              <td>{new Date(item.createdAt).toLocaleString()}</td>
              <td>{item.meterNumber}</td>
              <td>{item.currentValue}</td>
              <td>{item.status}</td>
            </tr>
          ))}
          {!recent.length ? (
            <tr>
              <td colSpan={4}>Р—Р°СЏРІРѕРє РїРѕРєР° РЅРµС‚</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function AdminPanel({ accessToken }) {
  const [tab, setTab] = useState("users");
  const [organizations, setOrganizations] = useState([]);
  const [users, setUsers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [userForm, setUserForm] = useState({
    maxUserId: "",
    firstName: "",
    lastName: "",
    role: "USER",
    organizationId: "",
    isActive: true
  });

  async function loadBaseData() {
    setError("");
    try {
      const [orgData, usersData, submissionsData, logsData] = await Promise.all([
        listOrganizations(accessToken),
        listUsers({ limit: "50" }, accessToken),
        listSubmissions({ limit: "50" }, accessToken),
        listAuditLogs({ limit: "50" }, accessToken)
      ]);
      setOrganizations(orgData.organizations || []);
      setUsers(usersData.users || []);
      setSubmissions(submissionsData.submissions || []);
      setLogs(logsData.logs || []);
    } catch (err) {
      setError(err.message || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р°РґРјРёРЅ-РґР°РЅРЅС‹Рµ");
    }
  }

  useEffect(() => {
    void loadBaseData();
  }, []);

  async function onCreateUser(event) {
    event.preventDefault();
    try {
      await createUser(
        {
          maxUserId: userForm.maxUserId,
          firstName: userForm.firstName,
          lastName: userForm.lastName || null,
          role: userForm.role,
          organizationId: userForm.organizationId || null,
          isActive: userForm.isActive
        },
        accessToken
      );
      setUserForm({
        maxUserId: "",
        firstName: "",
        lastName: "",
        role: "USER",
        organizationId: "",
        isActive: true
      });
      await loadBaseData();
    } catch (err) {
      setError(err.message || "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ");
    }
  }

  async function toggleUser(user) {
    try {
      await updateUser(user.id, { isActive: !user.isActive }, accessToken);
      await loadBaseData();
    } catch (err) {
      setError(err.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РјРµРЅРёС‚СЊ СЃС‚Р°С‚СѓСЃ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ");
    }
  }

  async function loadHistory(submissionId) {
    try {
      const data = await getSubmissionHistory(submissionId, accessToken);
      setHistory(data.history || []);
    } catch (err) {
      setError(err.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РёСЃС‚РѕСЂРёСЋ СЃС‚Р°С‚СѓСЃРѕРІ");
    }
  }

  return (
    <div>
      <h3>РђРґРјРёРЅ-РїР°РЅРµР»СЊ</h3>
      {error ? <div className="alert error">{error}</div> : null}
      <div className="tabs">
        <button className={`tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")} type="button">
          РџРѕР»СЊР·РѕРІР°С‚РµР»Рё
        </button>
        <button
          className={`tab ${tab === "submissions" ? "active" : ""}`}
          onClick={() => setTab("submissions")}
          type="button"
        >
          Р—Р°СЏРІРєРё
        </button>
        <button className={`tab ${tab === "logs" ? "active" : ""}`} onClick={() => setTab("logs")} type="button">
          Audit
        </button>
      </div>

      {tab === "users" ? (
        <div>
          <form onSubmit={onCreateUser}>
            <div className="row">
              <div className="field" style={{ flex: "1 1 150px" }}>
                <label>MAX user id</label>
                <input
                  value={userForm.maxUserId}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, maxUserId: event.target.value }))}
                />
              </div>
              <div className="field" style={{ flex: "1 1 180px" }}>
                <label>РРјСЏ</label>
                <input
                  value={userForm.firstName}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, firstName: event.target.value }))}
                />
              </div>
              <div className="field" style={{ flex: "1 1 180px" }}>
                <label>Р¤Р°РјРёР»РёСЏ</label>
                <input
                  value={userForm.lastName}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, lastName: event.target.value }))}
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: "1 1 150px" }}>
                <label>Р РѕР»СЊ</label>
                <select
                  value={userForm.role}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="field" style={{ flex: "2 1 240px" }}>
                <label>РћСЂРіР°РЅРёР·Р°С†РёСЏ</label>
                <select
                  value={userForm.organizationId}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, organizationId: event.target.value }))}
                >
                  <option value="">Р‘РµР· РѕСЂРіР°РЅРёР·Р°С†РёРё</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.inn})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="button" type="submit">
              РЎРѕР·РґР°С‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
            </button>
          </form>

          <table>
            <thead>
              <tr>
                <th>РРјСЏ</th>
                <th>MAX ID</th>
                <th>Р РѕР»СЊ</th>
                <th>РћСЂРіР°РЅРёР·Р°С†РёСЏ</th>
                <th>РђРєС‚РёРІРµРЅ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.fullName}</td>
                  <td>{item.maxUserId}</td>
                  <td>{item.role}</td>
                  <td>{item.organizationName || "-"}</td>
                  <td>{item.isActive ? "Р”Р°" : "РќРµС‚"}</td>
                  <td>
                    <button className="button" type="button" onClick={() => toggleUser(item)}>
                      {item.isActive ? "Р”РµР°РєС‚РёРІРёСЂРѕРІР°С‚СЊ" : "РђРєС‚РёРІРёСЂРѕРІР°С‚СЊ"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "submissions" ? (
        <div>
          <table>
            <thead>
              <tr>
                <th>Р”Р°С‚Р°</th>
                <th>РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ</th>
                <th>РћСЂРіР°РЅРёР·Р°С†РёСЏ</th>
                <th>РЎС‡РµС‚С‡РёРє</th>
                <th>Р—РЅР°С‡РµРЅРёРµ</th>
                <th>РЎС‚Р°С‚СѓСЃ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {submissions.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>{item.user.fullName}</td>
                  <td>{item.organization.name}</td>
                  <td>{item.meterNumber}</td>
                  <td>{item.currentValue}</td>
                  <td>{item.status}</td>
                  <td>
                    <button className="button" type="button" onClick={() => loadHistory(item.id)}>
                      РСЃС‚РѕСЂРёСЏ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length ? (
            <div className="alert info">
              <strong>РСЃС‚РѕСЂРёСЏ СЃС‚Р°С‚СѓСЃРѕРІ</strong>
              {history.map((entry) => (
                <div key={entry.id}>
                  {new Date(entry.createdAt).toLocaleString()} {entry.oldStatus || "-"} в†’ {entry.newStatus}{" "}
                  {entry.changedBy ? `(${entry.changedBy.fullName})` : ""}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "logs" ? (
        <table>
          <thead>
            <tr>
              <th>Р”Р°С‚Р°</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString()}</td>
                <td>{log.action}</td>
                <td>
                  {log.entityType} {log.entityId || ""}
                </td>
                <td>{log.actor?.fullName || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export default function App() {
  const { loading, accessToken, user, maxUserId, error, errorCode } = useAuth();

  if (loading) {
    return <StatusScreen title="Р—Р°РіСЂСѓР·РєР°" description="Р’С‹РїРѕР»РЅСЏРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ С‡РµСЂРµР· MAX WebApp..." />;
  }

  if (!accessToken || !user) {
    if (errorCode === "USER_NOT_FOUND") {
      return (
        <StatusScreen
          title="Вы не в базе"
          description={`Вы не в базе, ваш MAX ID ${maxUserId || "не определен"}\u260E Связь с админом @HelpMetr
\uD83D\uDCDE  Связь с админом +79370332222`}
        />
      );
    }
    if (errorCode === "USER_INACTIVE") {
      return (
        <StatusScreen
          title="РђРєРєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ"
          description="Р”РѕСЃС‚СѓРї Рє miniapp РѕС‚РєР»СЋС‡РµРЅ. РћР±СЂР°С‚РёС‚РµСЃСЊ Рє Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ."
          code={errorCode}
        />
      );
    }
    return <StatusScreen title="РћС€РёР±РєР° Р°РІС‚РѕСЂРёР·Р°С†РёРё" description={error || "Р”РѕСЃС‚СѓРї Р·Р°РїСЂРµС‰РµРЅ"} code={errorCode} />;
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{user.fullName}</h2>
        <p>
          Р РѕР»СЊ: <b>{user.role}</b>
          {user.organizationName ? `, РѕСЂРіР°РЅРёР·Р°С†РёСЏ: ${user.organizationName}` : ""}
        </p>
        {user.role === "ADMIN" ? <AdminPanel accessToken={accessToken} /> : <UserPanel accessToken={accessToken} />}
      </div>
    </div>
  );
}


