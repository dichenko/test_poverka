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

const OTHER_EQUIPMENT_TYPE_VALUE = "other";

const submissionSchema = z
  .object({
    address: z.string().trim().min(3, "Введите корректный адрес"),
    phone: z.string().trim().regex(/^\d{10}$/, "Введите телефон из 10 цифр без +7"),
    waterType: z.enum(["HVS", "GVS"], { message: "Выберите тип воды" }),
    equipmentTypeId: z.string().trim().min(1, "Выберите тип счетчика"),
    customEquipmentTypeName: z.string().trim().max(120, "Слишком длинный тип счетчика").optional(),
    factoryNumber: z.string().trim().regex(/^[0-9A-Za-zА-Яа-яЁё]+$/u, "Введите заводской номер (буквы и цифры)"),
    productionYear: z
      .string()
      .trim()
      .refine((value) => /^\d{4}$/.test(value) && Number(value) >= 1950 && Number(value) <= 2050, {
        message: "Год выпуска должен быть в диапазоне 1950-2050"
      }),
    reading: z.string().trim().regex(/^\d+([.,]\d{1,3})?$/, "Показания должны быть числом")
  })
  .superRefine((value, ctx) => {
    const customType = value.customEquipmentTypeName?.trim() ?? "";

    if (value.equipmentTypeId === OTHER_EQUIPMENT_TYPE_VALUE) {
      if (!customType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customEquipmentTypeName"],
          message: "Введите тип счетчика"
        });
      }
      return;
    }

    if (!/^\d+$/.test(value.equipmentTypeId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["equipmentTypeId"],
        message: "Выберите тип счетчика"
      });
    }

    if (customType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customEquipmentTypeName"],
        message: "Поле другого типа доступно только для варианта \"Другая\""
      });
    }
  });

function StatusScreen({ title, description, code }) {
  return (
    <div className="page">
      <div className="card">
        <h2>{title}</h2>
        <p style={{ whiteSpace: "pre-line" }}>{description}</p>
        {code ? <p>Р В РЎв„ўР В РЎвЂўР В РўвЂ: {code}</p> : null}
      </div>
    </div>
  );
}

function formatRemainingPackages(balance, tarif) {
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

function hasEnoughBalance(balance, tarif) {
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
    customEquipmentTypeName: "",
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
        setActiveTopupMessage(err.message || "Р В Р в‚¬ Р В Р вЂ Р В Р’В°Р РЋР С“ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В Р вЂ¦Р В РЎвЂўР В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ.");
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
        equipmentTypeId: data.submission.equipmentTypeId
          ? String(data.submission.equipmentTypeId)
          : data.submission.customEquipmentTypeName
            ? OTHER_EQUIPMENT_TYPE_VALUE
            : "",
        customEquipmentTypeName: data.submission.customEquipmentTypeName || "",
        factoryNumber: data.submission.factoryNumber || "",
        productionYear: data.submission.productionYear ? String(data.submission.productionYear) : "",
        reading: data.submission.reading || ""
      });
    } catch (err) {
      if (err.code === "ACTIVE_TOPUP_PENDING") {
        setActiveTopupMessage(err.message || "Р В Р в‚¬ Р В Р вЂ Р В Р’В°Р РЋР С“ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В Р вЂ¦Р В РЎвЂўР В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ.");
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
      const isCustomEquipmentType = parsed.data.equipmentTypeId === OTHER_EQUIPMENT_TYPE_VALUE;
      const payload = {
        ...parsed.data,
        equipmentTypeId: isCustomEquipmentType ? null : Number(parsed.data.equipmentTypeId),
        customEquipmentTypeName: isCustomEquipmentType ? parsed.data.customEquipmentTypeName?.trim() || null : null
      };
      await createDraftSubmission(payload, accessToken);
      setActiveTopupMessage("");
      setSavedNotice("Р В РІР‚вЂќР В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂќР В Р’В° Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р вЂ  Р В Р’В±Р В РЎвЂўР РЋРІР‚С™. Р В РЎСџР В РЎвЂўР В РўвЂР РЋРІР‚С™Р В Р вЂ Р В Р’ВµР РЋР вЂљР В РўвЂР В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р’ВµР В Р’Вµ Р РЋР С“ Р РЋРІР‚С›Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂў Р В РЎвЂР В Р’В»Р В РЎвЂ Р В РЎвЂўР РЋРІР‚С™Р В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р вЂ  Р РЋР С“Р В РЎвЂўР В РЎвЂўР В Р’В±Р РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РЎвЂ.");
      setTimeout(() => closeWebApp(), 250);
    } catch (err) {
      if (err.code === "ACTIVE_TOPUP_PENDING") {
        setActiveTopupMessage(err.message || "Р В Р в‚¬ Р В Р вЂ Р В Р’В°Р РЋР С“ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В Р вЂ¦Р В РЎвЂўР В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ.");
      }
      setError(err.message || "Р В РЎСљР В Р’Вµ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂўР РЋР С“Р РЋР Р‰ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В РЎвЂР В РЎвЂќ");
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
        setError(err.message || "Р В РЎСљР В Р’Вµ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂўР РЋР С“Р РЋР Р‰ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР РЋРІР‚в„–");
      }
    }

    void run();
  }, []);

  return (
    <div>
      <h3>Р В РЎСџР В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В Р’В°Р РЋРІР‚РЋР В Р’В° Р В РЎвЂ”Р В РЎвЂўР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В РІвЂћвЂ“</h3>
      {!canSubmitInitially ? (
        <div className="alert error">
          Р В РЎСљР В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂў Р РЋР С“Р РЋР вЂљР В Р’ВµР В РўвЂР РЋР С“Р РЋРІР‚С™Р В Р вЂ  Р В Р вЂ¦Р В Р’В° Р В Р’В±Р В Р’В°Р В Р’В»Р В Р’В°Р В Р вЂ¦Р РЋР С“Р В Р’Вµ Р В РЎвЂўР РЋР вЂљР В РЎвЂ“Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ. Р В РЎвЂєР РЋРІР‚С™Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎвЂќР В Р’В° Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В Р’В°. Р В РЎСџР В РЎвЂўР В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р’В±Р В Р’В°Р В Р’В»Р В Р’В°Р В Р вЂ¦Р РЋР С“ Р В РЎвЂ Р В РЎвЂ”Р В РЎвЂўР В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р’В±Р РЋРЎвЂњР В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’Вµ Р РЋР С“Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В°.
        </div>
      ) : null}
      {activeTopupMessage ? <div className="alert error">{activeTopupMessage}</div> : null}
      <form onSubmit={submitDraft}>
        <div className="field">
          <label htmlFor="address">Р В РЎвЂ™Р В РўвЂР РЋР вЂљР В Р’ВµР РЋР С“</label>
          <input
            id="address"
            value={form.address}
            onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
            placeholder="Р В РЎСљР В Р’В°Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В РЎВР В Р’ВµР РЋР вЂљ: Р РЋРЎвЂњР В Р’В». Р В РІР‚С”Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р вЂ¦Р В Р’В°, Р В РўвЂ. 10, Р В РЎвЂќР В Р вЂ . 15"
          />
        </div>
        <div className="field">
          <label htmlFor="phone">Р В РЎС›Р В Р’ВµР В Р’В»Р В Р’ВµР РЋРІР‚С›Р В РЎвЂўР В Р вЂ¦</label>
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
            <label htmlFor="waterType">Р В РЎС›Р В РЎвЂР В РЎвЂ” Р В Р вЂ Р В РЎвЂўР В РўвЂР РЋРІР‚в„–</label>
            <select
              id="waterType"
              value={form.waterType}
              onChange={(event) => setForm((prev) => ({ ...prev, waterType: event.target.value }))}
            >
              <option value="HVS">Р В РўС’Р В РІР‚в„ўР В Р Р‹</option>
              <option value="GVS">Р В РІР‚СљР В РІР‚в„ўР В Р Р‹</option>
            </select>
          </div>
          <div className="field" style={{ flex: "2 1 260px" }}>
            <label htmlFor="equipmentTypeId">Р В РЎС›Р В РЎвЂР В РЎвЂ” Р РЋР С“Р РЋРІР‚РЋР В Р’ВµР РЋРІР‚С™Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќР В Р’В°</label>
            <select
              id="equipmentTypeId"
              value={form.equipmentTypeId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  equipmentTypeId: event.target.value,
                  customEquipmentTypeName:
                    event.target.value === OTHER_EQUIPMENT_TYPE_VALUE ? prev.customEquipmentTypeName : ""
                }))
              }
            >
              <option value="">Р В РІР‚в„ўР РЋРІР‚в„–Р В Р’В±Р В Р’ВµР РЋР вЂљР В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р РЋРІР‚С™Р В РЎвЂР В РЎвЂ”</option>
              {equipmentTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              <option value={OTHER_EQUIPMENT_TYPE_VALUE}>Другая</option>
            </select>
          </div>
        </div>
        {form.equipmentTypeId === OTHER_EQUIPMENT_TYPE_VALUE ? (
          <div className="field">
            <label htmlFor="customEquipmentTypeName">Укажите тип счетчика</label>
            <input
              id="customEquipmentTypeName"
              value={form.customEquipmentTypeName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, customEquipmentTypeName: event.target.value }))
              }
              placeholder="Введите тип счетчика"
              maxLength={120}
            />
          </div>
        ) : null}
        <div className="row">
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="factoryNumber">Р В РІР‚вЂќР В Р’В°Р В Р вЂ Р В РЎвЂўР В РўвЂР РЋР С“Р В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“ Р В Р вЂ¦Р В РЎвЂўР В РЎВР В Р’ВµР РЋР вЂљ</label>
            <input
              id="factoryNumber"
              inputMode="text"
              value={form.factoryNumber}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, factoryNumber: event.target.value }))
              }
              placeholder="Р СњР В°Р С—РЎР‚Р С‘Р СР ВµРЎР‚ A123B45"
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="productionYear">Р В РІР‚СљР В РЎвЂўР В РўвЂ Р В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќР В Р’В°</label>
            <input
              id="productionYear"
              inputMode="numeric"
              value={form.productionYear}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, productionYear: event.target.value.replace(/\D/g, "").slice(0, 4) }))
              }
              placeholder="Р В РЎСљР В Р’В°Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В РЎВР В Р’ВµР РЋР вЂљ 2021"
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="reading">Р В РЎСџР В РЎвЂўР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР РЏ</label>
            <input
              id="reading"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              value={form.reading}
              onChange={(event) => setForm((prev) => ({ ...prev, reading: event.target.value }))}
              placeholder="Р В РЎСљР В Р’В°Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В РЎВР В Р’ВµР РЋР вЂљ 88.5"
            />
          </div>
        </div>
        <button className="button" type="submit" disabled={loading || !canSubmitInitially || Boolean(activeTopupMessage)}>
          {loading ? "Р В Р Р‹Р В РЎвЂўР РЋРІР‚В¦Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ..." : "Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В Р’В·Р В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂќР РЋРЎвЂњ"}
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
      setError(err.message || "Р В РЎСљР В Р’Вµ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂўР РЋР С“Р РЋР Р‰ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В Р’В°Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦-Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ");
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
      setError(err.message || "Р В РЎСљР В Р’Вµ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂўР РЋР С“Р РЋР Р‰ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР РЏ");
    }
  }

  async function toggleUser(user) {
    try {
      await updateUser(user.id, { isActive: !user.isActive }, accessToken);
      await loadBaseData();
    } catch (err) {
      setError(err.message || "Р В РЎСљР В Р’Вµ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂўР РЋР С“Р РЋР Р‰ Р В РЎвЂР В Р’В·Р В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР РЏ");
    }
  }

  async function loadHistory(submissionId) {
    try {
      const data = await getSubmissionHistory(submissionId, accessToken);
      setHistory(data.history || []);
    } catch (err) {
      setError(err.message || "Р В РЎСљР В Р’Вµ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂўР РЋР С“Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋРЎвЂњР РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂР РЋР вЂ№ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В РЎвЂўР В Р вЂ ");
    }
  }

  return (
    <div>
      <h3>Р В РЎвЂ™Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦-Р В РЎвЂ”Р В Р’В°Р В Р вЂ¦Р В Р’ВµР В Р’В»Р РЋР Р‰</h3>
      {error ? <div className="alert error">{error}</div> : null}
      <div className="tabs">
        <button className={`tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")} type="button">
          Р В РЎСџР В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р В РЎвЂ
        </button>
        <button
          className={`tab ${tab === "submissions" ? "active" : ""}`}
          onClick={() => setTab("submissions")}
          type="button"
        >
          Р В РІР‚вЂќР В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂќР В РЎвЂ
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
                <label>Р В Р’ВР В РЎВР РЋР РЏ</label>
                <input
                  value={userForm.firstName}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, firstName: event.target.value }))}
                />
              </div>
              <div className="field" style={{ flex: "1 1 180px" }}>
                <label>Р В Р’В¤Р В Р’В°Р В РЎВР В РЎвЂР В Р’В»Р В РЎвЂР РЋР РЏ</label>
                <input
                  value={userForm.lastName}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, lastName: event.target.value }))}
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: "1 1 150px" }}>
                <label>Р В Р’В Р В РЎвЂўР В Р’В»Р РЋР Р‰</label>
                <select
                  value={userForm.role}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="field" style={{ flex: "2 1 240px" }}>
                <label>Р В РЎвЂєР РЋР вЂљР В РЎвЂ“Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ</label>
                <select
                  value={userForm.organizationId}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, organizationId: event.target.value }))}
                >
                  <option value="">Р В РІР‚ВР В Р’ВµР В Р’В· Р В РЎвЂўР РЋР вЂљР В РЎвЂ“Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.inn})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="button" type="submit">
              Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР РЏ
            </button>
          </form>

          <table>
            <thead>
              <tr>
                <th>Р В Р’ВР В РЎВР РЋР РЏ</th>
                <th>MAX ID</th>
                <th>Р В Р’В Р В РЎвЂўР В Р’В»Р РЋР Р‰</th>
                <th>Р В РЎвЂєР РЋР вЂљР В РЎвЂ“Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ</th>
                <th>Р В РЎвЂ™Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В Р’ВµР В Р вЂ¦</th>
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
                  <td>{item.isActive ? "Р В РІР‚СњР В Р’В°" : "Р В РЎСљР В Р’ВµР РЋРІР‚С™"}</td>
                  <td>
                    <button className="button" type="button" onClick={() => toggleUser(item)}>
                      {item.isActive ? "Р В РІР‚СњР В Р’ВµР В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰" : "Р В РЎвЂ™Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР В Р вЂ Р В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰"}
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
                <th>Р В РІР‚СњР В Р’В°Р РЋРІР‚С™Р В Р’В°</th>
                <th>Р В РЎСџР В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰</th>
                <th>Р В РЎвЂєР РЋР вЂљР В РЎвЂ“Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ</th>
                <th>Р В РЎвЂ™Р В РўвЂР РЋР вЂљР В Р’ВµР РЋР С“</th>
                <th>Р В РЎС›Р В РЎвЂР В РЎвЂ” Р В Р вЂ Р В РЎвЂўР В РўвЂР РЋРІР‚в„–</th>
                <th>Р В РЎС›Р В РЎвЂР В РЎвЂ” Р РЋР С“Р РЋРІР‚РЋР В Р’ВµР РЋРІР‚С™Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќР В Р’В°</th>
                <th>Р В РІР‚вЂќР В Р’В°Р В Р вЂ Р В РЎвЂўР В РўвЂР РЋР С“Р В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“ Р Р†РІР‚С›РІР‚вЂњ</th>
                <th>Р В РІР‚СљР В РЎвЂўР В РўвЂ</th>
                <th>Р В РЎСџР В РЎвЂўР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР РЏ</th>
                <th>Р В Р Р‹Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“</th>
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
                  <td>{item.waterType === "GVS" ? "Р В РІР‚СљР В РІР‚в„ўР В Р Р‹" : item.waterType === "HVS" ? "Р В РўС’Р В РІР‚в„ўР В Р Р‹" : "-"}</td>
                  <td>{item.equipmentTypeName || "-"}</td>
                  <td>{item.factoryNumber || "-"}</td>
                  <td>{item.productionYear || "-"}</td>
                  <td>{item.reading}</td>
                  <td>{item.status}</td>
                  <td>
                    <button className="button" type="button" onClick={() => loadHistory(item.id)}>
                      Р В Р’ВР РЋР С“Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂР РЋР РЏ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length ? (
            <div className="alert info">
              <strong>Р В Р’ВР РЋР С“Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂР РЋР РЏ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В РЎвЂўР В Р вЂ </strong>
              {history.map((entry) => (
                <div key={entry.id}>
                  {formatDateTimeMsk(entry.createdAt)} {entry.oldStatus || "-"} Р Р†РІР‚В РІР‚в„ў {entry.newStatus}{" "}
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
              <th>Р В РІР‚СњР В Р’В°Р РЋРІР‚С™Р В Р’В°</th>
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
  const packagesCount = formatRemainingPackages(user?.organizationBalance, user?.organizationTarif);
  const canSubmitInitially = hasEnoughBalance(user?.organizationBalance, user?.organizationTarif);

  if (loading) {
    return <StatusScreen title="Р В РІР‚вЂќР В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’В°" description="Р В РІР‚в„ўР РЋРІР‚в„–Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р РЋР РЏР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В Р’В°Р В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В Р’В· MAX WebApp..." />;
  }

  if (!accessToken || !user) {
    if (errorCode === "USER_NOT_FOUND" || errorCode === "INITDATA_MISSING") {
      return (
        <StatusScreen
          title="Р В РІР‚в„ўР РЋРІР‚в„– Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ  Р В Р’В±Р В Р’В°Р В Р’В·Р В Р’Вµ"
          description={`Р В РІР‚в„ўР РЋРІР‚в„– Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ  Р В Р’В±Р В Р’В°Р В Р’В·Р В Р’Вµ, Р В Р вЂ Р В Р’В°Р РЋРІвЂљВ¬ MAX ID ${maxUserId || "Р В Р вЂ¦Р В Р’Вµ Р В РЎвЂўР В РЎвЂ”Р РЋР вЂљР В Р’ВµР В РўвЂР В Р’ВµР В Р’В»Р В Р’ВµР В Р вЂ¦"}
Р Р†Р’ВР вЂ№ Р В Р Р‹Р В Р вЂ Р РЋР РЏР В Р’В·Р РЋР Р‰ Р РЋР С“ Р В Р’В°Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦Р В РЎвЂўР В РЎВ @HelpMetr
РЎР‚РЎСџРІР‚СљРЎвЂє  Р В Р Р‹Р В Р вЂ Р РЋР РЏР В Р’В·Р РЋР Р‰ Р РЋР С“ Р В Р’В°Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦Р В РЎвЂўР В РЎВ +79370332222`}
        />
      );
    }
    if (errorCode === "USER_INACTIVE") {
      return (
        <StatusScreen
          title="Р В РЎвЂ™Р В РЎвЂќР В РЎвЂќР В Р’В°Р РЋРЎвЂњР В Р вЂ¦Р РЋРІР‚С™ Р В Р’В·Р В Р’В°Р В Р’В±Р В Р’В»Р В РЎвЂўР В РЎвЂќР В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦"
          description="Р В РІР‚СњР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋРЎвЂњР В РЎвЂ” Р В РЎвЂќ miniapp Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂќР В Р’В»Р РЋР вЂ№Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦. Р В РЎвЂєР В Р’В±Р РЋР вЂљР В Р’В°Р РЋРІР‚С™Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР РЋР С“Р РЋР Р‰ Р В РЎвЂќ Р В Р’В°Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР РЋРЎвЂњ."
          code={errorCode}
        />
      );
    }
    return <StatusScreen title="Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В Р’В°Р В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" description={error || "Р В РІР‚СњР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋРЎвЂњР В РЎвЂ” Р В Р’В·Р В Р’В°Р В РЎвЂ”Р РЋР вЂљР В Р’ВµР РЋРІР‚В°Р В Р’ВµР В Р вЂ¦"} code={errorCode} />;
  }

  return (
    <div className="page">
      <div className="card">
        <h2>{user.organizationName || "Р В РЎвЂєР РЋР вЂљР В РЎвЂ“Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В Р вЂ¦Р В Р’Вµ Р РЋРЎвЂњР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р В Р вЂ¦Р В Р’В°"}</h2>
        <p>Р В РЎСџР В Р’В°Р В РЎвЂќР В Р’ВµР РЋРІР‚С™Р РЋРІР‚в„–: {packagesCount}</p>
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
