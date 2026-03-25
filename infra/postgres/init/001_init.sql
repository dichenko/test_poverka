CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    max_user_id VARCHAR(64) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_submissions (
    id BIGSERIAL PRIMARY KEY,
    max_user_id VARCHAR(64) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    meter_number VARCHAR(100) NOT NULL,
    current_value VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'confirmed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_user_id
    ON form_submissions (max_user_id);

CREATE INDEX IF NOT EXISTS idx_form_submissions_user_status
    ON form_submissions (max_user_id, status, id DESC);

INSERT INTO employees (max_user_id, full_name, is_active)
VALUES
    ('1001', 'Иван Петров', TRUE),
    ('1002', 'Мария Сидорова', TRUE),
    ('1003', 'Тестовый Сотрудник', TRUE)
ON CONFLICT (max_user_id) DO NOTHING;
