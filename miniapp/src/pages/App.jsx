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
import { createDraftSubmission, getLatestPendingSubmission, listEquipmentTypes } from "../api/submissions";
import { useAuth } from "../hooks/useAuth";
import { closeWebApp } from "../lib/maxWebApp";

const submissionSchema = z.object({
  address: z.string().trim().min(3, "Введите адрес"),
  phone: z.string().trim().regex(/^\d{10}$/, "Введите ровно 10 цифр после +7"),
  waterType: z.enum(["HVS", "GVS"], { message: "Выберите тип воды" }),
  equipmentTypeId: z.string().trim().regex(/^\d+$/, "Выберите тип счетчика"),
  factoryNumber: z.string().trim().regex(/^\d+$/, "Введите заводской номер (только цифры)"),
  productionYear: z
    .string()
    .trim()
    .refine((value) => /^\d{4}$/.test(value) && Number(value) >= 1950 && Number(value) <= 2050, {
      message: "Год выпуска должен быть от 1950 до 2050"
    }),
  reading: z.string().trim().regex(/^\d+([.,]\d{1,3})?$/, "Введите корректное числовое показание")
});

function StatusScreen({ title, description, code }) {
  return (
    <div className="page">
      <div className="card">
        <h2>{title}</h2>
        <p style={{ whiteSpace: "pre-line" }}>{description}</p>
        {code ? <p>Код: {code}</p> : null}
      </div>
    </div>
  );
}

function parseKopecks(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  try {
    const parsed = BigInt(raw);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function formatRemainingPackages(balance, tarif, balanceKopecks, tariffKopecks) {
  const bKopecks = parseKopecks(balanceKopecks);
  const tKopecks = parseKopecks(tariffKopecks);
  if (bKopecks != null && tKopecks != null && tKopecks > 0n) {
    const value = Number(bKopecks) / Number(tKopecks);
    if (!Number.isFinite(value) || value < 0) {
      return "-";
    }
    return value.toFixed(1).replace(/\.0$/, "");
  }

  const b = Number(balance);
  const t = Number(tarif);
  if (!Number.isFinite(b) || !Number.isFinite(t) || t <= 0) {
    return "-";
  }
  const value = b / t;
  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }
  return value.toFixed(1).replace(/\.0$/, "");
}

function hasEnoughBalance(balance, tarif, balanceKopecks, tariffKopecks) {
  const bKopecks = parseKopecks(balanceKopecks);
  const tKopecks = parseKopecks(tariffKopecks);
  if (bKopecks != null && tKopecks != null && tKopecks > 0n) {
    return bKopecks >= tKopecks;
  }

  const b = Number(balance);
  const t = Number(tarif);
  if (!Number.isFinite(b) || !Number.isFinite(t) || t <= 0) {
    return false;
  }
  return b >= t;
}

function formatDateTimeMsk(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function UserPanel({ accessToken, canSubmitInitially }) {
  const [form, setForm] = useState({
    address: "",
    phone: "",
    waterType: "HVS",
    equipmentTypeId: "",
    factoryNumber: "",
    productionYear: "",
    reading: ""
  });
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTopupMessage, setActiveTopupMessage] = useState("");

  async function loadEquipment() {
    try {
      const data = await listEquipmentTypes(accessToken);
      setEquipmentTypes(data.equipmentTypes || []);
    } catch (err) {
      if (err.code === "ACTIVE_TOPUP_PENDING") {
        setActiveTopupMessage(err.message || "У вас есть активное пополнение.");
        return;
      }
      throw err;
    }
  }

  async function loadLatestPending() {
    try {
      const data = await getLatestPendingSubmission(accessToken);
      if (!data.submission) {
        return;
      }
      setForm({
        address: data.submission.address || "",
        phone: data.submission.phone || "",
        waterType: data.submission.waterType || "HVS",
        equipmentTypeId: data.submission.equipmentTypeId ? String(data.submission.equipmentTypeId) : "",
        factoryNumber: data.submission.factoryNumber || "",
        productionYear: data.submission.productionYear ? String(data.submission.productionYear) : "",
        reading: data.submission.reading || ""
      });
    } catch (err) {
      if (err.code === "ACTIVE_TOPUP_PENDING") {
        setActiveTopupMessage(err.message || "У вас есть активное пополнение.");
        return;
      }
      throw err;
    }
  }

  async function submitDraft(event) {
    event.preventDefault();
    setError("");
    setSavedNotice("");
    const parsed = submissionSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    try {
      setLoading(true);
      const payload = {
        ...parsed.data,
        equipmentTypeId: Number(parsed.data.equipmentTypeId)
      };
      await createDraftSubmission(payload, accessToken);
      setActiveTopupMessage("");
      setSavedNotice("Заявка отправлена в бот. Подтвердите ее с фото или отмените в сообщении.");
      setTimeout(() => closeWebApp(), 250);
    } catch (err) {
      if (err.code === "ACTIVE_TOPUP_PENDING") {
        setActiveTopupMessage(err.message || "У вас есть активное пополнение.");
      }
      setError(err.message || "Не удалось создать черновик");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function run() {
      try {
        await loadEquipment();
        await loadLatestPending();
      } catch (err) {
        setError(err.message || "Не удалось загрузить данные формы");
      }
    }

    void run();
  }, []);

  return (
    <div>
      <h3>Передача показаний</h3>
      {!canSubmitInitially ? (
        <div className="alert error">
          Недостаточно средств на балансе организации. Отправка не выполнена. Пополните баланс и попробуйте снова.
        </div>
      ) : null}
      {activeTopupMessage ? <div className="alert error">{activeTopupMessage}</div> : null}
      <form onSubmit={submitDraft}>
        <div className="field">
          <label htmlFor="address">Адрес</label>
          <input
            id="address"
            value={form.address}
            onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
            placeholder="Например: ул. Ленина, д. 10, кв. 15"
          />
        </div>
        <div className="field">
          <label htmlFor="phone">Телефон</label>
          <div className="phone-input">
            <span>+7</span>
            <input
              id="phone"
              inputMode="numeric"
              maxLength={10}
              value={form.phone}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: event.target.value.replace(/\D/g, "").slice(0, 10) }))
              }
              placeholder="9001234567"
            />
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor="waterType">Тип воды</label>
            <select
              id="waterType"
              value={form.waterType}
              onChange={(event) => setForm((prev) => ({ ...prev, waterType: event.target.value }))}
            >
              <option value="HVS">ХВС</option>
              <option value="GVS">ГВС</option>
            </select>
          </div>
          <div className="field" style={{ flex: "2 1 260px" }}>
            <label htmlFor="equipmentTypeId">Тип счетчика</label>
            <select
              id="equipmentTypeId"
              value={form.equipmentTypeId}
              onChange={(event) => setForm((prev) => ({ ...prev, equipmentTypeId: event.target.value }))}
            >
              <option value="">Выберите тип</option>
              {equipmentTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="factoryNumber">Заводской номер</label>
            <input
              id="factoryNumber"
              inputMode="numeric"
              value={form.factoryNumber}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, factoryNumber: event.target.value.replace(/\D/g, "") }))
              }
              placeholder="Только цифры"
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="productionYear">Год выпуска</label>
            <input
              id="productionYear"
              inputMode="numeric"
              value={form.productionYear}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, productionYear: event.target.value.replace(/\D/g, "").slice(0, 4) }))
              }
              placeholder="Например 2021"
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="reading">Показания</label>
            <input
              id="reading"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              value={form.reading}
              onChange={(event) => setForm((prev) => ({ ...prev, reading: event.target.value }))}
              placeholder="Например 88.5"
            />
          </div>
        </div>
        <button className="button" type="submit" disabled={loading || !canSubmitInitially || Boolean(activeTopupMessage)}>
          {loading ? "Сохранение..." : "Создать заявку"}
        </button>
      </form>

      {error ? <div className="alert error">{error}</div> : null}
      {savedNotice ? <div className="alert info">{savedNotice}</div> : null}
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
                <th>Адрес</th>
                <th>Тип воды</th>
                <th>Тип счетчика</th>
                <th>Заводской №</th>
                <th>Год</th>
                <th>Показания</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {submissions.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTimeMsk(item.createdAt)}</td>
                  <td>{item.user.fullName}</td>
                  <td>{item.organization.name}</td>
                  <td>{item.address || "-"}</td>
                  <td>{item.waterType === "GVS" ? "ГВС" : item.waterType === "HVS" ? "ХВС" : "-"}</td>
                  <td>{item.equipmentTypeName || "-"}</td>
                  <td>{item.factoryNumber || "-"}</td>
                  <td>{item.productionYear || "-"}</td>
                  <td>{item.reading}</td>
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
                  {formatDateTimeMsk(entry.createdAt)} {entry.oldStatus || "-"} → {entry.newStatus}{" "}
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
                <td>{formatDateTimeMsk(log.createdAt)}</td>
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
  const packagesCount = formatRemainingPackages(
    user?.organizationBalance,
    user?.organizationTarif,
    user?.organizationBalanceKopecks,
    user?.organizationTariffPerPackageKopecks
  );
  const canSubmitInitially = hasEnoughBalance(
    user?.organizationBalance,
    user?.organizationTarif,
    user?.organizationBalanceKopecks,
    user?.organizationTariffPerPackageKopecks
  );

  if (loading) {
    return <StatusScreen title="Загрузка" description="Выполняется авторизация через MAX WebApp..." />;
  }

  if (!accessToken || !user) {
    if (errorCode === "USER_NOT_FOUND" || errorCode === "INITDATA_MISSING") {
      return (
        <StatusScreen
          title="Вы не в базе"
          description={`Вы не в базе, ваш MAX ID ${maxUserId || "не определен"}
☎ Связь с админом @HelpMetr
📞  Связь с админом +79370332222`}
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
        <h2>{user.organizationName || "Организация не указана"}</h2>
        <p>Пакеты: {packagesCount}</p>
        <p>{user.fullName}</p>
        {user.role === "ADMIN" ? (
          <AdminPanel accessToken={accessToken} />
        ) : (
          <UserPanel accessToken={accessToken} canSubmitInitially={canSubmitInitially} />
        )}
      </div>
    </div>
  );
}
