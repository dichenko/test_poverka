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
  meterNumber: z.string().trim().min(3, "Введите номер прибора"),
  currentValue: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,3})?$/, "Введите корректное числовое значение")
});

function StatusScreen({ title, description, code }) {
  return (
    <div className="page">
      <div className="card">
        <h2>{title}</h2>
        <p>{description}</p>
        {code ? <p>Код: {code}</p> : null}
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
      setError(err.message || "Не удалось создать черновик");
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
      setError(err.message || "Не удалось подтвердить заявку");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecent();
  }, []);

  return (
    <div>
      <h3>Передача показаний</h3>
      <form onSubmit={submitDraft}>
        <div className="field">
          <label htmlFor="meterNumber">Номер счетчика</label>
          <input
            id="meterNumber"
            value={form.meterNumber}
            onChange={(event) => setForm((prev) => ({ ...prev, meterNumber: event.target.value }))}
            placeholder="Например 123456"
          />
        </div>
        <div className="field">
          <label htmlFor="currentValue">Текущее значение</label>
          <input
            id="currentValue"
            value={form.currentValue}
            onChange={(event) => setForm((prev) => ({ ...prev, currentValue: event.target.value }))}
            placeholder="Например 88.5"
          />
        </div>
        <button className="button" type="submit" disabled={loading}>
          {loading ? "Сохранение..." : "Создать заявку"}
        </button>
      </form>

      {error ? <div className="alert error">{error}</div> : null}

      {pending ? (
        <div className="alert info">
          <p>Проверьте данные перед подтверждением:</p>
          <p>Счетчик: {pending.meterNumber}</p>
          <p>Показание: {pending.currentValue}</p>
          <button className="button secondary" type="button" onClick={confirmCurrent} disabled={loading}>
            Подтвердить данные
          </button>
        </div>
      ) : null}

      <h3>Мои последние заявки</h3>
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Счетчик</th>
            <th>Значение</th>
            <th>Статус</th>
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
              <td colSpan={4}>Заявок пока нет</td>
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
      setError(err.message || "Не удалось загрузить админ-данные");
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
      setError(err.message || "Не удалось создать пользователя");
    }
  }

  async function toggleUser(user) {
    try {
      await updateUser(user.id, { isActive: !user.isActive }, accessToken);
      await loadBaseData();
    } catch (err) {
      setError(err.message || "Не удалось изменить статус пользователя");
    }
  }

  async function loadHistory(submissionId) {
    try {
      const data = await getSubmissionHistory(submissionId, accessToken);
      setHistory(data.history || []);
    } catch (err) {
      setError(err.message || "Не удалось получить историю статусов");
    }
  }

  return (
    <div>
      <h3>Админ-панель</h3>
      {error ? <div className="alert error">{error}</div> : null}
      <div className="tabs">
        <button className={`tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")} type="button">
          Пользователи
        </button>
        <button
          className={`tab ${tab === "submissions" ? "active" : ""}`}
          onClick={() => setTab("submissions")}
          type="button"
        >
          Заявки
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
                <label>Имя</label>
                <input
                  value={userForm.firstName}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, firstName: event.target.value }))}
                />
              </div>
              <div className="field" style={{ flex: "1 1 180px" }}>
                <label>Фамилия</label>
                <input
                  value={userForm.lastName}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, lastName: event.target.value }))}
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: "1 1 150px" }}>
                <label>Роль</label>
                <select
                  value={userForm.role}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="field" style={{ flex: "2 1 240px" }}>
                <label>Организация</label>
                <select
                  value={userForm.organizationId}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, organizationId: event.target.value }))}
                >
                  <option value="">Без организации</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.inn})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="button" type="submit">
              Создать пользователя
            </button>
          </form>

          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>MAX ID</th>
                <th>Роль</th>
                <th>Организация</th>
                <th>Активен</th>
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
                  <td>{item.isActive ? "Да" : "Нет"}</td>
                  <td>
                    <button className="button" type="button" onClick={() => toggleUser(item)}>
                      {item.isActive ? "Деактивировать" : "Активировать"}
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
                <th>Дата</th>
                <th>Пользователь</th>
                <th>Организация</th>
                <th>Счетчик</th>
                <th>Значение</th>
                <th>Статус</th>
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
                      История
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length ? (
            <div className="alert info">
              <strong>История статусов</strong>
              {history.map((entry) => (
                <div key={entry.id}>
                  {new Date(entry.createdAt).toLocaleString()} {entry.oldStatus || "-"} → {entry.newStatus}{" "}
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
              <th>Дата</th>
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
  const { loading, accessToken, user, error, errorCode } = useAuth();

  if (loading) {
    return <StatusScreen title="Загрузка" description="Выполняется авторизация через MAX WebApp..." />;
  }

  if (!accessToken || !user) {
    if (errorCode === "USER_NOT_FOUND") {
      return (
        <StatusScreen
          title="Пользователь не найден"
          description="Ваш аккаунт не зарегистрирован. Обратитесь к администратору."
          code={errorCode}
        />
      );
    }
    if (errorCode === "USER_INACTIVE") {
      return (
        <StatusScreen
          title="Аккаунт заблокирован"
          description="Доступ к miniapp отключен. Обратитесь к администратору."
          code={errorCode}
        />
      );
    }
    return <StatusScreen title="Ошибка авторизации" description={error || "Доступ запрещен"} code={errorCode} />;
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{user.fullName}</h2>
        <p>
          Роль: <b>{user.role}</b>
          {user.organizationName ? `, организация: ${user.organizationName}` : ""}
        </p>
        {user.role === "ADMIN" ? <AdminPanel accessToken={accessToken} /> : <UserPanel accessToken={accessToken} />}
      </div>
    </div>
  );
}
