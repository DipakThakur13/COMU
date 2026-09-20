from __future__ import annotations

import json
import sqlite3

from permits.domain.application import Application

SCHEMA = """
create table if not exists applications (
  reference text primary key,
  applicant text not null,
  address text not null,
  work_kind text not null,
  estimated_cost_pence integer not null,
  state text not null,
  submitted_at text not null,
  decided_at text,
  outcome text,
  note text not null default '',
  history text not null default '[]'
);
create table if not exists counters (name text primary key, value integer not null);
"""


class SqliteRepository:
    """The real store. Uses the standard library only; the DSN is a file path."""

    kind = "sqlite"

    def __init__(self, dsn: str) -> None:
        self._connection = sqlite3.connect(dsn, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.executescript(SCHEMA)
        self._connection.commit()

    def save(self, application: Application, actor: str) -> None:
        del actor
        self._connection.execute(
            """
            insert into applications
              (reference, applicant, address, work_kind, estimated_cost_pence, state,
               submitted_at, decided_at, outcome, note, history)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(reference) do update set
              state = excluded.state,
              decided_at = excluded.decided_at,
              outcome = excluded.outcome,
              note = excluded.note,
              history = excluded.history
            """,
            (
                application.reference,
                application.applicant,
                application.address,
                application.work_kind,
                application.estimated_cost_pence,
                application.state,
                application.submitted_at,
                application.decided_at,
                application.outcome,
                application.note,
                json.dumps(list(application.history)),
            ),
        )
        self._connection.commit()

    def get(self, reference: str) -> Application | None:
        row = self._connection.execute(
            "select * from applications where reference = ?", (reference,)
        ).fetchone()
        if row is None:
            return None
        return Application(
            reference=row["reference"],
            applicant=row["applicant"],
            address=row["address"],
            work_kind=row["work_kind"],
            estimated_cost_pence=row["estimated_cost_pence"],
            state=row["state"],
            submitted_at=row["submitted_at"],
            decided_at=row["decided_at"],
            outcome=row["outcome"],
            note=row["note"],
            history=tuple(json.loads(row["history"])),
        )

    def next_sequence(self) -> int:
        cursor = self._connection.execute(
            "insert into counters (name, value) values ('reference', 1) "
            "on conflict(name) do update set value = value + 1 returning value"
        )
        value = int(cursor.fetchone()[0])
        self._connection.commit()
        return value

    def all_references(self) -> list[str]:
        rows = self._connection.execute("select reference from applications order by reference")
        return [row[0] for row in rows]

    def trail_size(self) -> int:
        return 0
