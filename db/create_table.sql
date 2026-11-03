CREATE TABLE groups (
    group_id        SERIAL PRIMARY KEY,
    name            VARCHAR(30)  NOT NULL UNIQUE,
    admission_year  SMALLINT     NOT NULL,
    course          SMALLINT     NOT NULL,
    faculty         VARCHAR(100) NOT NULL,
    status          VARCHAR(15)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','graduated','archived')),
    updated_at      TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE TABLE semesters (
    semester_id    SERIAL PRIMARY KEY,
    academic_year  VARCHAR(9) NOT NULL,
    term_number    SMALLINT   NOT NULL,
    start_date     DATE       NOT NULL,
    end_date       DATE       NOT NULL,
    is_current     BOOLEAN    NOT NULL DEFAULT FALSE,
    UNIQUE (academic_year, term_number)
);

CREATE TABLE users (
    user_id          SERIAL PRIMARY KEY,
    full_name        VARCHAR(150) NOT NULL,
    email            VARCHAR(150) NOT NULL UNIQUE,
    password_hash    VARCHAR(255) NOT NULL,
    role             VARCHAR(20)  NOT NULL
                     CHECK (role IN ('student','teacher','curator','admin')),
    group_id         INTEGER REFERENCES groups(group_id),
    status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','academic_leave','graduated','expelled')),
    enrollment_year  SMALLINT,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    updated_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE disciplines (
    discipline_id    SERIAL PRIMARY KEY,
    name             VARCHAR(150) NOT NULL,
    credits          SMALLINT     NOT NULL,
    semester_number  SMALLINT     NOT NULL,
    is_elective      BOOLEAN      NOT NULL DEFAULT FALSE,
    status           VARCHAR(15)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','archived'))
);

CREATE TABLE teaching_assignments (
    assignment_id  SERIAL PRIMARY KEY,
    teacher_id     INTEGER NOT NULL REFERENCES users(user_id),
    discipline_id  INTEGER NOT NULL REFERENCES disciplines(discipline_id),
    group_id       INTEGER NOT NULL REFERENCES groups(group_id),
    semester_id    INTEGER NOT NULL REFERENCES semesters(semester_id),
    UNIQUE (teacher_id, discipline_id, group_id, semester_id)
);

CREATE TABLE lessons (
    lesson_id      SERIAL PRIMARY KEY,
    assignment_id  INTEGER NOT NULL REFERENCES teaching_assignments(assignment_id),
    lesson_date    DATE NOT NULL,
    lesson_type    VARCHAR(15) NOT NULL
                   CHECK (lesson_type IN ('лекція','практична','лабораторна','модуль','залік','іспит')),
    topic          VARCHAR(200)
);

CREATE TABLE grades (
    grade_id      SERIAL PRIMARY KEY,
    student_id    INTEGER NOT NULL REFERENCES users(user_id),
    lesson_id     INTEGER NOT NULL REFERENCES lessons(lesson_id),
    value         SMALLINT NOT NULL CHECK (value BETWEEN 0 AND 100),
    recorded_by   INTEGER NOT NULL REFERENCES users(user_id),
    given_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE grade_history (
    history_id   SERIAL PRIMARY KEY,
    grade_id     INTEGER NOT NULL REFERENCES grades(grade_id),
    old_value    SMALLINT NOT NULL,
    new_value    SMALLINT NOT NULL,
    changed_by   INTEGER NOT NULL REFERENCES users(user_id),
    changed_at   TIMESTAMP NOT NULL DEFAULT now(),
    reason       VARCHAR(255)
);

CREATE TABLE attendance (
    attendance_id  SERIAL PRIMARY KEY,
    student_id     INTEGER NOT NULL REFERENCES users(user_id),
    lesson_id      INTEGER NOT NULL REFERENCES lessons(lesson_id),
    status         VARCHAR(10) NOT NULL CHECK (status IN ('present','absent')),
    reason         VARCHAR(50)
);

CREATE TABLE debts (
    debt_id        SERIAL PRIMARY KEY,
    student_id     INTEGER NOT NULL REFERENCES users(user_id),
    discipline_id  INTEGER NOT NULL REFERENCES disciplines(discipline_id),
    semester_id    INTEGER NOT NULL REFERENCES semesters(semester_id),
    deadline       DATE NOT NULL,
    status         VARCHAR(10) NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','closed'))
);

CREATE TABLE elective_enrollments (
    enrollment_id  SERIAL PRIMARY KEY,
    student_id     INTEGER NOT NULL REFERENCES users(user_id),
    discipline_id  INTEGER NOT NULL REFERENCES disciplines(discipline_id),
    semester_id    INTEGER NOT NULL REFERENCES semesters(semester_id),
    status         VARCHAR(10) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
    enrolled_at    TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (student_id, discipline_id, semester_id)
);

CREATE TABLE notifications (
    notification_id  SERIAL PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(user_id),
    message          TEXT NOT NULL,
    is_read          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE group_promotions (
    promotion_id   SERIAL PRIMARY KEY,
    group_id       INTEGER NOT NULL REFERENCES groups(group_id),
    academic_year  VARCHAR(9)  NOT NULL,
    from_course    SMALLINT    NOT NULL,
    to_course      SMALLINT,
    new_status     VARCHAR(15) NOT NULL,
    old_name       VARCHAR(30) NOT NULL,
    new_name       VARCHAR(30) NOT NULL,
    promoted_by    INTEGER NOT NULL REFERENCES users(user_id),
    promoted_at    TIMESTAMP NOT NULL DEFAULT now()
);
