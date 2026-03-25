import { useEffect, useState } from 'react';
import { getMiniappAccess, submitMiniappForm } from './api';

const pageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px'
};

const cardStyle = {
  width: '100%',
  maxWidth: '520px',
  background: '#ffffff',
  borderRadius: '16px',
  boxShadow: '0 12px 40px rgba(12, 35, 64, 0.12)',
  padding: '24px'
};

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: '10px',
  border: '1px solid #ccd3db',
  fontSize: '16px',
  boxSizing: 'border-box'
};

const labelStyle = {
  display: 'block',
  marginBottom: '8px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#243447'
};

const helperBoxStyle = {
  marginTop: '16px',
  padding: '12px 14px',
  borderRadius: '10px',
  background: '#f0f7ff',
  whiteSpace: 'pre-wrap',
  color: '#16324f'
};

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('user_id') || '';
  const token = params.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submitResult, setSubmitResult] = useState(null);
  const [form, setForm] = useState({
    full_name: '',
    meter_number: '',
    current_value: ''
  });

  useEffect(() => {
    let isMounted = true;

    async function loadAccess() {
      if (!userId || !token) {
        setAccessDenied(true);
        setErrorMessage('Не хватает параметров доступа.');
        setLoading(false);
        return;
      }

      try {
        const data = await getMiniappAccess(userId, token);

        if (!isMounted) {
          return;
        }

        setForm((prev) => ({
          ...prev,
          full_name: data.employee.full_name || ''
        }));
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAccessDenied(true);
        setErrorMessage(error.message || 'Доступ запрещен');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadAccess();

    return () => {
      isMounted = false;
    };
  }, [token, userId]);

  function updateField(fieldName, value) {
    setForm((prev) => ({
      ...prev,
      [fieldName]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage('');
    setSubmitResult(null);
    setLoading(true);

    try {
      const result = await submitMiniappForm({
        token,
        user_id: userId,
        full_name: form.full_name,
        meter_number: form.meter_number,
        current_value: form.current_value
      });

      setSubmitResult(result);
    } catch (error) {
      setErrorMessage(error.message || 'Не удалось отправить форму.');
    } finally {
      setLoading(false);
    }
  }

  if (loading && !accessDenied && !form.full_name) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0 }}>Загрузка...</h1>
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0 }}>Доступ запрещен</h1>
          {errorMessage ? <p style={{ marginBottom: 0 }}>{errorMessage}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0, marginBottom: '8px' }}>Форма поверки</h1>
        <p style={{ marginTop: 0, color: '#52606d' }}>
          Заполни данные и отправь черновик на подтверждение в MAX.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="full_name" style={labelStyle}>
              ФИО
            </label>
            <input
              id="full_name"
              style={inputStyle}
              value={form.full_name}
              onChange={(event) => updateField('full_name', event.target.value)}
              placeholder="Иван Петров"
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="meter_number" style={labelStyle}>
              Номер счетчика
            </label>
            <input
              id="meter_number"
              style={inputStyle}
              value={form.meter_number}
              onChange={(event) => updateField('meter_number', event.target.value)}
              placeholder="123456"
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label htmlFor="current_value" style={labelStyle}>
              Текущее показание
            </label>
            <input
              id="current_value"
              style={inputStyle}
              value={form.current_value}
              onChange={(event) => updateField('current_value', event.target.value)}
              placeholder="88.5"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              border: 0,
              borderRadius: '10px',
              background: '#1163ff',
              color: '#ffffff',
              fontSize: '16px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Отправка...' : 'Отправить'}
          </button>
        </form>

        {errorMessage ? (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 14px',
              borderRadius: '10px',
              background: '#fff1f1',
              color: '#8a1f1f'
            }}
          >
            {errorMessage}
          </div>
        ) : null}

        {submitResult ? (
          <div style={helperBoxStyle}>
            {submitResult.message_for_bot || JSON.stringify(submitResult, null, 2)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
